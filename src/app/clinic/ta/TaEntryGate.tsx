// src/app/clinic/ta/TaEntryGate.tsx
//
// 조교 채점 화면이 쓰는 이름·직책 로딩 훅.
// 로그인 시 저장된 실명(logica_instructor_name)과 직책(logica_instructor_position)을 우선 사용하며
// instructor 테이블과 실시간 동기화한다.
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getInstructorName,
  getInstructorPosition,
  seedTaTenantId,
  syncInstructorProfile,
  TA_NAME_STORAGE_KEY,
} from "./taAccess";

export function useTaEntry() {
  const [taName, setTaName] = useState<string | null>(null);
  const [taPosition, setTaPosition] = useState<string>("");

  useEffect(() => {
    const name = getInstructorName();
    const pos = getInstructorPosition();
    if (name) {
      localStorage.setItem(TA_NAME_STORAGE_KEY, name);
      seedTaTenantId();
    }
    setTaName(name);
    setTaPosition(pos);

    syncInstructorProfile(supabase).then((profile) => {
      if (profile.name) setTaName(profile.name);
      if (profile.position) setTaPosition(profile.position);
    });
  }, []);

  return { taName: taName || "", taPosition, ready: taName !== null };
}
