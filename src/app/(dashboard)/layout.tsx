// src/app/(dashboard)/layout.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase"; // 🌟 수파베이스 임포트 추가
import FloatingChat from "@/components/FloatingChat";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import ProfileModal from "@/components/ProfileModal";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  const [layoutData, setLayoutData] = useState({ instId: "", name: "", profileImgUrl: "", isSuperAdmin: false });
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    // 🌟 서버 액션 대신 수파베이스를 통해 직접 인증 상태와 DB 정보를 가져옵니다.
    const fetchLayoutData = async () => {
      // 1. 수파베이스 로그인 세션 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        router.push("/"); // 수파베이스 세션이 없으면 쫓아냄
        return; 
      }

      // 2. 이메일에서 로그인 ID 추출 (fakeEmail 방식)
      const loginId = user.email?.split('@')[0];
      
      if (loginId) {
        // 3. DB에서 강사 정보 실시간으로 가져오기
        const { data: instructor } = await supabase
          .from('instructor')
          .select('*')
          .eq('login_id', loginId)
          .single();

        if (instructor) {
          const role = String(instructor.role || '').toUpperCase();
          const pos = String(instructor.position || '');
          
          const isSuperAdmin = 
            role === 'SUPER_ADMIN' || 
            ['ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role) ||
            pos.includes('원장') || 
            pos.includes('실장') ||
            pos.includes('최고관리자');

          setLayoutData({
            instId: instructor.instructor_id,
            name: instructor.name,
            profileImgUrl: instructor.profile_image_url || "",
            isSuperAdmin: isSuperAdmin
          });
        }
      }
    };

    fetchLayoutData();
  }, [router]);

  const handleLogout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      // 🌟 [수정됨] 옛날 쿠키 대신 수파베이스 쿠키(sb-access-token) 삭제
      document.cookie = "sb-access-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.clear();
      sessionStorage.clear();
      
      await supabase.auth.signOut(); // 수파베이스 로그아웃 처리
      router.push("/");
    }
  };

  return (
    <div className="h-screen flex overflow-hidden text-slate-800 bg-slate-50 relative">
      
      {/* 1. 독립된 사이드바 컴포넌트 */}
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-50 relative">
        {/* 2. 독립된 플로팅 헤더 캡슐 */}
        <TopHeader 
          instId={layoutData.instId} 
          instructorName={layoutData.name} 
          profileImgUrl={layoutData.profileImgUrl} 
          isSuperAdmin={layoutData.isSuperAdmin}
          onOpenProfile={() => setIsProfileOpen(true)} 
          onLogout={handleLogout} 
        />

        {/* 메인 렌더링 영역 */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 pt-4">
          {children}
        </main>
      </div>

      {/* 3. 독립된 프로필 수정 모달 */}
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