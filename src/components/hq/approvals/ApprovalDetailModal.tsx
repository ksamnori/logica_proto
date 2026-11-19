// src/components/hq/approvals/ApprovalDetailModal.tsx
"use client";

import React, { useState } from "react";
import { APPROVAL_DOC_META, getRankLevel } from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import { useOptionalHqShell } from "@/components/hq/HqShellContext";
import {
  formatMinutesToKoreanAmPm,
  resolveBreakWindowsForSpan,
  resolveWorkRuleForMember,
} from "@/lib/hq/defaultWorkRules";
import {
  isNonPositionSystemLabel,
  resolveMemberDisplayPosition,
} from "@/lib/hq/orgTreeHelper";
import type {
  HqApprovalDoc,
  HqApprovalStatus,
  HqMember,
  HqWorkflowDocMeta,
} from "@/lib/hq/types";

interface Props {
  doc: HqApprovalDoc | null;
  me: HqMember | null;
  isHqAdmin: boolean;
  canDeleteCompanyDoc?: boolean;
  isStarred?: boolean;
  onToggleStar?: (approvalId: string) => void;
  onFollowUpPostExpense?: (doc: HqApprovalDoc) => void;
  onCloneDoc?: (doc: HqApprovalDoc) => void;
  onOpenRefDoc?: (refDocId: string) => void;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_BADGE: Record<
  HqApprovalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "진행중",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  IN_PROGRESS: {
    label: "진행중",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  APPROVED: {
    label: "승인",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "반려",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
  CANCELLED: {
    label: "취소",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

export default function ApprovalDetailModal({
  doc,
  me,
  isHqAdmin,
  canDeleteCompanyDoc = false,
  isStarred = false,
  onToggleStar,
  onFollowUpPostExpense,
  onCloneDoc,
  onOpenRefDoc,
  onClose,
  onUpdated,
}: Props) {
  const [comment, setComment] = useState("");
  const [threadInput, setThreadInput] = useState("");
  const [acting, setActing] = useState(false);
  const [postingThread, setPostingThread] = useState(false);
  const shell = useOptionalHqShell();
  const [localMeta, setLocalMeta] = useState<HqWorkflowDocMeta | null>(null);
  const [compareBeforeOpen, setCompareBeforeOpen] = useState(true);

  if (!doc) return null;

  const wfMeta =
    localMeta && localMeta.approval_id === doc.approval_id
      ? localMeta
      : doc.workflow_meta || null;

  const meta = APPROVAL_DOC_META[doc.doc_type] || APPROVAL_DOC_META.GENERAL;
  const formTitle = wfMeta?.form_title || meta.label;
  const formIcon = wfMeta?.form_icon || meta.icon;
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
  const canApproveNow =
    isPendingOrProgress && (isAssignedToMe || canExecutiveAct);
  const canCancel = Boolean(
    me && doc.drafter_id === me.instructor_id && doc.status === "PENDING"
  );

  // 사전 지출계획서 승인 건인 경우 [사후 지출품의서 이어서 작성] 노출
  const isApprovedPreExpense =
    doc.status === "APPROVED" &&
    (wfMeta?.form_id === "wf-expense-pre" ||
      formTitle.includes("지출계획서") ||
      doc.doc_type === "PURCHASE");

  const runAction = async (
    action: "APPROVE" | "REJECT" | "CANCEL" | "DELETE_DOC"
  ) => {
    if (action === "REJECT" && !comment.trim()) {
      alert("반려 시에는 하단 의견란에 반려 사유를 입력해 주세요.");
      return;
    }
    if (
      action === "CANCEL" &&
      !confirm("작성한 문서를 요청 취소(회수)하시겠습니까?")
    ) {
      return;
    }
    if (
      action === "DELETE_DOC" &&
      !confirm(
        "이 문서를 회사 문서함에서 영구 삭제하시겠습니까? 삭제 후 복구할 수 없습니다."
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
      alert(err?.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setActing(false);
    }
  };

  const handlePostThreadComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!threadInput.trim()) return;
    setPostingThread(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { docMeta: HqWorkflowDocMeta };
      }>("/api/hq/workflows", {
        method: "POST",
        body: {
          action: "ADD_COMMENT",
          approval_id: doc.approval_id,
          content: threadInput.trim(),
        },
      });
      setLocalMeta(res.data.docMeta);
      setThreadInput("");
      onUpdated();
    } catch (err: any) {
      alert(err?.message || "의견 등록 실패");
    } finally {
      setPostingThread(false);
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

  const customFieldEntries = Object.entries(wfMeta?.field_values || {}).filter(
    ([, v]) => String(v || "").trim() !== ""
  );

  const attachmentList = wfMeta?.attachments || [];

  const findLiveMember = (memberId?: string, memberName?: string) => {
    const pool = shell?.members || [];
    if (memberId) {
      const byId = pool.find((m) => m.instructor_id === memberId);
      if (byId) return byId;
    }
    if (memberName) {
      const byName = pool.find((m) => m.name === memberName);
      if (byName) return byName;
    }
    if (
      me &&
      ((memberId && me.instructor_id === memberId) ||
        (memberName && me.name === memberName))
    ) {
      return me;
    }
    return null;
  };

  const resolveStepDisplayMeta = (st: {
    approver_id: string;
    approver_name: string;
    approver_title: string;
    approver_dept: string;
  }) => {
    const live = findLiveMember(st.approver_id, st.approver_name);
    const position = live
      ? resolveMemberDisplayPosition(live)
      : !isNonPositionSystemLabel(st.approver_title)
        ? st.approver_title.trim()
        : "";
    const rawDept = (st.approver_dept || live?.department || "").trim();
    const dept = rawDept === "미지정" ? "" : rawDept;
    return { position, dept };
  };

  const drafterLive = findLiveMember(doc.drafter_id, doc.drafter_name);
  const drafterPosition = drafterLive
    ? resolveMemberDisplayPosition(drafterLive)
    : !isNonPositionSystemLabel(doc.drafter_title)
      ? (doc.drafter_title || "").trim()
      : "";
  const rawDrafterDept = (
    doc.drafter_dept ||
    drafterLive?.department ||
    ""
  ).trim();
  const drafterDept = rawDrafterDept === "미지정" ? "" : rawDrafterDept;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 print:static print:bg-white print:p-0">
      <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden print:shadow-none print:border-none print:max-h-none print:max-w-none">
        {/* 상단 헤더 바 */}
        <div className="print:hidden px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-base shrink-0">
              {formIcon}
            </span>
            <span className="font-extrabold text-sm text-slate-900 truncate">
              {formTitle}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {doc.doc_no}
            </span>
            {doc.urgent && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold">
                긴급
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleStar && (
              <button
                type="button"
                onClick={() => onToggleStar(doc.approval_id)}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm transition-colors ${
                  isStarred
                    ? "bg-amber-50 border-amber-200 text-amber-500"
                    : "bg-white border-slate-200 text-slate-300 hover:text-amber-400"
                }`}
                title="중요 문서 표시"
              >
                {isStarred ? "★" : "☆"}
              </button>
            )}

            {isApprovedPreExpense && onFollowUpPostExpense && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onFollowUpPostExpense(doc);
                }}
                className="px-3 py-1.5 rounded-lg bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-2xs"
              >
                💳 사후 지출품의서 이어서 작성
              </button>
            )}

            {onCloneDoc && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCloneDoc(doc);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                📋 재기안
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
            >
              🖨️ 인쇄
            </button>

            {canDeleteCompanyDoc && (
              <button
                type="button"
                disabled={acting}
                onClick={() => runAction("DELETE_DOC")}
                className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold"
              >
                삭제
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-extrabold ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 문서 본문 */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6 custom-scroll text-[13px] text-slate-800">
          {/* 제목 + 우측 승인 단계 도장 테이블 */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-md border text-xs font-extrabold ${stBadge.className}`}
                >
                  {isPendingOrProgress
                    ? `진행중 ${doc.current_step_order}/${doc.total_steps}`
                    : stBadge.label}
                </span>
                {doc.is_auto_delegated && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-extrabold">
                    ⚡ 전결 규정 적용
                  </span>
                )}
                <span className="text-xs text-slate-400 font-mono">
                  문서번호: {doc.doc_no}
                </span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 leading-snug">
                {doc.title}
              </h2>
              {wfMeta?.cc_member_names && wfMeta.cc_member_names.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-slate-500">
                  <span className="font-bold text-slate-400">참조:</span>
                  {wfMeta.cc_member_names.map((ccName, i) => (
                    <span
                      key={`${ccName}-${i}`}
                      className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold"
                    >
                      {ccName}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 승인 도장란 */}
            <div className="flex border border-slate-300 rounded-xl overflow-hidden shrink-0 self-start">
              <div className="w-[72px] flex flex-col border-r border-slate-300 text-center">
                <div className="bg-slate-100 py-1 text-[10px] font-bold text-slate-600 border-b border-slate-300">
                  작 성
                </div>
                <div className="h-14 flex items-center justify-center px-1">
                  <span className="w-9 h-9 rounded-full border-2 border-blue-600 text-blue-700 flex items-center justify-center text-[10px] font-extrabold">
                    작성
                  </span>
                </div>
                <div className="border-t border-slate-200 py-1 text-[10px] font-bold text-slate-700 truncate px-1 bg-slate-50">
                  {doc.drafter_name}
                </div>
                <div className="text-[9px] text-slate-400 pb-1 bg-slate-50">
                  {formatDateShort(doc.submitted_at)}
                </div>
              </div>

              {doc.steps.map((st) => {
                const isZeroStepSelf =
                  st.approver_id === doc.drafter_id && doc.steps.length === 1;
                if (isZeroStepSelf) return null;
                const { position: stepPos } = resolveStepDisplayMeta(st);

                return (
                  <div
                    key={st.step_order}
                    className="w-[72px] flex flex-col border-r last:border-r-0 border-slate-300 text-center"
                  >
                    <div className="bg-slate-100 py-1 text-[10px] font-bold text-slate-600 border-b border-slate-300 truncate px-1">
                      {st.step_order}단계
                    </div>
                    <div className="h-14 flex items-center justify-center px-1">
                      {st.status === "APPROVED" ? (
                        <span className="w-10 h-10 rounded-full border-2 border-emerald-600 text-emerald-700 flex items-center justify-center text-[10px] font-extrabold rotate-[-6deg]">
                          승인
                        </span>
                      ) : st.status === "REJECTED" ? (
                        <span className="w-10 h-10 rounded-full border-2 border-rose-600 text-rose-600 flex items-center justify-center text-[10px] font-extrabold">
                          반려
                        </span>
                      ) : st.status === "CURRENT" ? (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-extrabold">
                          승인대기
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
                    <div className="text-[9px] text-slate-400 pb-1 bg-slate-50 truncate px-1">
                      {st.acted_at ? formatDateShort(st.acted_at) : stepPos}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 연결된 참조 문서 배너 */}
          {wfMeta?.ref_doc_title && (
            <div className="px-4 py-3 rounded-2xl bg-indigo-50/70 border border-indigo-200/80 flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-indigo-900">
                🔗 참조 문서:{" "}
                <span className="font-mono text-indigo-600">
                  [{wfMeta.ref_doc_no || "문서"}]
                </span>{" "}
                {wfMeta.ref_doc_title}
              </div>
              {wfMeta.ref_doc_id && onOpenRefDoc && (
                <button
                  type="button"
                  onClick={() => onOpenRefDoc(wfMeta.ref_doc_id!)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[11px] font-extrabold text-indigo-700 hover:bg-indigo-50 shrink-0"
                >
                  참조 문서 열기 ›
                </button>
              )}
            </div>
          )}

          {/* 기본 정보 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
            <div>
              <div className="text-[11px] text-slate-400 font-bold">
                작성자 / 조직
              </div>
              <div className="font-bold text-slate-800 mt-0.5">
                {doc.drafter_name}
                {drafterPosition ? ` ${drafterPosition}` : ""}
                {drafterDept ? ` (${drafterDept})` : ""}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-bold">
                작성 일시
              </div>
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
                    : "기준 일자"}
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
                {doc.doc_type === "LEAVE" ? "신청 일수" : "문서 금액"}
              </div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                {doc.doc_type === "LEAVE"
                  ? `${doc.leave_days}일 (${doc.leave_type || "연차"})`
                  : doc.amount > 0
                    ? `${doc.amount.toLocaleString()}원`
                    : "-"}
              </div>
            </div>
          </div>

          {/* 플렉스식 [근무 미리보기 + 이전 기록 비교] 블록 (Screenshot 7472646d 재현) */}
          {wfMeta?.work_edit_payload && (() => {
            const wp = wfMeta.work_edit_payload;
            const targetMember =
              shell?.members?.find(
                (m) =>
                  m.instructor_id === wp.target_member_id ||
                  m.name === wp.target_member_name
              ) ||
              (me &&
              (me.instructor_id === wp.target_member_id ||
                me.name === wp.target_member_name)
                ? me
                : null);
            const memberRule = resolveWorkRuleForMember(
              shell?.companySettings?.extra_settings?.work_rules,
              wp.target_member_name || targetMember?.name,
              targetMember?.profile_extra?.work_schedule_type
            );
            const getSnapBreaks = (snap: typeof wp.before) =>
              snap.exists && snap.break_minutes > 0
                ? resolveBreakWindowsForSpan({
                    inMinutes: snap.in_minutes,
                    outMinutes: snap.out_minutes,
                    breakMinutes: snap.break_minutes,
                    explicitBreaks: snap.breaks,
                    explicitStart: snap.break_start_minutes,
                    explicitEnd: snap.break_end_minutes,
                    rule: memberRule,
                  })
                : [];
            const beforeBreaks = getSnapBreaks(wp.before);
            const afterBreaks =
              wp.action_mode === "DELETE" ? [] : getSnapBreaks(wp.after);

            const fmtDur = (mins: number) => {
              const safe = Math.max(0, Math.round(mins || 0));
              if (safe === 0) return "없음";
              const h = Math.floor(safe / 60);
              const m = safe % 60;
              if (h > 0 && m > 0) return `${h}시간 ${m}분`;
              if (h > 0) return `${h}시간`;
              return `${m}분`;
            };
            const fmtBreakSummary = (
              snap: typeof wp.before,
              breaks: { start_minutes: number; end_minutes: number }[]
            ) => {
              if (!snap.exists || snap.break_minutes <= 0) return "없음";
              const durText = fmtDur(snap.break_minutes);
              if (breaks.length === 0) return durText;
              const rangeText = breaks
                .map(
                  (b) =>
                    `${formatMinutesToKoreanAmPm(b.start_minutes)} – ${formatMinutesToKoreanAmPm(b.end_minutes)}`
                )
                .join(", ");
              return `${durText} (${rangeText})`;
            };
            const renderMiniBar = (
              snap: typeof wp.before,
              badgeLabel: string,
              resolvedBreaks: { start_minutes: number; end_minutes: number }[]
            ) => {
              if (!snap.exists) {
                return (
                  <div className="relative h-14 px-3 flex items-center border-b border-slate-100 last:border-b-0">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500 mr-4">
                      {badgeLabel}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      등록된 근무 기록 없음
                    </span>
                  </div>
                );
              }
              const segList =
                Array.isArray(snap.segments) && snap.segments.length > 0
                  ? snap.segments
                  : [
                      {
                        id: "seg-single",
                        work_mode: snap.work_mode,
                        policy_name: snap.policy_name,
                        in_minutes: snap.in_minutes,
                        out_minutes: snap.out_minutes,
                      },
                    ];

              return (
                <div className="relative h-16 border-b border-slate-100 last:border-b-0">
                  <span className="absolute left-2.5 top-2 z-20 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500 pointer-events-none">
                    {badgeLabel}
                  </span>
                  <div className="grid grid-cols-24 h-full pointer-events-none">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className={`h-full border-r ${
                          h === 11
                            ? "border-r-slate-300 border-dashed"
                            : "border-r-slate-100"
                        } last:border-r-0`}
                      />
                    ))}
                  </div>
                  {segList.map((sg, sgIdx) => {
                    const rawSpan =
                      sg.out_minutes >= sg.in_minutes
                        ? sg.out_minutes - sg.in_minutes
                        : 1440 - sg.in_minutes + sg.out_minutes;
                    const span = Math.max(15, rawSpan);
                    const leftPct = Math.max(
                      0,
                      Math.min(96, (sg.in_minutes / 1440) * 100)
                    );
                    const widthPct = Math.min(
                      100 - leftPct,
                      (span / 1440) * 100
                    );
                    const visibleSpanMin = Math.max(1, (widthPct / 100) * 1440);
                    const isLastSeg = sgIdx === segList.length - 1;
                    const otPct =
                      isLastSeg && snap.overtime_minutes > 0
                        ? Math.min(
                            100,
                            (snap.overtime_minutes / visibleSpanMin) * 100
                          )
                        : 0;
                    const modeIcon =
                      sg.policy_name === "출장"
                        ? "✈️"
                        : sg.work_mode === "REMOTE"
                          ? "🏠"
                          : sg.work_mode === "OUTSIDE"
                            ? "🚗"
                            : "💼";
                    const segBreaks = resolvedBreaks.filter(
                      (b) =>
                        Math.min(sg.out_minutes, b.end_minutes) >
                        Math.max(sg.in_minutes, b.start_minutes)
                    );
                    return (
                      <div
                        key={sg.id || sgIdx}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        className="absolute top-3.5"
                      >
                        <div className="relative h-6 rounded-[5px] border border-[#2dd4bf] bg-[#aef4e8]/95 px-2 flex items-center overflow-hidden text-[#0f766e]">
                          {otPct > 0 && (
                            <div
                              style={{ width: `${otPct}%` }}
                              className="pointer-events-none absolute top-0 right-0 h-[3px] bg-[#f05638] z-20"
                            />
                          )}
                          <span className="relative z-10 text-[10.5px] font-extrabold leading-none">
                            {modeIcon}
                          </span>
                          {segBreaks.map((brk, bIdx) => {
                            const bLeft = Math.max(
                              0,
                              Math.min(
                                100,
                                ((brk.start_minutes - sg.in_minutes) /
                                  visibleSpanMin) *
                                  100
                              )
                            );
                            const bWidth = Math.max(
                              0,
                              Math.min(
                                100 - bLeft,
                                ((brk.end_minutes - brk.start_minutes) /
                                  visibleSpanMin) *
                                  100
                              )
                            );
                            if (bWidth <= 0) return null;
                            return (
                              <div
                                key={bIdx}
                                title={`휴게: ${formatMinutesToKoreanAmPm(brk.start_minutes)} – ${formatMinutesToKoreanAmPm(brk.end_minutes)}`}
                                style={{
                                  left: `${bLeft}%`,
                                  width: `${bWidth}%`,
                                }}
                                className="absolute top-1 bottom-1 min-w-[18px] rounded-[3px] bg-white/95 border border-slate-200/90 flex items-center px-1 text-[9.5px] text-slate-500 z-10 overflow-hidden"
                              >
                                ☕
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between text-[9.5px] text-slate-500 font-semibold mt-0.5 whitespace-nowrap">
                          <span>
                            {formatMinutesToKoreanAmPm(sg.in_minutes)}
                            {segBreaks.length > 0 && (
                              <span className="text-slate-400 ml-1">
                                휴게 {segBreaks.length}건
                              </span>
                            )}
                          </span>
                          {span >= 180 && (
                            <span
                              className={
                                otPct > 0
                                  ? "text-[#e85d3f] font-bold"
                                  : undefined
                              }
                            >
                              {formatMinutesToKoreanAmPm(sg.out_minutes)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            };

            return (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div className="text-xs font-extrabold text-slate-800">
                    근무 미리보기
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompareBeforeOpen((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                      compareBeforeOpen
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    🗂 이전 기록 비교
                  </button>
                </div>

                {/* 24시간 눈금 헤더 (근무표와 동일하게 각 시간 정각 경계선 기준 정렬) */}
                <div className="grid grid-cols-24 h-7 border-b border-slate-100 text-[9.5px] text-slate-400 tabular-nums">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="relative h-full">
                      {h > 0 && (
                        <span
                          className={`absolute left-0 -translate-x-1/2 top-1/2 -translate-y-1/2 whitespace-nowrap ${
                            h === 12
                              ? "font-bold text-slate-500"
                              : "font-medium text-slate-400"
                          }`}
                        >
                          {h === 12 ? "정오" : h > 12 ? h - 12 : h}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {compareBeforeOpen &&
                  renderMiniBar(wp.before, "기록 전", beforeBreaks)}
                {renderMiniBar(
                  wp.action_mode === "DELETE"
                    ? { ...wp.after, exists: false }
                    : wp.after,
                  compareBeforeOpen ? "기록 후" : "변경 일정",
                  afterBreaks
                )}

                <div className="p-4 bg-slate-50/50 border-t border-slate-100 space-y-2 text-xs">
                  <div className="grid grid-cols-12 items-center">
                    <span className="col-span-3 text-slate-500 font-semibold">
                      근무 시간
                    </span>
                    <span className="col-span-4 text-slate-400">
                      총 {fmtDur(wp.before.exists ? wp.before.worked_minutes + wp.before.break_minutes : 0)}
                    </span>
                    <span className="col-span-1 text-slate-300">→</span>
                    <span className="col-span-4 font-extrabold text-slate-900">
                      {wp.action_mode === "DELETE"
                        ? "삭제"
                        : `총 ${fmtDur(wp.after.worked_minutes + wp.after.break_minutes)}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-12 items-center">
                    <span className="col-span-3 text-slate-500 font-semibold">
                      연장 근무
                    </span>
                    <span className="col-span-4 text-slate-400">
                      {fmtDur(wp.before.exists ? wp.before.overtime_minutes : 0)}
                    </span>
                    <span className="col-span-1 text-slate-300">→</span>
                    <span className="col-span-4 font-extrabold text-slate-900">
                      {wp.action_mode === "DELETE"
                        ? "없음"
                        : fmtDur(wp.after.overtime_minutes)}
                    </span>
                  </div>
                  <div className="grid grid-cols-12 items-center">
                    <span className="col-span-3 text-slate-500 font-semibold">
                      휴게 시간
                    </span>
                    <span className="col-span-4 text-slate-400 tabular-nums">
                      {fmtBreakSummary(wp.before, beforeBreaks)}
                    </span>
                    <span className="col-span-1 text-slate-300">→</span>
                    <span className="col-span-4 font-extrabold text-slate-900 tabular-nums">
                      {wp.action_mode === "DELETE"
                        ? "없음"
                        : fmtBreakSummary(wp.after, afterBreaks)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200/70 grid grid-cols-12 items-center">
                    <span className="col-span-3 text-slate-500 font-semibold">
                      {wp.after.policy_name || "근무"}
                    </span>
                    <span className="col-span-4 text-slate-400 tabular-nums">
                      {wp.before.exists
                        ? `${formatMinutesToKoreanAmPm(wp.before.in_minutes)} – ${formatMinutesToKoreanAmPm(wp.before.out_minutes)}`
                        : "없음"}
                    </span>
                    <span className="col-span-1 text-slate-300">→</span>
                    <span className="col-span-4 font-extrabold text-slate-900 tabular-nums">
                      {wp.action_mode === "DELETE"
                        ? "일정 삭제"
                        : `${formatMinutesToKoreanAmPm(wp.after.in_minutes)} – ${formatMinutesToKoreanAmPm(wp.after.out_minutes)}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 커스텀 입력 항목 표 */}
          {customFieldEntries.length > 0 && (
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-extrabold text-slate-700">
                양식 입력 항목
              </div>
              <div className="divide-y divide-slate-100">
                {customFieldEntries.map(([fldId, val]) => {
                  const label = wfMeta?.field_labels?.[fldId] || fldId;
                  if (wfMeta?.ref_doc_id && val === wfMeta.ref_doc_id) {
                    return null;
                  }
                  return (
                    <div
                      key={fldId}
                      className="grid grid-cols-12 px-4 py-2.5 text-xs"
                    >
                      <span className="col-span-4 font-bold text-slate-500">
                        {label}
                      </span>
                      <span className="col-span-8 font-semibold text-slate-800">
                        {val}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 연동 모듈별 세부 블록 */}
          {doc.doc_type === "PURCHASE" &&
            doc.items_json &&
            doc.items_json.length > 0 && (
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-extrabold text-slate-700">
                  <span>🛒 품목 명세</span>
                  <span>거래처: {doc.merchant_name || "-"}</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">품목명</th>
                      <th className="px-4 py-2 text-right">수량</th>
                      <th className="px-4 py-2 text-right">단가</th>
                      <th className="px-4 py-2 text-right">금액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {doc.items_json.map((it, i) => (
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
            <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-amber-900">
                💳 지출 정산: [{doc.expense_category || "기타"}]{" "}
                {doc.merchant_name || "-"} · {doc.payment_method || "법인카드"}
                {doc.card_last4 ? ` (${doc.card_last4})` : ""}
              </div>
              {doc.status === "APPROVED" && (
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[11px] font-extrabold">
                  ✅ 비용·경비 정산 장부 연동 완료
                </span>
              )}
            </div>
          )}

          {/* 상세 내용 본문 */}
          {doc.content && (
            <div>
              <h4 className="text-xs font-extrabold text-slate-500 mb-2">
                상세 내용
              </h4>
              <div className="min-h-[100px] p-4 rounded-2xl border border-slate-200 bg-white whitespace-pre-wrap leading-relaxed text-slate-800 font-medium">
                {doc.content}
              </div>
            </div>
          )}

          {/* 첨부 파일 목록 */}
          {(attachmentList.length > 0 || receiptPublicUrl) && (
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold text-slate-500">
                첨부 파일
              </h4>
              <div className="flex flex-wrap gap-2">
                {attachmentList.length > 0
                  ? attachmentList.map((att, idx) => {
                      const pub = resolveStoragePublicUrl(att.url);
                      return (
                        <a
                          key={`${att.url}-${idx}`}
                          href={pub || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-bold text-blue-600 flex items-center gap-1.5"
                        >
                          <span>📎</span>
                          <span>{att.name}</span>
                        </a>
                      );
                    })
                  : receiptPublicUrl && (
                      <a
                        href={receiptPublicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-bold text-blue-600 flex items-center gap-1.5"
                      >
                        <span>📎</span>
                        <span>첨부 증빙 열람</span>
                      </a>
                    )}
              </div>
            </div>
          )}

          {/* 승인 진행 이력 */}
          <div>
            <h4 className="text-xs font-extrabold text-slate-500 mb-2">
              승인 진행 이력
            </h4>
            <div className="space-y-2">
              {doc.steps.map((st) => {
                const { position: stepPosition, dept: stepDept } =
                  resolveStepDisplayMeta(st);
                return (
                <div
                  key={st.step_order}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {st.step_order}
                    </span>
                    <div>
                      <div className="font-bold text-slate-800 text-xs">
                        {st.approver_name}
                        {stepPosition ? ` ${stepPosition}` : ""}
                        {stepDept && stepDept !== stepPosition && (
                          <span className="text-slate-400 font-normal ml-1">
                            ({stepDept})
                          </span>
                        )}
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
                              ? "text-blue-600"
                              : "text-slate-400"
                      }`}
                    >
                      {st.status === "APPROVED"
                        ? "승인"
                        : st.status === "REJECTED"
                          ? "반려"
                          : st.status === "CURRENT"
                            ? "승인 대기중"
                            : st.status === "SKIPPED"
                              ? "취소"
                              : "대기"}
                    </span>
                    {st.acted_at && (
                      <div className="text-[11px] text-slate-400">
                        {formatDateTime(st.acted_at)}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* 문서 의견 · 댓글 소통 스레드 */}
          <div className="print:hidden pt-2 border-t border-slate-100 space-y-3">
            <h4 className="text-xs font-extrabold text-slate-500">
              의견 및 코멘트 ({wfMeta?.comments?.length || 0})
            </h4>

            {wfMeta?.comments && wfMeta.comments.length > 0 && (
              <div className="space-y-2">
                {wfMeta.comments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-extrabold text-slate-800">
                        {c.author_name}{" "}
                        <span className="font-normal text-slate-400">
                          ({c.author_dept})
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {formatDateTime(c.created_at)}
                      </span>
                    </div>
                    <p className="text-slate-700 whitespace-pre-wrap">
                      {c.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handlePostThreadComment}
              className="flex items-center gap-2"
            >
              <input
                value={threadInput}
                onChange={(e) => setThreadInput(e.target.value)}
                placeholder="참조 의견이나 보충 메모를 남겨보세요..."
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-[#00c458]"
              />
              <button
                type="submit"
                disabled={postingThread || !threadInput.trim()}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold shrink-0"
              >
                의견 등록
              </button>
            </form>
          </div>
        </div>

        {/* 하단 승인 / 반려 / 취소 액션 바 */}
        {(canApproveNow || canCancel) && (
          <div className="print:hidden px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-3 shrink-0">
            {canApproveNow && (
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="승인 의견 또는 반려 사유를 입력하세요 (반려 시 필수)"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-[#00c458]"
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
                    요청 취소
                  </button>
                )}
              </div>

              {canApproveNow && (
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => runAction("REJECT")}
                    className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-extrabold"
                  >
                    반려
                  </button>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => runAction("APPROVE")}
                    className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-xs"
                  >
                    승인하기
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
