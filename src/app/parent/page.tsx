// src/app/parent/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import ChatWidget from "@/components/parent/ChatWidget";
import StudentCard from "@/components/parent/StudentCard";
import { verifyParentPhone, loginParentAction, setupParentAction } from "@/app/actions/parentAuth";

export default function ParentPortalPage() {
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [authState, setAuthState] = useState<"check_phone" | "login" | "setup" | "dashboard">("check_phone");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false);
  
  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupPw, setSetupPw] = useState("");
  
  const [parentId, setParentId] = useState<string | null>(null);
  const [infoName, setInfoName] = useState("");
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [studentsData, setStudentsData] = useState<any[]>([]);

  // 히스토리 라우팅 (뒤로가기 방어)
  const isExitModalOpenRef = useRef(isExitModalOpen);
  isExitModalOpenRef.current = isExitModalOpen;
  const isInfoModalOpenRef = useRef(isInfoModalOpen);
  isInfoModalOpenRef.current = isInfoModalOpen;
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isExitModalOpenRef.current || isInfoModalOpenRef.current) {
        setIsExitModalOpen(false); setIsInfoModalOpen(false);
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      } else if (authStateRef.current === "dashboard") {
        setIsExitModalOpen(true);
        window.history.pushState({ app_state: "modal" }, "", window.location.href);
      } else {
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      }
    };
    window.history.replaceState({ app_state: "main" }, "", window.location.href);
    window.history.pushState({ app_state: "trap" }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => { window.removeEventListener("popstate", handlePopState); };
  }, []);

  // 초기 인증 확인 및 카카오 세션 처리
  useEffect(() => {
    const hash = window.location.hash;
    
    if (localStorage.getItem("logica_parent_id")) {
      localStorage.removeItem("logica_parent_id");
    }

    const savedParentId = sessionStorage.getItem("logica_parent_id");
    
    if (hash.includes("access_token")) setIsKakaoLoading(true); 

    const handleKakaoSession = async (session: any) => {
      let kakaoPhone = session.user?.user_metadata?.phone_number || session.user?.phone || "";

      if (!kakaoPhone) {
        alert("카카오 계정에 연동된 전화번호 정보가 없습니다.\n카카오톡 설정에서 '전화번호 제공'에 동의하시거나, 일반 로그인을 이용해주세요.");
        await supabase.auth.signOut();
        setIsKakaoLoading(false);
        return;
      }

      if (kakaoPhone.startsWith("+82")) {
        kakaoPhone = "0" + kakaoPhone.slice(3).trim(); 
      }
      
      // 💡 [TS 에러 수정] m, p1, p2, p3 매개변수에 명시적으로 string 타입을 지정
      const formattedPhone = kakaoPhone
        .replace(/[^0-9]/g, "")
        .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      try {
        const { data } = await supabase.from("parent").select("parent_id").eq("phone", formattedPhone).limit(1).maybeSingle();
        
        if (data) {
          sessionStorage.setItem("logica_parent_id", data.parent_id);
          window.history.replaceState({ app_state: "trap" }, "", window.location.pathname);
          setIsKakaoLoading(false);
          loadDashboard(data.parent_id);
        } else {
          alert(`등록된 학원 연락처(${formattedPhone})와 일치하는 학부모 정보가 없습니다.\n학원에 등록된 번호와 카카오톡 번호가 같은지 확인해주세요.`);
          await supabase.auth.signOut();
          setIsKakaoLoading(false); 
        }
      } catch (err) { 
        console.error(err);
        setIsKakaoLoading(false); 
      }
    };

    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await handleKakaoSession(session);
      else if (savedParentId && !hash.includes("access_token")) loadDashboard(savedParentId);
    };
    initAuth();
  }, []);

  // 💡 [TS 에러 수정] 여기에도 m, p1, p2, p3 에 string 타입을 명시
  const handlePhoneInput = (val: string) => {
    const formatted = val
      .replace(/[^0-9]/g, "")
      .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));
    setPhoneInput(formatted);
  };

  const checkPhone = async () => {
    if (phoneInput.length < 12) return alert("연락처를 정확히 입력해주세요.");
    const result = await verifyParentPhone(phoneInput);
    if (!result.success) return alert(result.message);
    setParentId(result.parentId || null);
    setAuthState(result.needsSetup ? "setup" : "login");
  };

  const loginParent = async () => {
    const result = await loginParentAction(phoneInput, pwInput);
    if (result.success && result.parentId) {
      sessionStorage.setItem("logica_parent_id", result.parentId);
      loadDashboard(result.parentId);
    } else {
      alert(result.message);
    }
  };

  const setupParent = async () => {
    if (!setupName.trim() || !setupPw.trim() || !parentId) return alert("모두 입력해주세요.");
    const result = await setupParentAction(parentId, setupName, setupPw);
    if (result.success) {
      sessionStorage.setItem("logica_parent_id", parentId);
      loadDashboard(parentId);
    } else {
      alert(result.message);
    }
  };

  const loginWithKakao = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ 
      provider: "kakao", 
      options: { 
        redirectTo: `${window.location.origin}/parent`,
      }
    });
    if (error) alert("카카오 로그인 중 오류가 발생했습니다.");
  };

  const logout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    }
  };

  const loadDashboard = async (pid: string) => {
    setParentId(pid);
    setAuthState("dashboard");
    try {
      const { data: pData } = await supabase.from("parent").select("name").eq("parent_id", pid).single();
      setInfoName(pData?.name || "");

      const { data: sData, error } = await supabase
        .from("student")
        .select("*, enrollment(class(name, class_schedule(day_of_week, start_time))), exam_assignment(total_score, status, created_at), attendance(attendance_date, status)")
        .eq("parent_id", pid);

      if (!error && sData) {
        const sorted = sData.sort((a, b) => (parseInt(b.grade) || 0) - (parseInt(a.grade) || 0));
        setStudentsData(sorted.map(s => ({ ...s, mockHwRate: Math.floor(Math.random() * 30) + 70 })));
      }
    } catch (err) { console.error("대시보드 로드 에러", err); }
  };

  const renderAuthSection = () => {
    if (authState === "dashboard") return null;
    if (isKakaoLoading) return <div className="flex-1 flex items-center justify-center p-4 bg-slate-50"><div className="text-lg font-bold text-[#FEE500] bg-slate-800 px-6 py-3 rounded-full animate-pulse shadow-lg">카카오 계정 연동 중...</div></div>;
    
    return (
      <div className="flex-1 flex items-center justify-center p-4 h-full bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
          <div className="text-center mb-6 flex justify-center"><img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-10 object-contain" alt="Logica" /></div>
          {authState === "check_phone" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <button onClick={loginWithKakao} className="w-full flex items-center justify-center gap-2 bg-[#FEE500] text-[#000000] font-black py-4 px-4 rounded-xl hover:bg-[#e6cf00] transition-colors shadow-md mb-6">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-5.523 0-10 3.51-10 7.839 0 2.825 1.83 5.305 4.606 6.643l-1.18 4.316c-.086.315.267.559.53.376l5.06-3.348c.323.033.655.051.984.051 5.523 0 10-3.51 10-7.839C22 6.51 17.523 3 12 3z"/></svg>
                카카오톡으로 1초만에 시작하기
              </button>
              
              <div className="flex items-center my-6"><div className="flex-1 border-t border-slate-200"></div><span className="px-4 text-xs font-bold text-slate-400">또는 다른 방법으로 로그인</span><div className="flex-1 border-t border-slate-200"></div></div>
              
              <input type="text" maxLength={13} value={phoneInput} onChange={e => handlePhoneInput(e.target.value)} className="w-full px-4 py-3 mb-4 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" placeholder="등록된 학부모 휴대전화번호" />
              <button onClick={checkPhone} className="w-full bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200 transition-colors">전화번호로 로그인</button>
            </div>
          )}
          {authState === "login" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} className="w-full px-4 py-3 mb-4 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" placeholder="비밀번호 입력" />
              <div className="flex gap-2">
                <button onClick={() => setAuthState("check_phone")} className="w-1/3 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl">뒤로</button>
                <button onClick={loginParent} className="w-2/3 bg-[#002864] text-white font-bold py-3.5 rounded-xl">로그인</button>
              </div>
            </div>
          )}
          {authState === "setup" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <div className="bg-blue-50 text-blue-600 font-bold text-xs p-3 rounded-lg mb-4 text-center">처음 오셨군요! 사용할 비밀번호를 설정해주세요.</div>
              <input type="text" value={setupName} onChange={e => setSetupName(e.target.value)} className="w-full px-4 py-2.5 mb-3 rounded-lg border border-slate-300 font-bold text-center" placeholder="학부모님 성함 (예: 홍길동)" />
              <input type="password" value={setupPw} onChange={e => setSetupPw(e.target.value)} className="w-full px-4 py-2.5 mb-5 rounded-lg border border-slate-300 font-bold text-center" placeholder="사용할 비밀번호 설정" />
              <button onClick={setupParent} className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl">비밀번호 설정 완료</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="text-slate-800 relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-slate-50 overscroll-none">
      
      {/* 종료 확인 모달 */}
      {isExitModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[280px] rounded-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="p-6 text-center space-y-2"><div className="text-4xl mb-3">👋</div><h2 className="font-bold text-lg text-slate-800">앱을 종료하시겠습니까?</h2></div>
            <div className="flex border-t border-slate-200">
              <button onClick={() => { setIsExitModalOpen(false); window.history.replaceState({ app_state: "trap" }, "", window.location.href); }} className="flex-1 py-3.5 text-slate-500 font-bold border-r border-slate-200">취소</button>
              <button onClick={() => window.history.go(-2)} className="flex-1 py-3.5 text-rose-500 font-bold">종료하기</button>
            </div>
          </div>
        </div>
      )}

      {renderAuthSection()}

      {authState === "dashboard" && (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm border-b border-slate-200 shrink-0 z-10">
            <div className="flex items-center gap-2"><img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-6 object-contain" alt="Logica" /></div>
            <div className="flex gap-2">
              <button onClick={logout} className="text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">로그아웃</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto custom-scroll w-full mx-auto p-4 sm:p-8 pb-32 overscroll-contain">
            <h2 className="text-lg font-extrabold text-slate-800 mb-4 flex items-center gap-2">👨‍🎓 내 자녀 학습 현황</h2>
            <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
              {studentsData.length === 0 ? (
                <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-2xl border border-slate-200">등록된 자녀 정보가 없습니다.</div>
              ) : (
                studentsData.map(s => <StudentCard key={s.student_id} student={s} />)
              )}
            </div>
          </main>

          {parentId && <ChatWidget parentId={parentId} />}
        </div>
      )}
    </div>
  );
}