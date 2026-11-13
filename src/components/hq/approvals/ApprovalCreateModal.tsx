// src/components/hq/approvals/ApprovalCreateModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  APPROVAL_DOC_META,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_POLICY,
  getRankLevel,
  getRankMeta,
  LEAVE_TYPES,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import {
  buildRecommendedApprovalLine,
  type RecommendedStepDraft,
} from "@/lib/hq/approvalLine";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import type {
  HqApprovalDocType,
  HqMember,
  PurchaseLineItem,
} from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  me: HqMember | null;
  members: HqMember[];
  defaultDocType?: HqApprovalDocType;
  onClose: () => void;
  onCreated: () => void;
}

export default function ApprovalCreateModal({
  isOpen,
  me,
  members,
  defaultDocType = "GENERAL",
  onClose,
  onCreated,
}: Props) {
  const [docType, setDocType] = useState<HqApprovalDocType>(defaultDocType);
  const [urgent, setUrgent] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  // 날짜 및 휴가
  const [effectiveDate, setEffectiveDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0].label);
  const [leaveDays, setLeaveDays] = useState("1");
  const [handoverName, setHandoverName] = useState("");

  // 금액 · 지출 · 품의
  const [amountInput, setAmountInput] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>(
    EXPENSE_CATEGORIES[0]
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [merchantName, setMerchantName] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  // 구매 품의 품목 리스트
  const [items, setItems] = useState<PurchaseLineItem[]>([
    { name: "", qty: 1, unitPrice: 0, amount: 0 },
  ]);

  // 결재선 설정
  const [useAutoDelegation, setUseAutoDelegation] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const [steps, setSteps] = useState<RecommendedStepDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().slice(0, 10);
    setDocType(defaultDocType);
    setUrgent(false);
    setTitle("");
    setContent("");
    setEffectiveDate(today);
    setEndDate(today);
    setLeaveType(LEAVE_TYPES[0].label);
    setLeaveDays("1");
    setHandoverName("");
    setAmountInput("");
    setExpenseCategory(EXPENSE_CATEGORIES[0]);
    setPaymentMethod(PAYMENT_METHODS[0]);
    setMerchantName("");
    setCardLast4("");
    setReceiptUrl(null);
    setItems([{ name: "", qty: 1, unitPrice: 0, amount: 0 }]);
    setUseAutoDelegation(true);
    setCustomMode(false);
  }, [isOpen, defaultDocType]);

  // 휴가 종류 또는 시작/종료일 변경 시 일수 자동 계산
  useEffect(() => {
    if (docType !== "LEAVE") return;
    const meta = LEAVE_TYPES.find((l) => l.label === leaveType);
    if (meta && meta.defaultDays === 0.5) {
      setLeaveDays("0.5");
      if (effectiveDate) setEndDate(effectiveDate);
      return;
    }
    if (effectiveDate && endDate) {
      const s = new Date(effectiveDate);
      const e = new Date(endDate);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
        let workDays = 0;
        const cur = new Date(s);
        while (cur <= e) {
          const day = cur.getDay();
          if (day !== 0 && day !== 6) workDays += 1;
          cur.setDate(cur.getDate() + 1);
        }
        setLeaveDays(String(Math.max(1, workDays)));
      }
    }
  }, [docType, leaveType, effectiveDate, endDate]);

  const purchaseTotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + Math.max(0, Number(it.qty || 0) * Number(it.unitPrice || 0)),
        0
      ),
    [items]
  );

  const effectiveAmount = useMemo(() => {
    if (docType === "PURCHASE") return purchaseTotal;
    if (docType === "LEAVE") return 0;
    return Math.max(0, Math.round(Number(amountInput.replace(/[^0-9]/g, "") || 0)));
  }, [docType, purchaseTotal, amountInput]);

  // 추천 결재선 계산
  const recommendation = useMemo(() => {
    if (!me) {
      return {
        steps: [],
        isAutoDelegated: false,
        delegationReason: "",
        instantSelfApprove: false,
      };
    }
    return buildRecommendedApprovalLine({
      drafter: me,
      allMembers: members,
      docType,
      amount: effectiveAmount,
      leaveDays: Number(leaveDays || 0),
      useAutoDelegation,
    });
  }, [me, members, docType, effectiveAmount, leaveDays, useAutoDelegation]);

  useEffect(() => {
    if (!customMode) {
      setSteps(recommendation.steps);
    }
  }, [recommendation, customMode]);

  if (!isOpen || !me) return null;

  const eligibleApprovers = members
    .filter((m) => m.work_status === "재직" && m.instructor_id !== me.instructor_id)
    .sort((a, b) => {
      const diff = getRankLevel(b.rank_code) - getRankLevel(a.rank_code);
      if (diff !== 0) return diff;
      if (a.department === me.department && b.department !== me.department) return -1;
      if (b.department === me.department && a.department !== me.department) return 1;
      return a.name.localeCompare(b.name, "ko");
    });

  const handleItemChange = (
    idx: number,
    field: keyof PurchaseLineItem,
    val: string
  ) => {
    setItems((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row };
        if (field === "name") {
          next.name = val;
        } else if (field === "qty") {
          next.qty = Math.max(1, Number(val || 1));
          next.amount = next.qty * next.unitPrice;
        } else if (field === "unitPrice") {
          next.unitPrice = Math.max(0, Number(val.replace(/[^0-9]/g, "") || 0));
          next.amount = next.qty * next.unitPrice;
        }
        return next;
      })
    );
  };

  const addItemRow = () => {
    setItems((prev) => [...prev, { name: "", qty: 1, unitPrice: 0, amount: 0 }]);
  };

  const removeItemRow = (idx: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const handleStepApproverChange = (idx: number, approverId: string) => {
    const target = members.find((m) => m.instructor_id === approverId);
    if (!target) return;
    setCustomMode(true);
    setSteps((prev) =>
      prev.map((s, i) =>
        i === idx
          ? {
              ...s,
              approver_id: target.instructor_id,
              approver_name: target.name,
              approver_dept: target.department,
              approver_rank: target.rank_code,
              approver_title: target.job_title,
            }
          : s
      )
    );
  };

  const handleAddCustomStep = () => {
    if (steps.length >= 4 || eligibleApprovers.length === 0) return;
    const used = new Set(steps.map((s) => s.approver_id));
    const candidate =
      eligibleApprovers.find((m) => !used.has(m.instructor_id)) ||
      eligibleApprovers[0];
    setCustomMode(true);
    const nextOrder = steps.length + 1;
    setSteps((prev) => [
      ...prev.map((s, idx) => ({
        ...s,
        step_order: idx + 1,
        step_role: "REVIEWER" as const,
        role_label: `${idx + 1}차 검토`,
      })),
      {
        step_order: nextOrder,
        step_role: "FINAL_APPROVER",
        role_label: "최종 승인",
        approver_id: candidate.instructor_id,
        approver_name: candidate.name,
        approver_dept: candidate.department,
        approver_rank: candidate.rank_code,
        approver_title: candidate.job_title,
      },
    ]);
  };

  const handleRemoveStep = (idx: number) => {
    if (steps.length <= 1) return;
    setCustomMode(true);
    const filtered = steps.filter((_, i) => i !== idx);
    setSteps(
      filtered.map((s, i) => ({
        ...s,
        step_order: i + 1,
        step_role: i + 1 === filtered.length ? "FINAL_APPROVER" : "REVIEWER",
        role_label: i + 1 === filtered.length ? "최종 승인" : `${i + 1}차 검토`,
      }))
    );
  };

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_approval_receipts");
      setReceiptUrl(path);
    } catch (err: any) {
      alert(err?.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert("결재 문서 제목을 입력해주세요.");
      return;
    }
    if (docType === "EXPENSE" && effectiveAmount <= 0) {
      alert("지출결의서는 지출 금액(0원 초과)을 입력해야 합니다.");
      return;
    }
    if (docType === "PURCHASE" && purchaseTotal <= 0) {
      alert("구매 품의 품목과 단가를 입력해주세요.");
      return;
    }
    if (!recommendation.instantSelfApprove && steps.length === 0) {
      alert("최소 1명 이상의 결재자를 지정해주세요.");
      return;
    }

    const cleanedItems =
      docType === "PURCHASE"
        ? items
            .filter((it) => it.name.trim() !== "")
            .map((it) => ({
              name: it.name.trim(),
              qty: Number(it.qty || 1),
              unitPrice: Number(it.unitPrice || 0),
              amount: Number(it.qty || 1) * Number(it.unitPrice || 0),
            }))
        : [];

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: docType,
          urgent,
          title: title.trim(),
          content: content.trim(),
          amount: effectiveAmount,
          effective_date: effectiveDate || null,
          end_date: docType === "LEAVE" ? endDate || effectiveDate : null,
          leave_type: docType === "LEAVE" ? leaveType : null,
          leave_days: docType === "LEAVE" ? Number(leaveDays || 0) : 0,
          handover_name: docType === "LEAVE" ? handoverName.trim() || null : null,
          expense_category: docType === "EXPENSE" ? expenseCategory : null,
          payment_method: docType === "EXPENSE" ? paymentMethod : null,
          merchant_name:
            docType === "EXPENSE" || docType === "PURCHASE"
              ? merchantName.trim() || null
              : null,
          card_last4:
            docType === "EXPENSE" && cardLast4.trim() ? cardLast4.trim() : null,
          receipt_url: receiptUrl,
          items_json: cleanedItems,
          is_auto_delegated: !customMode && recommendation.isAutoDelegated,
          steps,
        },
      });

      window.dispatchEvent(new Event("hq:approval-updated"));
      alert(
        recommendation.instantSelfApprove
          ? "✅ 최고결재권자 기안으로 즉시 전결 승인되었습니다."
          : "✅ 전자결재 문서가 상신되었습니다."
      );
      onCreated();
      onClose();
    } catch (err: any) {
      alert(err?.message || "결재 상신 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const policyInfo = EXPENSE_CATEGORY_POLICY[expenseCategory];
  const receiptPreview = resolveStoragePublicUrl(receiptUrl);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <span>✍️ 새 전자결재 기안 작성</span>
              <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300">
                기안자: {me.name} {me.job_title} ({me.department})
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              양식과 금액·일수에 따라 직급별 표준 결재선과 전결 규정이 자동으로 적용됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none font-bold"
          >
            &times;
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-auto space-y-5 flex-1 custom-scroll text-[13px]"
        >
          {/* 1. 기안 양식 선택 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                1. 기안 양식 선택
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded"
                />
                <span className="text-xs font-bold text-rose-600">
                  🚨 긴급 결재 요청
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(Object.keys(APPROVAL_DOC_META) as HqApprovalDocType[]).map((key) => {
                const m = APPROVAL_DOC_META[key];
                const selected = docType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setDocType(key);
                      setCustomMode(false);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selected
                        ? "border-brand bg-blue-50/60 ring-2 ring-brand/20"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="text-lg mb-1">{m.icon}</div>
                    <div className="font-bold text-slate-800 text-xs">{m.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                      {m.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. 직급별 결재선 자동 추천 & 커스텀 */}
          <section className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">
                  2. 직급별 결재선 설정
                </span>
                {recommendation.isAutoDelegated && !customMode && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                    ⚡ 전결 규정 적용
                  </span>
                )}
                {customMode && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                    수동 편집됨
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useAutoDelegation}
                    onChange={(e) => {
                      setUseAutoDelegation(e.target.checked);
                      setCustomMode(false);
                    }}
                    className="w-3.5 h-3.5 accent-brand rounded"
                  />
                  <span>전결 규정 자동 적용</span>
                </label>
                {customMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMode(false);
                      setSteps(recommendation.steps);
                    }}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    🔄 추천 결재선 복원
                  </button>
                )}
                {!recommendation.instantSelfApprove && steps.length < 4 && (
                  <button
                    type="button"
                    onClick={handleAddCustomStep}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-700"
                  >
                    + 결재자 추가
                  </button>
                )}
              </div>
            </div>

            <div className="text-xs text-slate-600 bg-white px-3 py-2 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2">
              <span>💡 {recommendation.delegationReason}</span>
              <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">
                (30만원/3일 이하 팀장전결 · 100만원 이하 임원전결)
              </span>
            </div>

            {recommendation.instantSelfApprove ? (
              <div className="px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">
                👑 대표·소장(Lv.5) 본인 기안 문서이므로 상신 즉시 최종 승인 처리됩니다.
              </div>
            ) : steps.length === 0 ? (
              <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
                ⚠️ 결재 가능한 재직 본부 구성원이 없습니다. [구성원·조직 관리]에서 결재권자를 먼저 등록해주세요.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {steps.map((step, idx) => {
                  const rMeta = getRankMeta(step.approver_rank);
                  return (
                    <div
                      key={`${step.step_order}-${idx}`}
                      className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-extrabold text-brand">
                          {idx + 1}단계 · {step.role_label}
                        </span>
                        {steps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveStep(idx)}
                            className="text-[11px] text-slate-400 hover:text-rose-500 font-bold"
                          >
                            제외
                          </button>
                        )}
                      </div>

                      <select
                        value={step.approver_id}
                        onChange={(e) => handleStepApproverChange(idx, e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                      >
                        {eligibleApprovers.map((m) => (
                          <option key={m.instructor_id} value={m.instructor_id}>
                            [{m.department}] {m.name} {m.job_title} (Lv.{m.rank_level})
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{step.approver_dept}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${rMeta.badgeClass}`}
                        >
                          {step.approver_title}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. 양식별 전용 입력 영역 */}
          {docType === "LEAVE" && (
            <section className="rounded-2xl bg-emerald-50/40 border border-emerald-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-900">
                  🌴 휴가 · 연차 상세 정보
                </h4>
                <span className="px-2.5 py-1 rounded-full bg-white border border-emerald-200 text-emerald-700 text-xs font-extrabold">
                  내 잔여 연차: {me.annual_leave_remain}일 (총 {me.annual_leave_total}일 중{" "}
                  {me.annual_leave_used}일 사용)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    휴가 구분
                  </label>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {LEAVE_TYPES.map((lt) => (
                      <option key={lt.label} value={lt.label}>
                        {lt.label} {lt.deductAnnual ? "(연차차감)" : "(미차감)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    시작일
                  </label>
                  <input
                    type="date"
                    required
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    종료일
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    min={effectiveDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    사용 일수
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={leaveDays}
                    onChange={(e) => setLeaveDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-extrabold text-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  부재 중 업무 대행자 (인수인계자)
                </label>
                <input
                  value={handoverName}
                  onChange={(e) => setHandoverName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                  placeholder="예: 연구개발팀 김선임 연구원"
                />
              </div>
            </section>
          )}

          {docType === "PURCHASE" && (
            <section className="rounded-2xl bg-sky-50/40 border border-sky-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-sky-900">
                  🛒 구매 · 발주 품목 명세
                </h4>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="px-2.5 py-1 rounded-lg bg-white border border-sky-300 text-sky-700 text-xs font-bold hover:bg-sky-100"
                >
                  + 품목 행 추가
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    공급업체 · 구매처
                  </label>
                  <input
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                    placeholder="예: 교보문고, 쿠팡비즈, 프린트피아"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    희망 납기 · 도입 예정일
                  </label>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-slate-200"
                  >
                    <input
                      value={it.name}
                      onChange={(e) => handleItemChange(idx, "name", e.target.value)}
                      placeholder="품목명 · 규격"
                      className="col-span-5 px-2.5 py-1.5 rounded-lg border border-slate-200 font-medium text-slate-800"
                    />
                    <input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) => handleItemChange(idx, "qty", e.target.value)}
                      placeholder="수량"
                      className="col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-200 text-right font-bold text-slate-800"
                    />
                    <input
                      type="text"
                      value={it.unitPrice ? it.unitPrice.toLocaleString() : ""}
                      onChange={(e) =>
                        handleItemChange(idx, "unitPrice", e.target.value)
                      }
                      placeholder="단가(원)"
                      className="col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 text-right font-bold text-slate-800"
                    />
                    <div className="col-span-2 flex items-center justify-end gap-1.5 pr-1">
                      <span className="text-xs font-extrabold text-slate-700 truncate">
                        {(it.qty * it.unitPrice).toLocaleString()}원
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          className="text-slate-400 hover:text-rose-500 font-bold"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end items-center gap-2 pt-1 text-sm font-extrabold text-slate-900">
                <span>총 품의 합계액:</span>
                <span className="text-brand text-base">
                  {purchaseTotal.toLocaleString()}원
                </span>
              </div>
            </section>
          )}

          {docType === "EXPENSE" && (
            <section className="rounded-2xl bg-amber-50/40 border border-amber-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-amber-900">
                  💳 지출결의 상세 (최종 승인 시 비용관리 장부에 자동 반영)
                </h4>
                {policyInfo && (
                  <span className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-800 text-[11px] font-bold">
                    📌 규정 안내: {policyInfo.limitText}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    비용 카테고리
                  </label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    결제 수단
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    지출(결제) 일자
                  </label>
                  <input
                    type="date"
                    required
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    가맹점 · 거래처명 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="예: 스타벅스 대치점, AWS"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    지출 금액 (원) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    value={
                      amountInput
                        ? Number(amountInput.replace(/[^0-9]/g, "")).toLocaleString()
                        : ""
                    }
                    onChange={(e) =>
                      setAmountInput(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-extrabold text-brand text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    카드 끝 4자리 (선택)
                  </label>
                  <input
                    maxLength={4}
                    value={cardLast4}
                    onChange={(e) =>
                      setCardLast4(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="예: 4821"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                  />
                </div>
              </div>

              {/* 영수증 파일 첨부 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer">
                    📎 {uploadingReceipt ? "업로드 중..." : "영수증·세금계산서 첨부"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleReceiptChange}
                      className="hidden"
                    />
                  </label>
                  {receiptPreview && (
                    <a
                      href={receiptPreview}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-bold text-blue-600 hover:underline"
                    >
                      ✅ 증빙 첨부 완료 (미리보기)
                    </a>
                  )}
                </div>
                {policyInfo && (
                  <span className="text-[11px] text-slate-500">
                    {policyInfo.guide}
                  </span>
                )}
              </div>
            </section>
          )}

          {docType === "GENERAL" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  시행 예정일
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  관련 예산 금액 (선택 · 없으면 비움)
                </label>
                <input
                  value={
                    amountInput
                      ? Number(amountInput.replace(/[^0-9]/g, "")).toLocaleString()
                      : ""
                  }
                  onChange={(e) =>
                    setAmountInput(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="0"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 text-right"
                />
              </div>
            </div>
          )}

          {/* 4. 제목 및 본문 */}
          <section className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                기안 제목 <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  docType === "LEAVE"
                    ? `예: [${me.department}] ${me.name} ${leaveType} 신청의 건`
                    : docType === "EXPENSE"
                      ? `예: [${me.department}] ${expenseCategory} 지출결의의 건`
                      : "결재 문서 제목을 명확하게 입력하세요"
                }
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-brand"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                상세 기안 사유 · 내용
              </label>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="기안 배경, 세부 내역, 참석자(회의/식대 시), 기대 효과 등을 기재해 주세요."
                className="w-full px-4 py-3 rounded-xl border border-slate-300 font-medium text-slate-800 resize-none focus:outline-none focus:border-brand leading-relaxed"
              />
            </div>
          </section>
        </form>

        {/* 하단 액션 바 */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-medium truncate">
            {recommendation.instantSelfApprove
              ? "상신 즉시 최종 승인 처리됩니다."
              : `결재선: ${steps.map((s) => `${s.approver_name}(${s.approver_title})`).join(" → ")}`}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-100"
            >
              취소
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold shadow-sm disabled:opacity-50"
            >
              {submitting ? "상신 처리 중..." : "결재 상신하기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
