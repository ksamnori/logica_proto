// src/components/hq/approvals/ApprovalDetailModal.tsx
"use client";

import React, { useState } from "react";
import { APPROVAL_DOC_META, getRankLevel } from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import type { HqApprovalDoc, HqApprovalStatus, HqMember } from "@/lib/hq/types";

interface Props {
  doc: HqApprovalDoc | null;
  me: HqMember | null;
  isHqAdmin: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_BADGE: Record<
  HqApprovalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "결재 대기",
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
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

export default function ApprovalDetailModal({
  doc,
  me,
  isHqAdmin,
  onClose,
  onUpdated,
}: Props) {
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  if (!doc) return null;

  const meta = APPROVAL_DOC_META[doc.doc_type] || APPROVAL_DOC_META.GENERAL;
  const stBadge = STATUS_BADGE[doc.status] || STATUS_BADGE.PENDING;
  const receiptPublicUrl = resolveStoragePublicUrl(doc.receipt_url);

  const currentStep = doc.steps.find(
    (s) => Number(s.step_order) === Number(doc.current_step_order)
  );
  const myLevel = getRankLevel(me?.rank_code);

  const isPendingOrProgress =
    doc.status === "PENDING" || doc.status === "IN_PROGRESS";
  const isAssignedToMe = Boolean(
    me && currentStep && currentStep.approver_id === me.instructor_id
  );
  const canExecutiveAct = Boolean(me && (myLevel >= 5 || isHqAdmin));
  const canApproveNow = isPendingOrProgress && (isAssignedToMe || canExecutiveAct);
  const canDelegatedFinal =
    canApproveNow &&
    myLevel >= 3 &&
    Number(doc.current_step_order) < Number(doc.total_steps);
  const canCancel = Boolean(
    me && doc.drafter_id === me.instructor_id && doc.status === "PENDING"
  );

  const runAction = async (
    action: "APPROVE" | "FINAL_APPROVE" | "REJECT" | "CANCEL"
  ) => {
    if (action === "REJECT" && !comment.trim()) {
      alert("반려 시에는 하단 결재 의견란에 반려 사유를 반드시 입력해주세요.");
      return;
    }
    if (
      action === "CANCEL" &&
      !confirm("기안한 결재 문서를 상신 회수하시겠습니까?")
    ) {
      return;
    }
    if (
      action === "FINAL_APPROVE" &&
      !confirm(
        "상위 결재 단계를 생략하고 현재 직급 권한으로 [전결 최종 승인] 처리하시겠습니까?"
      )
    ) {
      return;
    }

    setActing(true);
    try {
      await hqFetch("/api/hq/approvals", {
        method: "PATCH",
        body: {
          approval_id: doc.approval_id,
          action,
          comment: comment.trim(),
        },
      });
      window.dispatchEvent(new Event("hq:approval-updated"));
      setComment("");
      onUpdated();
      onClose();
    } catch (err: any) {
      alert(err?.message || "결재 처리 중 오류가 발생했습니다.");
    } finally {
      setActing(false);
    }
  };

  const formatDateShort = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:static print:bg-white print:p-0">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden print:shadow-none print:border-none print:max-h-none print:max-w-none">
        {/* 상단 바 */}
        <div className="print:hidden px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{meta.icon}</span>
            <span className="font-bold text-sm truncate">{meta.label}</span>
            <span className="text-xs text-slate-400 font-mono">{doc.doc_no}</span>
            {doc.urgent && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-extrabold">
                긴급
              </span>
            )}
            {doc.is_auto_delegated && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold">
                ⚡ 전결규정
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
            >
              🖨️ 인쇄
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white text-2xl leading-none font-bold ml-1"
            >
              &times;
            </button>
          </div>
        </div>

        {/* 문서 본문 */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6 custom-scroll text-[13px] text-slate-800">
          {/* 타이틀 + 우측 결재 도장란 */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full border text-xs font-extrabold ${stBadge.className}`}
                >
                  {stBadge.label}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {doc.doc_no}
                </span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 leading-snug">
                {doc.title}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                천종현수학연구소 본부 전자결재 시스템
              </p>
            </div>

            {/* 결재 도장 테이블 */}
            <div className="flex border border-slate-300 rounded-lg overflow-hidden shrink-0 self-start">
              {/* 기안자 칸 */}
              <div className="w-[74px] flex flex-col border-r border-slate-300 text-center">
                <div className="bg-slate-100 py-1 text-[10px] font-bold text-slate-600 border-b border-slate-300">
                  기 안
                </div>
                <div className="h-14 flex flex-col items-center justify-center px-1">
                  <span className="w-9 h-9 rounded-full border-2 border-blue-600 text-blue-700 flex items-center justify-center text-[10px] font-extrabold">
                    상신
                  </span>
                </div>
                <div className="border-t border-slate-200 py-1 text-[10px] font-bold text-slate-700 truncate px-1 bg-slate-50">
                  {doc.drafter_name}
                </div>
                <div className="text-[9px] text-slate-400 pb-1 bg-slate-50">
                  {formatDateShort(doc.submitted_at)}
                </div>
              </div>

              {/* 결재선 단계 칸들 */}
              {doc.steps.map((st) => {
                const isSelfApproved =
                  st.approver_id === doc.drafter_id && doc.steps.length === 1;
                if (isSelfApproved) return null;

                const headerLabel =
                  st.step_role === "DELEGATED_FINAL"
                    ? "전 결"
                    : st.step_order === doc.total_steps
                      ? "최 종"
                      : `${st.step_order} 차`;

                return (
                  <div
                    key={st.step_order}
                    className="w-[74px] flex flex-col border-r last:border-r-0 border-slate-300 text-center"
                  >
                    <div className="bg-slate-100 py-1 text-[10px] font-bold text-slate-600 border-b border-slate-300 truncate px-1">
                      {headerLabel}
                    </div>
                    <div className="h-14 flex items-center justify-center px-1">
                      {st.status === "APPROVED" ? (
                        <span className="w-10 h-10 rounded-full border-2 border-rose-600 text-rose-600 flex items-center justify-center text-[10px] font-extrabold rotate-[-6deg]">
                          {st.comment?.includes("전결") ||
                          st.step_role === "DELEGATED_FINAL"
                            ? "전결"
                            : "승인"}
                        </span>
                      ) : st.status === "REJECTED" ? (
                        <span className="w-10 h-10 rounded-full border-2 border-slate-700 text-slate-700 flex items-center justify-center text-[10px] font-extrabold">
                          반려
                        </span>
                      ) : st.status === "SKIPPED" ? (
                        <span className="text-[11px] font-bold text-slate-300 line-through">
                          전결생략
                        </span>
                      ) : st.status === "CURRENT" ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                          검토중
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300 font-semibold">
                          대기
                        </span>
                      )}
                    </div>
                    <div className="border-t border-slate-200 py-1 text-[10px] font-bold text-slate-700 truncate px-1 bg-slate-50">
                      {st.approver_name}
                    </div>
                    <div className="text-[9px] text-slate-400 pb-1 bg-slate-50">
                      {st.acted_at ? formatDateShort(st.acted_at) : st.approver_title}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 기안 기본 정보 표 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <div className="text-[11px] text-slate-400 font-bold">기안자 / 부서</div>
              <div className="font-bold text-slate-800 mt-0.5">
                {doc.drafter_name} {doc.drafter_title} ({doc.drafter_dept})
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-bold">상신 일시</div>
              <div className="font-semibold text-slate-700 mt-0.5">
                {formatDateTime(doc.submitted_at)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-bold">
                {doc.doc_type === "LEAVE"
                  ? "휴가 기간"
                  : doc.doc_type === "EXPENSE"
                    ? "지출 일자"
                    : "시행 · 기준일"}
              </div>
              <div className="font-semibold text-slate-700 mt-0.5">
                {doc.effective_date || "-"}
                {doc.doc_type === "LEAVE" &&
                  doc.end_date &&
                  doc.end_date !== doc.effective_date &&
                  ` ~ ${doc.end_date}`}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-bold">
                {doc.doc_type === "LEAVE" ? "신청 일수" : "결재 금액"}
              </div>
              <div className="font-extrabold text-brand mt-0.5">
                {doc.doc_type === "LEAVE"
                  ? `${doc.leave_days}일 (${doc.leave_type || "연차"})`
                  : doc.amount > 0
                    ? `${doc.amount.toLocaleString()}원`
                    : "-"}
              </div>
            </div>
          </div>

          {/* 양식별 세부 내역 블록 */}
          {doc.doc_type === "LEAVE" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-emerald-900">
                  🌴 휴가 상세: {doc.leave_type} · 총 {doc.leave_days}일
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  업무 대행자(인수인계):{" "}
                  <span className="font-bold text-slate-800">
                    {doc.handover_name || "미지정"}
                  </span>
                </div>
              </div>
              {doc.status === "APPROVED" && (
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  ✅ 구성원 연차 사용일수에 자동 반영됨
                </span>
              )}
            </div>
          )}

          {doc.doc_type === "PURCHASE" && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                <span>🛒 구매 · 발주 품목 명세</span>
                <span>공급처: {doc.merchant_name || "-"}</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">품목명</th>
                    <th className="px-4 py-2 text-right">수량</th>
                    <th className="px-4 py-2 text-right">단가</th>
                    <th className="px-4 py-2 text-right">금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(doc.items_json || []).map((it, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">
                        {it.name}
                      </td>
                      <td className="px-4 py-2.5 text-right">{it.qty}</td>
                      <td className="px-4 py-2.5 text-right">
                        {Number(it.unitPrice || 0).toLocaleString()}원
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                        {Number(it.amount || 0).toLocaleString()}원
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {doc.doc_type === "EXPENSE" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-amber-900">
                  💳 지출 내역: [{doc.expense_category || "기타"}]{" "}
                  {doc.merchant_name || "-"} · {doc.payment_method || "법인카드"}
                  {doc.card_last4 ? ` (${doc.card_last4})` : ""}
                </div>
                {doc.status === "APPROVED" && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold">
                    ✅ 비용·경비 정산 장부에 자동 등록됨
                  </span>
                )}
              </div>
              {receiptPublicUrl && (
                <div>
                  <a
                    href={receiptPublicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-bold text-blue-600 hover:underline"
                  >
                    📎 첨부된 영수증 · 증빙서류 열람
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 기안 본문 */}
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              상세 기안 내용
            </h4>
            <div className="min-h-[120px] p-4 rounded-xl border border-slate-200 bg-white whitespace-pre-wrap leading-relaxed text-slate-800 font-medium">
              {doc.content || "상세 기재 내용 없음"}
            </div>
          </div>

          {/* 결재선 진행 이력 및 코멘트 */}
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              결재 진행 이력 · 의견
            </h4>
            <div className="space-y-2">
              {doc.steps.map((st) => (
                <div
                  key={st.step_order}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {st.step_order}
                    </span>
                    <div>
                      <div className="font-bold text-slate-800 text-xs">
                        {st.approver_name} {st.approver_title}{" "}
                        <span className="text-slate-400 font-normal">
                          ({st.approver_dept})
                        </span>
                      </div>
                      {st.comment && (
                        <div className="text-xs text-slate-600 mt-0.5">
                          💬 {st.comment}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <span
                      className={`font-extrabold ${
                        st.status === "APPROVED"
                          ? "text-emerald-600"
                          : st.status === "REJECTED"
                            ? "text-rose-600"
                            : st.status === "CURRENT"
                              ? "text-amber-600"
                              : "text-slate-400"
                      }`}
                    >
                      {st.status === "APPROVED"
                        ? "승인 완료"
                        : st.status === "REJECTED"
                          ? "반려"
                          : st.status === "CURRENT"
                            ? "현재 결재 차례"
                            : st.status === "SKIPPED"
                              ? "전결 생략"
                              : "대기"}
                    </span>
                    {st.acted_at && (
                      <div className="text-[11px] text-slate-400">
                        {formatDateTime(st.acted_at)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 하단 결재 처리 액션 바 */}
        {(canApproveNow || canCancel) && (
          <div className="print:hidden px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-3 shrink-0">
            {canApproveNow && (
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="결재 의견 또는 반려 사유를 입력하세요 (반려 시 필수)"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-brand"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {canCancel && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => runAction("CANCEL")}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 text-xs font-bold"
                  >
                    상신 회수
                  </button>
                )}
              </div>

              {canApproveNow && (
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => runAction("REJECT")}
                    className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold"
                  >
                    ↩️ 반려
                  </button>

                  {canDelegatedFinal && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => runAction("FINAL_APPROVE")}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm"
                      title="상위 결재 단계를 생략하고 현재 직급 전결 권한으로 즉시 최종 승인합니다."
                    >
                      ⚡ 전결 최종승인
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => runAction("APPROVE")}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
                  >
                    ✅ 결재 승인
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
