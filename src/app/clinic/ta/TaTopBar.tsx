// src/app/clinic/ta/TaTopBar.tsx
//
// 조교 패드(/clinic/ta/pad) 및 조교 채점(/clinic/ta/grading) 공용 상단바.
// 로그인한 사용자의 실제 이름과 직책(position)을 동적으로 표시하고,
// 허브 화면을 거치지 않고 즉시 로그아웃할 수 있는 원클릭 로그아웃 버튼을 제공한다.
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  getInstructorName,
  getInstructorPosition,
  syncInstructorProfile,
  performTaLogout,
} from "./taAccess";

const TABS = [
  { path: "/clinic/ta/pad", label: "🧑‍🏫 조교 패드" },
  { path: "/clinic/ta/grading", label: "📝 조교 채점" },
];

interface TaTopBarProps {
  taName: string;
  taPosition?: string;
  isConnected?: boolean;
  hasActiveRequest?: boolean;
  onBeforeLogout?: () => Promise<void> | void;
}

export default function TaTopBar({
  taName,
  taPosition,
  isConnected,
  hasActiveRequest,
  onBeforeLogout,
}: TaTopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [resolvedName, setResolvedName] = useState<string>(taName || "");
  const [resolvedPosition, setResolvedPosition] = useState<string>(taPosition || "");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const initialName = taName || getInstructorName();
    const initialPos = taPosition ?? getInstructorPosition();
    setResolvedName(initialName);
    setResolvedPosition(initialPos);

    if (!taPosition) {
      syncInstructorProfile(supabase).then((profile) => {
        if (profile.name) setResolvedName((prev) => prev || profile.name);
        if (profile.position) setResolvedPosition(profile.position);
      });
    }
  }, [taName, taPosition]);

  const guard = (e: React.MouseEvent) => {
    if (hasActiveRequest) {
      e.preventDefault();
      alert("처리 중인 요청이 있습니다. 먼저 완료한 뒤에 이동해주세요.");
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    if (hasActiveRequest) {
      const ok = window.confirm(
        "현재 선택된 학생 요청이 있습니다. 로그아웃하시겠습니까?"
      );
      if (!ok) return;
    }
    setIsLoggingOut(true);
    try {
      if (onBeforeLogout) {
        await onBeforeLogout();
      }
      await performTaLogout(supabase);
      router.replace("/");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const displayName = taName || resolvedName || "접속자";
  const displayPosition = (taPosition !== undefined ? taPosition : resolvedPosition).trim();

  return (
    <header className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3 shrink-0 shadow-sm z-30">
      {/* 로고 클릭 시 /clinic/ta 로 이동 (진행 중인 작업이 있으면 guard 적용) */}
      <Link
        href="/clinic/ta"
        onClick={guard}
        className="shrink-0 mr-1 flex items-center transition-opacity hover:opacity-80"
        title="조교 허브로 이동"
      >
        <img
          src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
          alt="Logica"
          className="h-6 object-contain"
        />
      </Link>

      <nav className="flex items-center gap-4 h-full self-stretch">
        {TABS.map((tab) => {
          const active = pathname === tab.path || pathname.startsWith(tab.path + "/");
          return (
            <Link
              key={tab.path}
              href={tab.path}
              onClick={active ? undefined : guard}
              aria-disabled={!active && hasActiveRequest}
              className={`text-xs font-bold h-full flex items-center border-b-2 transition-colors ${
                active
                  ? "border-brand text-brand"
                  : hasActiveRequest
                  ? "border-transparent text-slate-300 cursor-not-allowed"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {isConnected !== undefined && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1">
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                isConnected
                  ? "bg-green-500 animate-[pulse_1.6s_infinite]"
                  : "bg-rose-500"
              }`}
            ></span>
            <span>{isConnected ? "연결됨" : "연결 중..."}</span>
          </div>
        )}

        {/* 접속자 이름 + 실제 직책 배지 */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
          <span className="text-[12px]">👨‍🏫</span>
          <span className="text-xs font-bold text-brand">{displayName}</span>
          {displayPosition && (
            <span className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
              {displayPosition}
            </span>
          )}
        </div>

        {/* 원클릭 즉시 로그아웃 버튼 */}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 active:bg-rose-100 bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm transition-colors disabled:opacity-50"
        >
          {isLoggingOut ? "로그아웃 중..." : "로그아웃"}
        </button>
      </div>
    </header>
  );
}
