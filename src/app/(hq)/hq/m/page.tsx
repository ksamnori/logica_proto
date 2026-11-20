// src/app/(hq)/hq/m/page.tsx
"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqMobileApprovalsTab from "@/components/hq/mobile/HqMobileApprovalsTab";
import HqMobileCalendarTab, {
  type CalendarSubView,
} from "@/components/hq/mobile/HqMobileCalendarTab";
import HqMobileHomeTab, {
  type MobileQuickAction,
} from "@/components/hq/mobile/HqMobileHomeTab";
import HqMobileLeaveExpenseTab, {
  type LeaveExpenseSubMode,
} from "@/components/hq/mobile/HqMobileLeaveExpenseTab";
import HqMobileMessengerTab from "@/components/hq/mobile/HqMobileMessengerTab";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";

type MobileTabKey =
  | "HOME"
  | "APPROVALS"
  | "LEAVE_EXPENSE"
  | "CALENDAR"
  | "MESSENGER";

const TAB_HEADER_TITLES: Record<MobileTabKey, string> = {
  HOME: "본부 모바일 홈",
  APPROVALS: "전자결재 · 워크플로우",
  LEAVE_EXPENSE: "내 휴가 · 경비 정산",
  CALENDAR: "통합 일정 · 미팅",
  MESSENGER: "사내 메신저",
};

