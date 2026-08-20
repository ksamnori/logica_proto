// src/app/page.tsx
"use client";

import { useState, useEffect } from "react"; 
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter(); 

  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [isPwModalOpen, setIsPwModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  
  const [showAdminChoice, setShowAdminChoice] = useState(false);
  const [adminProfileName, setAdminProfileName] = useState("");

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
    if (!loginId) {
      alert("아이디 또는 이메일을 입력해주세요.");
      return;
    }
    
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      document.cookie = "sb-access-token=; path=/; max-age=0;"; 
      document.cookie = "logica_tenant_id=; path=/; max-age=0;"; 

      // 🌟 [하이브리드 로직] @가 없으면 예전처럼 @logica.com을 붙이고, 있으면 진짜 이메일로 씁니다!
      const targetEmail = loginId.includes('@') ? loginId : `${loginId}@logica.com`;

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: loginPw,
      });

      if (authError) {
        alert("계정 정보 또는 비밀번호가 틀렸습니다.");
        setIsLoading(false);
        return;
      }

      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

      const userId = authData.user?.id;
      if (!userId) {
        alert("유저 인증 정보를 확인할 수 없습니다.");
        setIsLoading(false);
        return;
      }

      const { data: instructorData, error: dbError } = await supabase
        .from('instructor')
        .select('*')
        .eq('instructor_id', userId)
        .single();

      if (dbError || !instructorData) {
        alert("강사 정보를 불러오는데 실패했습니다.");
        setIsLoading(false);
        return;
      }

      const role = instructorData.role;
      const position = String(instructorData.position);
      
      const isSuperAdmin = role === 'SUPER_ADMIN' || position.includes('최고관리자') || position.includes('대장');
      const isPrincipal = ['ADMIN', 'VICE_ADMIN', 'MANAGER'].includes(role) || 
                          ['원장', '부원장', '실장'].some((p: string) => position.includes(p));

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

      if (!isSuperAdmin) {
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
      }

      localStorage.setItem("logica_instructor_id", instructorData.instructor_id);
      localStorage.setItem("logica_instructor_name", instructorData.name);
      localStorage.setItem("logica_instructor_role", instructorData.role || "TEACHER");
      localStorage.setItem("logica_instructor_position", instructorData.position || "");
      
      if (instructorData.tenant_id) {
        localStorage.setItem("logica_tenant_id", instructorData.tenant_id);
        document.cookie = `logica_tenant_id=${instructorData.tenant_id}; path=/; max-age=86400;`;
      }
      sessionStorage.setItem("just_logged_in", "true");

      if (isSuperAdmin) {
        setAdminProfileName(instructorData.name);
        setShowAdminChoice(true);
        setIsLoading(false); 
      } else if (isPrincipal) {
        alert(`로그인 성공! ${instructorData.name}님 환영합니다.`);
        router.replace("/admin-dashboard"); 
      } else {
        alert(`로그인 성공! ${instructorData.name}님 환영합니다.`);
        router.replace("/home"); 
      }

    } catch (error) {
      console.error("로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
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

      // 🌟 [하이브리드 로직] 클리닉 관리 로그인에도 똑같이 적용!
      const targetEmail = loginId.includes('@') ? loginId : `${loginId}@logica.com`;

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: loginPw,
      });

      if (authError) {
        alert("계정 정보 또는 비밀번호가 틀렸습니다.");
        setIsLoading(false);
        return;
      }

      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

      const userId = authData.user?.id;
      if (!userId) {
        alert("유저 인증 정보를 확인할 수 없습니다.");
        setIsLoading(false);
        return;
      }

      const { data: instructorData, error: dbError } = await supabase
        .from('instructor')
        .select('*')
        .eq('instructor_id', userId)
        .single();

      if (dbError || !instructorData) {
        alert("강사 정보를 불러오는데 실패했습니다.");
        setIsLoading(false);
        return;
      }

      const role = instructorData.role;
      const position = String(instructorData.position);
      const isSuperAdmin = role === 'SUPER_ADMIN' || position.includes('최고관리자') || position.includes('대장');

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

      if (!isSuperAdmin) {
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
      }

      const isAdmin = instructorData.role === 'SUPER_ADMIN' ||
                instructorData.role === 'ADMIN' ||
                instructorData.role === 'VICE_ADMIN' ||
                instructorData.role === 'MANAGER' ||
                instructorData.role === 'PRINCIPAL' ||
                String(instructorData.position).includes('최고관리자') ||
                String(instructorData.position).includes('원장') ||
                String(instructorData.position).includes('부원장') ||
                String(instructorData.position).includes('실장') ||
                String(instructorData.position).includes('대장'); 

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

        if (isSuperAdmin) {
          setAdminProfileName(instructorData.name);
          setShowAdminChoice(true);
          setIsLoading(false);
        } else {
          router.replace('/supervisor');
        }
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

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail || !resetEmail.includes('@')) {
      alert("정확한 이메일 주소를 입력해주세요.");
      return;
    }
    
    setIsResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/update-password`, 
      });

      if (error) throw error;
      
      alert(`✉️ [${resetEmail}]로 비밀번호 재설정 링크가 발송되었습니다.\n이메일함을 확인해주세요!`);
      setIsPwModalOpen(false);
      setResetEmail("");
    } catch (error: any) {
      alert("이메일 발송에 실패했습니다. 가입된 이메일이 맞는지 확인해주세요.\n(에러: " + error.message + ")");
    } finally {
      setIsResetting(false);
    }
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
            <label className="block text-sm font-bold text-slate-700 mb-1">로그인 ID 또는 이메일</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                </svg>
              </span>
              <input
                type="text"
                maxLength={60}
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] font-medium"
                placeholder="전화번호, ID, 이메일"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-bold text-slate-700">비밀번호</label>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setIsPwModalOpen(true)}
                className="text-[11px] font-bold text-blue-500 hover:text-blue-700 hover:underline transition-colors focus:outline-none"
              >
                비밀번호를 잊으셨나요?
              </button>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                </svg>
              </span>
              <input
                type={showLoginPw ? "text" : "password"}
                required
                value={loginPw}
                onChange={(e) => setLoginPw(e.target.value)}
                className="w-full pl-10 pr-10 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] font-medium"
                placeholder="비밀번호를 입력하세요"
              />
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); setShowLoginPw(true); }}
                onMouseUp={() => setShowLoginPw(false)}
                onMouseLeave={() => setShowLoginPw(false)}
                onTouchStart={(e) => { e.preventDefault(); setShowLoginPw(true); }}
                onTouchEnd={() => setShowLoginPw(false)}
                onTouchCancel={() => setShowLoginPw(false)}
                className={`absolute inset-y-0 right-0 flex items-center pr-3 transition-colors ${showLoginPw ? "text-[#002864]" : "text-slate-400 hover:text-slate-600"}`}
                aria-label="누르고 있으면 비밀번호 표시"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  {showLoginPw && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18"></path>}
                </svg>
              </button>
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
        </div>
      </div>

      {showAdminChoice && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white w-full max-w-[500px] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-[#002864] p-5 text-center relative shrink-0">
              <h2 className="text-xl font-black text-white">👑 최고 관리자 로그인</h2>
              <p className="text-blue-200 text-sm mt-1">{adminProfileName}님, 접속할 시스템을 선택해주세요.</p>
            </div>
            
            <div className="p-5 space-y-2.5 bg-slate-50">
              <button 
                onClick={() => router.replace("/hq-login")}
                className="w-full flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-purple-600 hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 bg-purple-50 rounded-full flex items-center justify-center text-xl group-hover:bg-purple-600 transition-colors shrink-0">
                  <span className="group-hover:text-white transition-colors">🏢</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 text-[14px] group-hover:text-purple-700 transition-colors truncate">본사 워크스페이스 (HQ)</h3>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">본사 전용 시스템 및 가맹점 통합 관리</p>
                </div>
              </button>

              <button 
                onClick={() => router.replace("/admin-dashboard")}
                className="w-full flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-blue-600 hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-xl group-hover:bg-blue-600 transition-colors shrink-0">
                  <span className="group-hover:text-white transition-colors">📈</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 text-[14px] group-hover:text-blue-600 transition-colors truncate">학원 운영 대시보드 (Admin)</h3>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">매출, 원생 통계 등 학원 전반 업무 관리</p>
                </div>
              </button>

              <button 
                onClick={() => router.replace("/home")}
                className="w-full flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-[#002864] hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-xl group-hover:bg-[#002864] transition-colors shrink-0">
                  <span className="group-hover:text-white transition-colors">👨‍🏫</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 text-[14px] group-hover:text-[#002864] transition-colors truncate">강사/데스크 홈 (Home)</h3>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">수업 일정, 출결, 학생 개별 관리</p>
                </div>
              </button>

              <button 
                onClick={() => router.replace("/supervisor")}
                className="w-full flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-amber-500 hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-xl group-hover:bg-amber-500 transition-colors shrink-0">
                  <span className="group-hover:text-white transition-colors">📡</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 text-[14px] group-hover:text-amber-600 transition-colors truncate">클리닉 관제탑 (Supervisor)</h3>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">클리닉 좌석 배치 및 학생 실시간 출결 관리</p>
                </div>
              </button>

              <button 
                onClick={() => router.replace("/super-admin")}
                className="w-full flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-600 hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center text-xl group-hover:bg-emerald-600 transition-colors shrink-0">
                  <span className="group-hover:text-white transition-colors">⚙️</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 text-[14px] group-hover:text-emerald-700 transition-colors truncate">최고 관리자 통제실</h3>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">시스템 설정 및 계정 권한 마스터 관리</p>
                </div>
              </button>
            </div>

            <div className="p-4 bg-white border-t border-slate-100 flex justify-center">
              <button 
                onClick={() => { setShowAdminChoice(false); supabase.auth.signOut(); }}
                className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors underline"
              >
                로그인 취소
              </button>
            </div>
          </div>
        </div>
      )}

      {isPwModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h2 className="text-lg font-black text-slate-800 flex items-center gap-2"><span>🔑</span> 비밀번호 초기화</h2>
              <button onClick={() => setIsPwModalOpen(false)} className="text-slate-400 hover:text-rose-400 text-2xl font-bold leading-none transition-colors">&times;</button>
            </div>
            
            <form onSubmit={handlePasswordResetRequest} className="p-6 bg-white flex flex-col space-y-4">
              <div className="text-center mb-2">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-3 mx-auto text-2xl">
                  ✉️
                </div>
                <h3 className="font-bold text-slate-700 text-[14px] leading-relaxed">
                  가입하신 이메일 계정을 입력하시면<br/>비밀번호 재설정 링크를 보내드립니다.
                </h3>
              </div>
              
              <div>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium text-sm"
                  placeholder="가입된 이메일 계정 입력"
                />
              </div>

              <button 
                type="submit"
                disabled={isResetting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl shadow-sm transition-colors text-sm mt-2"
              >
                {isResetting ? "메일 발송 중... ⏳" : "재설정 링크 받기"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}