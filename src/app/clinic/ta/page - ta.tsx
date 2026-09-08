// src/app/clinic/ta/page.tsx
//
// 조교(TA) 허브 화면. 정식 인증은 아니고, 이름 표시 정도의 최소한의 출입 통제만 한다.
// 이름을 입력하면 조교 패드(클리닉 현장용)와 조교 채점 중 원하는 화면으로 들어간다.
// 실제 검증/보안 로직은 taAccess.ts에 몰아뒀다.
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TA_NAME_STORAGE_KEY, seedTaTenantId } from "./taAccess";

export default function TaHubPage() {
  const router = useRouter();
  const [taName, setTaName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [isInstructorLogin, setIsInstructorLogin] = useState(false);

  useEffect(() => {
    setTaName(localStorage.getItem(TA_NAME_STORAGE_KEY) || '');
    setIsInstructorLogin(localStorage.getItem('logica_instructor_role') === 'TA');
  }, []);

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const val = nameInput.trim();
    if (!val) {
      alert("조교 이름을 입력해주세요.");
      return;
    }
    localStorage.setItem(TA_NAME_STORAGE_KEY, val);
    seedTaTenantId();
    setTaName(val);
  };

  const handleSwitchName = () => {
    localStorage.removeItem(TA_NAME_STORAGE_KEY);
    setNameInput('');
    setTaName('');
  };

  // 아직 로딩 전(localStorage 확인 전) 깜빡임 방지
  if (taName === null) return <div className="min-h-screen bg-slate-50" />;

  // 🌟 로그인 화면 (메인 로그인 페이지 스타일 적용)
  if (!taName) {
    return (
      <div className="min-h-screen flex items-center justify-center relative bg-slate-50 font-pretendard">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200 z-10">
          <div className="text-center mb-8 flex flex-col items-center">
            <img
              src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
              alt="Logica"
              className="h-14 object-contain mb-3"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <h1 className="font-lexend text-3xl font-bold tracking-tighter text-[#002864] mb-2">
              Logica Clinic
            </h1>
            <p className="text-slate-500 font-bold text-sm mt-1">조교(TA) 통합 관리 시스템</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">조교 이름</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                  </svg>
                </span>
                <input
                  type="text"
                  maxLength={10}
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] font-medium"
                  placeholder="본인의 이름을 입력하세요"
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[#002864] hover:bg-[#001f4d] text-white font-bold py-3.5 px-4 rounded-lg shadow-md transition-colors mt-2"
            >
              시스템 접속하기
            </button>
          </form>
        </div>
        <BackToLoginLink />
      </div>
    );
  }

  // 🌟 로그인 이후 허브 화면 (관리자 선택 모달 스타일 적용)
  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 font-pretendard">
      <div className="bg-white w-full max-w-[500px] rounded-2xl shadow-2xl overflow-hidden flex flex-col z-10 border border-slate-200">
        <div className="bg-[#002864] p-6 text-center relative shrink-0">
          <h2 className="text-xl font-black text-white tracking-tighter">Logica Clinic TA</h2>
          <p className="text-blue-200 text-sm mt-1.5 font-medium">
            환영합니다, <span className="font-extrabold text-white underline decoration-dashed cursor-pointer hover:text-blue-100 transition-colors" onClick={handleSwitchName} title="이름 변경">{taName}</span> 조교님
          </p>
        </div>
        
        <div className="p-6 space-y-3 bg-slate-50">
          <button 
            onClick={() => router.push('/clinic/ta/pad')}
            className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-md transition-all group"
          >
            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-blue-600 transition-colors shrink-0">
              <span className="group-hover:text-white transition-colors">🧑‍🏫</span>
            </div>
            <div className="text-left flex-1 min-w-0">
              <h3 className="font-black text-slate-800 text-[15px] group-hover:text-blue-700 transition-colors truncate">조교 패드 (현장용)</h3>
              <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">클리닉 순회 및 학생 호출 · 힌트 응대</p>
            </div>
            <span className="text-slate-300 group-hover:text-blue-600 font-bold transition-colors">➔</span>
          </button>

          <button 
            onClick={() => router.push('/clinic/ta/grading')}
            className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-500 hover:shadow-md transition-all group"
          >
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-emerald-500 transition-colors shrink-0">
              <span className="group-hover:text-white transition-colors">📝</span>
            </div>
            <div className="text-left flex-1 min-w-0">
              <h3 className="font-black text-slate-800 text-[15px] group-hover:text-emerald-700 transition-colors truncate">조교 채점 (데스크용)</h3>
              <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">제출된 시험지 및 과제 수동 집중 채점</p>
            </div>
            <span className="text-slate-300 group-hover:text-emerald-600 font-bold transition-colors">➔</span>
          </button>

          {isInstructorLogin && (
            <button 
              onClick={() => router.push('/home')}
              className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-500 hover:shadow-md transition-all group mt-2"
            >
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-indigo-500 transition-colors shrink-0">
                <span className="group-hover:text-white transition-colors">🏠</span>
              </div>
              <div className="text-left flex-1 min-w-0">
                <h3 className="font-black text-slate-800 text-[15px] group-hover:text-indigo-700 transition-colors truncate">메인 메뉴 (Home)</h3>
                <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">일반 강사 대시보드로 이동</p>
              </div>
              <span className="text-slate-300 group-hover:text-indigo-600 font-bold transition-colors">➔</span>
            </button>
          )}
        </div>
      </div>
      <BackToLoginLink />
    </div>
  );
}

const BackToLoginLink = () => (
  <a
    href="/"
    className="absolute bottom-6 right-6 text-[12px] font-bold text-slate-400 hover:text-slate-600 transition-colors underline decoration-dotted"
  >
    학원 메인 로그인으로
  </a>
);