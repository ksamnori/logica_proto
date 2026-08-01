// src/components/lesson/AssignBookModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface AssignBookModalProps {
  isOpen: boolean;
  assignData: any | null;
  selectedClass: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignBookModal({ isOpen, assignData, selectedClass, onClose, onSuccess }: AssignBookModalProps) {
  const [formData, setFormData] = useState<any>({ status: "진행중", start_date: "", target_end_date: "" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && assignData) {
      setFormData({
        status: assignData.status || "진행중",
        start_date: assignData.start_date || "",
        target_end_date: assignData.target_end_date || ""
      });
    }
  }, [isOpen, assignData]);

  const handleSave = async () => {
    if (!formData.start_date || !formData.target_end_date) return alert("시작/종료 예정일을 모두 입력해주세요.");
    if (!selectedClass) return alert("선택된 반 정보가 없습니다.");

    setIsSaving(true);
    try {
      const { data: exist } = await supabase.from("class_textbook").select("class_textbook_id").eq("class_id", selectedClass.class_id).eq("book_id", assignData.book_id);
      if (exist && exist.length > 0) return alert("이미 이 반에 배정된 교재입니다.");

      await supabase.from("class_textbook").insert([{
        class_id: selectedClass.class_id,
        book_id: assignData.book_id,
        start_date: formData.start_date,
        target_end_date: formData.target_end_date,
        status: formData.status,
        current_session: 0
      }]);
      
      alert("교재가 성공적으로 배정되었습니다!");
      onSuccess();
      onClose();
    } catch (e) { 
      alert("배정 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !assignData || !selectedClass) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold">선택 반에 교재 배정</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold transition-colors leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">배정 대상 반</label>
            <input type="text" readOnly value={selectedClass.name} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold bg-slate-100 text-slate-600 focus:outline-none text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
            <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#002864]">
              <option value="예정">예정 (시작 전)</option>
              <option value="진행중">진행중 (수강중)</option>
              <option value="완료">완료 (종료됨)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
              <input type="date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">목표 완료일</label>
              <input type="date" value={formData.target_end_date} onChange={e => setFormData({...formData, target_end_date: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm" />
            </div>
          </div>
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm">취소</button>
          <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-[#0ea5e9] text-white font-bold rounded-lg hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50">배정 저장</button>
        </div>
      </div>
    </div>
  );
}