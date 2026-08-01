// src/components/student/ConsultModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface ConsultModalProps {
  isOpen: boolean;
  studentId: string;
  instId: string;
  logData: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ConsultModal({ isOpen, studentId, instId, logData, onClose, onSuccess }: ConsultModalProps) {
  const [consultForm, setConsultForm] = useState({ logId: null as any, type: "재원상담", method: "전화", content: "" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (logData) {
        setConsultForm({ logId: logData.log_id, type: logData.consultation_type, method: logData.contact_method, content: logData.content });
      } else {
        setConsultForm({ logId: null, type: "재원상담", method: "전화", content: "" });
      }
    }
  }, [isOpen, logData]);

  const submitConsultLog = async () => {
    if (!consultForm.content.trim()) return alert("상담 내용을 입력해주세요.");
    setIsSaving(true);
    try {
      if (consultForm.logId) {
        await supabase.from("consultation_log").update({ consultation_type: consultForm.type, contact_method: consultForm.method, content: consultForm.content }).eq("log_id", consultForm.logId);
      } else {
        await supabase.from("consultation_log").insert({ student_id: studentId, instructor_id: instId, consultation_type: consultForm.type, contact_method: consultForm.method, content: consultForm.content });
      }
      onSuccess();
      onClose();
    } catch (e) { 
      alert("상담 기록 저장 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col transform transition-all animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-indigo-600 p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
          <h3 className="text-lg font-extrabold flex items-center gap-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>{consultForm.logId ? '상담 기록 수정' : '새 상담 기록 등록'}</h3>
          <button onClick={onClose} className="text-white hover:text-rose-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div className="p-6 space-y-5 bg-slate-50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">상담 유형</label>
              <select value={consultForm.type} onChange={e=>setConsultForm({...consultForm, type: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-indigo-500">
                <option value="재원상담">재원상담</option><option value="신규상담">신규상담</option><option value="퇴원상담">퇴원상담</option><option value="성적상담">성적상담</option><option value="태도상담">태도상담</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">연락 방법</label>
              <select value={consultForm.method} onChange={e=>setConsultForm({...consultForm, method: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-indigo-500">
                <option value="전화">전화</option><option value="방문">방문</option><option value="채널톡">채널톡 (웹챗)</option><option value="문자/카톡">문자/카카오톡</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">상담 내용</label>
            <textarea rows={5} value={consultForm.content} onChange={e=>setConsultForm({...consultForm, content: e.target.value})} placeholder="학부모님과 나눈 대화 내용을 상세히 기록해주세요." className="w-full bg-white border border-slate-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 resize-none"></textarea>
          </div>
        </div>
        <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm">취소</button>
          <button onClick={submitConsultLog} disabled={isSaving} className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-md text-sm disabled:opacity-50">기록 저장</button>
        </div>
      </div>
    </div>
  );
}