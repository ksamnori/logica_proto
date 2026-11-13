// src/components/hq/HqHeader.tsx
"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHqShell } from "./HqShellContext";
import { ATTENDANCE_MODES, getRankMeta } from "@/lib/hq/constants";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/hq": {
    title: "본부 홈 대시보드",
    subtitle: "오늘의 근무 현황 · 우선 결재/전자계약 · 출판 하판 마감 브리핑",
  },
  "/hq/members": {
    title: "구성원 · 조직 관리 (Core HR)",
    subtitle: "15인 출판 본부 임직원 DB · 시점별 부서 조직도 · 셀프 증명서 발급",
  },
  "/hq/attendance": {
    title: "출퇴근 · 유연근무 근태 관리",
    subtitle: "시차출퇴근 · 재택원고 · 인쇄감리 외근 체크인 및 주 52시간 실시간 관리",
  },
  "/hq/contracts": {
    title: "전자계약 · 저작권/외주 계약 관리",
    subtitle: "근로·연봉·비밀유지(NDA) 및 저자 출판권·외주 용역 전자서명",
  },
  "/hq/approvals": {
    title: "전자결재 워크플로우",
    subtitle: "직급별 3단계 결재선 · 금액/일수별 자동 전결 · 승인/반려 처리",
  },
  "/hq/expenses": {
    title: "비용 · 경비 정산 관리",
    subtitle: "지출결의 자동 연동 · 법인카드/인쇄비/영수증 정산 처리",
  },
  "/hq/payroll": {
    title: "급여 · 외주 원천세(3.3% / 8.8%) · 인세 정산",
    subtitle: "임직원 급여명세서 셀프 열람 · 외주 프리랜서 원천세 및 저자 인세 자동 계산",
  },
  "/hq/publishing": {
    title: "출판 기획 · 편집 마감 & ISBN 공정 보드",
    subtitle: "기획·원고검수·교정(1~3교)·디자인·인쇄하판·출간 파이프라인 관리",
  },
  "/hq/messenger": {
    title: "전사 소통 메신저",
    subtitle: "본부 부서 및 전국 가맹점 실시간 대화 · 조직도 검색",
  },
  "/hq/analytics": {
    title: "진단평가 데이터 분석",
    subtitle: "전국 지점 진단평가 성취도 및 문항 통계",
  },
  "/hq/contest-db": {
    title: "사고력 · 문장제 문제 DB",
    subtitle: "출판 연구소 전용 문항 검색 및 한국어 번역 관리",
  },
  "/hq/permissions": {
    title: "포털 메뉴 권한 관리",
    subtitle: "임직원별 연구 DB · 진단평가 분석 열람 권한 제어",
  },
};

function formatKstTime(iso?: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function HqHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    me,
    pendingApprovalCount,
    myTodayAttendance,
    quickCheckIn,
    quickCheckOut,
    openProfileModal,
    logout,
  } = useHqShell();

  const [clockBusy, setClockBusy] = useState(false);

  const meta = PAGE_TITLES[pathname] || {
    title: "본부 워크스페이스",
    subtitle: "천종현수학연구소 HQ 통합 시스템",
  };

  const rankMeta = getRankMeta(me?.rank_code);
  const avatarUrl = resolveStoragePublicUrl(me?.profile_image_url);

  const handleQuickClockIn = async () => {
    setClockBusy(true);
    try {
      await quickCheckIn("OFFICE");
    } catch (err: any) {
      alert(err?.message || "출근 체크인 중 오류가 발생했습니다.");
    } finally {
      setClockBusy(false);
    }
  };

  const handleQuickClockOut = async () => {
    if (!confirm("오늘 업무를 마무리하고 퇴근 기록하시겠습니까?")) return;
    setClockBusy(true);
    try {
      await quickCheckOut();
    } catch (err: any) {
      alert(err?.message || "퇴근 처리 중 오류가 발생했습니다.");
    } finally {
      setClockBusy(false);
    }
  };

  const handleLogoutClick = () => {
    if (confirm("본부 워크스페이스에서 로그아웃 하시겠습니까?")) {
      logout();
    }
  };

  const modeMeta = myTodayAttendance
    ? ATTENDANCE_MODES[myTodayAttendance.work_mode] || ATTENDANCE_MODES.OFFICE
    : null;

  return (
    <header className="print:hidden h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 z-10">
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold text-slate-800 leading-tight truncate">
          {meta.title}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{meta.subtitle}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* 실시간 출퇴근 미니 위젯 */}
        {!myTodayAttendance ? (
          <div className="hidden lg:flex items-center rounded-xl border border-emerald-200 bg-emerald-50/70 p-0.5">
            <button
              type="button"
              disabled={clockBusy}
              onClick={handleQuickClockIn}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              {clockBusy ? "처리중..." : "🟢 출근하기"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/hq/attendance")}
              className="px-2 py-1.5 text-[11px] font-bold text-emerald-800 hover:underline"
              title="시차출퇴근 · 재택 · 외근 선택"
            >
              유연근무▾
            </button>
          </div>
        ) : myTodayAttendance.status === "WORKING" ? (
          <div className="hidden lg:flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1">
            <button
              type="button"
              onClick={() => router.push("/hq/attendance")}
              className="text-xs font-bold text-blue-800 hover:underline flex items-center gap-1"
            >
              <span>{modeMeta?.icon || "🏢"}</span>
              <span>
                {modeMeta?.shortLabel || "근무중"}{" "}
                {formatKstTime(myTodayAttendance.check_in_at)}~
              </span>
            </button>
            <button
              type="button"
              disabled={clockBusy}
              onClick={handleQuickClockOut}
              className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold transition-colors disabled:opacity-50"
            >
              퇴근
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/hq/attendance")}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors"
          >
            <span>
              {myTodayAttendance.status === "DONE" ? "✅ 퇴근완료" : "🌴 휴가·반차"}
            </span>
            {myTodayAttendance.check_out_at && (
              <span className="text-[11px] text-slate-500">
                {formatKstTime(myTodayAttendance.check_out_at)}
              </span>
            )}
          </button>
        )}

        {pendingApprovalCount > 0 && pathname !== "/hq/approvals" && (
          <button
            type="button"
            onClick={() => router.push("/hq/approvals")}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold transition-colors"
          >
            <span>🔔 결재 대기</span>
            <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[11px] leading-none">
              {pendingApprovalCount}건
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => router.push("/hq/approvals?new=1")}
          className="px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
        >
          <span>✍️</span>
          <span>새 결재 기안</span>
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={openProfileModal}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 transition-colors text-left"
          title="내 프로필 및 부재중 자동응답 설정"
        >
          <div className="relative w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-600 font-bold text-xs overflow-hidden shrink-0">
            <span>{me?.name?.slice(0, 1) || "H"}</span>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt={me?.name || "profile"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
          <div className="hidden md:block">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>{me?.name || "로딩중"}</span>
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${rankMeta.badgeClass}`}
              >
                {me?.job_title || rankMeta.defaultTitle}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {me?.department || "본부"}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={handleLogoutClick}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold transition-colors"
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}
