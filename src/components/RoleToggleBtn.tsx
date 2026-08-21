// src/components/RoleToggleBtn.tsx
"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function RoleToggleBtn() {
  const pathname = usePathname(); // 🌟 페이지 이동을 실시간으로 감지합니다.
  
  const [realRole, setRealRole] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [isGodMode, setIsGodMode] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id");

    // 🌟 [핵심 버그 수정] 아이디가 없으면(로그아웃 상태) 즉시 버튼을 숨기고 백업 찌꺼기를 날립니다.
    if (!instId) {
      setIsGodMode(false);
      localStorage.removeItem("logica_real_role");
      localStorage.removeItem("logica_real_role_owner");
      return;
    }

    const activeRole = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    
    let originalRole = localStorage.getItem("logica_real_role");
    let originalOwner = localStorage.getItem("logica_real_role_owner");

    // 다른 아이디로 재로그인 했다면 이전 백업 찌꺼기 초기화
    if (originalOwner && originalOwner !== instId) {
      originalRole = null; 
    }

    // 진짜 권한 백업본이 없으면 현재 상태를 백업하면서 소유자 ID도 같이 묶어둡니다.
    if (!originalRole) {
      localStorage.setItem("logica_real_role", activeRole);
      localStorage.setItem("logica_real_role_owner", instId);
      originalRole = activeRole;
    }

    // 대소문자 무시 및 직급(Position) 한글 텍스트 동시 검사
    const isSA = ["SUPER_ADMIN", "ADMIN"].includes((originalRole || "").toUpperCase());
    const hasAdminPos = pos.includes("최고관리자") || pos.includes("원장") || pos.includes("대장");
    
    setIsGodMode(isSA || hasAdminPos);
    setRealRole(originalRole || "");
    setCurrentRole(activeRole);
    setIsMounted(true);
    
  // 🌟 핵심: 빈 배열이 아니라 pathname을 넣어, 페이지를 이동(로그인/아웃)할 때마다 재검사하도록 강제합니다.
  }, [pathname]); 

  // 렌더링 전이거나, 원장/최고관리자가 아니면 아예 그리지 않습니다.
  if (!isMounted || !isGodMode) return null;

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
    
    // 권한 변경 후 즉시 새로고침하여 전체 레이아웃과 메뉴 권한을 재평가합니다.
    window.location.reload(); 
  };

  const isTeacherMode = currentRole === "TEACHER";

  return (
    <button 
      onClick={toggleRole}
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