// src/app/kiosk/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

const CHECKOUT_COOLDOWN_MIN = 3;

const GRADE_ORDER: Record<string, number> = {
  '고3': 1, '고2': 2, '고1': 3, '중3': 4, '중2': 5, '중1': 6,
  '초6': 7, '초5': 8, '초4': 9, '초3': 10, '초2': 11, '초1': 12
};

const playSuccessSound = (type: string) => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const t = ctx.currentTime;
    if (type === 'out') {
      playTone(587.33, t, 0.15); // D5
      playTone(523.25, t + 0.15, 0.3); // C5
    } else {
      playTone(523.25, t, 0.1); // C5
      playTone(659.25, t + 0.1, 0.1); // E5
      playTone(783.99, t + 0.2, 0.3); // G5
    }
  } catch (e) {
    console.error("Audio playback failed:", e);
  }
};

const IconUser = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>;
const IconCheck = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
const IconHome = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const IconAlert = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>;
const IconX = () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
const IconQuestion = () => <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;

export default function KioskPage() {
  const [digits, setDigits] = useState("");
  const [matchedList, setMatchedList] = useState<any[]>([]);
  const [confirmStudent, setConfirmStudent] = useState<any>(null);
  const [successPopup, setSuccessPopup] = useState<{ name: string; type: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const logoClickCountRef = useRef(0);
  const logoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetState = useCallback(() => {
    setSuccessPopup(null);
    setConfirmStudent(null);
    setDigits('');
    setMatchedList([]);
    setIsProcessing(false);
  }, []);

  useEffect(() => {
    let idleTimer: NodeJS.Timeout;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      if ((digits || matchedList.length > 0 || confirmStudent) && !successPopup && !isProcessing) {
        idleTimer = setTimeout(() => {
          resetState();
        }, 15000);
      }
    };
    window.addEventListener('pointerdown', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    resetIdleTimer();
    return () => {
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
      clearTimeout(idleTimer);
    };
  }, [digits, matchedList, confirmStudent, successPopup, isProcessing, resetState]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getClassName = (student: any) => {
    if (student.enrollment && student.enrollment.length > 0 && student.enrollment[0].class) {
      return student.enrollment[0].class.name;
    }
    return '반 미배정';
  };

  const getClassId = (student: any) => {
    if (student.enrollment && student.enrollment.length > 0 && student.enrollment[0].class) {
      return student.enrollment[0].class.class_id;
    }
    return null;
  };

  const handleDigit = (num: string) => {
    if (isProcessing || confirmStudent) return;
    if (digits.length < 4) {
      const newDigits = digits + num;
      setDigits(newDigits);
      if (newDigits.length === 4) searchDBAndProcess(newDigits);
    }
  };

  const queueAlimtalk = (student: any, statusLabel: string, timeString: string) => {
    const parentObj = Array.isArray(student.parent) ? student.parent[0] : student.parent;
    const parentPhone = parentObj?.phone;
    if (!parentPhone) return;

    const isValidParentName = parentObj?.name && parentObj.name.trim() !== "" && parentObj.name !== "미입력";
    const parentName = isValidParentName ? parentObj.name : student.name;

    const newMsg = {
      id: `att_${student.student_id}_${statusLabel}`, 
      templateId: 'KA01TP260826014520504X1Fplf8R0FH',
      studentName: student.name,
      parentName: parentName,
      parentPhone: parentPhone,
      statusLabel,
      timeString,
      previewTitle: `[출결] ${statusLabel}`,
      previewDesc: `${parentPhone} • ${timeString}`
    };

    try {
      const rawLocal = localStorage.getItem("logica_queued_messages");
      let currentQueue: any[] = [];
      if (rawLocal) {
        currentQueue = JSON.parse(rawLocal);
      }
      const filtered = currentQueue.filter((m: any) => m.id !== newMsg.id);
      const nextQueue = [...filtered, newMsg];

      localStorage.setItem("logica_queued_messages", JSON.stringify(nextQueue));
      window.dispatchEvent(new Event('storage'));
    } catch (e) {
      console.error("대기열 저장 중 오류:", e);
    }
  };

  const searchDBAndProcess = async (code: string) => {
    setIsProcessing(true);
    try {
      const kioskTenantId = process.env.NEXT_PUBLIC_KIOSK_TENANT_ID || '';

      let studentQuery = supabase
        .from('student')
        .select('student_id, name, grade, phone, parent(name, phone), enrollment(enrollment_id, class(class_id, name))')
        .eq('status', '재원')
        .like('phone', `%${code}%`);
      if (kioskTenantId) studentQuery = studentQuery.eq('tenant_id', kioskTenantId);
      const { data: studentMatch, error: err1 } = await studentQuery;

      let parentQuery = supabase
        .from('student')
        .select('student_id, name, grade, phone, parent!inner(name, phone), enrollment(enrollment_id, class(class_id, name))')
        .eq('status', '재원')
        .like('parent.phone', `%${code}%`);
      if (kioskTenantId) parentQuery = parentQuery.eq('tenant_id', kioskTenantId);
      const { data: parentMatch, error: err2 } = await parentQuery;

      if (err1) console.error("학생조회 에러:", err1);
      if (err2) console.error("학부모조회 에러:", err2);

      let merged: any[] = [...(studentMatch || []), ...(parentMatch || [])];
      let uniqueMap = new Map();

      merged.forEach((item: any) => {
        const extractCleanDigits = (phoneStr: string) => {
          if (!phoneStr) return "";
          const withoutSuffix = phoneStr.replace(/-\d{1,2}$/, "");
          return withoutSuffix.replace(/[^0-9]/g, "");
        };

        const sPhoneCleaned = extractCleanDigits(item.phone);
        let rawPPhone = "";
        const parentObj = item.parent as any; 
        if (parentObj && !Array.isArray(parentObj)) {
          rawPPhone = parentObj.phone || "";
        } else if (Array.isArray(parentObj)) {
          rawPPhone = parentObj[0]?.phone || "";
        }
        const pPhoneCleaned = extractCleanDigits(rawPPhone);

        const isStudentMatch = sPhoneCleaned.endsWith(code);
        const isParentMatch = pPhoneCleaned.endsWith(code);

        if (isStudentMatch || isParentMatch) {
          uniqueMap.set(item.student_id, item);
        }
      });

      let matches = Array.from(uniqueMap.values());

      if (matches.length === 0) {
        alert('일치하는 번호가 없습니다.');
        resetState();
        return;
      }

      matches.sort((a, b) => (GRADE_ORDER[a.grade] || 99) - (GRADE_ORDER[b.grade] || 99));

      if (matches.length === 1) {
        setConfirmStudent(matches[0]);
      } else {
        setMatchedList(matches);
      }
      setIsProcessing(false);
      
    } catch (error) {
      console.error("DB 연동 에러:", error);
      alert("서버 연결에 문제가 발생했습니다.");
      resetState();
    }
  };

  const completeAttendance = async (student: any) => {
    setIsProcessing(true);
    setConfirmStudent(null); 

    try {
      const now = new Date();
      const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const today = kstTime.toISOString().split('T')[0];
      const timestamp = new Date().toISOString();
      const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

      let enrollmentId = (student.enrollment && student.enrollment.length > 0) ? student.enrollment[0].enrollment_id : null;
      let classId = getClassId(student);

      const { data: rawRecords, error: fetchError } = await supabase
        .from('attendance')
        .select('*')
        .eq('student_id', student.student_id)
        .eq('attendance_date', today);

      if (fetchError) throw fetchError;

      // 🌟 Kiosk에서도 절대 정렬(attendance_id) 방식으로 가장 최신 출결을 뽑아냅니다.
      const todayRecords = rawRecords || [];
      todayRecords.sort((a, b) => a.attendance_id - b.attendance_id);

      const latest = todayRecords.length > 0 ? todayRecords[todayRecords.length - 1] : null;

      let popupType = "in"; 
      let statusLabelForAlimtalk = "등원"; 

      if (!latest) {
        // 🌟 무조건 '등원' 텍스트 사용
        const { error: insertError } = await supabase.from('attendance').insert({
          student_id: student.student_id,
          class_id: classId,
          enrollment_id: enrollmentId,
          attendance_date: today,
          status: '등원',
          check_in_time: timestamp
        });
        if (insertError) throw insertError; 

      } else if (!latest.check_out_time) {
        const minutesSinceCheckIn = (now.getTime() - new Date(latest.check_in_time).getTime()) / 60000;
        if (minutesSinceCheckIn < CHECKOUT_COOLDOWN_MIN) {
          const remaining = Math.ceil(CHECKOUT_COOLDOWN_MIN - minutesSinceCheckIn);
          alert(`등원 후 ${CHECKOUT_COOLDOWN_MIN}분이 지나야 하원할 수 있습니다. (${remaining}분 남음)`);
          resetState();
          return;
        }

        const { error: updateError } = await supabase.from('attendance').update({
          check_out_time: timestamp,
          status: '하원'
        }).eq('attendance_id', latest.attendance_id);
        if (updateError) throw updateError; 
        
        popupType = "out";
        statusLabelForAlimtalk = "하원"; 

      } else {
        const { error: reentryError } = await supabase.from('attendance').insert({
          student_id: student.student_id,
          class_id: classId,
          enrollment_id: enrollmentId,
          attendance_date: today,
          status: '등원',
          check_in_time: timestamp
        });
        if (reentryError) throw reentryError; 

        popupType = "reentry";
        statusLabelForAlimtalk = "등원"; 
      }

      queueAlimtalk(student, statusLabelForAlimtalk, timeStr);
      playSuccessSound(popupType);
      setSuccessPopup({ name: student.name, type: popupType });
      
      setTimeout(() => {
        resetState();
      }, 3000);

    } catch (e: any) {
      console.error("출결 처리 DB 에러:", e);
      alert(`출결 처리 중 오류가 발생했습니다.\n(사유: ${e.message || 'DB 연결 오류'})`);
      resetState();
    }
  };

  const handleLogoClick = () => {
    logoClickCountRef.current += 1;
    if (logoTimeoutRef.current) clearTimeout(logoTimeoutRef.current);

    if (logoClickCountRef.current >= 5) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      window.location.reload();
    } else {
      logoTimeoutRef.current = setTimeout(() => {
        logoClickCountRef.current = 0;
      }, 1500);
    }
  };

  const renderPopupContent = () => {
    if (!successPopup) return null;
    if (successPopup.type === "in") {
      return (
        <div className="bg-white rounded-[32px] px-16 py-12 flex flex-col items-center shadow-2xl animate-[bounce_0.5s_ease-in-out]">
          <div className="text-[#152B69] mb-5"><IconCheck /></div>
          <div className="text-3xl font-extrabold text-slate-800 mb-2">{successPopup.name} <span className="font-bold text-2xl text-slate-500">학생</span></div>
          <div className="text-xl text-[#152B69] font-bold">등원 처리가 완료되었습니다 👏</div>
        </div>
      );
    } else if (successPopup.type === "out") {
      return (
        <div className="bg-white rounded-[32px] px-16 py-12 flex flex-col items-center shadow-2xl animate-[bounce_0.5s_ease-in-out]">
          <div className="text-emerald-500 mb-5"><IconHome /></div>
          <div className="text-3xl font-extrabold text-slate-800 mb-2">{successPopup.name} <span className="font-bold text-2xl text-slate-500">학생</span></div>
          <div className="text-xl text-emerald-600 font-bold">하원 처리가 완료되었습니다 🏠</div>
        </div>
      );
    } else {
      return (
        <div className="bg-white rounded-[32px] px-16 py-12 flex flex-col items-center shadow-2xl animate-[bounce_0.5s_ease-in-out]">
          <div className="text-amber-500 mb-5"><IconAlert /></div>
          <div className="text-3xl font-extrabold text-slate-800 mb-2">{successPopup.name} <span className="font-bold text-2xl text-slate-500">학생</span></div>
          <div className="text-xl text-amber-600 font-bold">재등원 처리가 완료되었습니다 🔁</div>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-12 bg-slate-100 font-pretendard select-none">
      <div className="flex w-[850px] h-[550px] bg-white rounded-[32px] shadow-2xl overflow-hidden relative border border-slate-200">
        
        {successPopup && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300">
            {renderPopupContent()}
          </div>
        )}

        {confirmStudent && !successPopup && !isProcessing && (
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-40 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white rounded-3xl p-10 flex flex-col items-center shadow-2xl w-[400px]">
              <div className="text-[#002864] mb-4"><IconQuestion /></div>
              <div className="text-center mb-8">
                <div className="text-3xl font-extrabold text-slate-800 mb-2">
                  {confirmStudent.name} <span className="font-bold text-2xl text-slate-500">학생</span>
                </div>
                <div className="text-lg text-slate-600 font-medium">본인이 맞습니까?</div>
              </div>
              
              <div className="flex w-full gap-4">
                <button 
                  onClick={resetState} 
                  className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-lg transition-colors"
                >
                  아니오
                </button>
                <button 
                  onClick={() => completeAttendance(confirmStudent)} 
                  className="flex-1 py-4 bg-[#152B69] hover:bg-[#002864] text-white font-bold rounded-xl text-lg transition-colors shadow-md"
                >
                  네, 맞습니다
                </button>
              </div>
            </div>
          </div>
        )}

        {isProcessing && !successPopup && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="text-[#002864] font-bold text-xl animate-pulse">DB 조회 및 처리 중...</div>
          </div>
        )}

        {/* 좌측 화면 */}
        <div className="w-1/2 flex flex-col p-10 bg-slate-50 justify-center relative">
          <div className="absolute bottom-8 left-10 z-50">
            <img 
              onClick={handleLogoClick} 
              src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" 
              alt="Logica" 
              className="h-6 opacity-70 grayscale contrast-125 cursor-pointer" 
            />
          </div>
          
          {matchedList.length > 0 ? (
            <div className="flex flex-col h-full mt-2 mb-8 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-center text-xl font-bold text-slate-800 mb-6">출석할 학생을 선택해주세요</div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {matchedList.map(student => (
                  <button key={student.student_id} onClick={() => setConfirmStudent(student)}
                    className="w-full flex items-center p-5 bg-white rounded-2xl border-2 border-slate-200 hover:border-[#002864] hover:bg-blue-50 transition-all text-left group">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mr-4 group-hover:bg-blue-100 group-hover:text-[#002864] text-slate-400 transition-colors">
                      <IconUser />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-lg">
                        {student.name} <span className="text-base font-extrabold text-[#e11d48] ml-1">[{student.grade}]</span>
                      </div>
                      <div className="text-sm text-slate-500 font-medium">{getClassName(student)}</div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={resetState} className="mt-4 text-sm text-slate-400 hover:text-slate-600 underline font-medium">처음으로 돌아가기</button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <h2 className="text-[#002864] font-extrabold text-2xl mb-1">휴대폰번호 뒤 4자리를</h2>
              <h2 className="text-slate-800 font-bold text-2xl mb-10">입력해주세요</h2>
              <div className="flex gap-4">
                {[0, 1, 2, 3].map((idx) => (
                  <div key={idx} className={`w-16 h-20 rounded-2xl flex items-center justify-center text-4xl font-black transition-all border-[3px] ${digits.length > idx ? 'border-[#002864] text-[#002864] bg-white shadow-md' : 'border-slate-200 bg-white text-transparent'}`}>
                    {digits[idx] ? '●' : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 우측 화면 (시계 및 키패드) */}
        <div className="w-1/2 flex flex-col bg-white">
          <div className="h-[35%] flex flex-col items-center justify-center border-b border-slate-100">
            <div className="text-sm font-bold text-slate-400 mb-2">
              {currentTime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </div>
            <div className="text-5xl font-black text-slate-800 tracking-tight">
              {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div className="h-[65%] bg-[#002864] p-6 flex flex-col justify-center">
            <div className="grid grid-cols-3 gap-3 h-full">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button key={num} onClick={() => handleDigit(num.toString())} className="bg-[#2A4B9F] hover:bg-[#3B5BBA] active:bg-[#152B69] text-white rounded-2xl text-3xl font-bold transition-colors">
                  {num}
                </button>
              ))}
              <button onClick={() => setDigits(digits.slice(0, -1))} className="bg-[#152B69] hover:bg-[#11245A] active:bg-slate-900 text-white rounded-2xl flex items-center justify-center transition-colors">
                <IconX />
              </button>
              <button onClick={() => handleDigit('0')} className="bg-[#2A4B9F] hover:bg-[#3B5BBA] active:bg-[#152B69] text-white rounded-2xl text-3xl font-bold transition-colors">
                0
              </button>
              <button onClick={resetState} className="bg-[#152B69] hover:bg-[#11245A] active:bg-slate-900 text-[#85A1EB] rounded-2xl text-xl font-bold transition-colors">
                초기화
              </button>
            </div>
          </div>
        </div>

      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
      `}} />
    </div>
  );
}