// src/components/billing/BillingAutoModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface BillingAutoModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: any[];
  students: any[];
}

export default function BillingAutoModal({ isOpen, onClose, classes, students }: BillingAutoModalProps) {
  const [rules, setRules] = useState<any[]>([]);
  const [autoTargetType, setAutoTargetType] = useState<"all" | "class" | "student">("all");
  const [autoTargetClass, setAutoTargetClass] = useState("");
  const [autoTargetStudent, setAutoTargetStudent] = useState("");
  const [autoScheType, setAutoScheType] = useState<"date" | "day" | "end">("day");
  const [ruleGen, setRuleGen] = useState(true);
  const [ruleSend, setRuleSend] = useState(true);
  const [ruleDateDay, setRuleDateDay] = useState("1일");
  const [ruleWeek, setRuleWeek] = useState("네번째");
  const [ruleDayOfWeek, setRuleDayOfWeek] = useState("목요일");
  const [ruleTime, setRuleTime] = useState("오후 2시 정각");

  useEffect(() => {
    if (isOpen) {
      supabase.from("automation_rule").select("*").eq("rule_category", "BILLING").order("created_at", { ascending: false })
        .then(({ data }) => setRules(data || []));
    }
  }, [isOpen]);

  const addAutoRule = async () => {
    try {
      let tId = null; let tName = '전체 재원생';
      
      if (autoTargetType === 'class') {
        if (!autoTargetClass) return alert('클래스를 선택해주세요.');
        tId = autoTargetClass; 
        tName = '[클래스] ' + classes.find(c => c.class_id.toString() === autoTargetClass)?.name;
      } else if (autoTargetType === 'student') {
        // 💡 UUID 정규식 대신, 입력된 문자열과 정확히 일치하는 학생 데이터를 찾아옵니다.
        const selectedStudent = students.find(s => {
          const labelStr = `${s.name} (${s.school || '학교미상'} ${s.grade || '학년미상'}, 학부모:${s.parent?.phone?.slice(-4) || '없음'})`;
          return labelStr === autoTargetStudent;
        });

        if (!selectedStudent) return alert('학생을 검색 후 목록에서 정확히 선택해주세요.');
        tId = selectedStudent.student_id; 
        tName = '[수강생] ' + selectedStudent.name;
      }

      await supabase.from('automation_rule').insert({
        rule_category: 'BILLING', target_type: autoTargetType, target_id: tId, target_name: tName,
        is_generate: ruleGen, is_send: ruleSend, schedule_type: autoScheType,
        schedule_date: autoScheType === 'date' ? ruleDateDay : null,
        schedule_week: autoScheType === 'day' ? ruleWeek : null,
        schedule_day: autoScheType === 'day' ? ruleDayOfWeek : null,
        schedule_time: ruleTime, is_active: true
      });
      alert("자동 예약 스케줄이 등록되었습니다!");
      
      const { data } = await supabase.from("automation_rule").select("*").eq("rule_category", "BILLING").order("created_at", { ascending: false });
      setRules(data || []);
      setAutoTargetStudent(""); // 입력창 초기화
    } catch (e: any) { alert("예약 등록 실패: " + e.message); }
  };

  const toggleRuleActive = async (id: string, isAct: boolean) => {
    await supabase.from('automation_rule').update({ is_active: isAct }).eq('rule_id', id);
    setRules(prev => prev.map(r => r.rule_id === id ? { ...r, is_active: isAct } : r));
  };
  
  const deleteRule = async (id: string) => {
    await supabase.from('automation_rule').delete().eq('rule_id', id);
    setRules(prev => prev.filter(r => r.rule_id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-slate-100 p-4 border-b border-slate-200 flex justify-between items-center shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">새 예약 등록 <span className="text-xs font-normal text-slate-500 ml-2">학원 전체/클래스별/수강생별 청구서 생성 및 발송 자동화</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-emerald-500 text-2xl font-bold transition-colors leading-none">&times;</button>
        </div>
        <div className="flex h-[550px]">
          {/* 좌측 탭 */}
          <div className="w-1/4 border-r border-slate-200 bg-slate-50 p-3 space-y-2">
            <button onClick={() => setAutoTargetType('all')} className={`w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-colors ${autoTargetType === 'all' ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'bg-transparent border border-transparent hover:border-slate-200 text-slate-500'}`}>학원 전체 설정</button>
            <button onClick={() => setAutoTargetType('class')} className={`w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-colors ${autoTargetType === 'class' ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'bg-transparent border border-transparent hover:border-slate-200 text-slate-500'}`}>클래스별 설정</button>
            <button onClick={() => setAutoTargetType('student')} className={`w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-colors ${autoTargetType === 'student' ? 'bg-white border border-slate-200 text-slate-800 shadow-sm' : 'bg-transparent border border-transparent hover:border-slate-200 text-slate-500'}`}>수강생별 설정</button>
          </div>
          
          {/* 우측 설정 영역 */}
          <div className="w-3/4 p-6 bg-white flex flex-col overflow-hidden">
            <div className="overflow-y-auto custom-scroll flex-1 pr-2">
              {autoTargetType === 'class' && (
                <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-500 mb-1">대상 클래스 선택</label>
                  <select value={autoTargetClass} onChange={e => setAutoTargetClass(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:border-emerald-500 focus:outline-none">
                    <option value="">클래스를 선택하세요</option>
                    {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {autoTargetType === 'student' && (
                <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-500 mb-1">대상 학생 검색</label>
                  <input type="text" value={autoTargetStudent} onChange={e => setAutoTargetStudent(e.target.value)} list="batch_student_list" placeholder="이름 검색 후 선택..." className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:border-emerald-500 focus:outline-none" />
                  <datalist id="batch_student_list">
                    {/* 💡 사용자가 요청한 포맷으로 깔끔하게 목록 표시 (UUID 제거) */}
                    {students.map(s => {
                      const labelStr = `${s.name} (${s.school || '학교미상'} ${s.grade || '학년미상'}, 학부모:${s.parent?.phone?.slice(-4) || '없음'})`;
                      return <option key={s.student_id} value={labelStr} />;
                    })}
                  </datalist>
                </div>
              )}

              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-xl flex flex-col gap-4 mb-6">
                <div className="flex gap-8 border-b border-emerald-100 pb-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-emerald-700"><input type="checkbox" checked={ruleGen} onChange={e => setRuleGen(e.target.checked)} className="w-4 h-4 accent-emerald-500" /> 청구서 생성</label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-emerald-700"><input type="checkbox" checked={ruleSend} onChange={e => setRuleSend(e.target.checked)} className="w-4 h-4 accent-emerald-500" /> 알림톡 발송</label>
                </div>
                
                <div className="flex gap-6">
                  <label className={`flex items-center gap-2 cursor-pointer text-sm font-bold transition-colors ${autoScheType === 'date' ? 'text-emerald-600' : 'text-slate-500'}`}><input type="radio" checked={autoScheType === 'date'} onChange={() => setAutoScheType('date')} className="w-4 h-4 accent-emerald-500" /> 일자 지정</label>
                  <label className={`flex items-center gap-2 cursor-pointer text-sm font-bold transition-colors ${autoScheType === 'day' ? 'text-emerald-600' : 'text-slate-500'}`}><input type="radio" checked={autoScheType === 'day'} onChange={() => setAutoScheType('day')} className="w-4 h-4 accent-emerald-500" /> 요일 지정</label>
                  <label className={`flex items-center gap-2 cursor-pointer text-sm font-bold transition-colors ${autoScheType === 'end' ? 'text-emerald-600' : 'text-slate-500'}`}><input type="radio" checked={autoScheType === 'end'} onChange={() => setAutoScheType('end')} className="w-4 h-4 accent-emerald-500" /> 말일 기준</label>
                </div>

                <div className="flex gap-2">
                  {autoScheType === 'date' && (
                    <select value={ruleDateDay} onChange={e => setRuleDateDay(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none">
                      {Array.from({length: 31}, (_, i) => <option key={i+1} value={`${i+1}일`}>{i+1}일</option>)}
                    </select>
                  )}
                  {autoScheType === 'day' && (
                    <>
                      <select value={ruleWeek} onChange={e => setRuleWeek(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none">
                        {['첫번째', '두번째', '세번째', '네번째', '마지막'].map(w => <option key={w} value={w}>매월 {w} 주</option>)}
                      </select>
                      <select value={ruleDayOfWeek} onChange={e => setRuleDayOfWeek(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none">
                        {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </>
                  )}
                  <select value={ruleTime} onChange={e => setRuleTime(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none">
                    {Array.from({length: 15}, (_, i) => i + 8).map(h => {
                      const text = h > 12 ? `오후 ${h-12}시` : (h === 12 ? `오후 12시` : `오전 ${h}시`);
                      return <optgroup key={h} label={text}><option value={`${text} 정각`}>{text} 00분</option><option value={`${text} 반`}>{text} 30분</option></optgroup>;
                    })}
                  </select>
                </div>

                <div className="text-right mt-2">
                  <button onClick={addAutoRule} className="bg-emerald-500 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow hover:bg-emerald-600 transition-colors flex items-center gap-1 ml-auto">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 새 예약 등록
                  </button>
                </div>
              </div>

              <h4 className="text-xs font-bold text-slate-500 mb-2">등록된 알림 스케줄</h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs text-center whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr><th className="py-2.5 px-3 text-left w-1/4">적용 대상</th><th className="py-2.5 w-1/3">예약 시점</th><th className="py-2.5 w-[15%]">항목</th><th className="py-2.5 w-[15%]">활성화</th><th className="py-2.5 w-[10%]">삭제</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-slate-700 font-bold">
                    {rules.length === 0 ? <tr><td colSpan={5} className="py-6 text-slate-400">등록된 설정이 없습니다.</td></tr> :
                      rules.map(r => {
                        let sText = r.schedule_type === 'date' ? `매월 ${r.schedule_date} ${r.schedule_time}` : r.schedule_type === 'day' ? `${r.schedule_week} ${r.schedule_day} ${r.schedule_time}` : `매월 말일 ${r.schedule_time}`;
                        return (
                          <tr key={r.rule_id} className={`hover:bg-slate-50 transition-opacity ${r.is_active ? 'opacity-100' : 'opacity-50'}`}>
                            <td className="py-3 px-3 text-left"><div className="text-slate-800 text-[12px] truncate max-w-[150px]">{r.target_name}</div></td>
                            <td className="py-3 text-[12px] text-slate-600">{sText}</td>
                            <td className="py-3">{r.is_generate && <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded mr-1 text-[10px]">생성</span>}{r.is_send && <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded text-[10px]">발송</span>}</td>
                            <td className="py-3 text-center">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={r.is_active} onChange={e => toggleRuleActive(r.rule_id, e.target.checked)} className="sr-only peer" />
                                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                              </label>
                            </td>
                            <td className="py-3"><button onClick={() => deleteRule(r.rule_id)} className="text-rose-500 bg-white border border-rose-200 hover:bg-rose-500 hover:text-white px-2.5 py-1 rounded-lg text-[11px] shadow-sm">삭제</button></td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}