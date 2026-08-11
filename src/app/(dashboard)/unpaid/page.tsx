// src/app/(dashboard)/unpaid/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUnpaid } from "@/hooks/useUnpaid";
import UnpaidAutoModal from "@/components/unpaid/UnpaidAutoModal";

export default function UnpaidPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 및 소속 지점 확인 상태 (민감 정보 페이지 철통 보안)
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [isAutoOpen, setIsAutoOpen] = useState(false);
  
  // 훅에서 비즈니스 로직과 상태를 모두 가져옵니다.
  const unpaid = useUnpaid();
  const sortedData = unpaid.getSortedData();
  const smsBytes = unpaid.getSmsBytes();

  // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 즉시 권한부터 검사합니다!
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
      if (isGodMode) {
        setIsAuthorized(true);
        return;
      }

      if (!tId || !role) {
         alert("권한 정보가 없습니다.");
         router.replace("/home");
         return;
      }

      const { data } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .maybeSingle();

      // 미납 관리 메뉴 접근 권한이 없다면 가차없이 쫓아냅니다.
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/unpaid"))) {
        alert("⛔ 미납 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };

    checkAccess();
  }, [router]);

  // 🌟 권한 확인 중이거나 권한이 없을 경우 화면 원천 차단
  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; // 이미 useEffect에서 alert 후 home으로 튕겨냅니다.
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden relative">
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        
        {/* 1. 상단 타이틀 바 */}
        <div className="flex justify-between items-center mb-5 shrink-0">
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
            🚨 미납 수강료 안내 발송 센터
          </h2>
          <button onClick={() => setIsAutoOpen(true)} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2">
            ⏰ 미납 안내 자동발송 예약
          </button>
        </div>

        {/* 2. 메인 컨텐츠 영역 */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
          
          {/* 좌측 리스트 영역 */}
          <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
              <div className="flex gap-2">
                <button onClick={() => unpaid.setViewMode('student')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors shadow-sm ${unpaid.viewMode === 'student' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>학생별 목록</button>
                <button onClick={() => unpaid.setViewMode('class')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors shadow-sm ${unpaid.viewMode === 'class' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>반별 묶어보기</button>
              </div>
              <span className="text-xs font-bold text-slate-500">총 <span className="text-rose-600 font-black text-sm">{unpaid.unpaidData.length}</span>건의 미납 내역</span>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-white sticky top-0 z-10 border-b border-slate-200 text-xs font-extrabold text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-center w-10"><input type="checkbox" checked={unpaid.selectedIds.length === unpaid.unpaidData.length && unpaid.unpaidData.length > 0} onChange={e => unpaid.toggleAll(e.target.checked)} className="w-[1.1rem] h-[1.1rem] accent-[#f43f5e] cursor-pointer" /></th>
                    <th className="px-4 py-3 text-center">상태</th>
                    <th className="px-4 py-3">청구년월</th>
                    <th className="px-4 py-3">생성일</th>
                    <th className="px-4 py-3">클래스명</th>
                    <th className="px-4 py-3">학생명</th>
                    <th className="px-4 py-3 text-right">청구액 (미납액)</th>
                    <th className="px-4 py-3 text-center">알림 이력</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {unpaid.isLoading ? (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-500 font-bold">데이터를 로드하는 중입니다...</td></tr>
                  ) : sortedData.length === 0 ? (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400 font-bold text-base">미납된 내역이 없습니다. 👏</td></tr>
                  ) : (
                    sortedData.map((item, idx) => {
                      const className = item.class?.name || '미배정 클래스';
                      const studentName = item.student?.name || '알수없는 학생';
                      const isClassChanged = unpaid.viewMode === 'class' && (idx === 0 || sortedData[idx - 1].class?.name !== className);
                      
                      const count = unpaid.sendCounts[item.billing_id] || 0;
                      const notiBadge = count > 0 ? <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-1 rounded text-[10px] font-bold">{count}회 전송됨</span> : <span className="bg-slate-100 text-slate-500 border border-slate-200 px-2 py-1 rounded text-[10px] font-bold">미전송</span>;
                      const dText = new Date(item.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

                      return (
                        <React.Fragment key={item.billing_id}>
                          {isClassChanged && (
                            <tr><td colSpan={8} className="px-4 py-2 bg-slate-100 font-extrabold text-slate-600 text-[11px] shadow-inner">{className}</td></tr>
                          )}
                          <tr onClick={() => unpaid.toggleRowCheck(item.billing_id)} className="hover:bg-rose-50/40 transition-colors border-b border-slate-50 group cursor-pointer">
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={unpaid.selectedIds.includes(item.billing_id)} onChange={() => unpaid.toggleRowCheck(item.billing_id)} className="w-[1.1rem] h-[1.1rem] accent-[#f43f5e] cursor-pointer" />
                            </td>
                            <td className="px-4 py-3 text-center"><span className="bg-rose-100 text-rose-600 px-2 py-0.5 rounded text-[10px] font-black shadow-sm">미납</span></td>
                            <td className="px-4 py-3 font-bold text-slate-500 text-xs">{item.billing_month}</td>
                            <td className="px-4 py-3 text-[11px] font-bold text-slate-400">{dText}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-600 truncate max-w-[120px]">{className}</td>
                            <td className="px-4 py-3 font-extrabold text-[#002864] hover:underline" onClick={e => { e.stopPropagation(); window.open(`/student/detail?id=${item.student_id}`); }}>{studentName}</td>
                            <td className="px-4 py-3 text-right font-black text-rose-600 text-base">{(parseInt(item.amount) || 0).toLocaleString()}원</td>
                            <td className="px-4 py-3 text-center">{notiBadge}</td>
                          </tr>
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 우측 SMS 작성 영역 */}
          <div className="lg:col-span-4 bg-white rounded-2xl shadow-lg border border-slate-200 flex flex-col overflow-hidden">
            <div className="bg-rose-600 p-4 shrink-0 flex items-center gap-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
              <h3 className="font-extrabold text-white">문자 메시지 작성</h3>
            </div>
            
            <div className="p-5 flex-1 overflow-y-auto custom-scroll space-y-5">
              <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
                <p className="text-[11px] font-bold text-rose-500 mb-2">클릭하여 문자 본문에 자동 삽입</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => unpaid.handleInsertVar('{학생명}')} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors">➕ {'{학생명}'}</button>
                  <button onClick={() => unpaid.handleInsertVar('{학원명}')} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors">➕ {'{학원명}'}</button>
                  <button onClick={() => unpaid.handleInsertVar('{미납액}')} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors">➕ {'{미납액}'}</button>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="text-xs font-bold text-slate-500">메시지 템플릿 작성</label>
                  <span className={`text-[10px] font-bold ${smsBytes > 90 ? 'text-rose-500' : 'text-slate-400'}`}>{smsBytes} bytes</span>
                </div>
                <textarea 
                  ref={unpaid.textareaRef}
                  value={unpaid.smsTemplate} 
                  onChange={e => unpaid.setSmsTemplate(e.target.value)} 
                  rows={6} 
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm font-medium focus:outline-none focus:border-rose-500 resize-none leading-relaxed custom-scroll"
                ></textarea>
              </div>

              <div className="border-t border-slate-200 pt-5">
                <label className="block text-xs font-bold text-slate-500 mb-2">발송 시점 설정</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <input type="radio" checked={unpaid.sendTime === 'now'} onChange={() => unpaid.setSendTime('now')} className="accent-rose-500 w-4 h-4" />
                    <span className="text-sm font-bold text-slate-700">지금 즉시 전송</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <input type="radio" checked={unpaid.sendTime === 'reserve'} onChange={() => unpaid.setSendTime('reserve')} className="accent-rose-500 w-4 h-4" />
                    <span className="text-sm font-bold text-slate-700">예약 전송</span>
                  </label>
                  {unpaid.sendTime === 'reserve' && (
                    <div className="pl-8 pr-2 py-2 flex gap-2 bg-slate-50 rounded-lg border border-slate-200">
                      <input type="date" value={unpaid.resDate} onChange={e => unpaid.setResDate(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-rose-500 w-1/2" />
                      <input type="time" value={unpaid.resTime} onChange={e => unpaid.setResTime(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-rose-500 w-1/2" />
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button onClick={unpaid.sendUnpaidSms} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl hover:bg-rose-700 shadow-md transition-colors text-sm flex justify-center items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                선택 인원에게 문자 발송
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 자동발송 모달 컴포넌트 */}
      <UnpaidAutoModal isOpen={isAutoOpen} onClose={() => setIsAutoOpen(false)} />
    </div>
  );
}