// src/components/unpaid/UnpaidAutoModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface UnpaidAutoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UnpaidAutoModal({ isOpen, onClose }: UnpaidAutoModalProps) {
  const [autoRules, setAutoRules] = useState<any[]>([]);
  const [ruleDay, setRuleDay] = useState("3");
  const [ruleTime, setRuleTime] = useState("오전 10시 정각");

  useEffect(() => {
    if (isOpen) {
      loadRules();
    }
  }, [isOpen]);

  const loadRules = async () => {
    const { data } = await supabase
      .from("automation_rule")
      .select("*")
      .eq("rule_category", "UNPAID")
      .order("created_at", { ascending: false });
    setAutoRules(data || []);
  };

  const addAutoRule = async () => {
    try {
      await supabase.from('automation_rule').insert({
        rule_category: 'UNPAID', 
        target_type: 'all', 
        target_name: '전체 미납자',
        is_send: true, 
        schedule_type: 'after_billing',
        schedule_date: ruleDay, // "+3일 후" 등
        schedule_time: ruleTime, 
        is_active: true
      });
      alert("자동 독촉 스케줄이 시스템에 등록되었습니다.");
      loadRules();
    } catch (e: any) {
      alert("등록 실패: " + e.message);
    }
  };

  const toggleRuleActive = async (id: string, isAct: boolean) => {
    await supabase.from('automation_rule').update({ is_active: isAct }).eq('rule_id', id);
    setAutoRules(prev => prev.map(r => r.rule_id === id ? { ...r, is_active: isAct } : r));
  };

  const deleteRule = async (id: string) => {
    await supabase.from('automation_rule').delete().eq('rule_id', id);
    setAutoRules(prev => prev.filter(r => r.rule_id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-slate-100 p-4 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-base font-extrabold text-slate-800">새 예약 등록 <span className="text-xs font-normal text-slate-500 ml-2">미납 안내문자 발송 자동화</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-rose-500 text-2xl font-bold">&times;</button>
        </div>
        
        <div className="flex h-[450px]">
          <div className="w-1/4 border-r border-slate-200 bg-slate-50 p-3 space-y-2">
            <button className="w-full text-left px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-800 shadow-sm">학원 전체 설정</button>
            <button className="w-full text-left px-4 py-3 bg-transparent hover:bg-white border border-transparent hover:border-slate-200 rounded-lg text-sm font-bold text-slate-500 transition-colors">클래스별 설정</button>
            <button className="w-full text-left px-4 py-3 bg-transparent hover:bg-white border border-transparent hover:border-slate-200 rounded-lg text-sm font-bold text-slate-500 transition-colors">수강생별 설정</button>
          </div>
          
          <div className="w-3/4 p-6 bg-white overflow-y-auto custom-scroll flex flex-col">
            <div className="flex gap-8 mb-6 border-b border-slate-100 pb-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-rose-600">
                <input type="checkbox" checked readOnly className="w-4 h-4 accent-rose-500" /> 미납 알림톡 자동 발송 활성화
              </label>
            </div>
            
            <div className="flex gap-6 mb-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-400"><input type="radio" readOnly className="w-4 h-4 accent-rose-500" /> 일자 지정</label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-rose-600"><input type="radio" checked readOnly className="w-4 h-4 accent-rose-500" /> 경과일 지정 (추천)</label>
            </div>
            
            <div className="flex gap-2 mb-6">
              <select value={ruleDay} onChange={e => setRuleDay(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-rose-500">
                <option value="3">청구일 기준 +3일 후</option>
                <option value="5">청구일 기준 +5일 후</option>
                <option value="7">청구일 기준 +7일 후</option>
              </select>
              <select value={ruleTime} onChange={e => setRuleTime(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-rose-500">
                <option value="오전 10시 정각">오전 10시 정각</option>
                <option value="오후 2시 정각">오후 2시 정각</option>
                <option value="오후 6시 정각">오후 6시 정각</option>
              </select>
            </div>
            
            <div className="text-right mb-8">
              <button onClick={addAutoRule} className="bg-rose-500 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-rose-600 transition-colors flex items-center gap-1 ml-auto">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 새 예약 등록
              </button>
            </div>

            <h4 className="text-xs font-bold text-slate-500 mb-2">등록된 예약 설정</h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-xs text-center whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500"><tr><th className="py-2.5">예약 기준</th><th className="py-2.5">항목</th><th className="py-2.5">활성화</th><th className="py-2.5">삭제</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700 font-bold">
                  {autoRules.length === 0 ? <tr><td colSpan={4} className="py-6 text-slate-400">등록된 자동 예약 설정이 없습니다.</td></tr> :
                    autoRules.map(r => (
                      <tr key={r.rule_id} className={`hover:bg-slate-50 border-b border-slate-100 transition-opacity ${r.is_active ? 'opacity-100' : 'opacity-50'}`}>
                        <td className="py-3 text-slate-700">청구일 기준 +{r.schedule_date}일 후 {r.schedule_time}</td>
                        <td className="py-3"><span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">알림톡 발송</span></td>
                        <td className="py-3">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={r.is_active} onChange={e => toggleRuleActive(r.rule_id, e.target.checked)} className="sr-only peer" />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        </td>
                        <td className="py-3"><button onClick={() => deleteRule(r.rule_id)} className="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white border border-rose-200 px-2 py-1 rounded transition-colors">삭제</button></td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}