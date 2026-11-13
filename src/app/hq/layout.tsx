// src/app/hq/layout.tsx
"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import ProfileModal from "@/components/ProfileModal";
import HqHeader from "@/components/hq/HqHeader";
import HqSchemaSetupBanner from "@/components/hq/HqSchemaSetupBanner";
import { HqShellProvider, useHqShell } from "@/components/hq/HqShellContext";
import HqSidebar from "@/components/hq/HqSidebar";

function HqWorkspaceFrame({
  children,
  isProfileOpen,
  onCloseProfile,
}: {
  children: React.ReactNode;
  isProfileOpen: boolean;
  onCloseProfile: () => void;
}) {
  const { instId, me, isBooting, refreshMembers } = useHqShell();

  return (
    <div className="h-screen flex overflow-hidden bg-[#F5F7FA] text-slate-800 print:h-auto print:overflow-visible print:bg-white">
      <HqSidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden print:h-auto print:overflow-visible">
        <HqHeader />
        <HqSchemaSetupBanner />

        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scroll relative print:overflow-visible">
          {isBooting ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 py-24 print:hidden">
              <div className="w-9 h-9 rounded-full border-3 border-slate-300 border-t-brand animate-spin" />
              <p className="text-xs font-bold text-slate-500">
                본부 HR · 전자결재 워크스페이스를 불러오는 중입니다...
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {isProfileOpen && instId && (
        <ProfileModal
          isOpen={isProfileOpen}
          onClose={() => {
            onCloseProfile();
            refreshMembers();
          }}
          instId={instId}
          instructorName={me?.name || "본부 구성원"}
          isHQ={true}
        />
      )}
    </div>
  );
}

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // 로그인·가입 화면은 쉘(사이드바·헤더·세션 가드) 없이 단독 렌더링
  if (pathname === "/hq/login" || pathname === "/hq/signup") {
    return <>{children}</>;
  }

  return (
    <HqShellProvider onOpenProfile={() => setIsProfileOpen(true)}>
      <HqWorkspaceFrame
        isProfileOpen={isProfileOpen}
        onCloseProfile={() => setIsProfileOpen(false)}
      >
        {children}
      </HqWorkspaceFrame>
    </HqShellProvider>
  );
}
