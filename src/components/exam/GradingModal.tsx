// src/components/exam/GradingModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface GradingModalProps {
  isOpen: boolean;
  examId: string;
  title: string;
  onClose: () => void;
  onUpdate: () => void;
}

export default function GradingModal({ isOpen, examId, title, onClose, onUpdate }: GradingModalProps) {
  const router = useRouter();
  const [gradingAssignments, setGradingAssignments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && examId) loadAssignments();
  }, [isOpen, examId]);

  const formatGrade = (g: any) => {
    if (!g) return '-';
    if (isNaN(Number(g))) return g;
    const num = parseInt(g, 10);
    if (num >= 1 && num <= 6) return `초등 ${num}학년`;
    if (num >= 7 && num <= 9) return `중등 ${num - 6}학년`;
    if (num >= 10 && num <= 12) return `고등 ${num - 9}학년`;
    return `${num}학년`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const loadAssignments = async () => {
    setIsLoading(true);
    try {
      // 💡 [핵심 수정] 쿼리에 class(name) 조인 추가
      const { data, error } = await supabase
        .from('exam_assignment')
        .select('*, student(name, grade), class(name)')
        .eq('exam_id', examId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGradingAssignments(data || []);
    } catch (e: any) { alert(`에러 발생: ${e.message}`); } finally { setIsLoading(false); }
  };

  const cancelAssignment = async (assignmentId: string) => {
    if (!confirm("⚠️ 이 학생의 출제를 취소하시겠습니까?\n(이미 입력된 답안과 채점 기록이 있다면 모두 삭제됩니다.)")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('student_exam_result').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      
      alert("✅ 출제가 성공적으로 취소되었습니다.");
      loadAssignments();
      onUpdate(); 
    } catch (e: any) { alert("❌ 출제 취소 중 오류가 발생했습니다: \n" + e.message); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-emerald-600 p-5 text-white flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2"><span>📊</span> 시험지 출제 현황 및 채점</h2>
            <p className="text-emerald-100 text-xs mt-1">[{title}] 출제된 학생 리스트입니다.</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-emerald-200 font-bold text-xl">&times;</button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scroll max-h-[60vh] bg-slate-50">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-bold text-slate-500">출처(수강반)</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500">이름(학년)</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500 text-center">출제일</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500 text-center">채점 상태</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {isLoading ? (
                  <tr><td colSpan={5} className="py-10 text-center text-slate-400 font-bold">데이터를 불러오는 중...</td></tr>
                ) : gradingAssignments.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-slate-400 font-bold">이 시험지가 출제된 학생이 없습니다.</td></tr>
                ) : (
                  gradingAssignments.map(a => {
                    const studentName = a.student?.name || '알 수 없음';
                    const gradeStr = formatGrade(a.student?.grade);
                    const className = a.class?.name || '반 미지정(공통)';
                    const assignDate = formatDate(a.created_at);
                    
                    const statusField = a.status || '미응시';
                    let statusText = ''; let statusColor = '';
                    
                    if (['채점완료', '완료'].includes(statusField)) {
                      statusText = `${a.total_score || 0}점`; statusColor = 'text-blue-600 bg-blue-50 border border-blue-200';
                    } else if (['응시중', '제출완료'].includes(statusField)) {
                      statusText = '채점대기'; statusColor = 'text-rose-500 bg-rose-50 border border-rose-200';
                    } else {
                      statusText = '미응시'; statusColor = 'text-slate-500 bg-slate-100 border border-slate-200';
                    }

                    return (
                      <tr key={a.assignment_id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 text-xs font-extrabold text-slate-500"><span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">{className}</span></td>
                        <td className="py-3 px-4 font-bold text-[#002864]">{studentName} <span className="text-[10px] text-slate-400 ml-1 font-medium">({gradeStr})</span></td>
                        <td className="py-3 px-4 text-center text-xs font-bold text-slate-500">{assignDate}</td>
                        <td className="py-3 px-4 text-center"><span className={`px-2 py-1 rounded text-[11px] font-extrabold ${statusColor}`}>{statusText}</span></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => router.push(`/exam/review?assignment_id=${a.assignment_id}`)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm transition-colors whitespace-nowrap">
                              채점/리뷰
                            </button>
                            <button onClick={() => cancelAssignment(a.assignment_id)} className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-500 border border-rose-200 hover:border-rose-300 rounded text-xs font-bold shadow-sm transition-colors whitespace-nowrap">
                              출제 취소
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}