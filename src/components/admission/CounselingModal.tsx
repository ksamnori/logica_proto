// src/components/admission/CounselingModal.tsx
"use client";

import { useState, useEffect } from "react";
import { updateCounselingResult } from "@/app/actions/admission";

interface CounselingModalProps {
  counselData: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CounselingModal({ counselData, onClose, onSuccess }: CounselingModalProps) {
  const [data, setData] = useState(counselData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => { setData(counselData); }, [counselData]);

  const saveCounseling = async () => {
    if (!data) return;
    
    // 🌟 '합격' 대신 '수강 등록' 시 자동 승급 로직 작동
    if (data.result === '수강 등록' && !confirm("해당 지원자가 '수강 등록'으로 확정되었습니다.\n학생 상태를 정규 '재원'생으로 자동 승급하시겠습니까?")) {
      return; 
    }

    setIsSubmitting(true);
    const res = await updateCounselingResult(data.appId, data.studentId, data.result, data.memo);
    setIsSubmitting(false);

    if (res.success) {
      alert("✅ 성공적으로 저장되었습니다.");
      onSuccess();
      onClose();
    } else {
      alert(`❌ 저장 실패: ${res.message}`);
    }
  };

  if (!counselData) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex justify-center items-center z-50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="bg-slate-800 text-white p-5 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-lg">📝 입학 상담 및 결과 기록</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-white transition-colors">&times;</button>
        </div>
        <div className="p-6 space-y-5 overflow-y-auto">
          <div><label className="block text-sm font-bold text-slate-700 mb-1">지원자 이름</label><div className="font-extrabold text-xl text-[#002864]">{data.name}</div></div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">진단평가 진행 상태</label>
            {/* 🌟 5단계 파이프라인으로 UI 셀렉트 옵션 변경 */}
            <select value={data.result} onChange={e => setData({ ...data, result: e.target.value })} className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] font-bold text-slate-700 focus:outline-none">
              <option value="대기">⏳ 대기 (시험 전/채점 대기)</option>
              <option value="검토중">🔍 검토중 (채점 완료, 통보 대기)</option>
              <option value="결과 통보">📞 결과 통보 (상담 완료, 결정 대기)</option>
              <option value="수강 등록">🎉 수강 등록 (입학 확정)</option>
              <option value="등록 보류">⏸️ 등록 보류 (점수 미달/보류)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">상담 메모</label>
            <textarea value={data.memo} onChange={e => setData({ ...data, memo: e.target.value })} rows={4} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none text-sm resize-none" placeholder="상담 내용 기록..."></textarea>
          </div>
        </div>
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end space-x-2 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50">취소</button>
          <button onClick={saveCounseling} disabled={isSubmitting} className="px-5 py-2.5 rounded-lg font-bold text-white bg-[#002864] hover:bg-blue-900 disabled:opacity-50">기록 저장하기</button>
        </div>
      </div>
    </div>
  );
}