// src/app/(dashboard)/billing/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBilling } from "@/hooks/useBilling";
import BillingAutoModal from "@/components/billing/BillingAutoModal";

export default function BillingPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 및 소속 지점 확인 상태 (1급 기밀 페이지 철통 보안)
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  // 💡 [변경됨] 기본 뷰 모드를 'kanban'에서 'list'로 변경
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  const [discItem, setDiscItem] = useState<any>(null);
  const [discAmount, setDiscAmount] = useState<number | "">("");

  const billing = useBilling();

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

      // 수납/청구 메뉴 접근 권한이 없다면 가차없이 쫓아냅니다.
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/billing"))) {
        alert("⛔ 수납/청구 페이지(매출 정보)에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };

    checkAccess();
  }, [router]);

  const toggleItem = (key: string) => billing.setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const toggleColumnAll = (kanbanStatus: string, checked: boolean) => {
    const keysInCol = billing.billingData.filter(d => d.kanban_status === kanbanStatus).map(d => d.key);
    billing.setSelectedKeys(prev => checked ? Array.from(new Set([...prev, ...keysInCol])) : prev.filter(k => !keysInCol.includes(k)));
  };
  const toggleAllList = (checked: boolean) => billing.setSelectedKeys(checked ? billing.billingData.map(d => d.key) : []);

  const kanbanColumns = [
    { id: '미발행', title: '미발행 청구서', color: 'pink', items: billing.billingData.filter(d => d.kanban_status === "미발행"), actions: [{ label: '발행', code: 'issue' }, { label: '발행 및 발송', code: 'issue_send' }, { label: '발행 취소', code: 'cancel_issue', isDanger: true }] },
    { id: '미전송', title: '미전송 청구서', color: 'blue', items: billing.billingData.filter(d => d.kanban_status === "미전송"), actions: [{ label: '발송', code: 'send' }, { label: '납부 처리', code: 'pay' }, { label: '발행 취소', code: 'cancel_issue', isDanger: true }] },
    { id: '발송됨', title: '발송된 청구서', color: 'amber', items: billing.billingData.filter(d => d.kanban_status === "발송됨"), actions: [{ label: '납부 처리', code: 'pay' }, { label: '미납 처리', code: 'mark_unpaid' }, { label: '발행 취소', code: 'cancel_issue', isDanger: true }] },
    { id: '납부완료', title: '납부완료 내역', color: 'emerald', items: billing.billingData.filter(d => d.kanban_status === "납부완료"), actions: [{ label: '완전 삭제 (DB)', code: 'delete', isDanger: true }] },
  ];

  // 🌟 권한 확인 중이거나 권한이 없을 경우 화면 원천 차단
  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; // 이미 useEffect에서 alert 후 home으로 튕겨냅니다.
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-6 overflow-hidden relative">
      <div className="max-w-[1400px] w-full mx-auto space-y-4 flex flex-col h-full">
        
        {/* 1. 상단 컨트롤 바 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <input type="month" value={billing.filterMonth} onChange={e => billing.setFilterMonth(e.target.value)} className="bg-slate-50 border border-slate-300 text-slate-700 font-bold text-sm rounded-lg px-3 py-2 cursor-pointer focus:border-emerald-500 focus:outline-none" />
            <select value={billing.filterClass} onChange={e => billing.setFilterClass(e.target.value)} className="bg-slate-50 border border-slate-300 text-slate-700 font-bold text-sm rounded-lg px-3 py-2 w-40 cursor-pointer focus:border-emerald-500 focus:outline-none">
              <option value="all">전체 클래스</option>
              {billing.classes.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
            </select>
            <input type="text" value={billing.filterName} onChange={e => billing.setFilterName(e.target.value)} onKeyDown={e => e.key === 'Enter' && billing.loadBillingData()} placeholder="학생 검색 (Enter)" className="bg-slate-50 border border-slate-300 text-slate-700 font-bold text-sm rounded-lg px-3 py-2 w-36 focus:border-emerald-500 focus:outline-none" />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'list' ? 'bg-[#10b981] text-white' : 'bg-white text-slate-500'}`}>전체 목록</button>
              <button onClick={() => setViewMode('kanban')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'kanban' ? 'bg-[#10b981] text-white' : 'bg-white text-slate-500'}`}>상태별 카드</button>
            </div>
            {/* 💡 [변경됨] 버튼 텍스트 변경 */}
            <button onClick={billing.exportPaybillExcel} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-xs hover:bg-blue-900 shadow-sm flex items-center gap-1.5 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              업로드용 엑셀 추출
            </button>
            <button onClick={() => setIsAutoOpen(true)} className="px-4 py-2 bg-emerald-500 text-white font-bold rounded-lg text-xs hover:bg-emerald-600 shadow-sm flex items-center gap-1.5 transition-colors">
              ⏰ 자동발송 예약
            </button>
          </div>
        </div>

        {/* 2. 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex items-center justify-between"><div><p className="text-xs font-bold text-slate-500 mb-0.5">이번 달 총 청구액</p><h3 className="text-2xl font-black text-slate-800">{billing.stats.total.toLocaleString()}원</h3></div></div>
          <div className="bg-emerald-50 rounded-xl p-4 shadow-sm border border-emerald-200 flex items-center justify-between"><div><p className="text-xs font-bold text-emerald-600 mb-0.5">납부 완료 (매출)</p><h3 className="text-2xl font-black text-emerald-700">{billing.stats.paid.toLocaleString()}원</h3></div></div>
          <div className="bg-rose-50 rounded-xl p-4 shadow-sm border border-rose-200 flex items-center justify-between"><div><p className="text-xs font-bold text-rose-600 mb-0.5">미납 및 미발행 총액</p><h3 className="text-2xl font-black text-rose-700">{billing.stats.unpaid.toLocaleString()}원</h3></div></div>
        </div>

        {/* 3. 메인 콘텐츠 */}
        <div className="flex-1 overflow-hidden">
          {billing.isLoading ? (
            <div className="flex h-full items-center justify-center font-bold text-slate-400">데이터를 불러오는 중입니다...</div>
          ) : viewMode === 'list' ? (
            <div className="h-full bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded">총 데이터: <span className="text-indigo-600">{billing.billingData.length}</span>건</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll">
                <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                  <thead className="text-xs text-slate-500 bg-white border-b border-slate-200 font-extrabold sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 w-10 text-center"><input type="checkbox" checked={billing.selectedKeys.length === billing.billingData.length && billing.billingData.length > 0} onChange={e => toggleAllList(e.target.checked)} className="w-[1.1rem] h-[1.1rem] accent-[#10b981] cursor-pointer" /></th>
                      <th className="px-4 py-3 text-center">상태</th>
                      <th className="px-4 py-3">클래스명</th>
                      <th className="px-4 py-3">학생명</th>
                      <th className="px-4 py-3 text-right text-indigo-600">청구 금액</th>
                      <th className="px-4 py-3 text-right">수강료</th>
                      <th className="px-4 py-3 text-right text-rose-500">할인액</th>
                      <th className="px-4 py-3 text-center">조정 / 관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {billing.billingData.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-slate-400">조건에 맞는 내역이 없습니다.</td></tr> : 
                      billing.billingData.map(item => {
                        let badgeColor = item.kanban_status === '미발행' ? 'text-pink-600 bg-pink-100' : (item.kanban_status === '미전송' ? 'text-blue-600 bg-blue-100' : (item.kanban_status === '발송됨' ? 'text-amber-600 bg-amber-100' : 'text-emerald-700 bg-emerald-100'));
                        return (
                          <tr key={item.key} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2 text-center"><input type="checkbox" checked={billing.selectedKeys.includes(item.key)} onChange={() => toggleItem(item.key)} className="w-[1.1rem] h-[1.1rem] accent-[#10b981] cursor-pointer" /></td>
                            <td className="px-4 py-2 text-center flex flex-col items-center justify-center gap-0.5 mt-1">
                              <span className={`${badgeColor} px-2 py-0.5 rounded text-[10px] font-black border border-slate-200/50`}>{item.kanban_status}</span>
                              {item.status === '미납' && <span className="bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded text-[9px] font-bold border border-rose-200">미납 상태</span>}
                            </td>
                            <td className="px-4 py-2 text-xs font-bold text-slate-500">{item.class_name}</td>
                            <td className="px-4 py-2 font-extrabold text-[#002864] cursor-pointer hover:underline" onClick={() => window.open(`/student/detail?id=${item.student_id}`)}>{item.student_name}</td>
                            <td className="px-4 py-2 text-right font-black text-indigo-600 text-sm">{item.final_amount.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-slate-400">{item.base_fee.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-rose-500">{item.discount_amount}</td>
                            <td className="px-4 py-2 text-center text-xs font-bold flex gap-1 justify-center">
                              <button onClick={() => { setDiscItem(item); setDiscAmount(item.discount_amount || ""); setIsDiscountOpen(true); }} className="bg-white border border-slate-200 text-slate-500 px-2 py-1 rounded shadow-sm hover:text-indigo-600">수정</button>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-full pb-2">
              {kanbanColumns.map(col => (
                <div key={col.id} className="bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col shadow-inner h-full overflow-hidden">
                  <div className="p-3 border-b border-slate-200 bg-white rounded-t-xl flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" onChange={e => toggleColumnAll(col.id, e.target.checked)} checked={col.items.length > 0 && col.items.every(d => billing.selectedKeys.includes(d.key))} className="w-[1.1rem] h-[1.1rem] accent-[#10b981] cursor-pointer" />
                      <h3 className="font-extrabold text-slate-700 text-[13px] flex items-center gap-1">{col.title} <span className={`bg-${col.color}-100 text-${col.color}-600 px-1.5 py-0.5 rounded text-[10px] font-black border border-${col.color}-200`}>{col.items.length}</span></h3>
                    </div>
                    <div className="relative inline-block group">
                      <button className={`p-1 text-${col.color}-500 hover:bg-${col.color}-50 rounded transition-colors`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg></button>
                      <div className="absolute right-0 top-full pt-1 z-50 hidden group-hover:block">
                        <div className="bg-white border border-slate-200 shadow-xl rounded-lg w-52 overflow-hidden flex flex-col">
                          {col.actions.map((act, i) => (
                            <button key={act.code} onClick={() => billing.executeAction(col.id, act.code)} className={`w-full text-left px-4 py-2.5 text-xs font-bold ${act.isDanger ? 'text-rose-600 hover:bg-rose-50 border-t border-slate-100' : 'text-slate-700 hover:bg-slate-50'}`}>선택 청구서 {act.label}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 overflow-y-auto custom-scroll flex-1 space-y-2">
                    {col.items.map((item: any) => (
                      <div key={item.key} className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm hover:border-indigo-400 transition-colors relative">
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex gap-1 items-center overflow-hidden">
                            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-bold truncate max-w-[80px] border border-slate-200">{item.class_name}</span>
                            {item.status === '미납' && <span className="text-[9px] bg-rose-50 text-rose-600 px-1 py-0.5 rounded font-bold border border-rose-200 shrink-0">미납 전환됨</span>}
                          </div>
                          <input type="checkbox" checked={billing.selectedKeys.includes(item.key)} onChange={() => toggleItem(item.key)} className="w-[1.1rem] h-[1.1rem] accent-[#10b981] cursor-pointer" />
                        </div>
                        <div className="flex justify-between items-end mb-1">
                          <span className="font-extrabold text-sm text-slate-800 cursor-pointer hover:text-indigo-600" onClick={() => window.open(`/student/detail?id=${item.student_id}`)}>{item.student_name}</span>
                          <span className={`font-black text-sm ${item.kanban_status === '납부완료' ? 'text-slate-400' : 'text-indigo-600'}`}>{item.final_amount.toLocaleString()}<span className="text-[10px] ml-0.5 font-bold">원</span></span>
                        </div>
                        <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-slate-50">
                          <span className="text-[10px] text-rose-500 font-bold">{item.discount_amount > 0 ? `할인: -${item.discount_amount}` : ''}</span>
                          <button onClick={() => { setDiscItem(item); setDiscAmount(item.discount_amount || ""); setIsDiscountOpen(true); }} className="text-[10px] bg-slate-50 text-slate-500 font-bold px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-200">상세/수정</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. 할인 조정 모달 */}
      {isDiscountOpen && discItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-2xl w-80 shadow-2xl">
            <h3 className="font-extrabold text-indigo-600 mb-4 border-b border-slate-100 pb-2">수강료 할인 조정</h3>
            <div className="text-xs font-bold text-slate-500 mb-4 text-center">{discItem.class_name} - {discItem.student_name}</div>
            <div className="flex justify-between items-center mb-4 text-sm font-bold"><span className="text-slate-500">기본 수강료</span><span>{discItem.base_fee.toLocaleString()}원</span></div>
            <label className="block text-xs font-bold text-slate-500 mb-1">할인액 (원)</label>
            <input type="number" value={discAmount} onChange={e => setDiscAmount(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 mb-4 text-right font-black text-rose-500 focus:outline-none focus:border-indigo-400" />
            <div className="flex justify-between items-center mb-5 pt-3 border-t border-slate-200">
              <span className="text-sm font-bold">최종 청구액</span>
              <span className="text-xl font-black text-emerald-600">{Math.max(0, discItem.base_fee - (Number(discAmount) || 0)).toLocaleString()}원</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setIsDiscountOpen(false)} className="w-1/3 bg-slate-100 text-slate-600 font-bold p-2 rounded-lg text-sm">취소</button>
              <button onClick={async () => { if (await billing.saveDiscount(discItem, Number(discAmount) || 0)) setIsDiscountOpen(false); }} className="w-2/3 bg-indigo-600 text-white font-bold p-2 rounded-lg text-sm shadow hover:bg-indigo-700 transition-colors">조정 적용</button>
            </div>
          </div>
        </div>
      )}

      {/* 5. 자동 발송 예약 모달 */}
      <BillingAutoModal isOpen={isAutoOpen} onClose={() => setIsAutoOpen(false)} classes={billing.classes} students={billing.students} />
    </div>
  );
}