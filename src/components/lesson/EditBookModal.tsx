// src/components/lesson/EditBookModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface EditBookModalProps {
  isOpen: boolean;
  bookData: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditBookModal({ isOpen, bookData, onClose, onSuccess }: EditBookModalProps) {
  const [formData, setFormData] = useState<any>({ title: "", book_type: "주교재", target_sessions: 12 });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && bookData) {
      setFormData({
        title: bookData.title || "",
        book_type: bookData.book_type || "주교재",
        target_sessions: bookData.target_sessions || 12
      });
    }
  }, [isOpen, bookData]);

  const handleSave = async () => {
    if (!formData.title?.trim()) return alert("교재 이름을 입력해주세요.");
    
    setIsSaving(true);
    try {
      await supabase.from("textbook").update({
        title: formData.title,
        book_type: formData.book_type,
        target_sessions: Number(formData.target_sessions) || 12
      }).eq("book_id", bookData.book_id);
      
      alert("교재 정보가 성공적으로 수정되었습니다.");
      onSuccess();
      onClose();
    } catch (e) { 
      alert("수정 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !bookData) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold">마스터 교재 수정</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold transition-colors leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">교재 이름</label>
            <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">교재 구분</label>
            <select value={formData.book_type} onChange={e => setFormData({...formData, book_type: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002864]">
              <option value="주교재">주교재</option>
              <option value="부교재">부교재</option>
              <option value="연산교재">연산교재</option>
              <option value="워크북">워크북</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">기준 회차 (분량)</label>
            <input type="number" value={formData.target_sessions} onChange={e => setFormData({...formData, target_sessions: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm" />
          </div>
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm">취소</button>
          <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm disabled:opacity-50">수정 저장</button>
        </div>
      </div>
    </div>
  );
}