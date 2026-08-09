// src/app/(dashboard)/layout.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FloatingChat from "@/components/FloatingChat";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import ProfileModal from "@/components/ProfileModal";
import { getLayoutData } from "@/app/actions/profile";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  const [layoutData, setLayoutData] = useState({ instId: "", name: "", profileImgUrl: "", isSuperAdmin: false });
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    // 🔒 서버에서 JWT 토큰을 까보고 안전한 정보만 가져옵니다.
    getLayoutData().then(res => {
      if (!res.success) {
        router.push("/"); // 쿠키가 없거나 위조됐다면 쫓아냄
        return; 
      }
      setLayoutData({
        instId: res.instId!,
        name: res.name!,
        profileImgUrl: res.profileImgUrl!,
        isSuperAdmin: res.isSuperAdmin!
      });
    });
  }, [router]);

  const handleLogout = () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      document.cookie = "logica_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.clear();
      router.push("/");
    }
  };

  return (
    <div className="h-screen flex overflow-hidden text-slate-800 bg-slate-50 relative">
      
      {/* 1. 독립된 사이드바 컴포넌트 */}
      <Sidebar isSuperAdmin={layoutData.isSuperAdmin} />

      <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-50 relative">
        {/* 2. 독립된 플로팅 헤더 캡슐 */}
        <TopHeader 
          instId={layoutData.instId} 
          instructorName={layoutData.name} 
          profileImgUrl={layoutData.profileImgUrl} 
          onOpenProfile={() => setIsProfileOpen(true)} 
          onLogout={handleLogout} 
        />

        {/* 메인 렌더링 영역 */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 pt-4">
          {children}
        </main>
      </div>

      {/* 3. 독립된 프로필 수정 모달 (💡 아예 DOM에서 제거되도록 조건부 렌더링 처리) */}
      {isProfileOpen && (
        <ProfileModal 
          isOpen={isProfileOpen} 
          onClose={() => setIsProfileOpen(false)} 
          instId={layoutData.instId} 
          instructorName={layoutData.name} 
        />
      )}

      {/* 우측 하단 플로팅 챗 */}
      {layoutData.instId && <FloatingChat instId={layoutData.instId} />}
    </div>
  );
}