export default function HqMobileWorkspacePage() {
  const router = useRouter();
  const hqHref = useHqHref();
  const {
    me,
    companySettings,
    pendingApprovalCount,
    approvalAlertActive,
    unreadChatCount,
    openProfileModal,
    logout,
  } = useHqShell();

  const [activeTab, setActiveTab] = useState<MobileTabKey>("HOME");
  const [navLaunchId, setNavLaunchId] = useState(0);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // 탭 간 빠른 실행 초기 상태
  const [openApprovalCreate, setOpenApprovalCreate] = useState(false);
  const [leaveExpenseMode, setLeaveExpenseMode] =
    useState<LeaveExpenseSubMode>("LEAVE");
  const [leaveExpenseSheet, setLeaveExpenseSheet] = useState<
    "LEAVE_CREATE" | "EXPENSE_CAMERA" | null
  >(null);
  const [calendarSubView, setCalendarSubView] =
    useState<CalendarSubView>("CALENDAR");
  const [openAiRecorder, setOpenAiRecorder] = useState(false);
  const [isChatRoomOpen, setIsChatRoomOpen] = useState(false);

  const companyLogoUrl = resolveStoragePublicUrl(
    companySettings?.logo_image_url
  );
  const myAvatarUrl = resolveStoragePublicUrl(me?.profile_image_url);

  const handleQuickAction = useCallback((action: MobileQuickAction) => {
    setNavLaunchId((n) => n + 1);
    switch (action) {
      case "OPEN_APPROVALS":
        setOpenApprovalCreate(false);
        setActiveTab("APPROVALS");
        break;
      case "NEW_APPROVAL":
        setOpenApprovalCreate(true);
        setActiveTab("APPROVALS");
        break;
      case "REQUEST_LEAVE":
        setLeaveExpenseMode("LEAVE");
        setLeaveExpenseSheet("LEAVE_CREATE");
        setActiveTab("LEAVE_EXPENSE");
        break;
      case "SNAP_EXPENSE":
        setLeaveExpenseMode("EXPENSE");
        setLeaveExpenseSheet("EXPENSE_CAMERA");
        setActiveTab("LEAVE_EXPENSE");
        break;
      case "OPEN_CALENDAR":
        setCalendarSubView("CALENDAR");
        setOpenAiRecorder(false);
        setActiveTab("CALENDAR");
        break;
      case "OPEN_MEETINGS":
        setCalendarSubView("MEETINGS");
        setOpenAiRecorder(false);
        setActiveTab("CALENDAR");
        break;
      case "START_AI_RECORD":
        setCalendarSubView("MEETINGS");
        setOpenAiRecorder(true);
        setActiveTab("CALENDAR");
        break;
      case "OPEN_MESSENGER":
        setActiveTab("MESSENGER");
        break;
    }
  }, []);

  const switchToDesktop = () => {
    try {
      localStorage.setItem("hq_prefer_desktop", "1");
    } catch {
      // ignore
    }
    router.push(hqHref("/hq"));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full max-w-lg mx-auto bg-[#F5F7FA] sm:shadow-xl sm:border-x sm:border-slate-200 relative overflow-hidden">
      {/* 상단 모바일 헤더 (채팅방 내부 진입 시 공간 확보를 위해 숨김) */}
      {!(activeTab === "MESSENGER" && isChatRoomOpen) && (
        <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between gap-2 shrink-0 z-20">
          <button
            type="button"
            onClick={() => setActiveTab("HOME")}
            className="flex items-center gap-2.5 min-w-0 text-left"
          >
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-xs shadow-xs shrink-0 overflow-hidden">
              <span>HQ</span>
              {companyLogoUrl && (
                <img
                  src={companyLogoUrl}
                  alt="HQ"
                  className="absolute inset-0 w-full h-full object-cover bg-white"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold text-slate-900 leading-tight truncate">
                {companySettings?.company_name || "(주)천종현수학연구소"}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 leading-tight truncate mt-0.5">
                {TAB_HEADER_TITLES[activeTab]}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {pendingApprovalCount > 0 && activeTab !== "APPROVALS" && (
              <button
                type="button"
                onClick={() => {
                  setOpenApprovalCreate(false);
                  setActiveTab("APPROVALS");
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold flex items-center gap-1 ${
                  approvalAlertActive
                    ? "bg-rose-600 text-white animate-pulse"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                <span>🔔</span>
                <span>{pendingApprovalCount}</span>
              </button>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-xs font-extrabold text-slate-700 overflow-hidden"
              >
                {myAvatarUrl ? (
                  <img
                    src={myAvatarUrl}
                    alt={me?.name || "프로필"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{me?.name?.slice(0, 1) || "H"}</span>
                )}
              </button>

              {profileMenuOpen && (
                <>
                  <div
                    onClick={() => setProfileMenuOpen(false)}
                    className="fixed inset-0 z-30"
                  />
                  <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                    <div className="px-3.5 py-2 border-b border-slate-100">
                      <div className="font-extrabold text-slate-900">
                        {me?.name} {me?.job_title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {me?.department || "본부"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        openProfileModal();
                      }}
                      className="w-full px-3.5 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span>👤</span>
                      <span>내 프로필 · 부재중 설정</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        switchToDesktop();
                      }}
                      className="w-full px-3.5 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span>🖥️</span>
                      <span>PC 데스크톱 버전 보기</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        if (confirm("로그아웃 하시겠습니까?")) {
                          void logout();
                        }
                      }}
                      className="w-full px-3.5 py-2.5 text-left font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-100"
                    >
                      <span>🚪</span>
                      <span>로그아웃</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      {/* 메인 탭 뷰포트 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === "HOME" && (
          <HqMobileHomeTab onAction={handleQuickAction} />
        )}

        {activeTab === "APPROVALS" && (
          <HqMobileApprovalsTab
            key={`apr-${navLaunchId}`}
            defaultOpenCreate={openApprovalCreate}
            onJumpToLeaveRequest={() => {
              setNavLaunchId((n) => n + 1);
              setLeaveExpenseMode("LEAVE");
              setLeaveExpenseSheet("LEAVE_CREATE");
              setActiveTab("LEAVE_EXPENSE");
            }}
          />
        )}

        {activeTab === "LEAVE_EXPENSE" && (
          <HqMobileLeaveExpenseTab
            key={`le-${navLaunchId}`}
            defaultSubMode={leaveExpenseMode}
            defaultOpenSheet={leaveExpenseSheet}
          />
        )}

        {activeTab === "CALENDAR" && (
          <HqMobileCalendarTab
            key={`cal-${navLaunchId}`}
            defaultSubView={calendarSubView}
            defaultOpenAiRecorder={openAiRecorder}
            onJumpToLeaveRequest={() => {
              setNavLaunchId((n) => n + 1);
              setLeaveExpenseMode("LEAVE");
              setLeaveExpenseSheet("LEAVE_CREATE");
              setActiveTab("LEAVE_EXPENSE");
            }}
          />
        )}

        {activeTab === "MESSENGER" && (
          <HqMobileMessengerTab
            onChatRoomOpenChange={(open) => setIsChatRoomOpen(open)}
          />
        )}
      </div>

      {/* 하단 5탭 고정 내비게이션 바 */}
      {!(activeTab === "MESSENGER" && isChatRoomOpen) && (
        <nav className="bg-white border-t border-slate-200 px-1.5 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] grid grid-cols-5 shrink-0 z-20 select-none">
          {(
            [
              { key: "HOME", icon: "🏠", label: "홈", badge: 0 },
              {
                key: "APPROVALS",
                icon: "✍️",
                label: "결재",
                badge: pendingApprovalCount,
              },
              {
                key: "LEAVE_EXPENSE",
                icon: "🌴",
                label: "휴가·경비",
                badge: 0,
              },
              {
                key: "CALENDAR",
                icon: "📅",
                label: "일정·미팅",
                badge: 0,
              },
              {
                key: "MESSENGER",
                icon: "💬",
                label: "메신저",
                badge: unreadChatCount,
              },
            ] as const
          ).map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key === "APPROVALS") setOpenApprovalCreate(false);
                  if (item.key === "LEAVE_EXPENSE") setLeaveExpenseSheet(null);
                  if (item.key === "CALENDAR") setOpenAiRecorder(false);
                  setActiveTab(item.key);
                }}
                className={`relative py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? "text-brand" : "text-slate-400 active:text-slate-600"
                }`}
              >
                <span className="text-[19px] leading-none relative">
                  {item.icon}
                  {item.badge > 0 && (
                    <span className="absolute -top-1 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center ring-2 ring-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10px] ${
                    active ? "font-extrabold text-slate-900" : "font-semibold"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
