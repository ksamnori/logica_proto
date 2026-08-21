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

  const handleLogin = () => {
    const val = nameInput.trim();
    if (!val) return;
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
  if (taName === null) return <div className="min-h-screen bg-slate-100" />;

  if (!taName) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6 font-pretendard relative">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-xs text-center">
          <h1 className="font-lexend text-lg font-bold text-[#002864] mb-1">Logica Clinic</h1>
          <p className="text-xs text-slate-400 font-medium mb-6">조교 이름을 입력하세요</p>
          <input
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="이름 입력"
            maxLength={10}
            autoFocus
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-center font-semibold text-slate-700 focus:outline-none focus:border-[#002864] mb-4 bg-slate-50"
          />
          <button onClick={handleLogin} className="w-full py-2.5 rounded-xl bg-[#002864] text-white text-sm font-semibold shadow-md hover:bg-blue-900 transition-colors">
            확인
          </button>
        </div>
        <BackToLoginLink />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6 font-pretendard relative">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-lexend text-lg font-bold text-[#002864]">Logica Clinic</h1>
          <p className="text-sm text-slate-500 font-semibold mt-1">
            <span className="underline decoration-dotted cursor-pointer hover:text-slate-700" onClick={handleSwitchName} title="이름 변경">{taName}</span> 조교님, 어떤 화면으로 들어가시겠어요?
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <button onClick={() => router.push('/clinic/ta/pad')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg border border-slate-200 hover:border-[#002864] transition-all p-6 text-left flex items-center gap-4 group">
            <span className="text-3xl shrink-0">🧑‍🏫</span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#002864] text-base">조교 패드</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5 leading-relaxed">클리닉 현장을 돌아다니며 학생 호출 · 힌트 요청에 응대할 때</p>
            </div>
            <span className="ml-auto text-slate-300 group-hover:text-[#002864] transition-colors">→</span>
          </button>

          <button onClick={() => router.push('/clinic/ta/grading')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg border border-slate-200 hover:border-[#002864] transition-all p-6 text-left flex items-center gap-4 group">
            <span className="text-3xl shrink-0">📝</span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#002864] text-base">조교 채점</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5 leading-relaxed">학생을 골라 시험지 · 과제를 채점할 때</p>
            </div>
            <span className="ml-auto text-slate-300 group-hover:text-[#002864] transition-colors">→</span>
          </button>

          {isInstructorLogin && (
            <button onClick={() => router.push('/home')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg border border-slate-200 hover:border-blue-500 transition-all p-6 text-left flex items-center gap-4 group">
              <span className="text-3xl shrink-0">🏠</span>
              <div className="min-w-0">
                <p className="font-extrabold text-blue-600 text-base">메인 메뉴 (Home)</p>
                <p className="text-xs text-slate-400 font-medium mt-0.5 leading-relaxed">일반 강사 대시보드로 이동</p>
              </div>
              <span className="ml-auto text-slate-300 group-hover:text-blue-500 transition-colors">→</span>
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
    className="absolute bottom-4 right-4 text-[11px] font-semibold text-slate-300 hover:text-slate-400 transition-colors"
  >
    로그인 페이지로
  </a>
);
