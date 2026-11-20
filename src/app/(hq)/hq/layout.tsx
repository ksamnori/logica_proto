// src/app/(hq)/hq/layout.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import HqChatDrawer from "@/components/hq/HqChatDrawer";
import HqHeader from "@/components/hq/HqHeader";
import HqSchemaSetupBanner from "@/components/hq/HqSchemaSetupBanner";
import { HqShellProvider, useHqShell } from "@/components/hq/HqShellContext";
import HqSidebar from "@/components/hq/HqSidebar";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import HqSettingsModal from "@/components/hq/settings/HqSettingsModal";
import { useHqHref } from "@/lib/hq/hqRoutes";
import { HQ_ROUTE_TAB_TITLES, toCanonicalHqPath } from "@/lib/hq/hqRouteUtils";

function HqWorkspaceFrame({
  canonicalPath,
  children,
  isProfileOpen,
  profileInitialSubModal,
  onCloseProfile,
  settingsModalOpen,
  settingsInitialTab,
  onCloseSettings,
}: {
  canonicalPath: string;
  children: React.ReactNode;
  isProfileOpen: boolean;
  profileInitialSubModal: "basic" | "hr" | null;
  onCloseProfile: () => void;
  settingsModalOpen: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
}) {
  const router = useRouter();
  const hqHref = useHqHref();
  const {
    instId,
    me,
    members,
    isHrManager,
    isBooting,
    canAccessMenu,
    refreshMembers,
  } = useHqShell();

  const existingDepts = useMemo(
    () => Array.from(new Set(members.map((m) => m.department).filter(Boolean))),
    [members]
  );

  const routeAllowed = !me || canAccessMenu(canonicalPath);
  const isMobilePortalRoute =
    canonicalPath === "/hq/m" || canonicalPath.startsWith("/hq/m/");

  if (isMobilePortalRoute) {
    return (
      <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-[#F5F7FA] text-slate-800 break-keep overscroll-none">
        {isBooting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 px-6 text-center">
            <div className="w-9 h-9 rounded-full border-3 border-slate-300 border-t-brand animate-spin" />
            <p className="text-xs font-bold text-slate-500">
              본부 모바일 워크스페이스를 불러오는 중입니다...
            </p>
          </div>
        ) : (
          children
        )}

        {/* 내 프로필 모달 (모바일에서도 동일 공유) */}
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
      </div>
    );
  }

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
          ) : !routeAllowed ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md shadow-xs space-y-3">
                <div className="text-3xl">🔒</div>
                <h3 className="text-base font-extrabold text-slate-900">
                  접근 권한이 제한된 메뉴입니다
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  현재 계정({me?.name})에는 해당 메뉴 열람 권한이 활성화되어 있지 않습니다.
                  필요한 경우 본부 관리자의 [설정 &gt; 권한 설정]에서 메뉴 허용을 요청해 주세요.
                </p>
                <button
                  type="button"
                  onClick={() => router.push(hqHref("/hq"))}
                  className="px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold"
                >
                  본부 홈 대시보드로 이동
                </button>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* 우측 슬라이드 미니 사내 메신저 */}
      <HqChatDrawer />

      {/* 내 프로필 모달 */}
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

      {/* 본부 환경 설정 모달 (설정 권한 보유 시에만 오픈) */}
      {canAccessMenu("/hq/settings") && (
        <HqSettingsModal
          isOpen={settingsModalOpen}
          mode="modal"
          initialTab={settingsInitialTab}
          onClose={onCloseSettings}
        />
      )}
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
      ? `${label} | HQ`
      : "HQ | 천종현수학연구소 본부";
  }, [canonicalPath]);

  // 로그인·가입 화면 및 외부 저자 원격 서명 화면은 쉘(사이드바·헤더·세션 가드) 없이 단독 렌더링
  if (
    canonicalPath === "/hq/login" ||
    canonicalPath === "/hq/signup" ||
    canonicalPath.startsWith("/hq/sign/")
  ) {
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
        canonicalPath={canonicalPath}
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
