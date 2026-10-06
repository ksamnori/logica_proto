// src/components/class/InstructorHistoryModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// 데이터 타입 정의
interface HistoryRecord {
  history_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  change_reason: string | null;
  instructor: {
    name: string;
  } | null;
}

interface InstructorHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string;
  className: string;
}

export default function InstructorHistoryModal({ isOpen, onClose, classId, className }: InstructorHistoryModalProps) {
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 사유 인라인 수정(Edit)을 위한 상태
  const [isEditingReason, setIsEditingReason] = useState<string | null>(null);
  const [tempReason, setTempReason] = useState("");

  useEffect(() => {
    if (isOpen && classId) {
      setIsEditingReason(null);
      fetchHistory();
    }
  }, [isOpen, classId]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      // 이력 테이블과 강사 테이블을 조인하여 이름까지 한 번에 불러옵니다.
      const { data, error } = await supabase
        .from("class_instructor_history")
        .select(`
          history_id,
          start_date,
          end_date,
          status,
          change_reason,
          instructor ( name )
        `)
        .eq("class_id", classId)
        .order("start_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setHistoryList((data as unknown as HistoryRecord[]) || []);
    } catch (error: any) {
      console.error("이력 불러오기 실패:", error.message);
      alert("이력을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // 관리자가 교체 사유를 직접 수정하는 함수
  const saveChangeReason = async (historyId: string) => {
    try {
      const { error } = await supabase
        .from("class_instructor_history")
        .update({ change_reason: tempReason })
        .eq("history_id", historyId);

      if (error) throw error;
      
      setHistoryList((prev) =>
        prev.map((h) =>
          h.history_id === historyId ? { ...h, change_reason: tempReason } : h
        )
      );
      setIsEditingReason(null);
    } catch (error) {
      alert("사유 저장에 실패했습니다. 관리자 권한을 확인해주세요.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* 모달 헤더 */}
        <div className="bg-brand text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">👨‍🏫 강사 배정 이력</h2>
            <p className="text-blue-200 text-xs mt-1 font-medium">[{className}] 반의 역대 담당 강사 기록입니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white transition-colors text-2xl leading-none">
            &times;
          </button>
        </div>

        {/* 본문 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50 custom-scroll space-y-3">
          {isLoading ? (
            <div className="text-center py-10 text-slate-400 font-bold text-sm">기록을 불러오는 중입니다...⏳</div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-bold text-sm">기록된 강사 배정 이력이 없습니다.</div>
          ) : (
            historyList.map((history) => {
              const isActive = history.status === "진행중";
              
              return (
                <div 
                  key={history.history_id} 
                  className={`flex flex-col p-4 rounded-xl border shadow-sm transition-colors ${
                    isActive 
                      ? "bg-blue-50 border-blue-200" 
                      : "bg-white border-slate-200"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2.5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-[15px] ${isActive ? "text-blue-900" : "text-slate-700"}`}>
                          {history.instructor?.name || "알 수 없음"} 강사
                        </span>
                        {isActive ? (
                          <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold shadow-sm">
                            현재 담당
                          </span>
                        ) : (
                          <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 font-bold">
                            배정 종료
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-slate-500">
                        🗓️ {history.start_date} ~ {history.end_date || "현재"}
                      </div>
                    </div>
                  </div>

                  {/* 교체 사유 표시 및 인라인 수정 영역 */}
                  <div className="mt-1 border-t border-slate-200/60 pt-2.5">
                    {isEditingReason === history.history_id ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={tempReason}
                          onChange={(e) => setTempReason(e.target.value)}
                          placeholder="교체 사유 입력 (예: 퇴사, 스케줄 변경)"
                          className="flex-1 text-xs px-2 py-1.5 rounded border border-slate-300 font-medium focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                        />
                        <button 
                          onClick={() => saveChangeReason(history.history_id)}
                          className="text-xs bg-brand text-white px-3 py-1.5 rounded font-bold hover:bg-blue-900 shadow-sm transition-colors shrink-0"
                        >
                          저장
                        </button>
                        <button 
                          onClick={() => setIsEditingReason(null)}
                          className="text-xs bg-white text-slate-600 border border-slate-300 px-3 py-1.5 rounded font-bold hover:bg-slate-50 shadow-sm transition-colors shrink-0"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-400 mb-0.5">교체 사유</span>
                          <span className="text-[12px] font-medium text-slate-600">
                            {history.change_reason || "-"}
                          </span>
                        </div>
                        {!isActive && (
                          <button 
                            onClick={() => {
                              setIsEditingReason(history.history_id);
                              setTempReason(history.change_reason || "");
                            }}
                            className="text-xs text-slate-400 hover:text-brand font-bold underline decoration-slate-300 underline-offset-2 transition-colors shrink-0"
                          >
                            사유 기록하기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}