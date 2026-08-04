"use client";

import React, { useState, useEffect } from "react";
import { searchStudentsByDigits, loginStudentAction } from "@/app/actions/studentAuth";

// 💡 아바타 에셋 유지
const ANIMALS = ['🐶', '🦒', '🦊', '🐱', '🐰'];
const AVATAR_COLORS = [
  { bg: 'bg-blue-50',    ring: 'group-hover:border-blue-500',    text: 'group-hover:text-blue-600' },
  { bg: 'bg-rose-50',    ring: 'group-hover:border-rose-500',    text: 'group-hover:text-rose-600' },
  { bg: 'bg-emerald-50', ring: 'group-hover:border-emerald-500', text: 'group-hover:text-emerald-600' },
  { bg: 'bg-amber-50',   ring: 'group-hover:border-amber-500',   text: 'group-hover:text-amber-600' },
  { bg: 'bg-violet-50',  ring: 'group-hover:border-violet-500',  text: 'group-hover:text-violet-600' },
  { bg: 'bg-cyan-50',    ring: 'group-hover:border-cyan-500',    text: 'group-hover:text-cyan-600' },
  { bg: 'bg-orange-50',  ring: 'group-hover:border-orange-500',  text: 'group-hover:text-orange-600' },
  { bg: 'bg-teal-50',    ring: 'group-hover:border-teal-500',    text: 'group-hover:text-teal-600' },
];

