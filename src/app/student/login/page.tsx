"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { searchStudentsByDigits, loginStudentAction, loginTransferAction, setupStudentPinAction } from "@/app/actions/studentAuth";
import { getSeatForDevice, assignPadDevice, listActiveTenants } from "@/app/actions/clinicPadDevice";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { getKioskDeviceId } from "@/lib/kioskDevice";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const getSupabaseClient = () => {
  if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();
const CLINIC_ROOM = 'logica-clinic-room';

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
  const router = useRouter(); 
  const [step, setStep] = useState<"phone" | "profile" | "password" | "setup_pin">("phone");
  const [digits, setDigits] = useState("");
  const [matchedList, setMatchedList] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [pendingLoginData, setPendingLoginData] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [unregisteredDeviceId, setUnregisteredDeviceId] = useState<string | null>(null);
  const [seatInputValue, setSeatInputValue] = useState("");
  const [isRegisteringSeat, setIsRegisteringSeat] = useState(false);
  const [tenantOptions, setTenantOptions] = useState<{ tenant_id: string; name: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const kioskSeatRef = useRef<string | null>(null);

  useEffect(() => {
    if (!unregisteredDeviceId || tenantOptions.length > 0) return;
    listActiveTenants().then(setTenantOptions);
  }, [unregisteredDeviceId, tenantOptions.length]);

  const handleRegisterSeat = async () => {
    const seat = seatInputValue.trim();
    if (!unregisteredDeviceId || !seat || !selectedTenantId || isRegisteringSeat) return;

    const tenantId = selectedTenantId;
    setIsRegisteringSeat(true);

    const layout = await getActiveSeatLayout(tenantId);
    const seatExists = layout.seats.some((s) => String(s.number) === seat);
    if (!seatExists) {
      setIsRegisteringSeat(false);
      alert(`이 지점의 좌석 배치도에 ${seat}번 좌석이 없습니다. 좌석번호를 다시 확인하거나 관리자에게 문의해주세요.`);
      return;
    }

    const res = await assignPadDevice(unregisteredDeviceId, seat, tenantId);
    setIsRegisteringSeat(false);

    if (!res.success) {
      alert(`좌석 등록 실패: ${res.message || '알 수 없는 오류'}`);
      return;
    }

    kioskSeatRef.current = seat;
    setUnregisteredDeviceId(null);
    setSeatInputValue("");
  };

  const finalizeLogin = (result: { studentId: string; name: string; phone?: string; tenant_id?: string }) => {
    localStorage.setItem("logica_student_id", result.studentId);
    localStorage.setItem("logica_student_phone", result.phone || "");
    localStorage.setItem("logica_student_name", result.name);
    if (result.tenant_id) localStorage.setItem("logica_tenant_id", result.tenant_id);
    if (kioskSeatRef.current) localStorage.setItem("logica_kiosk_seat", kioskSeatRef.current);
    router.push("/student/portal");
  };

  useEffect(() => {
    let cancelled = false;
    let channel: any = null;

    const setup = async () => {
      let deviceId = getKioskDeviceId();
      if (!deviceId) {
        deviceId = localStorage.getItem('logica_fallback_device_id');
        if (!deviceId) {
          deviceId = 'pad-' + Math.random().toString(36).substring(2, 9);
          localStorage.setItem('logica_fallback_device_id', deviceId);
        }
      }

      const seat = await getSeatForDevice(deviceId);
      if (cancelled) return;
      
      if (!seat) {
        setUnregisteredDeviceId(deviceId);
        return;
      }
      
      kioskSeatRef.current = seat;

      const tenantId = localStorage.getItem('logica_tenant_id') || process.env.NEXT_PUBLIC_TA_TENANT_ID || '';
      if (!tenantId) return;

      channel = supabaseClient.channel(`${CLINIC_ROOM}_${tenantId}`);
      channel.on('broadcast', { event: 'ta_action' }, async ({ payload }: any) => {
        if (payload?.action !== 'relocated_in' || payload.seat !== seat) return;
        setIsProcessing(true);
        const result = await loginTransferAction(payload.studentId, payload.token, seat);
        setIsProcessing(false);
        if (result.success) finalizeLogin(result as any);
        else alert(result.message || '좌석 이동 인계에 실패했습니다.');
      }).subscribe();
    };

    setup();
    return () => { cancelled = true; if (channel) supabaseClient.removeChannel(channel); };
  }, []);

  const ensureFullscreen = () => {
    if (typeof document !== "undefined" && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

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
    ensureFullscreen(); 
    setStep("phone");
    setDigits("");
    setMatchedList([]);
    setSelectedStudent(null);
    setPasswordInput("");
    setNewPinInput("");
    setPendingLoginData(null);
  };

  const handleDigit = (num: string) => {
    ensureFullscreen(); 
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
    ensureFullscreen();
    if (step === "phone") setDigits(digits.slice(0, -1));
  };

  const handlePinDigit = (num: string) => {
    ensureFullscreen(); 
    if (passwordInput.length < 4 && !isProcessing) {
      const newPin = passwordInput + num;
      setPasswordInput(newPin);
      if (newPin.length === 4) {
        handlePasswordLogin(newPin);
      }
    }
  };

  const handlePinDelete = () => {
    ensureFullscreen();
    setPasswordInput(prev => prev.slice(0, -1));
  };

  const handleNewPinDigit = (num: string) => {
    ensureFullscreen();
    if (newPinInput.length < 4 && !isProcessing) {
      const nextPin = newPinInput + num;
      setNewPinInput(nextPin);
      if (nextPin.length === 4) {
        handleSaveNewPin(nextPin);
      }
    }
  };

  const handleNewPinDelete = () => {
    ensureFullscreen();
    setNewPinInput(prev => prev.slice(0, -1));
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
      if ((result as any).needsPinSetup) {
        setPendingLoginData(result);
        setStep("setup_pin");
        setPasswordInput("");
      } else {
        finalizeLogin(result as any);
      }
    } else {
      alert("비밀번호가 일치하지 않습니다. 다시 시도해주세요.");
      setPasswordInput(""); 
    }
  };

  const handleSaveNewPin = async (pin: string) => {
    setIsProcessing(true);
    const res = await setupStudentPinAction(selectedStudent.student_id, pin);
    setIsProcessing(false);
    
    if (res.success) {
      finalizeLogin(pendingLoginData);
    } else {
      alert(res.message || "설정 실패. 다시 시도해주세요.");
      setNewPinInput("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 font-pretendard select-none py-12 px-4 relative">

      {isProcessing && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-[#002864] font-bold text-2xl animate-pulse">데이터를 불러오는 중입니다...</div>
        </div>
      )}

      {unregisteredDeviceId && (
        <div className="fixed left-6 top-1/2 -translate-y-1/2 w-72 bg-white border-2 border-amber-400 rounded-2xl shadow-2xl px-5 py-4 z-40">
          <p className="text-sm font-extrabold text-amber-600 mb-0.5">⚠️ 미등록 패드</p>
          <p className="text-xs text-slate-400 font-medium mb-3 break-all">기기ID: {unregisteredDeviceId}</p>
          <p className="text-xs text-slate-600 font-bold mb-2">이 패드가 속할 지점과 좌석번호를 입력하세요</p>
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            disabled={isRegisteringSeat}
            className="w-full mb-2 px-3 py-2.5 rounded-xl border-2 border-slate-200 text-slate-800 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 disabled:opacity-50"
          >
            <option value="">지점 선택</option>
            {tenantOptions.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input
              value={seatInputValue}
              onChange={(e) => setSeatInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRegisterSeat(); }}
              placeholder="좌석번호"
              inputMode="numeric"
              disabled={isRegisteringSeat}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border-2 border-slate-200 text-slate-800 text-base font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 disabled:opacity-50"
            />
            <button
              onClick={handleRegisterSeat}
              disabled={isRegisteringSeat || !seatInputValue.trim() || !selectedTenantId}
              className="shrink-0 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              {isRegisteringSeat ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      )}

      {/* 1단계: 전화번호 입력 */}
      {step === "phone" && (
        <div className="bg-white w-full max-w-[420px] pt-12 pb-10 px-8 rounded-[32px] shadow-2xl border border-slate-200 animate-[fadeIn_0.3s_ease-out] flex flex-col items-center relative z-10 overflow-hidden">
          
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
            <button onClick={resetState} className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-500 rounded-2xl py-4 text-sm font-bold transition-colors border border-slate-100 shadow-sm">
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
                <div key={student.student_id} onClick={() => { ensureFullscreen(); setSelectedStudent(student); setStep("password"); setPasswordInput(""); }}
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
              <button onClick={() => { ensureFullscreen(); setPasswordInput(""); }} className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-500 rounded-2xl py-4 text-sm font-bold transition-colors border border-slate-100 shadow-sm">
                초기화
              </button>
              <button onClick={() => handlePinDigit('0')} className="bg-slate-50 hover:bg-blue-50 active:bg-blue-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                0
              </button>
              <button onClick={handlePinDelete} className="bg-slate-50 hover:bg-rose-50 active:bg-rose-100 text-rose-500 rounded-2xl py-4 flex items-center justify-center transition-colors border border-slate-100 shadow-sm">
                <IconDelete />
              </button>
            </div>
            
            <button onClick={() => { ensureFullscreen(); setStep("profile"); setPasswordInput(""); }} className="mt-8 text-sm text-slate-400 hover:text-slate-600 underline font-medium underline-offset-4">
              다른 프로필 선택하기
            </button>
          </div>
        );
      })()}

      {/* 4단계: 초기 비밀번호 설정 */}
      {step === "setup_pin" && pendingLoginData && (() => {
        const avatar = getAvatarFor(selectedStudent.student_id);
        return (
          <div className="bg-white w-full max-w-[420px] pt-12 pb-10 px-8 rounded-[32px] shadow-2xl border border-slate-200 animate-[fadeIn_0.3s_ease-out] flex flex-col items-center relative z-10 overflow-hidden">
            
            <button onClick={toggleFullScreen} className="absolute top-0 right-0 w-16 h-16 bg-transparent opacity-0 cursor-pointer z-50" title="전체화면 토글" />

            <div className={`w-20 h-20 rounded-full ${avatar.color.bg} flex items-center justify-center mb-4 shadow-sm ring-4 ring-emerald-100`}>
              <span className="text-4xl">{avatar.animal}</span>
            </div>
            <h2 className="text-xl font-extrabold text-emerald-600 mb-1">
              환영합니다, {selectedStudent.name} 학생!
            </h2>
            <p className="text-xs text-slate-500 font-bold mb-8 bg-slate-50 px-3 py-1.5 rounded-md border border-slate-100 text-center">
              앞으로 사용할 <span className="text-emerald-600">새 비밀번호 4자리</span>를<br/>지금 바로 설정해주세요.
            </p>

            <div className="flex gap-4 mb-6">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className={`w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-black transition-all border-2 ${newPinInput.length > idx ? 'border-emerald-500 text-emerald-500 bg-white shadow-sm' : 'border-slate-200 bg-slate-50 text-transparent'}`}>
                  {newPinInput[idx] ? '●' : ''}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full mt-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button key={num} onClick={() => handleNewPinDigit(num.toString())} className="bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                  {num}
                </button>
              ))}
              <button onClick={() => { ensureFullscreen(); setNewPinInput(""); }} className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-500 rounded-2xl py-4 text-sm font-bold transition-colors border border-slate-100 shadow-sm">
                초기화
              </button>
              <button onClick={() => handleNewPinDigit('0')} className="bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 rounded-2xl py-4 text-2xl font-bold transition-colors border border-slate-100 shadow-sm">
                0
              </button>
              <button onClick={handleNewPinDelete} className="bg-slate-50 hover:bg-rose-50 active:bg-rose-100 text-rose-500 rounded-2xl py-4 flex items-center justify-center transition-colors border border-slate-100 shadow-sm">
                <IconDelete />
              </button>
            </div>
          </div>
        );
      })()}
      
    </div>
  );
}