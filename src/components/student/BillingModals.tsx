// src/components/student/BillingModals.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// === 청구서 발행 모달 ===
export function BillingModal({ isOpen, studentId, enrollments, allClasses, onClose, onSuccess }: any) {
  const [billForm, setBillForm] = useState({ month: "", dueDate: "", classId: "", amount: "" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setBillForm({
        month: `${now.getFullYear()}-${String(now.getMonth()+2).padStart(2,'0')}`,
        dueDate: nextMonth.toISOString().split('T')[0],
        classId: "", amount: ""
      });
    }
  }, [isOpen]);

  const submitBilling = async () => {
    if (!billForm.month || !billForm.dueDate || !billForm.classId || !billForm.amount) return alert("모든 항목을 입력해주세요.");
    setIsSaving(true);
    try {
      await supabase.from("academy_billing").insert({
        student_id: studentId, class_id: billForm.classId, billing_month: billForm.month, amount: parseInt(billForm.amount), due_date: billForm.dueDate, status: "미납"
      });
      onSuccess();
      onClose();
    } catch (e) { 
      alert("청구 발행 실패"); 
    } finally { setIsSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-emerald-600 p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
          <h3 className="text-lg font-extrabold flex items-center gap-2">새 청구서 발행</h3>
          <button onClick={onClose} className="text-white hover:text-emerald-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div className="p-6 space-y-4 bg-slate-50">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">청구 월</label>
            <input type="month" value={billForm.month} onChange={e=>setBillForm({...billForm, month: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">납부 기한 (언제까지 내야하나요?)</label>
            <input type="date" value={billForm.dueDate} onChange={e=>setBillForm({...billForm, dueDate: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">청구 대상 수강반 (선택시 금액 자동 입력)</label>
            <select value={billForm.classId} onChange={e => {
              const cId = e.target.value;
              const cInfo = allClasses.find((c: any) => c.class_id.toString() === cId);
              setBillForm({...billForm, classId: cId, amount: cInfo ? cInfo.tuition_fee?.toString()||"0" : ""});
            }} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-[#002864] focus:outline-none focus:border-emerald-500">
              <option value="">청구할 반을 선택하세요</option>
              {enrollments.map((e: any) => {
                const cInfo = allClasses.find((c: any) => c.class_id === e.class_id);
                return cInfo ? <option key={cInfo.class_id} value={cInfo.class_id}>{cInfo.name} (기본: {cInfo.tuition_fee?.toLocaleString()||0}원)</option> : null;
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">최종 청구 금액</label>
            <div className="flex items-center gap-2">
              <input type="number" value={billForm.amount} onChange={e=>setBillForm({...billForm, amount: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
              <span className="font-bold text-slate-500">원</span>
            </div>
          </div>
        </div>
        <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 text-sm">취소</button>
          <button onClick={submitBilling} disabled={isSaving} className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-md text-sm disabled:opacity-50">발행하기</button>
        </div>
      </div>
    </div>
  );
}

// === 수납 완료 처리 모달 ===
export function PaymentModal({ isOpen, payFormInit, onClose, onSuccess }: any) {
  const [payForm, setPayForm] = useState({ billingId: "", amount: 0, method: "계좌이체" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && payFormInit) setPayForm(payFormInit);
  }, [isOpen, payFormInit]);

  const submitPayment = async () => {
    setIsSaving(true);
    try {
      await supabase.from("academy_billing").update({ status: "완납" }).eq("billing_id", payForm.billingId);
      await supabase.from("payment_history").insert({
        billing_id: payForm.billingId, payment_method: payForm.method, paid_amount: payForm.amount, transaction_key: `MANUAL_PAY_${Date.now()}`
      });
      onSuccess();
      onClose();
    } catch (e) { 
      alert("수납 처리 실패"); 
    } finally { setIsSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
          <h3 className="text-lg font-extrabold flex items-center gap-2">수납 완료 처리</h3>
          <button onClick={onClose} className="text-white hover:text-blue-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div className="p-6 space-y-4 bg-slate-50">
          <div className="text-center mb-2">
            <p className="text-xs font-bold text-slate-500">결제할 금액</p>
            <p className="text-3xl font-black text-rose-600">{payForm.amount.toLocaleString()}원</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">결제 수단</label>
            <select value={payForm.method} onChange={e=>setPayForm({...payForm, method: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-[#002864]">
              <option value="계좌이체">계좌이체</option><option value="현장 카드결제">현장 카드결제</option><option value="현금">현금</option><option value="간편결제">간편결제 (카카오페이 등)</option>
            </select>
          </div>
        </div>
        <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 text-sm">취소</button>
          <button onClick={submitPayment} disabled={isSaving} className="px-5 py-2.5 bg-[#002864] text-white font-bold rounded-xl hover:bg-blue-900 shadow-md text-sm disabled:opacity-50">수납 확인</button>
        </div>
      </div>
    </div>
  );
}