function hashString(str: string, seed: number) {
  let hash = seed;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

function getAvatarFor(studentId: string) {
  const key = studentId || 'unknown';
  return { animal: ANIMALS[hashString(key, 1) % ANIMALS.length], color: AVATAR_COLORS[hashString(key, 7) % AVATAR_COLORS.length] };
}

function gradeLabel(grade: string) {
  const g = parseInt(grade, 10);
  if (isNaN(g)) return grade;
  if (g >= 1 && g <= 6) return `초등학교 ${g}학년`;
  if (g >= 7 && g <= 9) return `중학교 ${g - 6}학년`;
  if (g >= 10 && g <= 12) return `고등학교 ${g - 9}학년`;
  return '학년 정보 없음';
}

const IconDelete = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>;

export default function StudentKioskLogin() {
  const [step, setStep] = useState<"phone" | "profile" | "password">("phone");
  const [digits, setDigits] = useState("");
  const [matchedList, setMatchedList] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  
  // 💡 전체화면 상태 관리 (로그인 직후 전체화면 전환 시 필요)
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 💡 전체화면 토글 함수 (비밀 버튼에 연결됨)
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.log("전체화면 미지원 기기", err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const resetState = () => {
    setStep("phone");
    setDigits("");
    setMatchedList([]);
    setSelectedStudent(null);
    setPasswordInput("");
  };

  const handleDigit = (num: string) => {
    if (step === "phone") {
      if (digits.length < 4 && !isProcessing) {
        const newDigits = digits + num;
        setDigits(newDigits);
        if (newDigits.length === 4) {
          searchDBAndProcess(newDigits);
        }
      }
    }
  };

  const handleDelete = () => {
    if (step === "phone") setDigits(digits.slice(0, -1));
  };

  const handlePinDigit = (num: string) => {
    if (passwordInput.length < 4 && !isProcessing) {
      const newPin = passwordInput + num;
      setPasswordInput(newPin);
      if (newPin.length === 4) {
        handlePasswordLogin(newPin);
      }
    }
  };

  const handlePinDelete = () => {
    setPasswordInput(prev => prev.slice(0, -1));
  };

  const searchDBAndProcess = async (code: string) => {
    setIsProcessing(true);
    const result = await searchStudentsByDigits(code);
    setIsProcessing(false);

    if (!result.success || result.data.length === 0) {
      alert("일치하는 번호가 없습니다.");
      setDigits("");
      return;
    }

    setMatchedList(result.data);
    setStep("profile"); 
  };

  const handlePasswordLogin = async (pinToUse?: string) => {
    const finalPin = typeof pinToUse === 'string' ? pinToUse : passwordInput;
    if (!finalPin || finalPin.length < 4) return alert("비밀번호 4자리를 모두 입력해주세요.");
    
    setIsProcessing(true);
    const result = await loginStudentAction(selectedStudent.student_id, finalPin);
    setIsProcessing(false);

    if (result.success) {
      localStorage.setItem("logica_student_id", result.studentId);
      localStorage.setItem("logica_student_phone", result.phone || "");
      localStorage.setItem("logica_student_name", result.name);
      
      // 혹시나 비밀 버튼을 못 누르고 로그인에 성공했더라도, 이 시점에 전체화면 강제 발동
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

      window.location.href = "/student"; 
    } else {
      alert("비밀번호가 일치하지 않습니다. 다시 시도해주세요.");
      setPasswordInput(""); 
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 font-pretendard select-none py-12 px-4 relative">
      
      {/* 전역 로딩 오버레이 */}
      {isProcessing && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-[#002864] font-bold text-2xl animate-pulse">데이터를 불러오는 중입니다...</div>
        </div>
      )}

      {/* 1단계: 전화번호 입력 */}
      {step === "phone" && (
        <div className="bg-white w-full max-w-[420px] pt-12 pb-10 px-8 rounded-[32px] shadow-2xl border border-slate-200 animate-[fadeIn_0.3s_ease-out] flex flex-col items-center relative z-10 overflow-hidden">
          
          {/* 💡 투명한 비밀 버튼 (흰색 상자의 오른쪽 맨 위 구석) */}
          <button 
            onClick={toggleFullScreen} 
            className="absolute top-0 right-0 w-16 h-16 bg-transparent opacity-0 cursor-pointer z-50"
            title="전체화면 토글"
          />

          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-10 mb-6 opacity-80" />
          
          <h2 className="text-xl font-extrabold text-slate-800 mb-1">
            휴대폰번호 뒤 4자리
          </h2>
          <p className="text-xs text-slate-500 font-medium mb-8 bg-slate-50 px-3 py-1.5 rounded-md border border-slate-100">
            학생 본인 또는 학부모님 전화번호
          </p>

          <div className="flex gap-4 mb-6">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className={`w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-black transition-all border-2 ${digits.length > idx ? 'border-[#002864] text-[#002864] bg-white shadow-sm' : 'border-slate-200 bg-slate-50 text-transparent'}`}>
                {digits[idx] ? '●' : ''}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 w-full mt-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button key={num} onClick={() => handleDigit(num.toString())} className="bg-slate-50 hover:bg-blue-50 active:bg-blue-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                {num}
              </button>
            ))}
            <button onClick={() => setDigits("")} className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-500 rounded-2xl py-4 text-sm font-bold transition-colors border border-slate-100 shadow-sm">
              초기화
            </button>
            <button onClick={() => handleDigit('0')} className="bg-slate-50 hover:bg-blue-50 active:bg-blue-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
              0
            </button>
            <button onClick={handleDelete} className="bg-slate-50 hover:bg-rose-50 active:bg-rose-100 text-rose-500 rounded-2xl py-4 flex items-center justify-center transition-colors border border-slate-100 shadow-sm">
              <IconDelete />
            </button>
          </div>

        </div>
      )}

      {/* 2단계: 프로필 선택 */}
      {step === "profile" && matchedList.length > 0 && (
        <div className="bg-white p-12 rounded-[32px] shadow-2xl w-[750px] max-w-full text-center animate-[fadeIn_0.3s_ease-out] relative z-10 overflow-hidden">
          
          {/* 💡 프로필 창에도 비밀 버튼 추가 */}
          <button 
            onClick={toggleFullScreen} 
            className="absolute top-0 right-0 w-16 h-16 bg-transparent opacity-0 cursor-pointer z-50"
            title="전체화면 토글"
          />

          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-10 mb-8 inline-block opacity-50" />
          <h2 className="text-3xl font-extrabold text-slate-800 mb-10">누구로 접속할까요?</h2>
          
          <div className="flex flex-wrap justify-center gap-10 mb-12">
            {matchedList.map(student => {
              const { animal, color } = getAvatarFor(student.student_id);
              return (
                <div key={student.student_id} onClick={() => { setSelectedStudent(student); setStep("password"); setPasswordInput(""); }}
                  className="group cursor-pointer flex flex-col items-center w-40 shrink-0 transition-transform hover:-translate-y-2">
                  <div className={`w-32 h-32 rounded-full ${color.bg} flex items-center justify-center mb-5 border-4 border-transparent ${color.ring} transition-colors shadow-md group-hover:shadow-xl`}>
                    <span className="text-6xl">{animal}</span>
                  </div>
                  <h3 className={`text-2xl font-bold text-slate-800 ${color.text} transition-colors`}>{student.name}</h3>
                  <p className="text-slate-500 font-medium mt-1">{gradeLabel(student.grade)}</p>
                  <div className="flex flex-wrap justify-center gap-1.5 mt-3 max-w-[160px]">
                    {(student.classNames || []).map((cn: string, i: number) => (
                      <span key={i} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full border border-slate-200">
                        {cn}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={resetState} className="text-slate-400 hover:text-slate-600 font-semibold underline underline-offset-4 transition-colors">
            다른 번호로 로그인하기
          </button>
        </div>
      )}

      {/* 3단계: 비밀번호(PIN) 입력 */}
      {step === "password" && selectedStudent && (() => {
        const avatar = getAvatarFor(selectedStudent.student_id);
        return (
          <div className="bg-white w-full max-w-[420px] pt-12 pb-10 px-8 rounded-[32px] shadow-2xl border border-slate-200 animate-[fadeIn_0.3s_ease-out] flex flex-col items-center relative z-10 overflow-hidden">
            
            {/* 💡 PIN 입력 창에도 비밀 버튼 추가 */}
            <button 
              onClick={toggleFullScreen} 
              className="absolute top-0 right-0 w-16 h-16 bg-transparent opacity-0 cursor-pointer z-50"
              title="전체화면 토글"
            />

            <div className={`w-20 h-20 rounded-full ${avatar.color.bg} flex items-center justify-center mb-4 shadow-sm`}>
              <span className="text-4xl">{avatar.animal}</span>
            </div>
            <h2 className={`text-xl font-extrabold text-slate-800 mb-1 ${avatar.color.text}`}>
              {selectedStudent.name} <span className="text-base text-slate-500">학생</span>
            </h2>
            <p className="text-xs text-slate-500 font-medium mb-8 bg-slate-50 px-3 py-1.5 rounded-md border border-slate-100">
              PIN 번호 4자리를 입력해주세요
            </p>

            <div className="flex gap-4 mb-6">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className={`w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-black transition-all border-2 ${passwordInput.length > idx ? 'border-[#002864] text-[#002864] bg-white shadow-sm' : 'border-slate-200 bg-slate-50 text-transparent'}`}>
                  {passwordInput[idx] ? '●' : ''}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full mt-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button key={num} onClick={() => handlePinDigit(num.toString())} className="bg-slate-50 hover:bg-blue-50 active:bg-blue-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                  {num}
                </button>
              ))}
              <button onClick={() => setPasswordInput("")} className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-500 rounded-2xl py-4 text-sm font-bold transition-colors border border-slate-100 shadow-sm">
                초기화
              </button>
              <button onClick={() => handlePinDigit('0')} className="bg-slate-50 hover:bg-blue-50 active:bg-blue-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                0
              </button>
              <button onClick={handlePinDelete} className="bg-slate-50 hover:bg-rose-50 active:bg-rose-100 text-rose-500 rounded-2xl py-4 flex items-center justify-center transition-colors border border-slate-100 shadow-sm">
                <IconDelete />
              </button>
            </div>
            
            <button onClick={() => { setStep("profile"); setPasswordInput(""); }} className="mt-8 text-sm text-slate-400 hover:text-slate-600 underline font-medium underline-offset-4">
              다른 프로필 선택하기
            </button>
          </div>
        );
      })()}
      
    </div>
  );
}