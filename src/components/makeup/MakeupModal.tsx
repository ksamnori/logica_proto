// src/components/makeup/MakeupModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const hours = Array.from({ length: 15 }, (_, i) => String(i + 8).padStart(2, "0")); // 08시 ~ 22시
const minutes = ["00", "10", "20", "30", "40", "50"];

interface MakeupModalProps {
  isOpen: boolean;
  makeupData: any | null;
  students: any[];
  instructors: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function MakeupModal({ isOpen, makeupData, students, instructors, onClose, onSuccess }: MakeupModalProps) {
  const [mStudentId, setMStudentId] = useState("");
  const [mInstructorId, setMInstructorId] = useState("");
  const [mClassroom, setMClassroom] = useState("");
  const [mTopic, setMTopic] = useState("");
  const [mNote, setMNote] = useState("");
  const [mStatus, setMStatus] = useState("예정");
  
  // 🌟 [핵심 변경] 시/분을 각각의 드롭다운 상태로 관리하도록 분리
  const [schedules, setSchedules] = useState([{ date: '', sHour: '', sMin: '', eHour: '', eMin: '' }]);
  const [isSaving, setIsSaving] = useState(false);

  const toLocalDateString = (d: Date) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
  };

  useEffect(() => {
    if (isOpen) {
      if (makeupData) {
        setMStudentId(makeupData.student_id?.toString() || "");
        setMInstructorId(makeupData.instructor_id?.toString() || "");
        setMClassroom(makeupData.classroom || "");
        setMTopic(makeupData.target_category_id || "");
        setMStatus(makeupData.status || "예정");

        const d = new Date(makeupData.schedule_date);
        const dateStr = toLocalDateString(d);
        const sHour = String(d.getHours()).padStart(2, '0');
        const sMin = String(d.getMinutes()).padStart(2, '0');
        
        let eHour = '';
        let eMin = '';
        let cleanNote = makeupData.instructor_note || '';
        const match = cleanNote.match(/\[종료예정 (\d{2}):(\d{2})\]/);
        if (match) {
          eHour = match[1];
          eMin = match[2];
          cleanNote = cleanNote.replace(/\[종료예정 \d{2}:\d{2}\] /, '').trim();
        }
        
        setSchedules([{ date: dateStr, sHour, sMin, eHour, eMin }]);
        setMNote(cleanNote);
      } else {
        setMStudentId("");
        setMInstructorId("");
        setMClassroom("");
        setMTopic("");
        setMNote("");
        setMStatus("예정");
        setSchedules([{ date: toLocalDateString(new Date()), sHour: '', sMin: '', eHour: '', eMin: '' }]);
      }
    }
  }, [isOpen, makeupData]);

  // 🌟 [핵심 변경] 시작 시간을 고르면 종료 시간이 자동으로 1시간 뒤로 입력되는 로직
  const updateSchedule = (index: number, field: string, value: string) => {
    setSchedules(prev => prev.map((sch, i) => {
      if (i !== index) return sch;
      
      const updated = { ...sch, [field]: value };

      // 시작 시간(시)이 바뀌었을 때 1시간 후로 종료 시간(시) 자동 채움
      if (field === 'sHour' && value) {
        let nextH = parseInt(value, 10) + 1;
        if (nextH >= 24) nextH = 23; // 자정을 넘기지 않도록 방어
        updated.eHour = String(nextH).padStart(2, '0');
        // 시작 분이 채워져 있고 종료 분이 비어있으면 똑같이 맞춰줌
        if (!updated.eMin && updated.sMin) updated.eMin = updated.sMin;
      }
      // 시작 시간(분)이 바뀌었을 때 종료 시간(분) 동기화
      if (field === 'sMin' && value) {
        if (!updated.eMin) updated.eMin = value;
        // 시가 안 채워져 있었다면 시도 같이 계산
        if (!updated.eHour && updated.sHour) {
          let nextH = parseInt(updated.sHour, 10) + 1;
          if (nextH >= 24) nextH = 23;
          updated.eHour = String(nextH).padStart(2, '0');
        }
      }

      return updated;
    }));
  };

  const addScheduleRow = () => {
    setSchedules(prev => [...prev, { date: toLocalDateString(new Date()), sHour: '', sMin: '', eHour: '', eMin: '' }]);
  };

  const removeScheduleRow = (index: number) => {
    setSchedules(prev => prev.filter((_, i) => i !== index));
  };

