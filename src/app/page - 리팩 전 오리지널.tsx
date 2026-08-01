// src/app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation"; // 💡 페이지 이동을 위한 useRouter 추가
import { loginUser } from "@/app/actions/auth";
import SuperAdminModal from "@/components/auth/SuperAdminModal";

export default function LoginPage() {
  const router = useRouter(); // 💡 라우터 초기화

  // 일반 로그인 상태 관리
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // 모달 상태 관리
  const [isSaModalOpen, setIsSaModalOpen] = useState(false);

  // 자동 하이픈 포맷팅 함수
  const formatPhone = (val: string) => {
    if (/[a-zA-Z가-힣]/.test(val)) return val; 
    let digits = val.replace(/[^0-9]/g, "");
    if (digits.length < 4) return digits;
    if (digits.length < 8) return digits.substring(0, 3) + "-" + digits.substring(3);
    if (digits.length < 12) return digits.substring(0, 3) + "-" + digits.substring(3, 7) + "-" + digits.substring(7);
    return digits.substring(0, 3) + "-" + digits.substring(3, 7) + "-" + digits.substring(7, 11) + "-" + digits.substring(11);
  };

  // 일반 선생님 로그인
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await loginUser(loginId, loginPw, false) as {
        success: boolean;
        message?: string;
        instructor_id?: string;
        name?: string;
        position?: string;
        role?: string;
        isSuper?: boolean;
      };

      if (result.success) {
        if (result.instructor_id) localStorage.setItem("logica_instructor_id", result.instructor_id);
        if (result.name) localStorage.setItem("logica_instructor_name", result.name);
        
        if (result.role) localStorage.setItem("logica_instructor_role", result.role);
        else localStorage.setItem("logica_instructor_role", "TEACHER");
        
        sessionStorage.setItem("just_logged_in", "true");

        alert(`환영합니다! ${result.name} ${result.position}님.`);

        if (result.isSuper) {
          window.location.href = "/admin-dashboard"; 
        } else {
          window.location.href = "/home"; 
        }
      } else {
        alert(result.message || "로그인에 실패했습니다.");
      }
    } catch (error) {
      console.error("로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // 💡 클리닉 관리 전용 로그인 (캐시 무시 및 강제 돌파 버전)
  const handleSupervisorLogin = async () => {
    if (!loginId || !loginPw) {
      alert("아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }
    
    setIsLoading(true);

    try {
      const result = await loginUser(loginId, loginPw, false) as any;

      if (result.success) {
        // ✅ 1. DB에서 실장/원장으로 제대로 인식했는지 더블 체크 (보험용)
        const isAdmin = result.isSuper || String(result.position).includes('실장') || String(result.position).includes('원장');

        if (isAdmin) {
          // ✅ 2. 권한 정보를 로컬 스토리지에 쐐기 박기
          localStorage.setItem("logica_instructor_id", result.instructor_id || '');
          localStorage.setItem("logica_instructor_name", result.name || '');
          localStorage.setItem("logica_instructor_role", result.role || 'ADMIN');
          localStorage.setItem("logica_instructor_position", result.position || '실장');
          sessionStorage.setItem("just_logged_in", "true");
          
          // ✅ 3. Next.js 캐시를 완전히 무시하고 대시보드로 '강제 이동'
          window.location.replace('/supervisor'); 
        } else {
          // ❌ 만약 여기서 막힌다면 DB 데이터(오타, 공백) 문제임!
          alert(`[접근 불가] 현재 DB에서 가져온 직급: "${result.position}"\n관리자(실장/원장)로 인식되지 않았습니다. Supabase DB에 공백이나 오타가 없는지 확인하세요.`);
        }
      } else {
        alert(result.message || "로그인에 실패했습니다.");
      }
    } catch (error) {
      console.error("로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // 폭죽 효과 및 모달 오픈
  const triggerSuperAdminLogin = async () => {
    try {
      const confettiModule = await import("canvas-confetti");
      const confetti = confettiModule.default || confettiModule;
      
      const duration = 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: any = setInterval(function () {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) {
          return clearInterval(interval);
        }
        const particleCount = 50 * (timeLeft / duration);
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
      }, 250);
    } catch (error) {
      console.warn("폭죽 효과를 불러오지 못했습니다.", error);
    }

    setTimeout(() => {
      setIsSaModalOpen(true);
    }, 400);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50">
      {/* 일반 로그인 박스 */}
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200 z-10">
        <div className="text-center mb-8 flex flex-col items-center">
          <img
            src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
            alt="Logica"
            className="h-14 object-contain mb-3"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const nextEl = e.currentTarget.nextElementSibling as HTMLElement;
              if (nextEl) nextEl.style.display = "block";
            }}
          />
          <h1 className="hidden font-lexend text-4xl font-bold tracking-tighter text-[#002864] mb-2">
            Logica
          </h1>
          <p className="text-slate-500 font-bold text-sm mt-1">관리자 및 교강사 통합 시스템</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">로그인 ID (연락처)</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                </svg>
              </span>
              <input
                type="text"
                maxLength={20}
                required
                value={loginId}
                onChange={(e) => setLoginId(formatPhone(e.target.value))}
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] font-medium"
                placeholder="아이디 또는 연락처 입력"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">비밀번호</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                </svg>
              </span>
              <input
                type="password"
                required
                value={loginPw}
                onChange={(e) => setLoginPw(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] font-medium"
                placeholder="비밀번호를 입력하세요"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#002864] hover:bg-[#001f4d] text-white font-bold py-3.5 px-4 rounded-lg shadow-md transition-colors mt-2 disabled:opacity-70"
          >
            {isLoading ? "인증 확인 중..." : "선생님 로그인"}
          </button>
        </form>

        {/* 바로가기 및 어드민 로그인 통합 영역 */}
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={handleSupervisorLogin} // 💡 수정됨: 단순히 넘어가지 않고 로그인 검증 후 이동
            disabled={isLoading}
            className="w-full text-sm font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
          >
            <span>📊</span> {isLoading ? "인증 중..." : "클리닉 관리 로그인"}
          </button>
          
          <button
            type="button"
            onClick={triggerSuperAdminLogin}
            className="text-xs font-bold text-slate-400 hover:text-rose-500 transition-colors underline underline-offset-2 mt-2"
          >
            수퍼 어드민 (개발자) 로그인
          </button>
        </div>
      </div>

      <SuperAdminModal 
        isOpen={isSaModalOpen} 
        onClose={() => setIsSaModalOpen(false)} 
      />
    </div>
  );
}