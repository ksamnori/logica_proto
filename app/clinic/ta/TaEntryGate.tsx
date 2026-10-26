// src/app/clinic/ta/TaEntryGate.tsx
//
// 조교 채점 화면이 쓰는 이름 로딩 훅. 이름을 따로 물어보지 않고, 강사 로그인 시
// 저장된 실명(logica_instructor_name)을 그대로 가져다 쓴다.
"use client";

import { useEffect, useState } from "react";
import { TA_NAME_STORAGE_KEY, seedTaTenantId, getInstructorName } from "./taAccess";

export function useTaEntry() {
  const [taName, setTaName] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TA_NAME_STORAGE_KEY) || '';
    const name = saved || getInstructorName();
    if (name) {
      localStorage.setItem(TA_NAME_STORAGE_KEY, name);
      seedTaTenantId();
    }
    setTaName(name);
  }, []);

  return { taName: taName || '', ready: taName !== null };
}
