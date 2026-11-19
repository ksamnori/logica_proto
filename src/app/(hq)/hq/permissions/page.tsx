// src/app/hq/permissions/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import HqPermissionPanel from "@/components/hq/permissions/HqPermissionPanel";
import { useHqShell } from "@/components/hq/HqShellContext";

export default function HqPermissionsRoutePage() {
  const router = useRouter();
  const { isDevSuperAdmin, refreshPermissions } = useHqShell();

  if (!isDevSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-white rounded-2xl border border-rose-200 p-8 max-w-md shadow-xs space-y-3">
          <div className="text-3xl">🔐</div>
          <h3 className="text-base font-extrabold text-slate-900">
            개발자 수퍼어드민(Lv.6) 전용 메뉴입니다
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            포털 권한 관리 및 Lv.6 권한 지정은 현재 레벨 6(SUPER_ADMIN) 구성원만 접근할 수 있습니다.
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
      <HqPermissionPanel onChanged={refreshPermissions} />
    </div>
  );
}
