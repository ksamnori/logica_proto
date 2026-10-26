// src/app/(dashboard)/layout.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase"; 
import FloatingChat from "@/components/FloatingChat";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import ProfileModal from "@/components/ProfileModal";

// 🌟 [정석 타입 정의] 레이아웃에서 관리하는 상태 규격을 엄격하게 지정합니다.
interface LayoutData {
  instId: string;
  name: string;
  profileImgUrl: string;
  isSuperAdmin: boolean;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  const [layoutData, setLayoutData] = useState<LayoutData>({ instId: "", name: "", profileImgUrl: "", isSuperAdmin: false });
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    const fetchLayoutData = async () => {
      // 1. 수파베이스 로그인 세션 확인
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        router.push("/"); // 수파베이스 세션이 없으면 쫓아냄
        return; 
      }

      // 🌟 [핵심 해결] 이메일 자르기 꼼수를 버리고, 정확한 고유 UID(user.id)로 강사를 검색합니다!
      if (user.id) {
        // 3. DB에서 강사 정보 실시간으로 가져오기
        const { data: instructor } = await supabase
          .from('instructor')
          .select('*')
          .eq('instructor_id', user.id) // 👈 login_id 대신 instructor_id 로 완벽 매칭!
          .single();

        if (instructor) {
          const role = String(instructor.role || '').toUpperCase();
          const pos = String(instructor.position || '');
          
          const isSuperAdmin = 
            role === 'SUPER_ADMIN' || 
            ['ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role) ||
            pos.includes('원장') || 
            pos.includes('실장') ||
            pos.includes('대장') ||
            pos.includes('최고관리자');

          setLayoutData({
            instId: instructor.instructor_id,
            name: instructor.name,
            // 🌟 [추가 수정] DB 컬럼명 오타 (profile_image_url) 반영
            profileImgUrl: instructor.profile_image_url || instructor.profile_image || "",
            isSuperAdmin: isSuperAdmin
          });
        }
      }
    };

    fetchLayoutData();
  }, [router]);

  const handleLogout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      document.cookie = "sb-access-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.clear();
      sessionStorage.clear();
      
      await supabase.auth.signOut(); 
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

      {/* 🌟 이제 instId를 완벽하게 불러오므로 플로팅 챗이 무조건 나타납니다! */}
      {layoutData.instId && <FloatingChat instId={layoutData.instId} />}
    </div>
  );
}