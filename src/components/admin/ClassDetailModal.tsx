// src/components/admin/ClassDetailModal.tsx
"use client";

import React from "react";

interface ClassDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  classModalData: any;
  classSchedules: any[];
  classStudents: any[];
}

export default function ClassDetailModal({ isOpen, onClose, classModalData, classSchedules, classStudents }: ClassDetailModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold tracking-tight">🏫 반 상세 정보 및 수강생 목록</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50">
          <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">📋 기본 정보</h3>
          <div className="grid grid-cols-2 gap-4 mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">반 코드</label>
              <input type="text" value={classModalData.code || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100 uppercase" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">반 이름</label>
              <input type="text" value={classModalData.name || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">대상 학년</label>
              <input type="text" value={classModalData.target_grade || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">월 정규 수강료</label>
              <div className="flex items-center gap-2">
                <input type="number" value={classModalData.tuition_fee || 0} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                <span className="font-bold text-slate-500">원</span>
              </div>
            </div>

            <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
              <label className="block text-xs font-bold text-slate-500 mb-3">수업 요일 및 시간</label>
              <div className="flex flex-col gap-2">
                {classSchedules.map(s => (
                  <div key={s.day} className={`flex items-center gap-4 bg-white p-2.5 rounded-lg border border-slate-200`}>
                    <label className="flex items-center gap-2 w-16 shrink-0">
                      <input type="checkbox" disabled checked={s.checked} className="w-5 h-5 accent-[#002864]" />
                      <span className={`font-bold ${s.day === '토' ? 'text-blue-600' : s.day === '일' ? 'text-red-500' : 'text-slate-700'}`}>{s.day}</span>
                    </label>
                    {s.checked && (
                      <div className="flex-1 flex items-center gap-2">
                        <input type="time" disabled value={s.start_time} className="px-3 py-1 rounded border border-slate-300 text-sm w-full font-bold bg-slate-100" />
                        <span className="font-bold text-slate-400">~</span>
                        <input type="time" disabled value={s.end_time} className="px-3 py-1 rounded border border-slate-300 text-sm w-full font-bold bg-slate-100" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
              <input type="text" value={classModalData.status || "예정"} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">담당 강사</label>
              <input type="text" value={classModalData.instructorName ? `${classModalData.instructorName} 선생님` : "미정"} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
            </div>
          </div>

          <div className="flex justify-between items-end mb-3 border-b border-slate-200 pb-2">
            <h3 className="font-bold text-slate-800">👨‍🎓 수강 학생 리스트</h3>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-bold text-slate-500">이름</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500">학년</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500">수강반</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {classStudents.length === 0 ? (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400 font-bold">배정된 학생이 없습니다.</td></tr>
                ) : (
                  classStudents.map(s => {
                    const uniqueClasses = Array.from(new Set(s.enrollment?.map((e: any) => e.class?.name).filter(Boolean))).join(", ") || "-";
                    return (
                      <tr key={s.student_id}>
                        <td className="py-2.5 px-4 font-bold text-[#002864]">{s.name}</td>
                        <td className="py-2.5 px-4 text-slate-600 text-xs font-bold">{s.grade || "-"}</td>
                        <td className="py-2.5 px-4 text-slate-600 text-xs font-bold max-w-[200px] truncate">{uniqueClasses}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 shadow-sm transition-colors">닫기</button>
        </div>
      </div>
    </div>
  );
}