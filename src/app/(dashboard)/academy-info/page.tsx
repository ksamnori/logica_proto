// src/app/(dashboard)/academy-info/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export default function AcademyInfoPage() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", role: "", tenantId: "" });
  const [isHQ, setIsHQ] = useState(false);
  
  const [tenants, setTenants] = useState<any[]>([]);
  const [activeTenant, setActiveTenant] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    address: "",
    business_number: "",
    ceo_name: "",
    logo_url: ""
  });

  // 🌟 이미지 편집(Cropper) 관련 상태
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const sortTenants = (tenantList: any[]) => {
    const orderMap: Record<string, number> = { 'HQ': 1, 'DIRECT': 2, 'FRANCHISE': 3 };
    return [...tenantList].sort((a, b) => {
      const orderA = orderMap[a.tenant_type] || 99;
      const orderB = orderMap[b.tenant_type] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });
  };

  useEffect(() => {
    initializeAndLoad();
  }, []);

  const initializeAndLoad = async () => {
    setIsLoading(true);

    let instId = typeof window !== 'undefined' ? (sessionStorage.getItem("logica_instructor_id") || localStorage.getItem("logica_instructor_id") || "") : "";
    
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

      if (isSuperLevel && fetchedTenants.length > 1) {
        setIsHQ(true);
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

  const getImageUrl = (path: string | null | undefined) => {
    if (!path) return null;
    if (path.startsWith("http") || path.startsWith("data:")) return path;
    const { data } = supabase.storage.from("system_images").getPublicUrl(path);
    return data.publicUrl;
  };

  const syncForm = (data: any) => {
    if (!data) return;
    setFormData({
      name: data.name || "",
      phone: data.phone || "",
      address: data.address || "",
      business_number: data.business_number || "",
      ceo_name: data.ceo_name || "",
      logo_url: data.logo_url || ""
    });
    setPreviewUrl(getImageUrl(data.logo_url));
    setCroppedBlob(null); 
  };

  const handleTenantChange = (targetTenantId: string) => {
    const target = tenants.find(t => t.tenant_id === targetTenantId);
    if (target) {
      setActiveTenant(target);
      syncForm(target);
      setIsEditing(false);
    }
  };

  const handleCreateNewTenant = async () => {
    const newName = prompt("신규 지점(학원) 이름을 입력하세요:");
    if (!newName || !newName.trim()) return;

    try {
      const { error } = await supabase
        .from("academy_tenant")
        .insert([{
          name: newName.trim(),
          tenant_type: "FRANCHISE",
          status: "ACTIVE"
        }]);

      if (error) throw error;
      
      alert(`[${newName}] 지점이 성공적으로 등록되었습니다.`);
      
      const { data: allTenants } = await supabase.from("academy_tenant").select("*");
      if (allTenants) {
        setTenants(sortTenants(allTenants));
      }
    } catch (error: any) {
      alert(`신규 지점 등록에 실패했습니다: ${error.message}`);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setRawImageSrc(reader.result?.toString() || null);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setIsCropperOpen(true);
      });
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const onMouseUp = () => setIsDragging(false);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(prev => Math.min(Math.max(0.5, prev - e.deltaY * 0.005), 3));
  };

  // 🌟 [수정됨] 화면에 보이는 그대로 1픽셀 오차 없이 잘라내는 완벽한 크롭 공식
  const generateCrop = () => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 450;
    
    // UI 크롭 영역(480x270)과 최종 이미지(800x450)의 비율
    const scale = 800 / 480; 

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // 캔버스 중심 이동 후 줌/팬 적용
    ctx.translate(canvas.width / 2 + pan.x * scale, canvas.height / 2 + pan.y * scale);
    ctx.scale(zoom * scale, zoom * scale);

    // 원본 이미지의 비율에 맞춰서 기준 Height를 270px로 잡음 (CSS height: 100% 와 동일)
    const drawH = 270;
    const drawW = 270 * (img.naturalWidth / img.naturalHeight);

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (blob) {
        setCroppedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setIsCropperOpen(false);
        setRawImageSrc(null);
      }
    }, "image/jpeg", 0.9);
  };

  const handleSave = async () => {
    if (!activeTenant) return;
    
    let finalLogoUrl = formData.logo_url;

    if (croppedBlob) {
      try {
        const fileName = `tenants/tenant_${activeTenant.tenant_id}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('system_images')
          .upload(fileName, croppedBlob, { upsert: true });

        if (uploadError) throw uploadError;
        finalLogoUrl = fileName;
      } catch (err: any) {
        alert("이미지 업로드 중 오류가 발생했습니다: " + err.message);
        return;
      }
    }

    try {
      const { error } = await supabase
        .from("academy_tenant")
        .update({
          name: formData.name,
          phone: formData.phone,
          address: formData.address,
          business_number: formData.business_number,
          ceo_name: formData.ceo_name,
          logo_url: finalLogoUrl 
        })
        .eq("tenant_id", activeTenant.tenant_id);

      if (error) {
        alert("업데이트 중 에러가 발생했습니다.");
        return;
      }

      alert("학원 정보가 성공적으로 업데이트되었습니다.");
      setIsEditing(false);
      setFormData(prev => ({ ...prev, logo_url: finalLogoUrl }));
      setCroppedBlob(null);
      
      if (isHQ) {
        const { data: allTenants } = await supabase.from("academy_tenant").select("*");
        if (allTenants) {
          setTenants(sortTenants(allTenants));
        }
      }
      
      setActiveTenant((prev: any) => ({ ...prev, ...formData, logo_url: finalLogoUrl }));

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
    <div className="h-full flex flex-col font-pretendard bg-slate-50 p-4 sm:p-8 overflow-hidden relative">
      
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
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">지점 상세 정보 및 로고/전경 관리</p>
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
            <div className="max-w-4xl mx-auto space-y-6 pb-10">
              
              {/* 🌟 [NEW] 꽉 찬 가로형 배너 레이아웃으로 변경된 대표 이미지 섹션 */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                  <h3 className="text-sm font-black text-slate-800">대표 이미지 (로고 및 전경)</h3>
                  {isEditing && (
                    <button onClick={() => fileInputRef.current?.click()} className="text-[11px] font-bold bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1 shadow-sm">
                      <span>📸</span> 이미지 업로드
                    </button>
                  )}
                  <input type="file" accept="image/*" ref={fileInputRef} onChange={onFileChange} className="hidden" />
                </div>
                
                <div className="flex flex-col gap-4">
                  {/* 🌟 와이드 16:9 배너 형태로 박스를 꽉 채웁니다 */}
                  <div className="w-full aspect-[21/9] sm:aspect-[16/9] lg:aspect-[21/9] bg-slate-100 rounded-xl border border-slate-200 overflow-hidden relative shadow-inner flex items-center justify-center group">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Academy Logo" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center">
                        <span className="text-4xl text-slate-300 block mb-2">🏞️</span>
                        <span className="text-[11px] font-bold text-slate-400">등록된 이미지가 없습니다.</span>
                      </div>
                    )}
                    
                    {/* 마우스 오버 시 편집 유도 오버레이 */}
                    {isEditing && (
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-[2px]" onClick={() => fileInputRef.current?.click()}>
                        <span className="text-white text-sm font-bold bg-black/70 px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-lg">
                          <span>📸</span> 클릭하여 새 이미지 업로드
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[12px] font-bold text-slate-600 mb-2">권장 해상도 및 포맷</p>
                    <ul className="text-[11px] font-medium text-slate-500 space-y-1.5 list-disc pl-4">
                      <li>권장 비율: <strong className="text-indigo-600">16:9 와이드 (예: 800 x 450 픽셀)</strong></li>
                      <li>지원 포맷: JPG, PNG, WEBP (최대 5MB)</li>
                      <li>등록된 이미지는 학원 홈페이지 대문 및 지점 안내 페이지 등에서 공통으로 사용됩니다.</li>
                    </ul>
                    {isEditing && (
                      <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                        <p className="text-[10px] font-bold text-amber-700">💡 이미지를 업로드하면 마우스로 드래그하여 위치를 조정하고 크기를 자를 수 있는 편집창이 열립니다.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 기본 정보 섹션 */}
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

              {/* 운영 정보 섹션 */}
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

      {/* 🌟 웅장한 이미지 편집(Cropper) 모달 */}
      {isCropperOpen && rawImageSrc && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
              <h2 className="text-lg font-bold tracking-tight">✂️ 대표 이미지 편집</h2>
              <button onClick={() => { setIsCropperOpen(false); setRawImageSrc(null); }} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 bg-slate-50 flex flex-col items-center">
              <p className="text-xs font-bold text-slate-500 mb-4 text-center">
                마우스로 이미지를 <strong className="text-indigo-600">드래그</strong>하여 위치를 맞추고, 하단의 슬라이더로 <strong className="text-indigo-600">크기를 조절</strong>하세요.<br/>밝은 영역(16:9 비율)만 최종 저장됩니다.
              </p>
              
              {/* 편집 영역 (16:9 컨테이너) */}
              <div 
                className="relative w-[480px] h-[270px] bg-slate-800 overflow-hidden rounded-lg shadow-inner cursor-move touch-none border border-slate-300"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onWheel={onWheel}
              >
                <img 
                  ref={imageRef}
                  src={rawImageSrc} 
                  alt="Crop Target" 
                  className="absolute pointer-events-none"
                  style={{
                    height: '100%',
                    width: 'auto',
                    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                    top: '50%',
                    left: '50%'
                  }}
                  draggable={false}
                />
                <div className="absolute inset-0 border-2 border-white/50 pointer-events-none mix-blend-overlay"></div>
              </div>

              {/* 줌 컨트롤 */}
              <div className="flex items-center gap-4 w-[480px] mt-6 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-lg">🔍</span>
                <input 
                  type="range" 
                  min="0.5" max="3" step="0.01" 
                  value={zoom} 
                  onChange={(e) => setZoom(Number(e.target.value))} 
                  className="flex-1 accent-[#002864] h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" 
                />
                <span className="text-xs font-bold text-slate-500 w-12 text-right">{Math.round(zoom * 100)}%</span>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button onClick={() => { setIsCropperOpen(false); setRawImageSrc(null); }} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 shadow-sm transition-colors text-sm">취소</button>
              <button onClick={generateCrop} className="px-6 py-2.5 bg-[#002864] text-white font-bold rounded-lg hover:bg-blue-900 shadow-sm transition-colors flex items-center gap-1.5 text-sm">
                <span>✂️</span> 크롭 적용 및 임시 저장
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}