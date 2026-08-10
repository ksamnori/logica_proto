// src/app/(dashboard)/academy-info/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function AcademyInfoPage() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", role: "", tenantId: "" });
  const [isHQ, setIsHQ] = useState(false);
  
  // 모든 테넌트(지점) 목록 (HQ 전용)
  const [tenants, setTenants] = useState<any[]>([]);
  // 현재 화면에 띄워진 테넌트 정보
  const [activeTenant, setActiveTenant] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    address: "",
    business_number: "",
    ceo_name: ""
  });

  // 🌟 [추가됨] 본사 -> 직영점 -> 가맹점 순서로 정렬하는 헬퍼 함수
  const sortTenants = (tenantList: any[]) => {
    const orderMap: Record<string, number> = { 'HQ': 1, 'DIRECT': 2, 'FRANCHISE': 3 };
    return [...tenantList].sort((a, b) => {
      const orderA = orderMap[a.tenant_type] || 99;
      const orderB = orderMap[b.tenant_type] || 99;
      if (orderA !== orderB) return orderA - orderB;
      // 타입이 같을 경우 생성일 순으로 정렬
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });
  };

  useEffect(() => {
    initializeAndLoad();
  }, []);

  const initializeAndLoad = async () => {
    setIsLoading(true);

    let instId = typeof window !== 'undefined' ? (sessionStorage.getItem("logica_instructor_id") || localStorage.getItem("logica_instructor_id") || "") : "";
    
    // 브라우저에 ID가 날아갔다면 이메일 세션을 통해 강제로 ID 복구
    if (!instId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        const extractedLoginId = session.user.email.split('@')[0];
        const { data: inst } = await supabase.from('instructor').select('instructor_id').eq('login_id', extractedLoginId).maybeSingle();
        if (inst) {
          instId = inst.instructor_id;
          localStorage.setItem("logica_instructor_id", instId);
        }
      }
    }

    if (!instId) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. 강사 정보 확인 (DB에서 직접 최신 권한 확인)
      const { data: instData } = await supabase
        .from("instructor")
        .select("tenant_id, role, position, name")
        .eq("instructor_id", instId)
        .maybeSingle();

      if (!instData) {
        setIsLoading(false);
        return;
      }

      const myTenantId = instData.tenant_id;
      const isSuperLevel = instData.role === 'SUPER_ADMIN' || instData.role === 'ADMIN' || String(instData.position).includes('최고관리자') || String(instData.position).includes('원장');

      setCurrentUser({ instId, name: instData.name || "관리자", role: instData.role || "", tenantId: myTenantId || "" });

      if (!myTenantId) {
        setIsLoading(false);
        return;
      }

      // RLS 보안 정책 및 DB 에러를 뚫고 정보를 무조건 가져오는 로직
      let fetchedTenants: any[] = [];
      
      if (isSuperLevel) {
        const { data: allData } = await supabase.from("academy_tenant").select("*");
        if (allData && allData.length > 0) {
          fetchedTenants = allData;
        }
      }

      if (fetchedTenants.length === 0) {
        const { data: singleTenant } = await supabase.from("academy_tenant").select("*").eq("tenant_id", myTenantId).maybeSingle();
        if (singleTenant) {
          fetchedTenants = [singleTenant];
        }
      }

      if (fetchedTenants.length === 0) {
        setIsLoading(false);
        return;
      }

      // 3. 본사 모드 판단 및 데이터 렌더링
      if (isSuperLevel && fetchedTenants.length > 1) {
        setIsHQ(true);
        // 🌟 [적용] 커스텀 정렬 함수 사용
        const sortedTenants = sortTenants(fetchedTenants);
        setTenants(sortedTenants);
        
        const targetTenant = sortedTenants.find(t => t.tenant_id === myTenantId) 
                          || sortedTenants.find(t => t.tenant_type === 'HQ') 
                          || sortedTenants[0];
                          
        setActiveTenant(targetTenant);
        syncForm(targetTenant);
      } else {
        setIsHQ(false);
        const targetTenant = fetchedTenants.find(t => t.tenant_id === myTenantId) || fetchedTenants[0];
        setActiveTenant(targetTenant);
        syncForm(targetTenant);
      }

    } catch (e) {
      console.error("데이터 로딩 중 에러 발생:", e);
    }

    setIsLoading(false);
  };

  const syncForm = (data: any) => {
    if (!data) return;
    setFormData({
      name: data.name || "",
      phone: data.phone || "",
      address: data.address || "",
      business_number: data.business_number || "",
      ceo_name: data.ceo_name || ""
    });
  };

  const handleTenantChange = (targetTenantId: string) => {
    const target = tenants.find(t => t.tenant_id === targetTenantId);
    if (target) {
      setActiveTenant(target);
      syncForm(target);
      setIsEditing(false);
    }
  };

  // 신규 지점 등록 로직
  const handleCreateNewTenant = async () => {
    const newName = prompt("신규 지점(학원) 이름을 입력하세요:");
    if (!newName || !newName.trim()) return;

    try {
      const { error } = await supabase
        .from("academy_tenant")
        .insert([{
          name: newName.trim(),
          tenant_type: "FRANCHISE", // 기본으로 가맹점 상태 등록
          status: "ACTIVE"
        }]);

      if (error) throw error;
      
      alert(`[${newName}] 지점이 성공적으로 등록되었습니다.`);
      
      // 본사 권한이므로 즉시 리스트 갱신
      const { data: allTenants } = await supabase.from("academy_tenant").select("*");
      if (allTenants) {
        // 🌟 [적용] 신규 지점 등록 시에도 커스텀 정렬 적용
        setTenants(sortTenants(allTenants));
      }
    } catch (error: any) {
      console.error("신규 지점 등록 에러:", error);
      alert(`신규 지점 등록에 실패했습니다: ${error.message}`);
    }
  };

  const handleSave = async () => {
    if (!activeTenant) return;
    try {
      const { error } = await supabase
        .from("academy_tenant")
        .update({
          name: formData.name,
          phone: formData.phone,
          address: formData.address,
          business_number: formData.business_number,
          ceo_name: formData.ceo_name
        })
        .eq("tenant_id", activeTenant.tenant_id);

      if (error) {
        alert("업데이트 중 에러가 발생했습니다. (address, phone 등 컬럼 추가 여부 확인 필요)");
        return;
      }

      alert("학원 정보가 성공적으로 업데이트되었습니다.");
      setIsEditing(false);
      
      // 본사일 경우 리스트 강제 갱신
      if (isHQ) {
        const { data: allTenants } = await supabase.from("academy_tenant").select("*");
        if (allTenants) {
          // 🌟 [적용] 정보 수정 후에도 커스텀 정렬 적용
          setTenants(sortTenants(allTenants));
        }
      }
      
      setActiveTenant((prev: any) => ({ ...prev, ...formData }));

    } catch (error) {
      alert("정보 업데이트 중 오류가 발생했습니다.");
    }
  };

  if (isLoading) {
    return <div className="p-8 text-slate-500 font-bold">권한 및 지점 정보를 확인하는 중입니다...</div>;
  }

  if (!activeTenant) {
    return (
      <div className="h-full flex flex-col font-pretendard bg-slate-50 p-8 items-center justify-center">
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
          <div className="text-4xl mb-4">🏢</div>
          <h2 className="text-lg font-black text-slate-800 mb-2">소속 지점 정보가 없습니다.</h2>
          <p className="text-sm font-medium text-slate-500">현재 선생님의 계정에 등록된 지점(테넌트) 정보가 없거나 올바르지 않습니다.<br/>최고관리자에게 지점 배정을 요청해주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col font-pretendard bg-slate-50 p-4 sm:p-8 overflow-hidden">
      
      {/* 헤더 영역 */}
      <div className="shrink-0 flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            🏢 학원 정보 관리
          </h1>
          <p className="text-slate-500 font-bold text-[12px] mt-1">
            {isHQ ? "본사 및 전체 가맹점/직영점의 정보를 관리합니다." : "우리 지점의 기본 정보를 관리합니다."}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden min-h-0">
        
        {/* 본사(HQ)일 경우에만 좌측에 지점 선택 리스트 표시 */}
        {isHQ && (
          <div className="w-full lg:w-72 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col shrink-0 overflow-hidden h-full">
            <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0">
              <span className="font-black text-sm text-slate-700">지점 목록 (HQ)</span>
              <button onClick={handleCreateNewTenant} className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 hover:bg-emerald-100 transition-colors">
                + 신규 지점 등록
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-2">
              {tenants.map(t => (
                <button 
                  key={t.tenant_id}
                  onClick={() => handleTenantChange(t.tenant_id)}
                  className={`w-full text-left p-3 mb-1 rounded-xl transition-colors border flex flex-col gap-1 ${activeTenant.tenant_id === t.tenant_id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-[13px] ${activeTenant.tenant_id === t.tenant_id ? 'text-[#002864]' : 'text-slate-700'}`}>{t.name}</span>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${t.tenant_type === 'HQ' ? 'bg-indigo-100 text-indigo-600 border-indigo-200' : (t.tenant_type === 'DIRECT' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-amber-100 text-amber-600 border-amber-200')}`}>
                      {t.tenant_type === 'HQ' ? '본사' : (t.tenant_type === 'DIRECT' ? '직영점' : '가맹점')}
                    </span>
                  </div>
                  <div className={`text-[10px] truncate ${activeTenant.tenant_id === t.tenant_id ? 'text-blue-500' : 'text-slate-400'}`}>
                    {t.address || '주소 미등록'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 우측 학원 상세 정보 폼 */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-full relative">
          <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0 z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center text-xl shadow-inner">
                🏫
              </div>
              <div>
                <h2 className="text-base font-black text-[#002864] flex items-center gap-2">
                  {activeTenant.name}
                  <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-md font-bold">{activeTenant.status}</span>
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">지점 상세 정보 및 로고 관리</p>
              </div>
            </div>
            
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button onClick={() => { setIsEditing(false); syncForm(activeTenant); }} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm px-5 py-2.5 rounded-xl transition-all">취소</button>
                  <button onClick={handleSave} className="bg-[#002864] hover:bg-blue-900 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-1.5"><span>💾</span> 저장하기</button>
                </>
              ) : (
                <button onClick={() => setIsEditing(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-sm px-6 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-1.5">
                  <span>✏️</span> 정보 수정
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 lg:p-8 bg-slate-50/30">
            <div className="max-w-3xl mx-auto space-y-6">
              
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4 border-b border-slate-100 pb-2">기본 정보</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">학원(지점)명</label>
                    <input type="text" disabled={!isEditing} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-bold px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#002864] disabled:opacity-60 disabled:bg-slate-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">지점 형태 (수정 불가)</label>
                    <input type="text" disabled value={activeTenant.tenant_type === 'HQ' ? '본사 (Headquarters)' : (activeTenant.tenant_type === 'DIRECT' ? '직영점 (Direct Branch)' : '가맹점 (Franchise)')} className="w-full bg-slate-100 border border-slate-200 text-slate-500 font-bold px-4 py-2.5 rounded-lg cursor-not-allowed" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4 border-b border-slate-100 pb-2">운영 정보</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">대표자명</label>
                    <input type="text" disabled={!isEditing} value={formData.ceo_name} onChange={e => setFormData({...formData, ceo_name: e.target.value})} placeholder="홍길동" className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-bold px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#002864] disabled:opacity-60 disabled:bg-slate-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">사업자 등록번호</label>
                    <input type="text" disabled={!isEditing} value={formData.business_number} onChange={e => setFormData({...formData, business_number: e.target.value})} placeholder="123-45-67890" className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-bold px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#002864] disabled:opacity-60 disabled:bg-slate-100" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">대표 연락처</label>
                    <input type="text" disabled={!isEditing} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="02-1234-5678" className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-bold px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#002864] disabled:opacity-60 disabled:bg-slate-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-500 mb-1.5">학원 주소</label>
                    <input type="text" disabled={!isEditing} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="서울시 강남구 테헤란로..." className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-bold px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#002864] disabled:opacity-60 disabled:bg-slate-100" />
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}