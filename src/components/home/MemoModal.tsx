// src/components/home/MemoModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface MemoModalProps {
  isOpen: boolean;
  currentUser: { instId: string; name: string };
  onClose: () => void;
  onSuccess: () => void;
}

export default function MemoModal({ isOpen, currentUser, onClose, onSuccess }: MemoModalProps) {
  const [memoData, setMemoData] = useState({ type: "일반공지", content: "" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMemoData({ type: "일반공지", content: "" });
    }
  }, [isOpen]);

  const saveMemo = async () => {
    if (!memoData.content.trim()) return alert("내용을 입력해주세요.");
    setIsSaving(true);
    try {
      await supabase.from("instructor_memo").insert({
        instructor_id: currentUser.instId, 
        author_name: currentUser.name, 
        memo_type: memoData.type, 
        content: memoData.content
      });
      alert("공지가 등록되었습니다.");
      onSuccess();
      onClose();
    } catch (e) { 
      alert("공지 등록 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold text-sm">새 업무 공유 / 공지사항 작성</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">분류 (태그)</label>
            <select value={memoData.type} onChange={(e) => setMemoData({...memoData, type: e.target.value})} className="w-full text-sm font-bold text-slate-700 border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864]">
              <option value="긴급공지">🚨 긴급공지</option>
              <option value="일반공지">📢 일반공지</option>
              <option value="학생인계">🤝 학생인계</option>
              <option value="행정요청">📝 행정요청</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">내용 작성</label>
            <textarea value={memoData.content} onChange={(e) => setMemoData({...memoData, content: e.target.value})} rows={4} className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded-lg p-3 focus:outline-none focus:border-[#002864] resize-none custom-scroll" placeholder="선생님들께 공유할 내용을 입력하세요..."></textarea>
          </div>
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm">취소</button>
          <button onClick={saveMemo} disabled={isSaving} className="px-4 py-2 bg-[#002864] text-white text-xs font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm disabled:opacity-50">업무 등록</button>
        </div>
      </div>
    </div>
  );
}