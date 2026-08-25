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
  const [studentsData, setStudentsData] = useState<any[]>([]);
  
  // 현재 선택된 자녀의 ID를 관리하는 상태
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // 히스토리 라우팅 (뒤로가기 방어)
  const isExitModalOpenRef = useRef(isExitModalOpen);
  isExitModalOpenRef.current = isExitModalOpen;
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isExitModalOpenRef.current) {
        setIsExitModalOpen(false);
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

  // 초기 인증 확인 및 카카오 세션 처리 (완벽 복구!)
  useEffect(() => {
    const hash = window.location.hash;
    
    if (localStorage.getItem("logica_parent_id")) {
      localStorage.removeItem("logica_parent_id");
    }

    const savedParentId = sessionStorage.getItem("logica_parent_id");
    
    if (hash.includes("access_token")) setIsKakaoLoading(true); 

    const handleKakaoSession = async (session: any) => {
      console.log("🔥 [1단계] Supabase 세션 확인:", session);
      let kakaoPhone = "";

      // 💡 [핵심 비기] 카카오 출입증으로 카카오 본서버에 직접 요청
      if (session.provider_token) {
        try {
          const res = await fetch("https://kapi.kakao.com/v2/user/me", {
            headers: {
              Authorization: `Bearer ${session.provider_token}`,
              "Content-type": "application/x-www-form-urlencoded;charset=utf-8",
            },
          });
          const kakaoData = await res.json();
          console.log("🚀 [2단계] 카카오 다이렉트 통신 성공! 데이터:", kakaoData);
          kakaoPhone = kakaoData?.kakao_account?.phone_number || "";
        } catch (e) {
          console.error("카카오 다이렉트 호출 실패", e);
        }
      }

      // 백업: Supabase 메타데이터 스캔
      if (!kakaoPhone) {
        const meta = session.user?.user_metadata || {};
        kakaoPhone = meta.phone_number || meta.phone || session.user?.identities?.[0]?.identity_data?.phone_number || "";
      }

      // 우회: 테스트 모드 프롬프트
      if (!kakaoPhone) {
        const testPhone = prompt(
          "🚨 [임시 관리자 테스트 모드]\n카카오에서 전화번호를 받지 못했습니다.\n학원 DB에 등록된 학부모 연락처를 직접 입력해주세요.\n(예: 01012345678)"
        );
        if (testPhone) {
          kakaoPhone = testPhone;
        } else {
          await supabase.auth.signOut();
          setIsKakaoLoading(false);
          return;
        }
      }

      // +82 10-XXXX-XXXX 형식 정리
      if (kakaoPhone.startsWith("+82")) {
        kakaoPhone = "0" + kakaoPhone.slice(3).trim(); 
      }
      
      // 💡 [하이픈 패치] 순수 숫자 버전과 하이픈 버전을 모두 준비
      const rawPhone = kakaoPhone.replace(/[^0-9]/g, ""); 
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      console.log("📞 [3단계] 폰 번호 검색 준비 완료:", { rawPhone, formattedPhone });

      // DB 매칭 시도 (.or 로직 적용)
      try {
        const { data } = await supabase
          .from("parent")
          .select("parent_id")
          .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`)
          .limit(1)
          .maybeSingle();
        
        if (data) {
          sessionStorage.setItem("logica_parent_id", data.parent_id);
          window.history.replaceState({ app_state: "trap" }, "", window.location.pathname);
          setIsKakaoLoading(false);
          loadDashboard(data.parent_id);
        } else {
          alert(`등록된 학원 연락처(${formattedPhone})와 일치하는 학부모 정보가 없습니다.`);
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
        scopes: "phone_number profile_nickname profile_image account_email"
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
      // 1. 우선 로그인에 성공한 학부모의 번호를 확인합니다.
      const { data: pData } = await supabase.from("parent").select("name, phone").eq("parent_id", pid).single();
      setInfoName(pData?.name || "");

      if (!pData?.phone) return;

      // 2. 하이픈이 있는 번호와 없는 번호 두 가지 버전을 모두 준비합니다.
      const rawPhone = pData.phone.replace(/[^0-9]/g, "");
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      // 3. 💡 [핵심] DB에서 이 번호를 가진 '모든' 학부모 계정(parent_id)을 싹쓸이해 옵니다!
      const { data: allParents } = await supabase
        .from("parent")
        .select("parent_id")
        .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`);

      // 찾은 모든 parent_id들을 배열로 만듭니다.
      const pids = allParents?.map(p => p.parent_id) || [pid];

      // 4. 💡 해당 부모 배열(pids)에 하나라도 속한 자녀를 모조리 불러옵니다. (.in 사용)
      const { data: sData, error } = await supabase
        .from("student")
        .select("*, enrollment(class(name, class_schedule(day_of_week, start_time))), exam_assignment(total_score, status, created_at), attendance(attendance_date, status)")
        .in("parent_id", pids);

      if (!error && sData && sData.length > 0) {
        const sorted = sData.sort((a, b) => (parseInt(b.grade) || 0) - (parseInt(a.grade) || 0));
        setStudentsData(sorted);
        // 첫 번째 자녀를 기본으로 선택
        setSelectedStudentId(sorted[0].student_id);
      }
    } catch (err) { console.error("대시보드 로드 에러", err); }
  };

  // 통째로 날아갔던 로그인 UI 영역 완벽 복구!
  const renderAuthSection = () => {
    if (authState === "dashboard") return null;
    if (isKakaoLoading) return (
      <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
        <div className="text-lg font-bold text-[#FEE500] bg-slate-800 px-6 py-3 rounded-full animate-pulse shadow-lg">카카오 계정 연동 중...</div>
      </div>
    );
    
    return (
      <div className="flex-1 flex items-center justify-center p-4 h-full bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
          <div className="text-center mb-6 flex justify-center">
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-10 object-contain" alt="Logica" />
          </div>
          {authState === "check_phone" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <button onClick={loginWithKakao} className="w-full flex items-center justify-center gap-2 bg-[#FEE500] text-[#000000] font-black py-4 px-4 rounded-xl hover:bg-[#e6cf00] transition-colors shadow-md mb-6">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-5.523 0-10 3.51-10 7.839 0 2.825 1.83 5.305 4.606 6.643l-1.18 4.316c-.086.315.267.559.53.376l5.06-3.348c.323.033.655.051.984.051 5.523 0 10-3.51 10-7.839C22 6.51 17.523 3 12 3z"/></svg>
                카카오톡으로 1초만에 시작하기
              </button>
              
              <div className="flex items-center my-6">
                <div className="flex-1 border-t border-slate-200"></div>
                <span className="px-4 text-xs font-bold text-slate-400">또는 다른 방법으로 로그인</span>
                <div className="flex-1 border-t border-slate-200"></div>
              </div>
              
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

  // 현재 선택된 자녀 찾기
  const selectedStudent = studentsData.find(s => s.student_id === selectedStudentId);

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

      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          {/* 상단 헤더: 좌측 로고, 우측 로그아웃 */}
          <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm shrink-0 z-20">
            <div className="flex items-center">
              <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-6 object-contain" alt="Logica" />
            </div>
            <button onClick={logout} className="text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">
              로그아웃
            </button>
          </header>

          {/* 다자녀 선택 탭 (자녀가 2명 이상일 때만 렌더링됨) */}
          {studentsData.length > 1 && (
            <div className="bg-white px-4 pb-3 shrink-0 z-10 border-b border-slate-200">
              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                {studentsData.map((student) => (
                  <button
                    key={student.student_id}
                    onClick={() => setSelectedStudentId(student.student_id)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                      selectedStudentId === student.student_id
                        ? "bg-white text-slate-800 shadow-sm border border-slate-200"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    {student.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 메인 대시보드 영역 */}
          <main className="flex-1 overflow-y-auto custom-scroll w-full mx-auto p-4 sm:p-6 pb-32 overscroll-contain">
            <div className="w-full max-w-4xl mx-auto">
              {!selectedStudent ? (
                <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-2xl border border-slate-200">등록된 자녀 정보가 없습니다.</div>
              ) : (
                <StudentCard student={selectedStudent} />
              )}
            </div>
          </main>

          {parentId && <ChatWidget parentId={parentId} />}
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}