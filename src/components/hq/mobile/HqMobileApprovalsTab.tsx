// src/components/hq/mobile/HqMobileApprovalsTab.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { buildRecommendedApprovalLine } from "@/lib/hq/approvalLine";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import {
  APPROVAL_DOC_META,
  EXPENSE_CATEGORIES,
  getRankLevel,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqApprovalStatus,
  HqWorkflowDocMeta,
} from "@/lib/hq/types";

type FilterScope = "MY_TURN" | "MY_DRAFT" | "ALL";

interface Props {
  defaultOpenCreate?: boolean;
  onJumpToLeaveRequest?: () => void;
}

const STATUS_BADGE: Record<
  HqApprovalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "대기중",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  IN_PROGRESS: {
    label: "진행중",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  APPROVED: {
    label: "승인완료",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "반려",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
  CANCELLED: {
    label: "취소됨",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function getErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(
    2,
    "0"
  )}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function HqMobileApprovalsTab({
  defaultOpenCreate = false,
  onJumpToLeaveRequest,
}: Props) {
  const {
    me,
    members,
    companySettings,
    isHqAdmin,
    dismissApprovalAlert,
    refreshApprovalBadge,
    refreshMembers,
    refreshAttendanceState,
  } = useHqShell();

  const [docs, setDocs] = useState<HqApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterScope, setFilterScope] = useState<FilterScope>("MY_TURN");
  const [keyword, setKeyword] = useState("");
  const [didAutoPickScope, setDidAutoPickScope] = useState(false);

  // 상세 시트 상태
  const [selectedDoc, setSelectedDoc] = useState<HqApprovalDoc | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [threadInput, setThreadInput] = useState("");
  const [acting, setActing] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [localMeta, setLocalMeta] = useState<HqWorkflowDocMeta | null>(null);
  const [zoomReceiptUrl, setZoomReceiptUrl] = useState<string | null>(null);

  // 간편 기안 시트 상태
  const [createOpen, setCreateOpen] = useState<boolean>(defaultOpenCreate);
  const [draftType, setDraftType] = useState<HqApprovalDocType>("GENERAL");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftAmountStr, setDraftAmountStr] = useState("");
  const [draftDate, setDraftDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [draftCategory, setDraftCategory] = useState<string>(
    EXPENSE_CATEGORIES[0]
  );
  const [draftPayMethod, setDraftPayMethod] = useState<string>(
    PAYMENT_METHODS[0]
  );
  const [draftMerchant, setDraftMerchant] = useState("");
  const [draftCardLast4, setDraftCardLast4] = useState("");
  const [draftReceiptPath, setDraftReceiptPath] = useState<string | null>(null);
  const [draftUrgent, setDraftUrgent] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submittingDraft, setSubmittingDraft] = useState(false);

  useEffect(() => {
    dismissApprovalAlert();
  }, [dismissApprovalAlert]);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { docs: HqApprovalDoc[] };
      }>("/api/hq/approvals");
      const list = res.data?.docs || [];
      setDocs(list);

      if (!didAutoPickScope && me) {
        setDidAutoPickScope(true);
        const hasMyTurn = list.some((doc) => {
          if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") {
            return false;
          }
          const cur = doc.steps.find(
            (s) => Number(s.step_order) === Number(doc.current_step_order)
          );
          return cur && cur.approver_id === me.instructor_id;
        });
        if (!hasMyTurn) {
          setFilterScope("ALL");
        }
      }

      setSelectedDoc((prev) => {
        if (!prev) return null;
        return list.find((d) => d.approval_id === prev.approval_id) || prev;
      });
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [didAutoPickScope, me]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchDocs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDocs]);

  useEffect(() => {
    const sync = () => {
      void fetchDocs();
    };
    window.addEventListener("hq:approval-incoming", sync);
    window.addEventListener("hq:approval-updated", sync);
    return () => {
      window.removeEventListener("hq:approval-incoming", sync);
      window.removeEventListener("hq:approval-updated", sync);
    };
  }, [fetchDocs]);

  const isMyTurnDoc = useCallback(
    (doc: HqApprovalDoc) => {
      if (!me) return false;
      if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") {
        return false;
      }
      const cur = doc.steps.find(
        (s) => Number(s.step_order) === Number(doc.current_step_order)
      );
      return Boolean(cur && cur.approver_id === me.instructor_id);
    },
    [me]
  );

  const myTurnCount = useMemo(
    () => docs.filter(isMyTurnDoc).length,
    [docs, isMyTurnDoc]
  );

  const myDraftCount = useMemo(
    () =>
      me ? docs.filter((d) => d.drafter_id === me.instructor_id).length : 0,
    [docs, me]
  );

  const filteredDocs = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return docs
      .filter((doc) => {
        if (filterScope === "MY_TURN" && !isMyTurnDoc(doc)) return false;
        if (
          filterScope === "MY_DRAFT" &&
          (!me || doc.drafter_id !== me.instructor_id)
        ) {
          return false;
        }
        if (q) {
          const hay = [
            doc.doc_no,
            doc.title,
            doc.drafter_name,
            doc.drafter_dept,
            doc.content,
            doc.merchant_name || "",
            doc.workflow_meta?.form_title || "",
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (filterScope === "MY_TURN" && a.urgent !== b.urgent) {
          return Number(b.urgent) - Number(a.urgent);
        }
        return (
          new Date(b.submitted_at).getTime() -
          new Date(a.submitted_at).getTime()
        );
      });
  }, [docs, filterScope, isMyTurnDoc, keyword, me]);

  const numericDraftAmount = useMemo(
    () =>
      Math.max(0, Math.round(Number(draftAmountStr.replace(/[^0-9]/g, "") || 0))),
    [draftAmountStr]
  );

  const recommendedLine = useMemo(() => {
    if (!me) return null;
    return buildRecommendedApprovalLine({
      drafter: me,
      allMembers: members,
      docType: draftType,
      amount: numericDraftAmount,
      useAutoDelegation: true,
      orgNodes: companySettings?.extra_settings?.org_chart_nodes,
    });
  }, [
    companySettings?.extra_settings?.org_chart_nodes,
    draftType,
    me,
    members,
    numericDraftAmount,
  ]);

  const handleReceiptCapture = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_approval_receipts");
      setDraftReceiptPath(path);
    } catch (err: unknown) {
      alert(getErrMsg(err, "증빙 업로드 실패"));
    } finally {
      setUploadingReceipt(false);
    }
  };

  const resetDraftForm = () => {
    setDraftType("GENERAL");
    setDraftTitle("");
    setDraftContent("");
    setDraftAmountStr("");
    setDraftMerchant("");
    setDraftCardLast4("");
    setDraftReceiptPath(null);
    setDraftUrgent(false);
  };

  const handleSubmitDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) {
      alert("기안 제목을 입력해 주세요.");
      return;
    }
    if (
      (draftType === "EXPENSE" || draftType === "PURCHASE") &&
      numericDraftAmount <= 0
    ) {
      alert("금액을 올바르게 입력해 주세요.");
      return;
    }

    setSubmittingDraft(true);
    try {
      const stepsPayload = (recommendedLine?.steps || []).map((s) => ({
        step_order: s.step_order,
        step_role: s.step_role,
        approver_id: s.approver_id,
        approver_name: s.approver_name,
        approver_dept: s.approver_dept,
        approver_rank: s.approver_rank,
        approver_title: s.approver_title,
      }));

      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: draftType,
          title: draftTitle.trim(),
          content: draftContent.trim(),
          amount:
            draftType === "EXPENSE" || draftType === "PURCHASE"
              ? numericDraftAmount
              : 0,
          effective_date: draftDate,
          expense_category:
            draftType === "EXPENSE" || draftType === "PURCHASE"
              ? draftCategory
              : null,
          payment_method: draftType === "EXPENSE" ? draftPayMethod : null,
          merchant_name:
            draftType === "EXPENSE" || draftType === "PURCHASE"
              ? draftMerchant.trim() || draftTitle.trim()
              : null,
          card_last4:
            draftType === "EXPENSE" && draftCardLast4.trim()
              ? draftCardLast4.trim()
              : null,
          receipt_url: draftReceiptPath,
          urgent: draftUrgent,
          is_auto_delegated: Boolean(recommendedLine?.isAutoDelegated),
          instant_complete: Boolean(recommendedLine?.instantSelfApprove),
          steps: stepsPayload,
        },
      });

      resetDraftForm();
      setCreateOpen(false);
      setFilterScope("MY_DRAFT");
      await Promise.all([fetchDocs(), refreshApprovalBadge()]);
      window.dispatchEvent(new CustomEvent("hq:approval-updated"));
    } catch (err: unknown) {
      alert(getErrMsg(err, "결재 상신 중 오류가 발생했습니다."));
    } finally {
      setSubmittingDraft(false);
    }
  };

  const handleDecision = async (action: "APPROVE" | "REJECT" | "CANCEL") => {
    if (!selectedDoc) return;
    if (action === "REJECT" && !decisionNote.trim()) {
      alert("반려 시에는 반려 사유를 입력해 주세요.");
      return;
    }
    if (
      action === "CANCEL" &&
      !confirm("상신한 문서를 회수(취소)하시겠습니까?")
    ) {
      return;
    }

    setActing(true);
    try {
      await hqFetch("/api/hq/approvals", {
        method: "PATCH",
        body: {
          approval_id: selectedDoc.approval_id,
          action,
          comment: decisionNote.trim(),
        },
      });
      setDecisionNote("");
      setSelectedDoc(null);
      await Promise.all([
        fetchDocs(),
        refreshApprovalBadge(),
        refreshMembers(),
        refreshAttendanceState(),
      ]);
      window.dispatchEvent(new CustomEvent("hq:approval-updated"));
    } catch (err: unknown) {
      alert(getErrMsg(err, "결재 처리 실패"));
    } finally {
      setActing(false);
    }
  };

  const handlePostComment = async () => {
    if (!selectedDoc || !threadInput.trim()) return;
    setPostingComment(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { docMeta: HqWorkflowDocMeta };
      }>("/api/hq/workflows", {
        method: "POST",
        body: {
          action: "ADD_COMMENT",
          approval_id: selectedDoc.approval_id,
          content: threadInput.trim(),
        },
      });
      if (res.data?.docMeta) {
        setLocalMeta(res.data.docMeta);
      }
      setThreadInput("");
      await fetchDocs();
    } catch (err: unknown) {
      alert(getErrMsg(err, "코멘트 등록 실패"));
    } finally {
      setPostingComment(false);
    }
  };

  const activeWfMeta =
    selectedDoc &&
    localMeta &&
    localMeta.approval_id === selectedDoc.approval_id
      ? localMeta
      : selectedDoc?.workflow_meta || null;

  const canApproveSelected = useMemo(() => {
    if (!selectedDoc || !me) return false;
    if (
      selectedDoc.status !== "PENDING" &&
      selectedDoc.status !== "IN_PROGRESS"
    ) {
      return false;
    }
    const cur = selectedDoc.steps.find(
      (s) => Number(s.step_order) === Number(selectedDoc.current_step_order)
    );
    const assigned = Boolean(cur && cur.approver_id === me.instructor_id);
    const execOverride = getRankLevel(me.rank_code) >= 5 || isHqAdmin;
    return assigned || execOverride;
  }, [isHqAdmin, me, selectedDoc]);

  const canCancelSelected = Boolean(
    selectedDoc &&
      me &&
      selectedDoc.drafter_id === me.instructor_id &&
      selectedDoc.status === "PENDING"
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 상단 필터 칩 & 새 기안 버튼 */}
      <div className="bg-white border-b border-slate-200 px-4 pt-3 pb-3 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setFilterScope("MY_TURN")}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition-colors flex items-center gap-1 ${
                filterScope === "MY_TURN"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <span>🔔 내 차례</span>
              {myTurnCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px]">
                  {myTurnCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("MY_DRAFT")}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition-colors ${
                filterScope === "MY_DRAFT"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              📤 내 기안 ({myDraftCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("ALL")}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition-colors ${
                filterScope === "ALL"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              전체 ({docs.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-brand text-white text-xs font-extrabold shadow-xs shrink-0"
          >
            + 기안
          </button>
        </div>

        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="문서 제목, 기안자, 사용처 검색..."
          className="w-full rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {/* 문서 카드 피드 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {loading ? (
          <div className="py-16 text-center text-xs font-bold text-slate-400">
            결재 문서를 불러오는 중입니다...
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
            <div className="text-2xl">✨</div>
            <p className="text-xs font-extrabold text-slate-700">
              {filterScope === "MY_TURN"
                ? "현재 내 승인을 기다리는 결재 문서가 없습니다."
                : "조건에 해당하는 결재 문서가 없습니다."}
            </p>
            {filterScope === "MY_TURN" && docs.length > 0 && (
              <button
                type="button"
                onClick={() => setFilterScope("ALL")}
                className="text-xs font-bold text-brand underline"
              >
                전체 문서함 보기 ({docs.length}건)
              </button>
            )}
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const docMeta =
              APPROVAL_DOC_META[doc.doc_type] || APPROVAL_DOC_META.GENERAL;
            const st = STATUS_BADGE[doc.status] || STATUS_BADGE.PENDING;
            const myTurn = isMyTurnDoc(doc);
            const curStep = doc.steps.find(
              (s) => Number(s.step_order) === Number(doc.current_step_order)
            );
            const formTitle = doc.workflow_meta?.form_title || docMeta.shortLabel;
            const formIcon = doc.workflow_meta?.form_icon || docMeta.icon;

            return (
              <button
                key={doc.approval_id}
                type="button"
                onClick={() => {
                  setDecisionNote("");
                  setLocalMeta(null);
                  setSelectedDoc(doc);
                }}
                className={`w-full rounded-2xl bg-white p-4 border text-left shadow-xs transition-all active:scale-[0.99] space-y-2 ${
                  myTurn
                    ? "border-rose-300 ring-1 ring-rose-100"
                    : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {doc.urgent && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold shrink-0">
                        긴급
                      </span>
                    )}
                    <span className="text-xs font-bold text-slate-500 truncate">
                      {formIcon} {formTitle}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold shrink-0 ${st.className}`}
                  >
                    {myTurn ? "🔔 내 결재 차례" : st.label}
                  </span>
                </div>

                <div className="text-[14px] font-extrabold text-slate-900 leading-snug line-clamp-2">
                  {doc.title}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                  <span>
                    {doc.drafter_name} ({doc.drafter_dept || "본부"}) ·{" "}
                    {formatShortDate(doc.submitted_at)}
                  </span>
                  {doc.amount > 0 ? (
                    <span className="font-extrabold text-slate-800">
                      {doc.amount.toLocaleString()}원
                    </span>
                  ) : doc.doc_type === "LEAVE" && doc.leave_days > 0 ? (
                    <span className="font-extrabold text-emerald-700">
                      {doc.leave_type || "휴가"} {doc.leave_days}일
                    </span>
                  ) : curStep &&
                    (doc.status === "PENDING" ||
                      doc.status === "IN_PROGRESS") ? (
                    <span className="text-slate-500 font-semibold">
                      현 단계: {curStep.approver_name}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ===================================================================== */}
      {/* 결재 상세 풀스크린 바텀 시트 */}
      {/* ===================================================================== */}
      {selectedDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-400">
                  {selectedDoc.doc_no}
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 truncate">
                  {activeWfMeta?.form_title ||
                    APPROVAL_DOC_META[selectedDoc.doc_type]?.label ||
                    "결재 문서"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedDoc.urgent && (
                    <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold">
                      긴급
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[11px] font-extrabold ${
                      STATUS_BADGE[selectedDoc.status]?.className || ""
                    }`}
                  >
                    {STATUS_BADGE[selectedDoc.status]?.label}
                  </span>
                </div>
                <h4 className="text-base font-extrabold text-slate-900 leading-snug">
                  {selectedDoc.title}
                </h4>
                <p className="text-xs text-slate-500">
                  기안: {selectedDoc.drafter_name}{" "}
                  {selectedDoc.drafter_title || ""} ({selectedDoc.drafter_dept}) ·{" "}
                  {formatShortDate(selectedDoc.submitted_at)}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
                {selectedDoc.doc_type === "LEAVE" && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">휴가 종류 · 일수</span>
                      <span className="font-extrabold text-emerald-700">
                        {selectedDoc.leave_type || "연차"} ({selectedDoc.leave_days}일)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">휴가 기간</span>
                      <span className="font-bold text-slate-800">
                        {selectedDoc.effective_date || "-"}
                        {selectedDoc.end_date &&
                        selectedDoc.end_date !== selectedDoc.effective_date
                          ? ` ~ ${selectedDoc.end_date}`
                          : ""}
                      </span>
                    </div>
                    {selectedDoc.handover_name && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">업무 대행자</span>
                        <span className="font-bold text-slate-800">
                          {selectedDoc.handover_name}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {selectedDoc.amount > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">품의 · 지출 금액</span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        {selectedDoc.amount.toLocaleString()}원
                      </span>
                    </div>
                    {selectedDoc.merchant_name && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">가맹점 · 거래처</span>
                        <span className="font-bold text-slate-800">
                          {selectedDoc.merchant_name}
                        </span>
                      </div>
                    )}
                    {selectedDoc.expense_category && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">비용 분류 / 결제</span>
                        <span className="font-bold text-slate-800">
                          {selectedDoc.expense_category}
                          {selectedDoc.payment_method
                            ? ` · ${selectedDoc.payment_method}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {activeWfMeta?.field_values &&
                  Object.keys(activeWfMeta.field_values).length > 0 && (
                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      {Object.entries(activeWfMeta.field_values).map(
                        ([k, val]) => {
                          const label = activeWfMeta.field_labels?.[k] || k;
                          const textVal = Array.isArray(val)
                            ? val.join(", ")
                            : String(val ?? "");
                          if (!textVal) return null;
                          return (
                            <div
                              key={k}
                              className="flex justify-between gap-3"
                            >
                              <span className="text-slate-500 shrink-0">
                                {label}
                              </span>
                              <span className="font-bold text-slate-800 text-right">
                                {textVal}
                              </span>
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}

                {selectedDoc.content && (
                  <div className="pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-bold text-slate-400 mb-1">
                      상세 사유 · 본문
                    </div>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {selectedDoc.content}
                    </p>
                  </div>
                )}

                {selectedDoc.receipt_url && (
                  <div className="pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-bold text-slate-400 mb-1.5">
                      첨부 영수증 · 증빙
                    </div>
                    {(() => {
                      const pubUrl = resolveStoragePublicUrl(
                        selectedDoc.receipt_url
                      );
                      if (!pubUrl) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => setZoomReceiptUrl(pubUrl)}
                          className="block w-full rounded-xl overflow-hidden border border-slate-200 bg-white"
                        >
                          <img
                            src={pubUrl}
                            alt="증빙"
                            className="w-full max-h-48 object-contain bg-slate-100"
                          />
                          <div className="py-1.5 text-center text-[11px] font-bold text-brand">
                            🔍 터치하여 원본 확대 보기
                          </div>
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* 결재선 단계 */}
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold text-slate-800">
                  결재 진행 단계 ({selectedDoc.current_step_order}/
                  {selectedDoc.total_steps})
                </h5>
                <div className="space-y-1.5">
                  {selectedDoc.steps.map((s) => {
                    const stepBadge =
                      s.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-700"
                        : s.status === "REJECTED"
                          ? "bg-rose-100 text-rose-700"
                          : s.status === "CURRENT"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-500";
                    const stepText =
                      s.status === "APPROVED"
                        ? "승인"
                        : s.status === "REJECTED"
                          ? "반려"
                          : s.status === "CURRENT"
                            ? "현재 차례"
                            : s.status === "SKIPPED"
                              ? "건너뜀"
                              : "대기";
                    return (
                      <div
                        key={s.step_id || s.step_order}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">
                            {s.step_order}단계 · {s.approver_name}{" "}
                            <span className="text-slate-400 font-semibold">
                              {s.approver_title || ""}
                            </span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${stepBadge}`}
                          >
                            {stepText}
                          </span>
                        </div>
                        {s.comment && (
                          <p className="text-[11px] text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                            💬 {s.comment}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 의견 · 코멘트 스레드 */}
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold text-slate-800">
                  의견 · 댓글 ({activeWfMeta?.comments?.length || 0})
                </h5>
                {activeWfMeta?.comments && activeWfMeta.comments.length > 0 && (
                  <div className="space-y-1.5">
                    {activeWfMeta.comments.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-800">
                            {c.author_name} ({c.author_dept})
                          </span>
                          <span>{formatShortDate(c.created_at)}</span>
                        </div>
                        <p className="mt-1 text-slate-700 whitespace-pre-wrap">
                          {c.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={threadInput}
                    onChange={(e) => setThreadInput(e.target.value)}
                    placeholder="문서에 의견이나 질문 남기기..."
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    disabled={postingComment || !threadInput.trim()}
                    onClick={handlePostComment}
                    className="px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 shrink-0"
                  >
                    등록
                  </button>
                </div>
              </div>
            </div>

            {/* 하단 결재 처리 액션 바 */}
            {(canApproveSelected || canCancelSelected) && (
              <div className="border-t border-slate-200 bg-white p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] space-y-2 shrink-0">
                {canApproveSelected && (
                  <>
                    <input
                      type="text"
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="결재 의견 (반려 시 반려 사유 필수)"
                      className="w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => handleDecision("REJECT")}
                        className="py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-extrabold text-xs disabled:opacity-50"
                      >
                        반려하기
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => handleDecision("APPROVE")}
                        className="py-3 rounded-xl bg-emerald-600 text-white font-extrabold text-xs shadow-sm disabled:opacity-50"
                      >
                        {acting ? "처리 중..." : "✓ 승인하기"}
                      </button>
                    </div>
                  </>
                )}

                {canCancelSelected && !canApproveSelected && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => handleDecision("CANCEL")}
                    className="w-full py-3 rounded-xl bg-slate-100 text-slate-700 font-extrabold text-xs"
                  >
                    상신 회수 (문서 취소)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 모바일 간편 기안 바텀 시트 */}
      {/* ===================================================================== */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <form
            onSubmit={handleSubmitDraft}
            className="bg-white rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-extrabold text-slate-900">
                ✍️ 모바일 간편 결재 기안
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { type: "GENERAL", label: "📄 일반 기안서" },
                    { type: "EXPENSE", label: "💳 지출결의서" },
                    { type: "PURCHASE", label: "🛒 구매·인쇄품의" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setDraftType(opt.type)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-extrabold text-left ${
                      draftType === opt.type
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {onJumpToLeaveRequest && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateOpen(false);
                      onJumpToLeaveRequest();
                    }}
                    className="py-2.5 px-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-extrabold text-left"
                  >
                    🌴 휴가 신청하기 →
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  제목 *
                </label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder={
                    draftType === "EXPENSE"
                      ? "예: 파주 인쇄감리 출장 식대 정산"
                      : draftType === "PURCHASE"
                        ? "예: 초등 사고력 2쇄 용지 발주 품의"
                        : "기안 제목을 입력해 주세요"
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-brand"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    기준일(시행/지출일)
                  </label>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                  />
                </div>
                <div className="flex items-end">
                  <label className="w-full rounded-xl border border-slate-200 px-3 py-2 flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer">
                    <span>🚨 긴급 결재</span>
                    <input
                      type="checkbox"
                      checked={draftUrgent}
                      onChange={(e) => setDraftUrgent(e.target.checked)}
                      className="w-4 h-4 accent-rose-600"
                    />
                  </label>
                </div>
              </div>

              {(draftType === "EXPENSE" || draftType === "PURCHASE") && (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        금액(원) *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draftAmountStr}
                        onChange={(e) =>
                          setDraftAmountStr(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        거래처 · 가맹점
                      </label>
                      <input
                        type="text"
                        value={draftMerchant}
                        onChange={(e) => setDraftMerchant(e.target.value)}
                        placeholder="상호명"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        비용 분류
                      </label>
                      <select
                        value={draftCategory}
                        onChange={(e) => setDraftCategory(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold outline-none"
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    {draftType === "EXPENSE" && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600">
                          결제 수단
                        </label>
                        <select
                          value={draftPayMethod}
                          onChange={(e) => setDraftPayMethod(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold outline-none"
                        >
                          {PAYMENT_METHODS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {draftType === "EXPENSE" &&
                    draftPayMethod.includes("카드") && (
                      <input
                        type="text"
                        maxLength={4}
                        inputMode="numeric"
                        value={draftCardLast4}
                        onChange={(e) =>
                          setDraftCardLast4(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        placeholder="카드 끝 4자리 (선택)"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none"
                      />
                    )}

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 block">
                      영수증 · 견적서 촬영 첨부
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="py-2 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 text-center cursor-pointer">
                        📷 카메라 촬영
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleReceiptCapture}
                          className="hidden"
                        />
                      </label>
                      <label className="py-2 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 text-center cursor-pointer">
                        🖼️ 앨범·파일 선택
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleReceiptCapture}
                          className="hidden"
                        />
                      </label>
                    </div>
                    {uploadingReceipt && (
                      <p className="text-[11px] font-bold text-brand">
                        증빙 이미지를 업로드하는 중입니다...
                      </p>
                    )}
                    {draftReceiptPath && !uploadingReceipt && (
                      <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800">
                        <span>✓ 증빙 첨부 완료</span>
                        <button
                          type="button"
                          onClick={() => setDraftReceiptPath(null)}
                          className="text-rose-600 underline"
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  상세 내용 · 사유
                </label>
                <textarea
                  rows={3}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="기안 배경 및 주요 내용을 입력해 주세요."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-medium outline-none focus:border-brand resize-none"
                />
              </div>

              {recommendedLine && (
                <div className="rounded-2xl bg-blue-50/70 border border-blue-200 p-3 space-y-1.5">
                  <div className="text-[11px] font-extrabold text-blue-900">
                    자동 지정 결재선
                  </div>
                  <div className="text-[11px] text-blue-700">
                    {recommendedLine.delegationReason}
                  </div>
                  {recommendedLine.steps.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {recommendedLine.steps.map((s, idx) => (
                        <React.Fragment key={s.approver_id}>
                          {idx > 0 && (
                            <span className="text-xs text-blue-400">→</span>
                          )}
                          <span className="px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-[11px] font-bold text-slate-800">
                            {s.approver_name} {s.approver_title}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shrink-0">
              <button
                type="submit"
                disabled={submittingDraft || uploadingReceipt}
                className="w-full py-3.5 rounded-xl bg-brand text-white font-extrabold text-sm shadow-md disabled:opacity-50"
              >
                {submittingDraft ? "상신 중..." : "결재 상신하기"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 증빙 원본 확대 모달 */}
      {zoomReceiptUrl && (
        <div
          onClick={() => setZoomReceiptUrl(null)}
          className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center p-4"
        >
          <img
            src={zoomReceiptUrl}
            alt="영수증 원본"
            className="max-w-full max-h-[82dvh] object-contain rounded-xl"
          />
          <button
            type="button"
            className="mt-4 px-5 py-2 rounded-full bg-white text-slate-900 text-xs font-extrabold"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
