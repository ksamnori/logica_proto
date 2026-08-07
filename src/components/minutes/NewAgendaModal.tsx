// src/components/minutes/NewAgendaModal.tsx
"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import SimpleEditor from "./SimpleEditor";

interface NewAgendaModalProps {
  currentUser: { instId: string; name: string };
  onClose: () => void;
  onSuccess: () => void;
}

export default function NewAgendaModal({ currentUser, onClose, onSuccess }: NewAgendaModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("일반");

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return alert("제목과 내용을 입력해주세요.");
    try {
      await supabase.from("agenda").insert({
        title: title, 
        content,
        type: type,
        source: "Manual",
        source_id: crypto.randomUUID(),
        created_by: currentUser.instId
      });
      alert("새 안건이 전체 목록에 상정되었습니다.");
      onSuccess();
    } catch (e) { alert("저장 실패"); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-3 text-white flex justify-between items-center">
          <h2 className="font-bold text-[13px]">✏️ 새 회의 안건 수동 작성</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-xl font-bold leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4 bg-slate-50 flex-1">
          <div className="flex gap-3">
            <div className="w-1/3">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">안건 종류</label>
              <select value={type} onChange={e => setType(e.target.value)} className="w-full text-[12px] font-bold text-slate-700 border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864]">
                <option value="일반">일반 업무/공지</option>
                <option value="긴급">긴급/이슈</option>
                <option value="기타">기타 논의</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">안건 제목</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="회의에서 논의할 핵심 주제" className="w-full text-[12px] font-bold text-slate-800 border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864]" />
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-[250px]">
            <label className="block text-[11px] font-bold text-slate-500 mb-1">상세 내용 및 의견</label>
            <div className="flex-1 h-full"><SimpleEditor value={content} onChange={setContent} /></div>
          </div>
        </div>
        <div className="p-3 bg-white border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-[12px] rounded-lg hover:bg-slate-200 transition-colors">취소</button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-[#002864] text-white font-bold text-[12px] rounded-lg hover:bg-blue-900 transition-colors shadow-sm">안건 등록하기</button>
        </div>
      </div>
    </div>
  );
}