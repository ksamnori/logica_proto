// src/app/hq/settings/page.tsx
"use client";

import React, { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import HqSettingsModal from "@/components/hq/settings/HqSettingsModal";

function HqSettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "company";

  return (
    <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
      <HqSettingsModal
        isOpen={true}
        mode="page"
        initialTab={tab}
        onClose={() => router.push("/hq")}
      />
    </div>
  );
}

export default function HqSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-xs font-bold text-slate-400">
          설정 화면을 불러오는 중...
        </div>
      }
    >
      <HqSettingsPageInner />
    </Suspense>
  );
}
