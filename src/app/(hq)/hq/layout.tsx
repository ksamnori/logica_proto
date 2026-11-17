// src/app/hq/layout.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import HqHeader from "@/components/hq/HqHeader";
import HqSchemaSetupBanner from "@/components/hq/HqSchemaSetupBanner";
import { HqShellProvider, useHqShell } from "@/components/hq/HqShellContext";
import HqSidebar from "@/components/hq/HqSidebar";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import HqSettingsModal from "@/components/hq/settings/HqSettingsModal";
import { HQ_ROUTE_TAB_TITLES, toCanonicalHqPath } from "@/lib/hq/hqRouteUtils";

function HqWorkspaceFrame({
  children,
  isProfileOpen,
  profileInitialSubModal,
  onCloseProfile,
  settingsModalOpen,
  settingsInitialTab,
  onCloseSettings,
}: {
  children: React.ReactNode;
  isProfileOpen: boolean;
  profileInitialSubModal: "basic" | "hr" | null;
  onCloseProfile: () => void;
  settingsModalOpen: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
}) {
  const { instId, me, members, isHrManager, isBooting, refreshMembers } =
    useHqShell();

  const existingDepts = useMemo(
    () => Array.from(new Set(members.map((m) => m.department).filter(Boolean))),
    [members]
  );

  return (
    <div className="h-screen flex overflow-hidden bg-[#F5F7FA] text-slate-800 break-keep print:h-auto print:overflow-visible print:bg-white">
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

      {/* 내 프로필 모달 (Flex 스타일) */}
      <HqMemberProfileModal
        isOpen={isProfileOpen}
        member={me}
        meId={instId}
        isHrManager={isHrManager}
        existingDepartments={existingDepts}
        initialSubModal={profileInitialSubModal}
        onClose={onCloseProfile}
        onSaved={refreshMembers}
      />

      {/* 본부 환경 설정 모달 (회사 정보 · 쉬는 날 · 회사 직인 · 계열사 관리) */}
      <HqSettingsModal
        isOpen={settingsModalOpen}
        mode="modal"
        initialTab={settingsInitialTab}
        onClose={onCloseSettings}
      />
    </div>
  );
}

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const canonicalPath = toCanonicalHqPath(pathname);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileSubModal, setProfileSubModal] = useState<
    "basic" | "hr" | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("company");

  useEffect(() => {
    const label = HQ_ROUTE_TAB_TITLES[canonicalPath];
    document.title = label
      ? `${label} | Logica HQ`
      : "Logica HQ | 천종현수학연구소 본부";
  }, [canonicalPath]);

  // 로그인·가입 화면은 쉘(사이드바·헤더·세션 가드) 없이 단독 렌더링
  if (canonicalPath === "/hq/login" || canonicalPath === "/hq/signup") {
    return <>{children}</>;
  }

  return (
    <HqShellProvider
      onOpenProfile={(sub) => {
        setProfileSubModal(sub === "basic" || sub === "hr" ? sub : null);
        setIsProfileOpen(true);
      }}
      onOpenSettings={(tab) => {
        setSettingsTab(tab || "company");
        setSettingsOpen(true);
      }}
    >
      <HqWorkspaceFrame
        isProfileOpen={isProfileOpen}
        profileInitialSubModal={profileSubModal}
        onCloseProfile={() => {
          setIsProfileOpen(false);
          setProfileSubModal(null);
        }}
        settingsModalOpen={settingsOpen}
        settingsInitialTab={settingsTab}
        onCloseSettings={() => setSettingsOpen(false)}
      >
        {children}
      </HqWorkspaceFrame>
    </HqShellProvider>
  );
}
