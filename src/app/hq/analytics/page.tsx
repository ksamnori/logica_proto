// src/app/hq/analytics/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import AdmissionAnalyticsPage from "@/app/(dashboard)/admission/analytics/page";
import { useHqShell } from "@/components/hq/HqShellContext";

export default function HqAnalyticsRoutePage() {
  const router = useRouter();
  const { canAccessAnalytics } = useHqShell();

  if (!canAccessAnalytics) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md shadow-xs space-y-3">
          <div className="text-3xl">🔒</div>
          <h3 className="text-base font-extrabold text-slate-900">
            진단평가 분석 열람 권한이 필요합니다
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            전국 가맹점 진단평가 데이터 분석 메뉴는 권한이 부여된 본부 계정만 접근할 수 있습니다.
            포털 권한 관리자에게 권한 등록을 요청해 주세요.
          </p>
          <button
            type="button"
            onClick={() => router.push("/hq")}
            className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold"
          >
            본부 홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full h-full min-h-0 overflow-y-auto custom-scroll">
      <AdmissionAnalyticsPage />
    </div>
  );
}
