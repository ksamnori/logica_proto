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
  const [isSecret, setIsSecret] = useState(false); // 🌟 비밀 안건 여부

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return alert("제목과 내용을 입력해주세요.");
    
    // 🌟 [추가됨] 새 안건 상정 전 소속 지점 꼬리표 챙기기
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    try {
      await supabase.from("agenda").insert({
        title: title, 
        content,
        type: type,
        source: "Manual",
        source_id: crypto.randomUUID(),
        created_by: currentUser.instId,
        is_secret: isSecret,
        attendees: isSecret ? currentUser.name : null, 
        tenant_id: myTenantId // 🌟 [추가됨] 꼬리표 부착!
      });
      alert("새 안건이 상정되었습니다.");
      onSuccess();
    } catch (e) { alert("저장 실패"); }
  };

  const getTheme = () => {
    if (type === "긴급") return { bg: "bg-rose-600", text: "text-white", icon: "🚨", border: "border-rose-300" };
    if (type === "기타") return { bg: "bg-emerald-600", text: "text-white", icon: "📌", border: "border-emerald-300" };
    return { bg: "bg-[#002864]", text: "text-white", icon: "📝", border: "border-blue-300" };
  };
  const theme = getTheme();

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className={`${theme.bg} ${theme.text} p-3 flex justify-between items-center transition-colors`}>
          <h2 className="font-bold text-[13px] flex items-center gap-1.5">{theme.icon} 새 회의 안건 수동 작성</h2>
          <button onClick={onClose} className="hover:opacity-70 text-xl font-bold leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4 bg-slate-50 flex-1">
          <div className="flex items-end gap-3">
            <div className="w-1/4">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">안건 종류</label>
              <select value={type} onChange={e => setType(e.target.value)} className={`w-full text-[12px] font-bold text-slate-700 border ${theme.border} rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-opacity-50 transition-colors`}>
                <option value="일반">📝 일반/업무</option>
                <option value="긴급">🚨 긴급/이슈</option>
                <option value="기타">📌 기타/논의</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">안건 제목 <span className="text-rose-500">*</span></label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="회의에서 논의할 핵심 주제" className={`w-full text-[12px] font-bold text-slate-800 border ${theme.border} rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-opacity-50`} />
            </div>
            <div className="shrink-0">
              <button onClick={() => alert("녹음 모달로 연결하거나 녹음 로직을 시작합니다. (추가 구현 필요)")} className="h-[38px] px-3 bg-white text-blue-600 border border-blue-200 rounded-lg text-[11px] font-bold shadow-sm hover:bg-blue-50 transition-colors flex items-center gap-1">
                🎙️ 음성 녹음
              </button>
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-[250px]">
            <div className="flex justify-between items-center mb-1">
              <label className="block text-[11px] font-bold text-slate-500">상세 내용 및 의견 <span className="text-rose-500">*</span></label>
              <label className="flex items-center gap-1.5 cursor-pointer bg-white px-2 py-1 rounded border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
                <input type="checkbox" checked={isSecret} onChange={e => setIsSecret(e.target.checked)} className="w-3 h-3 accent-slate-800" />
                <span className="text-[10px] font-bold text-slate-600">🔒 비밀 안건으로 등록</span>
              </label>
            </div>
            <div className={`flex-1 h-full rounded-lg overflow-hidden border ${theme.border}`}><SimpleEditor value={content} onChange={setContent} /></div>
          </div>
        </div>
        <div className="p-3 bg-white border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-[12px] rounded-lg hover:bg-slate-200 transition-colors">취소</button>
          <button onClick={handleSubmit} className={`px-4 py-2 ${theme.bg} ${theme.text} font-bold text-[12px] rounded-lg hover:opacity-90 transition-colors shadow-sm`}>안건 등록하기</button>
        </div>
      </div>
    </div>
  );
}