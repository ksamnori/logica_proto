// src/app/(dashboard)/print-center/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface TenantInfo {
  name: string;
  ceo_name?: string;
  business_number?: string;
  address?: string;
}

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

export default function PrintCenterPage() {
  const [activeDoc, setActiveDoc] = useState<"student" | "instructor" | "ledger" | "receipt">("student");
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  
  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      
      if (tId) {
        const { data: tenant } = await supabase.from("academy_tenant").select("*").eq("tenant_id", tId).single();
        if (tenant) setTenantInfo(tenant);
      }

      let stuQuery = supabase.from("student").select("*, enrollment(start_date, class(name, tuition_fee))").in("status", ["재원", "휴원"]).order("name");
      if (tId) stuQuery = stuQuery.eq("tenant_id", tId);
      const { data: stuData } = await stuQuery;
      setStudents(stuData || []);

      let instQuery = supabase.from("instructor").select("*").order("created_at");
      if (tId) instQuery = instQuery.eq("tenant_id", tId);
      const { data: instData } = await instQuery;
      setInstructors(instData || []);

      let payQuery = supabase.from("payment_history").select("*, academy_billing(billing_month, student(name), class(name))").order("paid_at", { ascending: false }).limit(100);
      if (tId) payQuery = payQuery.eq("tenant_id", tId);
      const { data: payData } = await payQuery;
      setPayments(payData || []);

    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* 🌟 [초강력 CSS] exam_viewer의 노하우를 적용하여 1페이지 짤림 현상 및 플로팅 챗 완벽 해결 */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { size: A4 portrait; margin: 15mm 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          
          /* 1. 마법의 족쇄 풀기: Next.js Layout의 화면 고정 클래스들을 모두 무력화 */
          html, body, .h-screen, .overflow-hidden, .custom-scroll, main, .flex-1 {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            display: block !important;
          }
          
          /* 2. 화면용 UI 싹 지우기 (플로팅 챗 포함) */
          body * { visibility: hidden; }
          .print-hidden, aside, nav, button, #floating-chat-container { display: none !important; }
          
          /* 3. 인쇄 영역만 강제로 화면 최상단으로 끄집어내기 */
          #print-area, #print-area * { visibility: visible; }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* 4. 표 넘어갈 때 잘림 방지 규칙 */
          table { width: 100% !important; page-break-inside: auto; border-collapse: collapse; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th, td { page-break-inside: avoid; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}} />

      <div className="flex-1 flex flex-col h-full bg-slate-100 relative print:bg-white">
        
        {/* 🛑 화면 컨트롤러 (인쇄 시 완벽 숨김 처리됨) */}
        <div className="print-hidden p-6 bg-white border-b border-slate-200 shrink-0 shadow-sm z-10 sticky top-0">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2">
                <span>🖨️</span> 교육청 서류 출력 센터
              </h1>
              <p className="text-sm font-bold text-slate-500 mt-1">원하시는 양식을 선택하고 인쇄 버튼을 눌러주세요.</p>
              <p className="text-sm font-black text-rose-500 mt-2 bg-rose-50 inline-block px-3 py-1 rounded-lg border border-rose-200 shadow-sm">
                💡 꿀팁: 표 안의 글자를 클릭하면, 엑셀처럼 자유롭게 내용을 수정하거나 빈칸에 글을 적고 인쇄할 수 있습니다!
              </p>
            </div>
            
            <button 
              onClick={handlePrint}
              className="px-8 py-3 bg-[#002864] text-white font-black rounded-xl shadow-md hover:bg-blue-900 transition-colors flex items-center gap-2 text-lg shrink-0"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
              A4 인쇄하기
            </button>
          </div>

          <div className="max-w-5xl mx-auto mt-6 flex gap-2 overflow-x-auto pb-1">
            {[
              { id: "student", label: "👨‍🎓 수강생 대장" },
              { id: "instructor", label: "👨‍🏫 강사(직원) 명부" },
              { id: "ledger", label: "📊 현금 출납부" },
              { id: "receipt", label: "🧾 교육비 영수증" }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveDoc(tab.id as any)}
                className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-colors whitespace-nowrap ${activeDoc === tab.id ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-inner' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ✅ 인쇄 영역 (id="print-area" 필수) */}
        <div className="flex-1 overflow-y-auto p-8 print:p-0 print:overflow-visible custom-scroll">
          <div id="print-area" className="max-w-[210mm] min-h-[297mm] mx-auto bg-white p-12 print:p-0 shadow-lg print:shadow-none font-serif text-black">
            
            {isLoading ? (
              <div className="text-center py-20 font-bold text-slate-400 print-hidden">데이터를 불러오는 중입니다...</div>
            ) : (
              <>
                {/* 1. 수강생 대장 */}
                {activeDoc === "student" && (
                  <div>
                    <h1 className="text-3xl font-black text-center mb-10 tracking-[1em] underline underline-offset-8 decoration-2" contentEditable suppressContentEditableWarning>수강생대장</h1>
                    <table className="w-full border-collapse border-2 border-black text-sm text-center">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black py-2.5 font-black">연번</th>
                          <th className="border border-black py-2.5 font-black">성명</th>
                          <th className="border border-black py-2.5 font-black">학교/학년</th>
                          <th className="border border-black py-2.5 font-black">수강과목(반)</th>
                          <th className="border border-black py-2.5 font-black">수강시작일</th>
                          <th className="border border-black py-2.5 font-black">연락처</th>
                          <th className="border border-black py-2.5 font-black">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((s, idx) => {
                          const enroll = unwrap(s.enrollment);
                          const cName = unwrap(enroll?.class)?.name || "-";
                          return (
                            <tr key={s.student_id}>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{idx + 1}</td>
                              <td className="border border-black py-2 font-bold outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{s.name}</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{s.school || '-'} {s.grade}</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{cName}</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{enroll?.start_date || '-'}</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{s.phone}</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{s.status === '휴원' ? '휴원' : ''}</td>
                            </tr>
                          );
                        })}
                        {Array.from({ length: Math.max(0, 20 - students.length) }).map((_, i) => (
                          <tr key={`blank-${i}`}>
                            <td className="border border-black py-4 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* 🌟 학원명 강제 고정 완료 */}
                    <div className="mt-8 text-right font-black text-lg outline-none focus:bg-yellow-50 transition-colors inline-block float-right px-2" contentEditable suppressContentEditableWarning>
                      학원명 : LOGICA학원 대치 본원
                    </div>
                  </div>
                )}

                {/* 2. 강사 명부 */}
                {activeDoc === "instructor" && (
                  <div>
                    <h1 className="text-3xl font-black text-center mb-10 tracking-[1em] underline underline-offset-8 decoration-2" contentEditable suppressContentEditableWarning>강사명부</h1>
                    <table className="w-full border-collapse border-2 border-black text-sm text-center">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black py-2.5 font-black">연번</th>
                          <th className="border border-black py-2.5 font-black">성명</th>
                          <th className="border border-black py-2.5 font-black">담당과목/직급</th>
                          <th className="border border-black py-2.5 font-black">채용일자</th>
                          <th className="border border-black py-2.5 font-black">해임일자</th>
                          <th className="border border-black py-2.5 font-black">연락처</th>
                          <th className="border border-black py-2.5 font-black">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {instructors.map((inst, idx) => (
                          <tr key={inst.instructor_id}>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{idx + 1}</td>
                            <td className="border border-black py-2 font-bold outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{inst.name}</td>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{inst.position}</td>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{new Date(inst.created_at).toLocaleDateString('ko-KR')}</td>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{inst.deleted_at ? new Date(inst.deleted_at).toLocaleDateString('ko-KR') : '-'}</td>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{inst.phone || '-'}</td>
                            <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{inst.status}</td>
                          </tr>
                        ))}
                        {Array.from({ length: Math.max(0, 20 - instructors.length) }).map((_, i) => (
                          <tr key={`blank-${i}`}>
                            <td className="border border-black py-4 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-8 text-right font-black text-lg outline-none focus:bg-yellow-50 transition-colors inline-block float-right px-2" contentEditable suppressContentEditableWarning>
                      학원명 : LOGICA학원 대치 본원
                    </div>
                  </div>
                )}

                {/* 3. 현금 출납부 */}
                {activeDoc === "ledger" && (
                  <div>
                    <h1 className="text-3xl font-black text-center mb-10 tracking-[1em] underline underline-offset-8 decoration-2" contentEditable suppressContentEditableWarning>현금출납부</h1>
                    <div className="text-right mb-2 font-bold text-sm">(단위: 원)</div>
                    <table className="w-full border-collapse border-2 border-black text-sm text-center">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black py-2.5 font-black w-24">일자</th>
                          <th className="border border-black py-2.5 font-black">적요 (학생명/내역)</th>
                          <th className="border border-black py-2.5 font-black w-28">수입 (수납액)</th>
                          <th className="border border-black py-2.5 font-black w-28">지출</th>
                          <th className="border border-black py-2.5 font-black w-28">결제수단</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p, idx) => {
                          const bill = unwrap(p.academy_billing);
                          const sName = unwrap(bill?.student)?.name || '알수없음';
                          const cName = unwrap(bill?.class)?.name || '미배정';
                          return (
                            <tr key={p.payment_id}>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{new Date(p.paid_at).toLocaleDateString('ko-KR').slice(0,-1)}</td>
                              <td className="border border-black py-2 text-left px-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>[{bill?.billing_month}] {sName} ({cName})</td>
                              <td className="border border-black py-2 text-right px-3 text-blue-700 font-bold outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{p.paid_amount.toLocaleString()}</td>
                              <td className="border border-black py-2 text-right px-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>0</td>
                              <td className="border border-black py-2 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{p.payment_method}</td>
                            </tr>
                          );
                        })}
                        {Array.from({ length: Math.max(0, 20 - payments.length) }).map((_, i) => (
                          <tr key={`blank-${i}`}>
                            <td className="border border-black py-4 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                            <td className="border border-black outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-8 text-right font-black text-lg outline-none focus:bg-yellow-50 transition-colors inline-block float-right px-2" contentEditable suppressContentEditableWarning>
                      학원명 : LOGICA학원 대치 본원
                    </div>
                  </div>
                )}

                {/* 4. 교육비 영수증 */}
                {activeDoc === "receipt" && payments.length > 0 && (
                  <div className="space-y-12">
                    {[1, 2].map((num) => {
                      const p = payments[0]; 
                      const bill = unwrap(p.academy_billing);
                      return (
                        <div key={num} className="border-4 border-black p-8 relative">
                          <div className="absolute top-4 left-4 text-xs font-bold border border-black px-2 py-1">
                            {num === 1 ? '학원 보관용' : '학부모 교부용'}
                          </div>
                          <h1 className="text-3xl font-black text-center mb-10 tracking-widest" contentEditable suppressContentEditableWarning>교 육 비 영 수 증</h1>
                          
                          <div className="grid grid-cols-2 gap-x-10 gap-y-4 text-sm font-bold mb-8">
                            <div className="flex border-b border-black pb-1"><span className="w-24">학원명:</span><span className="flex-1 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>LOGICA학원 대치 본원</span></div>
                            <div className="flex border-b border-black pb-1"><span className="w-24">사업자번호:</span><span className="flex-1 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{tenantInfo?.business_number || '123-45-67890'}</span></div>
                            <div className="flex border-b border-black pb-1"><span className="w-24">대표자:</span><span className="flex-1 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{tenantInfo?.ceo_name || '이웅행'}</span></div>
                            <div className="flex border-b border-black pb-1"><span className="w-24">소재지:</span><span className="flex-1 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{tenantInfo?.address || '서울시 강남구'}</span></div>
                          </div>

                          <table className="w-full border-collapse border-2 border-black text-sm text-center mb-6">
                            <tbody>
                              <tr>
                                <td className="border border-black py-3 bg-gray-100 font-bold w-32">수강자 성명</td>
                                <td className="border border-black py-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{unwrap(bill?.student)?.name}</td>
                                <td className="border border-black py-3 bg-gray-100 font-bold w-32">수강 과정명</td>
                                <td className="border border-black py-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{unwrap(bill?.class)?.name}</td>
                              </tr>
                              <tr>
                                <td className="border border-black py-3 bg-gray-100 font-bold">청구 월</td>
                                <td className="border border-black py-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{bill?.billing_month}</td>
                                <td className="border border-black py-3 bg-gray-100 font-bold">결제 수단</td>
                                <td className="border border-black py-3 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>{p.payment_method}</td>
                              </tr>
                              <tr>
                                <td className="border border-black py-4 bg-gray-100 font-black text-lg">영수 금액</td>
                                <td colSpan={3} className="border border-black py-4 text-xl font-black text-right pr-6 outline-none focus:bg-yellow-50 transition-colors" contentEditable suppressContentEditableWarning>
                                  ₩ {p.paid_amount.toLocaleString()}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          
                          <div className="text-center mt-10">
                            <p className="mb-4">위와 같이 교육비를 영수함.</p>
                            <p className="text-lg font-black outline-none focus:bg-yellow-50 transition-colors inline-block px-4" contentEditable suppressContentEditableWarning>{new Date(p.paid_at).toLocaleDateString('ko-KR')}</p>
                            <div className="mt-8 text-2xl font-black text-right pr-10 relative">
                              <span className="outline-none focus:bg-yellow-50 transition-colors inline-block" contentEditable suppressContentEditableWarning>LOGICA학원 대치 본원 원장</span> <span className="text-sm ml-4">(인/서명)</span>
                              <div className="absolute right-6 top-1 w-12 h-12 border-2 border-red-500 rounded-full text-red-500 text-[10px] flex items-center justify-center rotate-[-15deg] opacity-70">로지카<br/>학원인</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}