// src/app/page.tsx
"use client";

import { useState, useEffect } from "react"; 
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SuperAdminModal from "@/components/auth/SuperAdminModal";

export default function LoginPage() {
  const router = useRouter(); 

  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaModalOpen, setIsSaModalOpen] = useState(false);

  useEffect(() => {
    const clearSession = async () => {
      localStorage.clear(); 
      sessionStorage.clear(); 
      document.cookie = "sb-access-token=; path=/; max-age=0;"; 
      document.cookie = "logica_tenant_id=; path=/; max-age=0;"; 
      await supabase.auth.signOut(); 
    };
    clearSession();
  }, []);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      document.cookie = "sb-access-token=; path=/; max-age=0;"; 
      document.cookie = "logica_tenant_id=; path=/; max-age=0;"; 

      const fakeEmail = `${loginId}@logica.com`;

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: loginPw,
      });

      if (authError) {
        alert("아이디 또는 비밀번호가 틀렸습니다.");
        setIsLoading(false);
        return;
      }

      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

      const { data: instructorData, error: dbError } = await supabase
        .from('instructor')
        .select('*')
        .eq('login_id', loginId)
        .single();

      if (dbError || !instructorData) {
        alert("강사 정보를 불러오는데 실패했습니다.");
        setIsLoading(false);
        return;
      }

      let isHQ = false;
      const HQ_TENANT_ID = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc';

      if (instructorData.tenant_id === HQ_TENANT_ID) {
        isHQ = true;
      } else if (instructorData.tenant_id) {
        const { data: tenantData } = await supabase
          .from('academy_tenant')
          .select('tenant_type, name')
          .eq('tenant_id', instructorData.tenant_id)
          .maybeSingle();

        if (tenantData?.tenant_type?.toUpperCase() === 'HQ' || tenantData?.name?.includes('본사')) {
          isHQ = true;
        }
      }

      if (isHQ) {
        alert("🏢 본사 임직원 계정은 학원(가맹점) 시스템에 접근할 수 없습니다.\n본사 전용 워크스페이스로 이동합니다.");
        await supabase.auth.signOut();
        router.replace('/hq-login');
        return;
      }
      if (!instructorData.tenant_id) {
        alert("🚫 소속 학원(테넌트)이 배정되지 않은 계정입니다. 본사 또는 원장님께 문의하세요.");
        await supabase.auth.signOut();
        return;
      }

      alert(`로그인 성공! ${instructorData.name}님 환영합니다.`);

      localStorage.setItem("logica_instructor_id", instructorData.instructor_id);
      localStorage.setItem("logica_instructor_name", instructorData.name);
      localStorage.setItem("logica_instructor_role", instructorData.role || "TEACHER");
      localStorage.setItem("logica_instructor_position", instructorData.position || "");
      
      if (instructorData.tenant_id) {
        localStorage.setItem("logica_tenant_id", instructorData.tenant_id);
        document.cookie = `logica_tenant_id=${instructorData.tenant_id}; path=/; max-age=86400;`;
      }
      sessionStorage.setItem("just_logged_in", "true");

      const role = instructorData.role;
      const position = String(instructorData.position);
      
      const isSuperAdmin = role === 'SUPER_ADMIN' || position.includes('최고관리자') || position.includes('대장');

      // 🌟 [핵심 변경] 로그인 성공 후 모두 정상적으로 /home 으로 보냅니다!
      // 권한 검사 및 타 페이지로의 튕겨내기는 /home 페이지 내부의 로직이 담당합니다.
      if (isSuperAdmin) {
        router.replace("/admin-dashboard"); 
      } else {
        router.replace("/home"); 
      }

    } catch (error) {
      console.error("로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSupervisorLogin = async () => {
    if (!loginId || !loginPw) {
      alert("아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }
    
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear(); 
      document.cookie = "sb-access-token=; path=/; max-age=0;"; 
      document.cookie = "logica_tenant_id=; path=/; max-age=0;"; 

      const fakeEmail = `${loginId}@logica.com`;

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: loginPw,
      });

      if (authError) {
        alert("아이디 또는 비밀번호가 틀렸습니다.");
        setIsLoading(false);
        return;
      }

      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

      const { data: instructorData, error: dbError } = await supabase
        .from('instructor')
        .select('*')
        .eq('login_id', loginId)
        .single();

      if (dbError || !instructorData) {
        alert("강사 정보를 불러오는데 실패했습니다.");
        setIsLoading(false);
        return;
      }

      let isHQ = false;
      const HQ_TENANT_ID = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc';

      if (instructorData.tenant_id === HQ_TENANT_ID) {
        isHQ = true;
      } else if (instructorData.tenant_id) {
        const { data: tenantData } = await supabase
          .from('academy_tenant')
          .select('tenant_type, name')
          .eq('tenant_id', instructorData.tenant_id)
          .maybeSingle();

        if (tenantData?.tenant_type?.toUpperCase() === 'HQ' || tenantData?.name?.includes('본사')) {
          isHQ = true;
        }
      }

      if (isHQ) {
        alert("🏢 본사 임직원 계정은 학원(가맹점) 시스템에 접근할 수 없습니다.\n본사 전용 워크스페이스로 이동합니다.");
        await supabase.auth.signOut();
        router.replace('/hq-login');
        return;
      }
      if (!instructorData.tenant_id) {
        alert("🚫 소속 학원(테넌트)이 배정되지 않은 계정입니다. 본사 또는 원장님께 문의하세요.");
        await supabase.auth.signOut();
        return;
      }

      const isAdmin = instructorData.role === 'SUPER_ADMIN' ||
                instructorData.role === 'ADMIN' ||
                instructorData.role === 'VICE_ADMIN' ||
                instructorData.role === 'MANAGER' ||
                instructorData.role === 'PRINCIPAL' ||
                String(instructorData.position).includes('최고관리자') ||
                String(instructorData.position).includes('원장') ||
                String(instructorData.position).includes('부원장') ||
                String(instructorData.position).includes('실장');

      if (isAdmin) {
        localStorage.setItem("logica_instructor_id", instructorData.instructor_id);
        localStorage.setItem("logica_instructor_name", instructorData.name);
        localStorage.setItem("logica_instructor_role", instructorData.role || 'ADMIN');
        localStorage.setItem("logica_instructor_position", instructorData.position || '실장');
        
        if (instructorData.tenant_id) {
          localStorage.setItem("logica_tenant_id", instructorData.tenant_id);
          document.cookie = `logica_tenant_id=${instructorData.tenant_id}; path=/; max-age=86400;`;
        }

        sessionStorage.setItem("just_logged_in", "true");

        router.replace('/supervisor');
      } else {
        alert(`[접근 불가] 현재 DB에서 가져온 직급: "${instructorData.position}"\n클리닉 관리자(실장/부원장/원장)로 인식되지 않았습니다.`);
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

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
                onChange={(e) => setLoginId(e.target.value)}
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

        <div className="mt-6 flex flex-col items-center gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={handleSupervisorLogin}
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