"use client";

import React, { useEffect, useState } from "react";

export default function RoleToggleBtn() {
  const [realRole, setRealRole] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // 1. 최초 렌더링 시 브라우저에 저장된 권한들을 확인합니다.
    let original = localStorage.getItem("logica_real_role");
    const active = localStorage.getItem("logica_instructor_role") || "";
    
    // 2. 처음 로그인 시에는 '진짜 권한' 백업본이 없으므로 백업합니다.
    if (!original && active) {
      localStorage.setItem("logica_real_role", active);
      original = active;
    }
    
    setRealRole(original || "");
    setCurrentRole(active);
    setIsMounted(true);
  }, []);

  // 렌더링 전이거나, '진짜 권한'이 원장/최고관리자가 아니면 그리지 않습니다.
  if (!isMounted) return null;
  if (realRole !== "ADMIN" && realRole !== "SUPER_ADMIN") return null;

  const toggleRole = () => {
    if (currentRole === "TEACHER") {
      // 강사 -> 원장 모드 복귀
      localStorage.setItem("logica_instructor_role", realRole);
      alert("👑 관리자(원장) 모드로 복귀합니다.");
    } else {
      // 원장 -> 강사 뷰 전환
      localStorage.setItem("logica_instructor_role", "TEACHER");
      alert("👨‍🏫 전임강사 모드로 전환합니다.");
    }
    
    // 권한 변경 후 즉시 새로고침하여 전체 레이아웃과 플로팅 메뉴 권한 재평가
    window.location.reload(); 
  };

  const isTeacherMode = currentRole === "TEACHER";

  return (
    <button 
      onClick={toggleRole}
      // 🌟 [수정] 플로팅 챗과 겹치지 않도록 bottom-[120px] 위로 올리고 z-index 극대화
      className={`fixed bottom-[120px] right-6 sm:bottom-[150px] sm:right-10 z-[99999] px-5 py-3 rounded-full font-black shadow-2xl transition-all duration-300 flex items-center gap-2 border-2 hover:-translate-y-1 pointer-events-auto ${
        isTeacherMode 
          ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-400 animate-pulse' 
          : 'bg-[#002864] hover:bg-blue-900 text-amber-400 border-blue-800'
      }`}
    >
      {isTeacherMode ? (
        <>
          <span className="text-xl">🔓</span> 
          <span>원장 모드로 복귀</span>
        </>
      ) : (
        <>
          <span className="text-xl">👨‍🏫</span> 
          <span>강사 뷰(View)로 전환</span>
        </>
      )}
    </button>
  );
}