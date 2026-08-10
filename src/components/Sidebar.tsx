// src/components/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase"; 

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  
  const [strictSuperAdmin, setStrictSuperAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  
  // 현재 소속 학원명 상태
  const [tenantName, setTenantName] = useState<string>("로딩중...");

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || '';
    const pos = localStorage.getItem('logica_instructor_position') || '';
    
    const isSA = role === 'SUPER_ADMIN' || pos.includes('최고관리자') || pos.includes('대장');
    const isMgr = role === 'PRINCIPAL' || role === 'MANAGER' || pos.includes('원장') || pos.includes('실장');
    
    setStrictSuperAdmin(isSA);
    setIsManager(isMgr || isSA);

    const fetchTenantName = async () => {
      const tId = localStorage.getItem('logica_tenant_id');
      if (tId) {
        const { data } = await supabase.from('academy_tenant').select('name').eq('tenant_id', tId).maybeSingle();
        if (data && data.name) {
          setTenantName(data.name);
        } else {
          setTenantName("지점 미배정");
        }
      } else {
        setTenantName("지점 미배정");
      }
    };
    fetchTenantName();
  }, []);

  const canAccess = (path: string) => {
    if (strictSuperAdmin) return true;
    if (path === "/admission" || path === "/task" || path === "/supply" || path === "/cs" || path === "/minutes") return true;
    return false;
  };

  const MenuItem = ({ path, label, desc, full = false }: { path: string, label: string, desc?: string, full?: boolean }) => {
    const active = pathname === path || pathname.startsWith(path + "/");
    const disabled = !canAccess(path);
    
    const baseClass = `flex flex-col items-center justify-center px-2 py-3 rounded-xl transition-all border ${full ? 'col-span-2' : 'col-span-1'}`;
    
    if (disabled) {
      return (
        <div className={`${baseClass} bg-slate-50/50 border-slate-100 text-slate-400 opacity-40 cursor-not-allowed`}>
          <span className="text-[13px] font-bold truncate">{label}</span>
          {desc && <span className="text-[10px] font-medium mt-0.5">{desc}</span>}
        </div>
      );
    }
    
    return (
      <Link href={path} className={`${baseClass} ${active ? 'bg-blue-50 border-blue-200 text-[#002864] shadow-[0_2px_8px_rgba(0,40,100,0.08)]' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-800 hover:shadow-sm'}`}>
        <span className={`text-[13px] truncate tracking-tight ${active ? 'font-black' : 'font-bold'}`}>{label}</span>
        {desc && <span className={`text-[10px] truncate tracking-tight mt-0.5 ${active ? 'text-blue-500 font-bold' : 'text-slate-400 font-medium'}`}>{desc}</span>}
      </Link>
    );
  };

  const MenuSection = ({ title, icon, children }: { title: string, icon: string, children: React.ReactNode }) => (
    <div className="mb-6">
      <div className="px-4 flex items-center gap-1.5 mb-3">
        <span className="text-[13px]">{icon}</span>
        <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">{title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3">
        {children}
      </div>
    </div>
  );

  return (
    <aside className="print:hidden w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 h-full relative">
      
      {/* 🌟 [수정됨] 글씨 잘림 방지를 위해 텍스트 컨테이너에 flex-1 min-w-0 적용 및 텍스트 래핑 제어 */}
      <div onClick={() => canAccess("/home") ? router.push("/home") : router.push("/admission")} className="h-24 flex items-center px-6 border-b border-slate-100 shrink-0 cursor-pointer group hover:bg-slate-50 transition-colors gap-3.5">
        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-9 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        
        <div className="flex flex-col border-l-2 border-slate-200 pl-3.5 flex-1 min-w-0 justify-center h-12">
          <span className="text-[15px] font-black text-slate-800 truncate leading-tight mb-0.5">
            {tenantName}
          </span>
          <span className="text-[10px] font-bold text-slate-400 uppercase leading-none tracking-wider whitespace-nowrap">
            {strictSuperAdmin ? "Super Admin" : "Teacher"}
          </span>
        </div>
      </div>

      <nav className="flex-1 py-5 overflow-y-auto custom-scroll">
        
        <MenuSection title="학원 관리" icon="🏫">
          <MenuItem path="/home" label="홈(대시보드)" />
          <MenuItem path="/student" label="학생 관리" />
          <MenuItem path="/class" label="반 관리" />
          <MenuItem path="/lesson" label="교재 관리" />
        </MenuSection>
        
        <MenuSection title="수업 관리" icon="👨‍🏫">
          <MenuItem path="/learning" label="학습 관리" desc="시험 · 과제 · 오답" full />
          <MenuItem path="/progress" label="진도 관리" />
          <MenuItem path="/makeup" label="보강 관리" /> 
        </MenuSection>

        <MenuSection title="소통 및 업무 관리" icon="💬">
          <MenuItem path="/minutes" label="AI 회의록" />
          <MenuItem path="/task" label="업무 공유" />
          <MenuItem path="/supply" label="비품 신청" />
          <MenuItem path="/cs" label="학부모 요청/CS" />
        </MenuSection>

        <MenuSection title="출제 및 배포" icon="🖨️">
          <MenuItem path="/exam-list" label="문제지 관리" />
          <MenuItem path="/admission" label="진단평가 관리" />
        </MenuSection>

        {/* 데스크 전용 메뉴 */}
        <div className="mb-6">
          <div className="px-4 flex items-center gap-1.5 mb-3">
            <span className="text-[13px]">🏢</span>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">데스크 전용</p>
            <span className="text-[9px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-md font-black border border-rose-200 ml-1">원장·실장</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3">
            <MenuItem path="/admin-dashboard" label="운영 대시보드" full />
            <MenuItem path="/billing" label="수납/청구" />
            <MenuItem path="/unpaid" label="미납 관리" />
            <MenuItem path="/shop-admin" label="상점 관리" full />
          </div>
        </div>

        {/* 최고관리자 전용 메뉴 */}
        {strictSuperAdmin && (
          <div className="mb-6">
            <div className="px-4 flex items-center gap-1.5 mb-3">
              <span className="text-[13px]">👑</span>
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">최고관리자 전용</p>
              <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-md font-black border border-indigo-200 ml-1">ADMIN</span>
            </div>
            <div className="grid grid-cols-2 gap-2 px-3">
              <MenuItem path="/seat-layout-editor" label="클리닉 좌석 관리" full />
              <MenuItem path="/permission" label="권한 관리" />
              <MenuItem path="/academy-info" label="학원 정보" />
            </div>
          </div>
        )}

      </nav>
    </aside>
  );
}