// src/app/launch-class/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

export default function LaunchRegularClassPage() {
  const [form, setForm] = useState({
    levelCode: "U", course: "", daysCode: "", period: "", ym: "",
    name: "", targetGrade: "", instructorId: "", status: "예정"
  });
  
  const [schedules, setSchedules] = useState(
    DAYS.map(day => ({ day, checked: false, start_time: "", end_time: "" }))
  );
  
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const previewCode = `${form.levelCode}${form.course.padEnd(2, "_")}${form.daysCode.toUpperCase() || "_"}${form.period || "_"} ? ${form.ym.padEnd(4, "_")}`;

  useEffect(() => {
    fetchInstructors();
  }, []);

  const fetchInstructors = async () => {
    const { data } = await supabase.from("instructor").select("instructor_id, name, position").eq("status", "재직");
    setInstructors(data || []);
  };

  const handleScheduleChange = (day: string, field: string, value: any) => {
    setSchedules(prev => prev.map(s => {
      if (s.day !== day) return s;
      let updated = { ...s, [field]: value };
      if (field === "checked" && value) {
        const first = prev.find(p => p.checked);
        if (first) { updated.start_time = first.start_time; updated.end_time = first.end_time; }
      } else if (field === "checked" && !value) {
        updated.start_time = ""; updated.end_time = "";
      }
      return updated;
    }));
  };

  const autoFillClassName = () => {
    if (form.name.trim() !== "") return;
    if (form.course && form.daysCode && form.period) {
      setForm({ ...form, name: `${form.levelCode}${form.course}${form.daysCode.toUpperCase()}${form.period}` });
    }
  };

  const registerClass = async () => {
    const { levelCode, course, daysCode, period, ym, name, targetGrade, instructorId, status } = form;
    const checkedSchedules = schedules.filter(s => s.checked);

    if (!course || !daysCode || !period || !ym || !name || !instructorId || checkedSchedules.length === 0) {
      return alert("필수 항목(*)을 채우고 실제 요일을 최소 1개 이상 선택해주세요.");
    }

    for (const s of checkedSchedules) {
      if (!s.start_time) return alert(`${s.day}요일의 시작 시간을 입력해주세요!`);
    }

    setIsSubmitting(true);
    try {
      const basePrefix = `${levelCode}${course}${daysCode.toUpperCase()}${period}`;
      const { data: existing } = await supabase.from('class').select('code').like('code', `${basePrefix}%${ym}`);
      
      let nextAlphabet = 'A';
      if (existing && existing.length > 0) {
        const used = existing.map((c: any) => c.code.replace(basePrefix, '').replace(ym, ''));
        used.sort().reverse();
        nextAlphabet = String.fromCharCode(used[0].charCodeAt(0) + 1);
      }
      
      const finalCode = `${basePrefix}${nextAlphabet}${ym}`;
      const levelName = { U: "Ultimate", M: "Master", A: "Apex", T: "Titan", H: "Horizon" }[levelCode] || levelCode;

      const { data: newClass, error: classErr } = await supabase.from('class').insert([{
        code: finalCode, name: name.trim(), level_name: levelName, target_grade: targetGrade || null,
        schedule_days: checkedSchedules.map(s => s.day).join(', '), instructor_id: instructorId, status: status
      }]).select().single();

      if (classErr) throw classErr;

      const scheduleData = checkedSchedules.map(s => ({
        class_id: newClass.class_id, day_of_week: s.day, start_time: s.start_time, end_time: s.end_time || null
      }));

      const { error: schErr } = await supabase.from('class_schedule').insert(scheduleData);
      if (schErr) throw schErr;

      alert(`🎉 반 개설 완료!\n클래스 코드 [ ${finalCode} ] 가 자동 부여되었습니다.`);
      
      try {
        if (window.opener && !window.opener.closed && window.opener.refreshClasses) window.opener.refreshClasses();
      } catch (e) {}
      localStorage.setItem('logica_refresh_signal', JSON.stringify({ target: 'class', time: Date.now() }));
      window.close();

    } catch (e: any) { alert(`❌ 오류 발생: ${e.message}`); setIsSubmitting(false); }
  };

  return (
    <div className="flex items-start justify-center min-h-screen p-6 bg-slate-50 font-pretendard">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden flex flex-col mt-4">
        <div className="bg-[#002864] text-white p-6 shrink-0 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">🏫 로지카 신규 정규반 개설</h1>
            <p className="text-blue-200 text-sm mt-1">체계적인 네이밍 룰에 따라 클래스 코드가 자동 생성됩니다.</p>
          </div>
          <div className="bg-blue-900 px-4 py-2 rounded-lg border border-blue-700">
            <span className="text-xs text-blue-300 block">생성될 클래스 코드 미리보기</span>
            <span className="text-2xl font-mono font-bold tracking-widest text-emerald-400">{previewCode}</span>
          </div>
        </div>

        <div className="p-8 space-y-8">
          <div>
            <h2 className="text-lg font-bold text-slate-800 border-b-2 border-slate-200 pb-2 mb-4">1. 클래스 코드 조합 정보</h2>
            <div className="grid grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">레벨 (1자리)</label>
                <select value={form.levelCode} onChange={e => setForm({...form, levelCode: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:ring-2 focus:ring-[#002864]">
                  <option value="U">Ultimate (U)</option><option value="M">Master (M)</option><option value="A">Apex (A)</option>
                  <option value="T">Titan (T)</option><option value="H">Horizon (H)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">과정 (2자리)</label>
                <input type="text" maxLength={2} value={form.course} onChange={e => setForm({...form, course: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 31" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">요일코드 (1~7자리)</label>
                <input type="text" maxLength={7} value={form.daysCode} onChange={e => setForm({...form, daysCode: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-center uppercase focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: MWF" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">교시 (1자리)</label>
                <input type="text" maxLength={1} value={form.period} onChange={e => setForm({...form, period: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 1" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">개강연월 (4자리)</label>
                <input type="text" maxLength={4} value={form.ym} onChange={e => setForm({...form, ym: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 2609" />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold text-slate-800 border-b-2 border-slate-200 pb-2 mb-4">2. 클래스 상세 정보</h2>
            <div className="grid grid-cols-2 gap-5">
              <div className="col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">반 이름 (표시용) <span className="text-red-500">*</span> <span className="text-xs text-blue-500 font-normal ml-2">클릭하면 위 조합을 바탕으로 깔끔하게 자동 완성됩니다.</span></label>
                <input type="text" value={form.name} onFocus={autoFillClassName} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] font-bold" placeholder="예: U31MWF1" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">대상 학년</label>
                <input type="text" value={form.targetGrade} onChange={e => setForm({...form, targetGrade: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 초5 ~ 초6" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">담당 강사 <span className="text-red-500">*</span></label>
                <select value={form.instructorId} onChange={e => setForm({...form, instructorId: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]">
                  <option value="">강사를 선택하세요</option>
                  {instructors.map(i => <option key={i.instructor_id} value={i.instructor_id}>{i.name} ({i.position})</option>)}
                </select>
              </div>

              <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <label className="block text-sm font-bold text-slate-700 mb-3">실제 수업 요일 및 시간 설정 <span className="text-red-500">*</span></label>
                <div className="flex flex-col gap-2">
                  {schedules.map(s => (
                    <div key={s.day} className={`flex items-center gap-4 bg-white p-2.5 rounded-lg border transition-colors ${s.checked ? 'border-[#002864] ring-1 ring-[#002864]' : 'border-slate-200'}`}>
                      <label className="flex items-center gap-2 cursor-pointer w-16 shrink-0">
                        <input type="checkbox" checked={s.checked} onChange={e => handleScheduleChange(s.day, "checked", e.target.checked)} className="w-5 h-5 accent-[#002864]" />
                        <span className={`font-bold ${s.day === '토' ? 'text-blue-600' : s.day === '일' ? 'text-red-500' : 'text-slate-700'}`}>{s.day}</span>
                      </label>
                      {s.checked && (
                        <div className="flex-1 flex items-center gap-2">
                          <input type="time" value={s.start_time} onChange={e => handleScheduleChange(s.day, "start_time", e.target.value)} className="px-3 py-1.5 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm w-full font-bold" />
                          <span className="font-bold text-slate-400">~</span>
                          <input type="time" value={s.end_time} onChange={e => handleScheduleChange(s.day, "end_time", e.target.value)} className="px-3 py-1.5 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm w-full font-bold" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">반 상태</label>
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]">
                  <option value="예정">📅 개강 예정</option><option value="진행중">🟢 진행 중</option><option value="종료">🔴 종료됨</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={registerClass} disabled={isSubmitting} className="flex-1 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-lg py-4 px-4 rounded-xl shadow-lg transition-all transform hover:scale-[1.01] disabled:opacity-50">
              {isSubmitting ? "처리 중..." : "자동 코드 부여 및 정규반 개설하기"}
            </button>
            <button onClick={() => window.close()} className="px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-lg rounded-xl shadow-sm transition-all border border-slate-300">
              창 닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}