  const formatGrade = (grade: any) => {
    if (!grade) return '-';
    if (isNaN(Number(grade))) return grade; 
    const g = parseInt(grade, 10);
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  const saveMakeup = async () => {
    if (!mStudentId || !mInstructorId || !mClassroom) return alert("학생, 강사, 강의실은 필수 항목입니다.");

    for (const sch of schedules) {
      if (!sch.date || !sch.sHour || !sch.sMin) {
        return alert("모든 보강 일정의 날짜와 시작 시간을 정확히 선택해주세요.");
      }
    }

    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : myTenantId;
    if (!validTenantId) return alert("소속 지점 정보가 없습니다.");

    setIsSaving(true);
    try {
      const scheduleData: any[] = schedules.map(sch => {
        // 한국 시간(KST)으로 정확히 ISO 변환
        const targetDate = new Date(`${sch.date}T${sch.sHour}:${sch.sMin}:00+09:00`);
        let finalNote = mNote;
        if (sch.eHour && sch.eMin) {
          finalNote = `[종료예정 ${sch.eHour}:${sch.eMin}] ` + finalNote;
        }

        return {
          student_id: mStudentId,
          instructor_id: mInstructorId,
          schedule_date: targetDate.toISOString(),
          classroom: mClassroom,
          target_category_id: mTopic,
          instructor_note: finalNote,
          status: mStatus,
          tenant_id: validTenantId 
        };
      });

      if (makeupData) {
        const { error } = await supabase.from('individual_makeup').update(scheduleData[0]).eq('makeup_id', makeupData.makeup_id);
        if (error) throw error;
        alert("보강 일정이 성공적으로 수정되었습니다.");
      } else {
        const { error } = await supabase.from('individual_makeup').insert(scheduleData);
        if (error) throw error;
        alert(`${scheduleData.length}개의 보강 일정이 성공적으로 등록되었습니다.`);
      }
      
      onSuccess();
      onClose();
    } catch (e: any) { 
      alert("저장 실패: " + e.message); 
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-tight">📅 1:1 개별 보강 일정 {makeupData ? '수정' : '등록'}</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scroll max-h-[80vh] bg-slate-50 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">대상 학생 <span className="text-rose-500">*</span></label>
              <select value={mStudentId} onChange={e => setMStudentId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="">학생을 선택하세요</option>
                {students.map((s: any) => <option key={s.student_id} value={s.student_id}>{s.name} ({formatGrade(s.grade)})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">담당 강사 <span className="text-rose-500">*</span></label>
              <select value={mInstructorId} onChange={e => setMInstructorId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="">강사를 선택하세요</option>
                {instructors.map((i: any) => <option key={i.instructor_id} value={i.instructor_id}>{i.name} 선생님</option>)}
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <label className="block text-sm font-bold text-slate-700 mb-3">보강 날짜 및 시간 설정 <span className="text-rose-500">*</span></label>
            <div className="flex flex-col gap-2">
              {schedules.map((sch, idx) => (
                <div key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 transition-all focus-within:border-[#002864] focus-within:ring-1 focus-within:ring-[#002864]">
                  
                  {/* 🌟 날짜 칸 축소 (120px 고정) */}
                  <input 
                    type="date" 
                    value={sch.date} 
                    onChange={e => updateSchedule(idx, 'date', e.target.value)} 
                    className="w-[120px] shrink-0 px-2 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white focus:outline-none focus:border-[#002864]" 
                  />
                  
                  {/* 🌟 드롭다운 방식(Select)으로 변경하여 시간이 잘리지 않게 확보 */}
                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <select 
                      value={sch.sHour} 
                      onChange={e => updateSchedule(idx, 'sHour', e.target.value)} 
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-[#002864]"
                    >
                      <option value="">시</option>
                      {hours.map(h => <option key={h} value={h}>{h}시</option>)}
                    </select>
                    <span className="font-bold text-slate-400">:</span>
                    <select 
                      value={sch.sMin} 
                      onChange={e => updateSchedule(idx, 'sMin', e.target.value)} 
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-[#002864]"
                    >
                      <option value="">분</option>
                      {minutes.map(m => <option key={m} value={m}>{m}분</option>)}
                    </select>

                    <span className="text-slate-400 font-bold px-1.5">~</span>

                    <select 
                      value={sch.eHour} 
                      onChange={e => updateSchedule(idx, 'eHour', e.target.value)} 
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-[#002864]"
                    >
                      <option value="">시</option>
                      {hours.map(h => <option key={h} value={h}>{h}시</option>)}
                    </select>
                    <span className="font-bold text-slate-400">:</span>
                    <select 
                      value={sch.eMin} 
                      onChange={e => updateSchedule(idx, 'eMin', e.target.value)} 
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-[#002864]"
                    >
                      <option value="">분</option>
                      {minutes.map(m => <option key={m} value={m}>{m}분</option>)}
                    </select>
                  </div>
                  
                  {!makeupData && schedules.length > 1 && (
                    <button onClick={() => removeScheduleRow(idx)} className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors shrink-0" title="이 일정 삭제">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!makeupData && (
              <button onClick={addScheduleRow} className="mt-3 w-full py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold transition-colors shadow-sm">
                ➕ 날짜 추가하여 여러 번 한 번에 보강 등록하기
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">강의실 <span className="text-rose-500">*</span></label>
              <select value={mClassroom} onChange={e => setMClassroom(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="">선택하세요</option>
                {['1강의실', '2강의실', '3강의실', '4강의실', '5강의실', '6강의실', '7강의실', '클리닉실'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">보강 상태</label>
              <select value={mStatus} onChange={e => setMStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="예정">예정</option><option value="진행중">진행중</option><option value="완료">완료</option><option value="취소">취소</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">보강 내용 및 목표 (단원)</label>
            <input type="text" value={mTopic} onChange={e => setMTopic(e.target.value)} placeholder="예: 2단원 방정식 재시험 및 오답" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]" />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">강사 전달 메모</label>
            <textarea rows={2} value={mNote} onChange={e => setMNote(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864] custom-scroll resize-none" placeholder="특이사항 메모"></textarea>
          </div>
        </div>
        
        <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm">취소</button>
          <button onClick={saveMakeup} disabled={isSaving} className="px-5 py-2.5 bg-[#002864] text-white font-bold rounded-xl hover:bg-blue-900 transition-colors shadow-md text-sm disabled:opacity-50">{makeupData ? '변경사항 저장' : '일정 저장'}</button>
        </div>
      </div>
    </div>
  );
}