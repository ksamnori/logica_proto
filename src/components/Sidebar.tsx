// src/components/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  
  const [strictSuperAdmin, setStrictSuperAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || '';
    const pos = localStorage.getItem('logica_instructor_position') || '';
    
    const isSA = role === 'SUPER_ADMIN' || pos.includes('최고관리자') || pos.includes('대장');
    const isMgr = role === 'PRINCIPAL' || role === 'MANAGER' || pos.includes('원장') || pos.includes('실장');
    
    setStrictSuperAdmin(isSA);
    setIsManager(isMgr || isSA);
  }, []);

  const canAccess = (path: string) => {
    if (strictSuperAdmin) return true;
    if (path === "/admission" || path === "/task" || path === "/supply" || path === "/cs" || path === "/minutes") return true;
    return false;
  };

  const getMenuClass = (path: string) => {
    if (!canAccess(path)) {
      return "text-slate-400 font-bold opacity-40 line-through pointer-events-none cursor-not-allowed";
    }
    const isActive = pathname === path || pathname.startsWith(path + "/");
    return isActive ? "bg-blue-50 text-[#002864] font-bold" : "text-slate-500 font-medium hover:bg-slate-50 hover:text-slate-800";
  };

  return (
    <aside className="print:hidden w-56 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 h-full relative">
      <div onClick={() => canAccess("/home") ? router.push("/home") : router.push("/admission")} className="h-16 flex items-center px-5 border-b border-slate-100 shrink-0 cursor-pointer group hover:bg-slate-50 transition-colors">
        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <span className="ml-2 text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
          {strictSuperAdmin ? "Admin" : "Teacher"}
        </span>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scroll">
        <Link href="/home" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/home")}`}>🏠 홈 (대시보드)</Link>
        <Link href="/student" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/student")}`}>👨‍🎓 학생 관리</Link>
        <Link href="/class" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/class")}`}>🏫 반 관리</Link>
        <Link href="/lesson" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/lesson")}`}>📚 교재 관리</Link>
        
        <div className="pt-3 pb-1"><p className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">수업 관리</p></div>
        <Link href="/progress" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/progress")}`}>📈 진도 관리</Link>
        <Link href="/learning" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/learning")}`}>📊 학습 관리</Link>
        <Link href="/makeup" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/makeup")}`}>🔄 보강 관리</Link>

        <div className="pt-3 pb-1"><p className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">소통 및 업무 관리</p></div>
        <Link href="/task" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/task")}`}>📌 업무 공유</Link>
        <Link href="/supply" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/supply")}`}>📦 비품 신청</Link>
        <Link href="/cs" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/cs")}`}>🚨 학부모 요청/CS</Link>
        <Link href="/minutes" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/minutes")}`}>🎙️ AI 회의록</Link>

        <div className="pt-3 pb-1"><p className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">출제 및 배포</p></div>
        <Link href="/exam-list" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/exam-list")}`}>🖨️ 문제지 관리</Link>
        <Link href="/admission" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/admission")}`}>📝 입학테스트 관리</Link>

        {strictSuperAdmin && (
          <>
            <div className="pt-3 pb-1 px-3 flex items-center gap-1.5">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">최고관리자 전용</p>
              <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-black border border-indigo-200">최고관리자</span>
            </div>
            <Link href="/seat-layout-editor" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/seat-layout-editor")}`}>🪑 클리닉 좌석 관리</Link>
          </>
        )}

        <div className="pt-3 pb-1 px-3 flex items-center gap-1.5">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">데스크 전용</p>
          <span className="text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded font-black border border-rose-200">원장·실장</span>
        </div>
        <Link href="/admin-dashboard" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] ${getMenuClass("/admin-dashboard")}`}>👑 운영 대시보드</Link>
        <Link href="/billing" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] mt-0.5 ${getMenuClass("/billing")}`}>💳 수납/청구 관리</Link>
        <Link href="/unpaid" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] mt-0.5 ${getMenuClass("/unpaid")}`}>⚠️ 미납 관리</Link>
        <Link href="/shop-admin" className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-colors text-[13px] mt-0.5 ${getMenuClass("/shop-admin")}`}>🛒 상점 관리</Link>
      </nav>
    </aside>
  );
}