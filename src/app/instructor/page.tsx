// src/app/instructor/page.tsx (또는 해당 경로)
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import FloatingChat from "@/components/FloatingChat"; // 선생님용 사내/학부모 통합 메신저
import AiRecordModal from "@/components/minutes/AiRecordModal"; // AI 회의록 녹음 모달

export default function InstructorPortalPage() {
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [authState, setAuthState] = useState<"login" | "dashboard">("login");
  
  // 로그인 상태 관리
  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  
  // 강사 정보 상태
  const [instId, setInstId] = useState<string | null>(null);
  const [instName, setInstName] = useState("");
  const [instDept, setInstDept] = useState("");

  // AI 모달 상태
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  // 모바일 뒤로가기 방어 로직 (History Trap)
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

  // 초기 세션 확인 (자동 로그인)
  useEffect(() => {
    const savedInstId = sessionStorage.getItem("logica_instructor_id");
    if (savedInstId) {
      loadDashboard(savedInstId);
    }
  }, []);

  // 전화번호 하이픈 자동 생성 로직
  const handlePhoneInput = (val: string) => {
    const formatted = val
      .replace(/[^0-9]/g, "")
      .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));
    setPhoneInput(formatted);
  };

  // 강사 로그인 로직
  const loginInstructor = async () => {
    if (!phoneInput || !pwInput) {
      return alert("연락처와 비밀번호를 모두 입력해주세요.");
    }

    try {
      // 💡 실제 DB의 instructor 테이블 구조에 맞게 쿼리합니다.
      const rawPhone = phoneInput.replace(/[^0-9]/g, "");
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      const { data, error } = await supabase
        .from("instructor")
        .select("instructor_id, name, department, status")
        .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`)
        // .eq("password", pwInput) // 🚨 실제 운영 시에는 암호화된 비밀번호 대조 로직 필요
        .maybeSingle();

      if (error || !data) {
        return alert("등록된 강사 정보가 없거나 비밀번호가 일치하지 않습니다.");
      }
      
      if (data.status === "퇴사") {
        return alert("퇴사 처리된 계정입니다. 관리자에게 문의하세요.");
      }

      sessionStorage.setItem("logica_instructor_id", data.instructor_id);
      localStorage.setItem("logica_instructor_name", data.name); // FloatingChat 내부 사용 용도
      
      loadDashboard(data.instructor_id);

    } catch (err) {
      console.error(err);
      alert("로그인 중 오류가 발생했습니다.");
    }
  };

  const logout = () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      sessionStorage.removeItem("logica_instructor_id");
      localStorage.removeItem("logica_instructor_name");
      window.location.reload();
    }
  };

  const loadDashboard = async (id: string) => {
    setInstId(id);
    setAuthState("dashboard");
    
    // 강사 기본 정보 세팅
    const { data } = await supabase.from("instructor").select("name, department").eq("instructor_id", id).maybeSingle();
    if (data) {
      setInstName(data.name || "선생님");
      setInstDept(data.department || "강사");
    }
  };

  // 렌더링 - 로그인 화면
  const renderAuthSection = () => {
    return (
      <div className="flex-1 flex items-center justify-center p-4 h-full bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100 animate-[fadeIn_0.3s_ease-out]">
          <div className="text-center mb-6 flex flex-col items-center justify-center">
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-10 object-contain mb-2" alt="Logica" />
            <span className="text-sm font-black text-[#002864] bg-blue-50 px-3 py-1 rounded-full">교직원 전용 포털</span>
          </div>
          
          <input 
            type="text" 
            maxLength={13} 
            value={phoneInput} 
            onChange={e => handlePhoneInput(e.target.value)} 
            className="w-full px-4 py-3 mb-3 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" 
            placeholder="등록된 연락처 (아이디)" 
          />
          <input 
            type="password" 
            value={pwInput} 
            onChange={e => setPwInput(e.target.value)} 
            onKeyPress={e => e.key === 'Enter' && loginInstructor()}
            className="w-full px-4 py-3 mb-5 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" 
            placeholder="비밀번호" 
          />
          <button onClick={loginInstructor} className="w-full bg-[#002864] text-white font-bold py-3.5 rounded-xl hover:bg-blue-900 transition-colors shadow-md">
            로그인
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="text-slate-800 relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-slate-50 overscroll-none">
      
      {/* 🚨 앱 종료 확인 모달 */}
      {isExitModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[280px] rounded-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="p-6 text-center space-y-2">
              <div className="text-4xl mb-3">👋</div>
              <h2 className="font-bold text-lg text-slate-800">앱을 종료하시겠습니까?</h2>
            </div>
            <div className="flex border-t border-slate-200">
              <button onClick={() => { setIsExitModalOpen(false); window.history.replaceState({ app_state: "trap" }, "", window.location.href); }} className="flex-1 py-3.5 text-slate-500 font-bold border-r border-slate-200">취소</button>
              <button onClick={() => window.history.go(-2)} className="flex-1 py-3.5 text-rose-500 font-bold">종료하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 🚨 AI 회의록 녹음 모달 탑재 */}
      {isAiModalOpen && (
        <AiRecordModal 
          onClose={() => setIsAiModalOpen(false)} 
          onSuccess={() => {
            alert("회의록 저장이 완료되었습니다!");
            setIsAiModalOpen(false);
          }} 
        />
      )}

      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          {/* 상단 헤더 */}
          <header className="bg-[#002864] px-6 py-4 flex justify-between items-center shadow-md shrink-0 z-20">
            <div className="flex items-center gap-2">
              <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-5 object-contain brightness-0 invert" alt="Logica" />
              <span className="text-white font-black text-xs opacity-80 border-l border-white/30 pl-2">교직원</span>
            </div>
            <button onClick={logout} className="text-[11px] font-bold text-white/80 hover:text-white bg-white/10 px-3 py-1.5 rounded-lg transition-colors">
              로그아웃
            </button>
          </header>

          {/* 메인 대시보드 영역 */}
          <main className="flex-1 overflow-y-auto custom-scroll w-full mx-auto p-4 sm:p-6 pb-32 overscroll-contain bg-slate-50">
            <div className="w-full max-w-4xl mx-auto space-y-4">
              
              {/* 환영 인사 카드 */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-600 mb-1">{instDept}</div>
                  <h1 className="text-xl font-black text-slate-800"><span className="text-[#002864]">{instName}</span> 선생님, 환영합니다!</h1>
                  <p className="text-xs text-slate-400 font-medium mt-1">오늘도 즐거운 하루 되세요.</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-full flex justify-center items-center text-blue-500 font-black text-xl">
                  {instName.charAt(0)}
                </div>
              </div>

              {/* 💡 핵심 기능 퀵 버튼 영역 */}
              <h2 className="font-black text-sm text-slate-700 ml-1 mt-6 mb-2">업무 퀵 메뉴</h2>
              <div className="grid grid-cols-2 gap-3">
                
                {/* 1. AI 회의록/상담 녹음 버튼 */}
                <button 
                  onClick={() => setIsAiModalOpen(true)}
                  className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center gap-3 hover:border-rose-300 hover:shadow-md transition-all group"
                >
                  <div className="w-12 h-12 bg-rose-50 rounded-full flex justify-center items-center text-rose-500 text-2xl group-hover:scale-110 transition-transform">
                    🎙️
                  </div>
                  <div className="text-center">
                    <div className="font-black text-slate-700 text-[13px]">AI 음성 기록</div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">회의 및 학부모 상담</div>
                  </div>
                </button>

                {/* 2. 메신저 열기 버튼 (FloatingChat을 여는 눈속임 버튼) */}
                <button 
                  onClick={() => {
                    // FloatingChat의 버튼을 프로그래밍 방식으로 클릭하여 엽니다.
                    const chatBtn = document.querySelector('.fixed.bottom-6.right-6.bg-\\[\\#002864\\]') as HTMLButtonElement;
                    if (chatBtn) chatBtn.click();
                  }}
                  className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center gap-3 hover:border-blue-300 hover:shadow-md transition-all group"
                >
                  <div className="w-12 h-12 bg-blue-50 rounded-full flex justify-center items-center text-blue-500 text-2xl group-hover:scale-110 transition-transform">
                    💬
                  </div>
                  <div className="text-center">
                    <div className="font-black text-slate-700 text-[13px]">통합 메신저</div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">사내 및 학부모 톡</div>
                  </div>
                </button>
                
              </div>
            </div>
          </main>

          {/* 🚨 우측 하단 메신저 위젯 마운트 (Staff & Parent 통합 채팅) */}
          {instId && <FloatingChat instId={instId} />}
          
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}