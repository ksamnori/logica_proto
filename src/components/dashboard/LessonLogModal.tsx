// src/components/dashboard/LessonLogModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface LessonLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  classId: string;
  students: any[];
  initialData?: any | null;
}

const getKSTDateStr = (offsetDays = 0) => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000) + (offsetDays * 86400000));
  return kst.toISOString().split('T')[0];
};

export default function LessonLogModal({ isOpen, onClose, onSuccess, classId, students, initialData }: LessonLogModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lessonForm, setLessonForm] = useState({
    lesson_log_id: null as number | null,
    actual_date: getKSTDateStr(),
    progress_desc: "",
    homework_title: "",
    due_date: "",
    homework_desc: "",
    individual_comments: [] as { student_id: string; comment: string }[],
    instructor_note: ""
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        const desc = initialData.homework_desc || "";
        const progressMatch = desc.match(/\[📖 오늘의 진도\]\n([\s\S]*?)(?=\n\n\[📝 공통 과제\]|$)/);
        const hwMatch = desc.match(/\[📝 공통 과제\]\n([\s\S]*?)$/);

        let p = progressMatch ? progressMatch[1].trim() : "";
        let hRaw = hwMatch ? hwMatch[1].trim() : "";
        
        let t = "";
        let d = "";
        let h = hRaw;

        if (!progressMatch && !hwMatch) h = desc;

        const titleMatch = h.match(/^🏷️ 과제명: (.*?)(\n|$)/);
        if (titleMatch) {
          t = titleMatch[1].trim();
          h = h.replace(titleMatch[0], "");
        }
        
        const dueMatch = h.match(/^⏰ 기한: (.*?)(\n|$)/);
        if (dueMatch) {
          d = dueMatch[1].trim();
          h = h.replace(dueMatch[0], "");
        }

        const mappedComments = (initialData.lesson_log_student_comment || []).map((c: any) => ({
          student_id: c.student_id,
          comment: c.comment
        }));

        setLessonForm({
          lesson_log_id: initialData.lesson_log_id,
          actual_date: initialData.actual_date ? initialData.actual_date.split('T')[0] : getKSTDateStr(),
          progress_desc: p,
          homework_title: t,
          due_date: d,
          homework_desc: h.trim(),
          individual_comments: mappedComments,
          instructor_note: initialData.instructor_note || ""
        });
      } else {
        setLessonForm({
          lesson_log_id: null,
          actual_date: getKSTDateStr(),
          progress_desc: "",
          homework_title: "",
          due_date: "",
          homework_desc: "",
          individual_comments: [],
          instructor_note: ""
        });
      }
    }
  }, [isOpen, initialData]);

  const handleSubmit = async () => {
    if (!classId) return alert("수강반 정보가 없습니다.");
    if (!lessonForm.progress_desc.trim() && !lessonForm.homework_desc.trim()) {
      return alert("진도 또는 공통 과제 내용 중 하나는 필수로 입력해주세요.");
    }

    let finalDesc = "";
    if (lessonForm.progress_desc.trim()) {
      finalDesc += `[📖 오늘의 진도]\n${lessonForm.progress_desc.trim()}\n\n`;
    }
    
    if (lessonForm.homework_title.trim() || lessonForm.due_date.trim() || lessonForm.homework_desc.trim()) {
      finalDesc += `[📝 공통 과제]\n`;
      if (lessonForm.homework_title.trim()) finalDesc += `🏷️ 과제명: ${lessonForm.homework_title.trim()}\n`;
      if (lessonForm.due_date.trim()) finalDesc += `⏰ 기한: ${lessonForm.due_date.trim()}\n`;
      if (lessonForm.homework_title.trim() || lessonForm.due_date.trim()) finalDesc += `\n`;
      if (lessonForm.homework_desc.trim()) finalDesc += `${lessonForm.homework_desc.trim()}`;
    }
    
    finalDesc = finalDesc.trim();

    setIsLoading(true);
    try {
      let currentLogId = lessonForm.lesson_log_id;

      if (currentLogId) {
        const { error: logErr } = await supabase.from("daily_lesson_log").update({
          actual_date: lessonForm.actual_date || getKSTDateStr(),
          homework_desc: finalDesc,
          instructor_note: lessonForm.instructor_note
        }).eq('lesson_log_id', currentLogId);
        
        if (logErr) throw logErr;
      } else {
        const { data: newLog, error: logErr } = await supabase.from("daily_lesson_log").insert({
          class_id: classId,
          actual_date: lessonForm.actual_date || getKSTDateStr(),
          homework_desc: finalDesc, 
          instructor_note: lessonForm.instructor_note 
        }).select('lesson_log_id').single();
        
        if (logErr) throw logErr;
        currentLogId = newLog.lesson_log_id;
      }

      if (currentLogId) {
         await supabase.from('lesson_log_student_comment').delete().eq('lesson_log_id', currentLogId);
         const validComments = lessonForm.individual_comments.filter(c => c.student_id && c.comment.trim());
         
         if (validComments.length > 0) {
           const inserts = validComments.map(c => ({
             lesson_log_id: currentLogId,
             student_id: c.student_id,
             comment: c.comment.trim()
           }));
           await supabase.from('lesson_log_student_comment').insert(inserts);
         }
      }

      alert(`✅ 수업 일지가 성공적으로 ${lessonForm.lesson_log_id ? '수정' : '등록'}되었습니다!`);
      onSuccess();
      onClose();
    } catch (e: any) {
      console.error(e);
      alert("처리 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-gradient-to-r from-indigo-700 to-blue-800 p-5 text-white flex justify-between items-center shrink-0">
          <h3 className="text-lg font-black flex items-center gap-2">📝 {lessonForm.lesson_log_id ? "수업 일지 내용 수정" : "새 수업 일지 작성"}</h3>
          <button onClick={onClose} disabled={isLoading} className="text-white hover:text-rose-400 text-2xl font-bold leading-none transition-colors">&times;</button>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] bg-slate-50/50 custom-scroll">
          
          {/* 🌟 1. 상단 1열: 수업일자, 과제명, 기한을 한 줄로 배치 */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex flex-col gap-1.5 md:w-1/4 shrink-0">
              <label className="text-sm font-black text-slate-700 flex items-center gap-1.5">
                📅 수업 일자 <span className="text-[10px] text-slate-400 font-normal">(소급가능)</span>
              </label>
              <input 
                type="date" 
                value={lessonForm.actual_date} 
                onChange={e => setLessonForm({...lessonForm, actual_date: e.target.value})} 
                className="border border-slate-300 p-2.5 w-full rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm"
              />
            </div>
            
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[13px] font-black text-indigo-700 flex items-center gap-1">
                <span>🏷️ 과제명</span> <span className="text-[10px] font-bold bg-indigo-50 text-indigo-400 px-1.5 py-0.5 rounded">(선택)</span>
              </label>
              <input 
                type="text" 
                value={lessonForm.homework_title} 
                onChange={e => setLessonForm({...lessonForm, homework_title: e.target.value})} 
                className="border border-indigo-200 p-2.5 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm placeholder-slate-300" 
                placeholder="예) 워크북 1단원" 
              />
            </div>

            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[13px] font-black text-indigo-700 flex items-center gap-1">
                <span>⏰ 기한</span> <span className="text-[10px] font-bold bg-indigo-50 text-indigo-400 px-1.5 py-0.5 rounded">(선택)</span>
              </label>
              <input 
                type="text" 
                value={lessonForm.due_date} 
                onChange={e => setLessonForm({...lessonForm, due_date: e.target.value})} 
                className="border border-indigo-200 p-2.5 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm placeholder-slate-300" 
                placeholder="예) 다음주 수요일" 
              />
            </div>
          </div>

          {/* 🌟 2. 텍스트 영역: 진도와 공통 과제 내용을 똑같은 높이로 나란히 배치 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-black text-indigo-700 flex items-center gap-1.5">
                <span>📖 오늘의 진도</span> <span className="text-rose-500">*</span>
              </label>
              <textarea 
                value={lessonForm.progress_desc} 
                onChange={e => setLessonForm({...lessonForm, progress_desc: e.target.value})} 
                rows={5}
                className="border border-indigo-200 p-4 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm resize-none placeholder-slate-300"
                placeholder="예) 이차방정식의 근과 계수 개념 학습 및 대표 유형 문제 풀이 (p.45 ~ p.50)" 
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-black text-indigo-700 flex items-center gap-1.5">
                <span>📝 공통 과제 내용</span> <span className="text-rose-500">*</span>
              </label>
              <textarea 
                value={lessonForm.homework_desc} 
                onChange={e => setLessonForm({...lessonForm, homework_desc: e.target.value})} 
                rows={5}
                className="border border-indigo-200 p-4 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm resize-none placeholder-slate-300"
                placeholder="예) 워크북 p.20 ~ p.25 홀수번 풀이 및 채점해오기" 
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <label className="text-sm font-black text-emerald-700 flex items-center gap-1.5">
              <span>🧑‍🎓 개별 특이 과제 / 코멘트</span>
              <span className="text-[11px] text-emerald-600/70 font-bold bg-emerald-50 px-2 py-0.5 rounded">(선택)</span>
            </label>
            <div className="flex flex-col gap-2">
              {lessonForm.individual_comments.map((ic, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-emerald-50/30 p-2.5 rounded-xl border border-emerald-100">
                  <select 
                    value={ic.student_id} 
                    onChange={(e) => {
                      const newComments = [...lessonForm.individual_comments];
                      newComments[idx].student_id = e.target.value;
                      setLessonForm({ ...lessonForm, individual_comments: newComments });
                    }}
                    className="border border-slate-300 p-2.5 w-[120px] rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:border-emerald-500 shrink-0 shadow-sm"
                  >
                    <option value="">학생 선택</option>
                    {students.map((s: any) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
                  </select>
                  <textarea 
                    value={ic.comment} 
                    onChange={(e) => {
                      const newComments = [...lessonForm.individual_comments];
                      newComments[idx].comment = e.target.value;
                      setLessonForm({ ...lessonForm, individual_comments: newComments });
                    }}
                    rows={2}
                    className="border border-slate-300 p-2.5 flex-1 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-emerald-500 resize-none placeholder-slate-400 shadow-sm"
                    placeholder="특정 학생의 개별 과제나 코멘트를 입력하세요."
                  />
                  <button 
                    onClick={() => {
                      const newComments = lessonForm.individual_comments.filter((_, i) => i !== idx);
                      setLessonForm({ ...lessonForm, individual_comments: newComments });
                    }}
                    className="mt-0.5 p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="이 코멘트 지우기"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                  </button>
                </div>
              ))}
            </div>
            <button 
              onClick={() => setLessonForm(prev => ({ ...prev, individual_comments: [...prev.individual_comments, { student_id: "", comment: "" }] }))}
              className="w-full py-2.5 bg-white text-emerald-600 hover:bg-emerald-50 font-bold text-xs rounded-xl border-2 border-emerald-200 border-dashed transition-colors flex items-center justify-center gap-1.5 mt-1 shadow-sm"
            >
              <span className="text-base leading-none">➕</span> 학생 특정 코멘트 추가하기
            </button>
          </div>

          <div className="flex flex-col gap-1.5 pt-4 border-t border-slate-200">
            <label className="text-sm font-black text-slate-500 flex items-center gap-1.5">
              <span>🔒 강사 특이사항 메모</span>
              <span className="text-[11px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded">(학부모 미노출)</span>
            </label>
            <textarea 
              value={lessonForm.instructor_note} 
              onChange={e => setLessonForm({...lessonForm, instructor_note: e.target.value})} 
              rows={2}
              className="border border-slate-300 p-3 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 bg-white shadow-sm resize-none placeholder-slate-300"
              placeholder="강사들끼리만 공유할 태도 불량, 특별 케이스 등의 내용을 적어주세요." 
            />
          </div>

        </div>
        
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={isLoading} className="px-6 py-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-xl text-sm transition-colors shadow-sm">취소</button>
          <button onClick={handleSubmit} disabled={isLoading} className="px-6 py-3 bg-[#002864] hover:bg-blue-900 text-white font-black rounded-xl text-sm shadow-md transition-colors flex items-center gap-2">
            {isLoading ? "처리 중..." : `✅ ${lessonForm.lesson_log_id ? "수정 내용 저장" : "새 일지 등록 완료"}`}
          </button>
        </div>
      </div>
    </div>
  );
}