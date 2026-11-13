// src/components/hq/HqSidebar.tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useHqShell } from "./HqShellContext";
import { getRankMeta } from "@/lib/hq/constants";

export default function HqSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    me,
    isHqAdmin,
    canAccessAnalytics,
    contestAccess,
    pendingApprovalCount,
    unsignedContractCount,
    unreadChatCount,
    sessionExpired,
    logout,
  } = useHqShell();

  const rankMeta = getRankMeta(me?.rank_code);

  const isActive = (href: string) => {
    if (href === "/hq") return pathname === "/hq";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const navItemClass = (href: string) =>
    `w-full flex items-center justify-between px-3.5 py-2 rounded-xl font-bold text-[13px] transition-all ${
      isActive(href)
        ? "bg-brand text-white shadow-md"
        : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <aside className="print:hidden w-[244px] bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800 shrink-0 z-20 select-none">
      {/* 상단 브랜드 로고 영역 */}
      <div
        onClick={() => router.push("/hq")}
        className="px-4 py-4 border-b border-slate-800 cursor-pointer hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-sm shadow-md shrink-0">
            HQ
          </div>
          <div className="min-w-0">
            <h1 className="text-[14px] font-bold text-white leading-tight truncate">
              천종현수학연구소
            </h1>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5 truncate">
              출판 · 연구 본부 올인원 HR
            </p>
          </div>
        </div>

        {me && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700/70 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">
                {me.name}{" "}
                <span className="text-slate-400 font-semibold">
                  {me.job_title}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                {me.department} · 잔여연차 {me.annual_leave_remain}일
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-slate-700 text-slate-200 text-[10px] font-bold shrink-0">
              Lv.{rankMeta.level}
            </span>
          </div>
        )}
      </div>

      {/* 네비게이션 메뉴 */}
      <nav className="flex-1 overflow-y-auto p-3.5 space-y-4 custom-scroll">
        {sessionExpired && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-[12px] text-amber-200 leading-relaxed">
            인증 세션이 만료되어 일부 기능을 불러오지 못했습니다.
            <button
              onClick={logout}
              className="block mt-1.5 font-bold text-amber-100 underline"
            >
              다시 로그인하기
            </button>
          </div>
        )}

        {/* 1. 워크스페이스 홈 */}
        <div>
          <div className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            워크스페이스
          </div>
          <div className="space-y-0.5">
            <Link href="/hq" className={navItemClass("/hq")}>
              <span className="flex items-center gap-2.5 truncate">
                <span>🏠</span>
                <span>본부 홈 대시보드</span>
              </span>
            </Link>
          </div>
        </div>

        {/* 2. 인사(Core HR) · 근태 · 전자계약 */}
        <div>
          <div className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            인사(HR) · 근태 · 계약
          </div>
          <div className="space-y-0.5">
            <Link href="/hq/members" className={navItemClass("/hq/members")}>
              <span className="flex items-center gap-2.5 truncate">
                <span>👥</span>
                <span>구성원 · 조직 관리</span>
              </span>
            </Link>

            <Link
              href="/hq/attendance"
              className={navItemClass("/hq/attendance")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>⏱️</span>
                <span>출퇴근 · 유연근무</span>
              </span>
            </Link>

            <Link
              href="/hq/contracts"
              className={navItemClass("/hq/contracts")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>📑</span>
                <span>전자계약 · 저작권</span>
              </span>
              {unsignedContractCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[11px] font-extrabold shrink-0">
                  {unsignedContractCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* 3. 결재 · 비용 · 급여/인세 */}
        <div>
          <div className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            결재 · 경비 · 정산
          </div>
          <div className="space-y-0.5">
            <Link
              href="/hq/approvals"
              className={navItemClass("/hq/approvals")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>✍️</span>
                <span>전자결재 워크플로우</span>
              </span>
              {pendingApprovalCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-extrabold shrink-0">
                  {pendingApprovalCount}
                </span>
              )}
            </Link>

            <Link href="/hq/expenses" className={navItemClass("/hq/expenses")}>
              <span className="flex items-center gap-2.5 truncate">
                <span>💳</span>
                <span>비용 · 경비 정산</span>
              </span>
            </Link>

            <Link href="/hq/payroll" className={navItemClass("/hq/payroll")}>
              <span className="flex items-center gap-2.5 truncate">
                <span>💰</span>
                <span>급여 · 인세 · 원천세</span>
              </span>
            </Link>
          </div>
        </div>

        {/* 4. 출판 제작 · 연구 DB */}
        <div>
          <div className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            출판 제작 · 연구 DB
          </div>
          <div className="space-y-0.5">
            <Link
              href="/hq/publishing"
              className={navItemClass("/hq/publishing")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>📚</span>
                <span>출판 공정 · ISBN 보드</span>
              </span>
            </Link>

            <button
              type="button"
              onClick={() => {
                if (!canAccessAnalytics) {
                  alert(
                    "⛔ 진단평가 분석 권한이 등록된 본부 계정만 열 수 있습니다.\n필요 시 권한 관리자에게 요청하세요."
                  );
                  return;
                }
                router.push("/hq/analytics");
              }}
              className={navItemClass("/hq/analytics")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>📊</span>
                <span className="truncate">진단평가 분석</span>
              </span>
              {!canAccessAnalytics && (
                <span className="text-xs text-slate-500 shrink-0">🔒</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!contestAccess) {
                  alert(
                    "⛔ 문제 DB 열람 권한이 등록된 본부 계정만 열 수 있습니다.\n필요 시 권한 관리자에게 요청하세요."
                  );
                  return;
                }
                router.push("/hq/contest-db");
              }}
              className={navItemClass("/hq/contest-db")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>📐</span>
                <span className="truncate">사고력·문장제 문제 DB</span>
              </span>
              {!contestAccess && (
                <span className="text-xs text-slate-500 shrink-0">🔒</span>
              )}
            </button>
          </div>
        </div>

        {/* 5. 전사 소통 & 시스템 관리 */}
        <div>
          <div className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            소통 · 시스템
          </div>
          <div className="space-y-0.5">
            <Link
              href="/hq/messenger"
              className={navItemClass("/hq/messenger")}
            >
              <span className="flex items-center gap-2.5 truncate">
                <span>💬</span>
                <span>사내 메신저 · 조직도</span>
              </span>
              {unreadChatCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-extrabold shrink-0">
                  {unreadChatCount}
                </span>
              )}
            </Link>

            {isHqAdmin && (
              <Link
                href="/hq/permissions"
                className={navItemClass("/hq/permissions")}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <span>🔐</span>
                  <span>포털 권한 관리</span>
                </span>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* 하단 상태 표시 */}
      <div className="p-3.5 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
        <span>HQ Publishing Suite</span>
        <span className="text-emerald-400 font-bold">● 정상 연결</span>
      </div>
    </aside>
  );
}
