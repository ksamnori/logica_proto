// src/components/hq/expenses/ExpenseCreateModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_POLICY,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import type { HqExpense } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  mode: "create" | "edit";
  expense?: HqExpense | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ExpenseCreateModal({
  isOpen,
  mode,
  expense,
  onClose,
  onSaved,
}: Props) {
  const [expenseDate, setExpenseDate] = useState("");
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [merchantName, setMerchantName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [description, setDescription] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().slice(0, 10);
    if (mode === "edit" && expense) {
      setExpenseDate(expense.expense_date || today);
      setCategory(expense.category || EXPENSE_CATEGORIES[0]);
      setPaymentMethod(expense.payment_method || PAYMENT_METHODS[0]);
      setMerchantName(expense.merchant_name || "");
      setAmountStr(String(expense.amount || ""));
      setCardLast4(expense.card_last4 || "");
      setDescription(expense.description || "");
      setReceiptUrl(expense.receipt_url || null);
    } else {
      setExpenseDate(today);
      setCategory(EXPENSE_CATEGORIES[0]);
      setPaymentMethod(PAYMENT_METHODS[0]);
      setMerchantName("");
      setAmountStr("");
      setCardLast4("");
      setDescription("");
      setReceiptUrl(null);
    }
  }, [isOpen, mode, expense]);

  if (!isOpen) return null;

  const numericAmount = Math.max(
    0,
    Math.round(Number(amountStr.replace(/[^0-9]/g, "") || 0))
  );
  const estimatedVat = Math.round(numericAmount / 11);
  const policy = EXPENSE_CATEGORY_POLICY[category];
  const receiptPreview = resolveStoragePublicUrl(receiptUrl);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_expense_receipts");
      setReceiptUrl(path);
    } catch (err: any) {
      alert(err?.message || "증빙 업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantName.trim()) {
      alert("가맹점 · 거래처명을 입력해주세요.");
      return;
    }
    if (numericAmount <= 0) {
      alert("지출 금액을 올바르게 입력해주세요.");
      return;
    }

    setSaving(true);
    try {
      if (mode === "edit" && expense) {
        await hqFetch("/api/hq/expenses", {
          method: "PATCH",
          body: {
            expense_id: expense.expense_id,
            expense_date: expenseDate,
            category,
            payment_method: paymentMethod,
            merchant_name: merchantName.trim(),
            amount: numericAmount,
            card_last4: cardLast4.trim() || null,
            description: description.trim() || null,
            receipt_url: receiptUrl,
          },
        });
      } else {
        await hqFetch("/api/hq/expenses", {
          method: "POST",
          body: {
            expense_date: expenseDate,
            category,
            payment_method: paymentMethod,
            merchant_name: merchantName.trim(),
            amount: numericAmount,
            tax_amount: estimatedVat,
            card_last4: cardLast4.trim() || null,
            description: description.trim() || null,
            receipt_url: receiptUrl,
          },
        });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold">
              {mode === "edit"
                ? "💳 비용 · 영수증 내역 수정"
                : "💳 법인카드 · 영수증 빠른 등록"}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              사전 결재가 필요한 고액 건은 [전자결재 &gt; 지출결의서]로 상신해 주세요.
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
          className="p-6 overflow-y-auto space-y-4 flex-1 custom-scroll text-[13px]"
        >
          {policy && (
            <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-2">
              <span>
                📌 <strong>{category}</strong>: {policy.guide}
              </span>
              <span className="font-extrabold shrink-0">{policy.limitText}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                지출(결제) 일자 <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                경비 카테고리
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
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
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
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
                카드 끝 4자리 (선택)
              </label>
              <input
                maxLength={4}
                value={cardLast4}
                onChange={(e) =>
                  setCardLast4(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="예: 4821"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                가맹점 · 거래처명 <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="예: 교보문고 강남점, 카카오모빌리티"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800"
              />
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  결제 금액 (원) <span className="text-rose-500">*</span>
                </label>
                {numericAmount > 0 && (
                  <span className="text-[11px] text-slate-400">
                    부가세(추정): {estimatedVat.toLocaleString()}원
                  </span>
                )}
              </div>
              <input
                required
                value={numericAmount > 0 ? numericAmount.toLocaleString() : ""}
                onChange={(e) =>
                  setAmountStr(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-extrabold text-brand text-right text-base"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                사용 목적 · 참석자 메모
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="예: 출판편집팀 신간 기획 회의 식대 (참석: 홍길동, 김철수)"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800 resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer">
              📎 {uploading ? "업로드 중..." : "영수증 이미지 · PDF 첨부"}
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
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
                ✅ 첨부된 영수증 확인
              </a>
            )}
          </div>
        </form>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-100"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold shadow-sm disabled:opacity-50"
          >
            {saving
              ? "저장 중..."
              : mode === "edit"
                ? "수정 저장"
                : "비용 내역 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
