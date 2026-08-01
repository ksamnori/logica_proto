// src/components/makeup/MakeupModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const UI_DAYS = [
  { val: '월', color: 'text-slate-700' }, { val: '화', color: 'text-slate-700' },
  { val: '수', color: 'text-slate-700' }, { val: '목', color: 'text-slate-700' },
  { val: '금', color: 'text-slate-700' }, { val: '토', color: 'text-blue-600' },
  { val: '일', color: 'text-red-500' }
];

const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => String(i + 8).padStart(2, '0'));
const MIN_OPTIONS = ['00', '10', '20', '30', '40', '50'];

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
  const [mBaseDate, setMBaseDate] = useState("");
  const [mClassroom, setMClassroom] = useState("");
  const [mTopic, setMTopic] = useState("");
  const [mNote, setMNote] = useState("");
  const [mStatus, setMStatus] = useState("예정");
  const [scheduleDays, setScheduleDays] = useState(
    UI_DAYS.map(d => ({ day: d.val, color: d.color, checked: false, sHour: '', sMin: '', eHour: '', eMin: '' }))
  );
  const [isSaving, setIsSaving] = useState(false);

  const toLocalDateString = (d: Date) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
  };

  const getNextDayOfWeek = (baseDateStr: string, dayName: string) => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const targetDay = days.indexOf(dayName);
    const baseDate = new Date(baseDateStr);
    let currentDay = baseDate.getDay();
    let distance = targetDay - currentDay;
    if (distance < 0) distance += 7;
    baseDate.setDate(baseDate.getDate() + distance);
    return baseDate;
  };

  useEffect(() => {
    if (isOpen) {
      if (makeupData) {
        setMStudentId(makeupData.student_id?.toString() || "");
        setMInstructorId(makeupData.instructor_id?.toString() || "");
        
        const d = new Date(makeupData.schedule_date);
        setMBaseDate(toLocalDateString(d));

        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const currentDayName = dayNames[d.getDay()];
        
        let eHour = '', eMin = '';
        let cleanNote = makeupData.instructor_note || '';
        const match = cleanNote.match(/\[종료예정 (\d{2}):(\d{2})\]/);
        if (match) {
          eHour = match[1];
          eMin = match[2];
          cleanNote = cleanNote.replace(/\[종료예정 \d{2}:\d{2}\] /, '').trim();
        }

        setScheduleDays(UI_DAYS.map(s => {
          if (s.val === currentDayName) {
            return { ...s, day: s.val, checked: true, sHour: String(d.getHours()).padStart(2, '0'), sMin: String(d.getMinutes()).padStart(2, '0'), eHour, eMin };
          }
          return { ...s, day: s.val, checked: false, sHour: '', sMin: '', eHour: '', eMin: '' };
        }));

        setMClassroom(makeupData.classroom || "");
        setMTopic(makeupData.target_category_id || "");
        setMNote(cleanNote);
        setMStatus(makeupData.status || "예정");
      } else {
        setMStudentId("");
        setMInstructorId("");
        setMBaseDate(toLocalDateString(new Date()));
        setMClassroom("");
        setMTopic("");
        setMNote("");
        setMStatus("예정");
        setScheduleDays(UI_DAYS.map(d => ({ day: d.val, color: d.color, checked: false, sHour: '', sMin: '', eHour: '', eMin: '' })));
      }
    }
  }, [isOpen, makeupData]);

  const handleDayCheck = (dayVal: string, checked: boolean) => {
    setScheduleDays(prev => prev.map(d => {
      if (d.day !== dayVal) return d;
      let newD = { ...d, checked };
      if (checked) {
        const firstChecked = prev.find(p => p.checked && p.day !== dayVal);
        if (firstChecked) {
          newD.sHour = firstChecked.sHour; newD.sMin = firstChecked.sMin;
          newD.eHour = firstChecked.eHour; newD.eMin = firstChecked.eMin;
        }
      } else {
        newD.sHour = ''; newD.sMin = ''; newD.eHour = ''; newD.eMin = '';
      }
      return newD;
    }));
  };

  const handleTimeChange = (dayVal: string, field: string, val: string) => {
    setScheduleDays(prev => prev.map(d => d.day === dayVal ? { ...d, [field]: val } : d));
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
    if (!mStudentId || !mInstructorId || !mBaseDate || !mClassroom) return alert("학생, 강사, 기준일, 강의실은 필수 항목입니다.");

    const checkedDays = scheduleDays.filter(d => d.checked);
    if (checkedDays.length === 0) return alert("보강을 진행할 요일과 시간을 최소 1개 이상 설정해주세요.");

    setIsSaving(true);
    try {
      const scheduleData: any[] = [];
      for (const d of checkedDays) {
        if (!d.sHour || !d.sMin) {
          alert(`${d.day}요일의 시작 시간을 선택해주세요!`);
          setIsSaving(false);
          return;
        }
        
        const targetDate = getNextDayOfWeek(mBaseDate, d.day);
        targetDate.setHours(parseInt(d.sHour), parseInt(d.sMin), 0, 0);

        let finalNote = mNote;
        if (d.eHour && d.eMin) finalNote = `[종료예정 ${d.eHour}:${d.eMin}] ` + finalNote;

        scheduleData.push({
          student_id: mStudentId,
          instructor_id: mInstructorId,
          schedule_date: targetDate.toISOString(),
          classroom: mClassroom,
          target_category_id: mTopic,
          instructor_note: finalNote,
          status: mStatus
        });
      }

      if (makeupData) {
        if (scheduleData.length > 1) {
          alert("기존 일정을 수정할 때는 1개의 요일만 선택 가능합니다.\n새로 등록을 이용해주세요.");
          setIsSaving(false);
          return;
        }
        await supabase.from('individual_makeup').update(scheduleData[0]).eq('makeup_id', makeupData.makeup_id);
        alert("보강 일정이 성공적으로 수정되었습니다.");
      } else {
        await supabase.from('individual_makeup').insert(scheduleData);
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">보강 기준일 (해당 주간) <span className="text-rose-500">*</span></label>
              <input type="date" value={mBaseDate} onChange={e => setMBaseDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">강의실 <span className="text-rose-500">*</span></label>
              <select value={mClassroom} onChange={e => setMClassroom(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="">선택하세요</option>
                {['1강의실', '2강의실', '3강의실', '4강의실', '5강의실', '6강의실', '7강의실', '클리닉실'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <label className="block text-sm font-bold text-slate-700 mb-3">보강 요일 및 시간 설정 <span className="text-rose-500">*</span> <span className="text-xs text-slate-400 font-normal ml-2">기준일 이후 가장 가까운 요일로 다중 등록 가능</span></label>
            <div className="flex flex-col gap-2">
              {scheduleDays.map(d => (
                <div key={d.day} className={`flex flex-wrap sm:flex-nowrap items-center gap-4 bg-slate-50 p-3 rounded-xl border transition-colors ${d.checked ? 'border-[#002864] ring-1 ring-[#002864] bg-blue-50/20' : 'border-slate-200'}`}>
                  <label className="flex items-center space-x-2 cursor-pointer w-16 shrink-0">
                    <input type="checkbox" checked={d.checked} onChange={e => handleDayCheck(d.day, e.target.checked)} className="w-[1.25rem] h-[1.25rem] accent-[#002864] cursor-pointer" />
                    <span className={`font-bold ${d.color}`}>{d.day}</span>
                  </label>
                  {d.checked && (
                    <div className="flex flex-1 items-center gap-1 transition-all">
                      <select value={d.sHour} onChange={e => handleTimeChange(d.day, 'sHour', e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm bg-white font-bold cursor-pointer">
                        <option value="">시</option>{HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}시</option>)}
                      </select>
                      <span className="font-bold text-slate-400">:</span>
                      <select value={d.sMin} onChange={e => handleTimeChange(d.day, 'sMin', e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm bg-white font-bold cursor-pointer">
                        <option value="">분</option>{MIN_OPTIONS.map(m => <option key={m} value={m}>{m}분</option>)}
                      </select>
                      <span className="font-bold text-slate-400 mx-2">~</span>
                      <select value={d.eHour} onChange={e => handleTimeChange(d.day, 'eHour', e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm bg-white font-bold cursor-pointer">
                        <option value="">시</option>{HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}시</option>)}
                      </select>
                      <span className="font-bold text-slate-400">:</span>
                      <select value={d.eMin} onChange={e => handleTimeChange(d.day, 'eMin', e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm bg-white font-bold cursor-pointer">
                        <option value="">분</option>{MIN_OPTIONS.map(m => <option key={m} value={m}>{m}분</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">보강 내용 및 목표 (단원)</label>
              <input type="text" value={mTopic} onChange={e => setMTopic(e.target.value)} placeholder="예: 2단원 방정식 재시험 및 오답" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">보강 상태</label>
              <select value={mStatus} onChange={e => setMStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#002864]">
                <option value="예정">예정</option><option value="진행중">진행중</option><option value="완료">완료</option><option value="취소">취소</option>
              </select>
            </div>
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