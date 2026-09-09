// src/components/exam/GradingModal.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase"; 

interface GradingModalProps {
  isOpen: boolean;
  examId: string;
  title: string;
  onClose: () => void;
  onUpdate: () => void;
}

export default function GradingModal({ isOpen, examId, title, onClose, onUpdate }: GradingModalProps) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [examType, setExamType] = useState<string>('시험'); 

  useEffect(() => {
    if (isOpen && examId) {
      loadAssignments();
    } else {
      setAssignments([]);
    }
  }, [isOpen, examId]);

  const loadAssignments = async () => {
    setIsLoading(true);
    try {
      const { data: masterData } = await supabase.from('exam_master')
        .select('exam_type')
        .eq('exam_id', examId)
        .single();
        
      if (masterData?.exam_type) {
        setExamType(masterData.exam_type);
      }

      // 🌟 [핵심 수정] student_id 속성을 select에 추가하여 undefined 에러 원천 차단!
      const { data, error } = await supabase
        .from('exam_assignment')
        .select('assignment_id, student_id, status, total_score, created_at, student(name), class(name)')
        .eq('exam_id', examId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignments(data || []);
    } catch (err: any) {
      console.error(err);
      alert("출제 현황을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAssignment = async (assignmentId: string) => {
    if (!confirm("이 학생의 출제를 취소(삭제)하시겠습니까?\n채점 기록이 있다면 모두 삭제됩니다.")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('admission_test_report').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      alert("출제가 취소되었습니다.");
      loadAssignments(); 
      onUpdate();
    } catch (err) {
      console.error(err);
      alert("출제 취소 중 오류가 발생했습니다.");
    }
  };

  const openGradingPanel = (assignmentId: string, studentId: string) => {
    if (!studentId || studentId === 'undefined') {
       alert("학생 정보(ID)를 찾을 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
       return;
    }

    if (['주간테스트', '중간테스트', '중간평가', '과제', '과제프린트'].includes(examType)) {
      window.location.href = `/homework/review?assignment_id=${assignmentId}&student_id=${studentId}&is_exam_hw=true`;
    } 
    else {
      window.location.href = `/exam/review?assignment_id=${assignmentId}`;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="bg-emerald-600 px-6 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-white font-black text-lg flex items-center gap-2">
            <span className="text-xl">✅</span> 출제 및 채점 현황
          </h2>
          <button onClick={onClose} className="text-emerald-100 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="p-6 bg-emerald-50/50 border-b border-slate-200 shrink-0">
          <p className="text-sm font-extrabold text-[#002864] mb-1">[{examType}] {title}</p>
          <p className="text-[11px] font-bold text-slate-500">학생별 출제 내역을 확인하고 채점 또는 회수(삭제)할 수 있습니다.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scroll">
          {isLoading ? (
            <div className="text-center py-10 text-slate-400 font-bold text-sm">목록을 불러오는 중입니다...</div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-bold text-sm bg-white rounded-xl border border-slate-200">
              아직 출제된 학생이 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map(a => {
                const sName = Array.isArray(a.student) ? a.student[0]?.name : a.student?.name;
                const cName = Array.isArray(a.class) ? a.class[0]?.name : a.class?.name;
                const isCompleted = ['채점완료', '제출완료', '완료'].includes(a.status);
                
                return (
                  <div key={a.assignment_id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm hover:border-emerald-300 transition-colors">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="bg-[#002864] text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm">{cName || '반 미지정'}</span>
                        <span className="text-[14px] font-black text-slate-800">{sName || '이름 없음'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${isCompleted ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-rose-50 text-rose-500 border-rose-200'}`}>
                          {a.status || '미응시'}
                        </span>
                        {isCompleted && (
                          <span className="text-[11px] font-black text-[#002864]">
                            {a.total_score}점
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-bold">
                          {new Date(a.created_at).toLocaleDateString()} 배부
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0 pl-4 border-l border-slate-100">
                      <button 
                        onClick={() => openGradingPanel(a.assignment_id, a.student_id)} 
                        className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-[11px] font-black transition-colors shadow-sm"
                      >
                        {isCompleted ? '결과 리뷰' : '수동 채점'}
                      </button>
                      <button 
                        onClick={() => handleCancelAssignment(a.assignment_id)} 
                        className="px-3 py-2 bg-white text-rose-500 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg text-[11px] font-bold transition-colors shadow-sm"
                      >
                        출제 취소
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}