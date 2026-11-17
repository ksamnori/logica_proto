// src/app/hq/contest-db/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import ContestDbPage from "@/app/(dashboard)/contest-db/page";
import { useHqShell } from "@/components/hq/HqShellContext";

export default function HqContestDbRoutePage() {
  const router = useRouter();
  const { contestAccess } = useHqShell();

  if (!contestAccess) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md shadow-xs space-y-3">
          <div className="text-3xl">🔒</div>
          <h3 className="text-base font-extrabold text-slate-900">
            문제 DB 열람 권한이 필요합니다
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            사고력·문장제 연구 문제 DB는 열람 명단(contest_db_access)에 등록된 본부 계정만 접근할 수 있습니다.
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
    <div className="flex-1 w-full h-full min-h-0 flex flex-col pt-3 overflow-hidden">
      <ContestDbPage />
    </div>
  );
}
