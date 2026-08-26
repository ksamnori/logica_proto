// src/app/kiosk/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// 학년 정렬 가중치
const GRADE_ORDER: Record<string, number> = {
  '고3': 1, '고2': 2, '고1': 3, '중3': 4, '중2': 5, '중1': 6,
  '초6': 7, '초5': 8, '초4': 9, '초3': 10, '초2': 11, '초1': 12
};

// 아이콘 컴포넌트
const IconUser = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>;
const IconCheck = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
const IconHome = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const IconAlert = () => <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>;
const IconX = () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;

export default function KioskPage() {
  const [digits, setDigits] = useState("");
  const [matchedList, setMatchedList] = useState<any[]>([]);
  // popup 상태: { name: 학생이름, type: 'in'(등원) | 'out'(하원) | 'already'(이미처리됨) }
  const [successPopup, setSuccessPopup] = useState<{ name: string; type: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 현재 시계 업데이트
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
    if (digits.length < 4 && !isProcessing) {
      const newDigits = digits + num;
      setDigits(newDigits);
      if (newDigits.length === 4) searchDBAndProcess(newDigits);
    }
  };

  // 💡 [핵심 구현] 꼬리표 절삭 및 학부모 폰번호 연동 다중 검색 로직
  const searchDBAndProcess = async (code: string) => {
    setIsProcessing(true);
    try {
      // 1. 넓은 범위로 포함된 번호를 검색 (단, '재원' 상태인 학생만)
      const { data: studentMatch, error: err1 } = await supabase
        .from('student')
        .select('student_id, name, grade, phone, parent(phone), enrollment(enrollment_id, class(class_id, name))')
        .eq('status', '재원')
        .like('phone', `%${code}%`);
      
      const { data: parentMatch, error: err2 } = await supabase
        .from('student')
        .select('student_id, name, grade, phone, parent!inner(phone), enrollment(enrollment_id, class(class_id, name))')
        .eq('status', '재원')
        .like('parent.phone', `%${code}%`);

      if (err1) console.error("학생조회 에러:", err1);
      if (err2) console.error("학부모조회 에러:", err2);

      // 💡 merged 배열과 item 매개변수에 any 타입을 명시하여 충돌을 방지합니다.
      let merged: any[] = [...(studentMatch || []), ...(parentMatch || [])];
      let uniqueMap = new Map();

      // 2. 검색된 넓은 범위 데이터 중 꼬리표(-1, -2)를 떼고 완벽히 매칭되는지 2차 검증
      merged.forEach((item: any) => {
        const extractCleanDigits = (phoneStr: string) => {
          if (!phoneStr) return "";
          // 꼬리표 제거 (-1, -2, -10 등)
          const withoutSuffix = phoneStr.replace(/-\d{1,2}$/, "");
          // 숫자만 남기기
          return withoutSuffix.replace(/[^0-9]/g, "");
        };

        const sPhoneCleaned = extractCleanDigits(item.phone);
        
        let rawPPhone = "";
        const parentObj = item.parent as any; // 💡 parent도 any로 처리
        if (parentObj && !Array.isArray(parentObj)) {
          rawPPhone = parentObj.phone || "";
        } else if (Array.isArray(parentObj)) {
          rawPPhone = parentObj[0]?.phone || "";
        }
        const pPhoneCleaned = extractCleanDigits(rawPPhone);

        // 정제된 번호가 사용자가 입력한 번호 4자리로 '끝나는지' 검증
        const isStudentMatch = sPhoneCleaned.endsWith(code);
        const isParentMatch = pPhoneCleaned.endsWith(code);

        if (isStudentMatch || isParentMatch) {
          uniqueMap.set(item.student_id, item);
        }
      });

      let matches = Array.from(uniqueMap.values());

      if (matches.length === 0) {
        alert('일치하는 번호가 없습니다.');
        setDigits('');
        setIsProcessing(false);
        return;
      }

      // 학년 역순 정렬
      matches.sort((a, b) => (GRADE_ORDER[a.grade] || 99) - (GRADE_ORDER[b.grade] || 99));

      if (matches.length === 1) {
        await completeAttendance(matches[0]);
      } else {
        // 학부모 번호나 꼬리표로 겹친 경우 목록 띄우기
        setMatchedList(matches);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error("DB 연동 에러:", error);
      alert("서버 연결에 문제가 발생했습니다.");
      setDigits('');
      setIsProcessing(false);
    }
  };

  const completeAttendance = async (student: any) => {
    setIsProcessing(true);
    try {
      // 한국 시간 기준 Today 날짜 구하기
      const now = new Date();
      const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const today = kstTime.toISOString().split('T')[0];
      const timestamp = new Date().toISOString();

      let enrollmentId = (student.enrollment && student.enrollment.length > 0) ? student.enrollment[0].enrollment_id : null; 
      let classId = getClassId(student);

      if (!classId || !enrollmentId) {
        const { data: fallback } = await supabase.from('enrollment').select('enrollment_id, class_id').limit(1).maybeSingle();
        if (fallback) {
          if (!enrollmentId) enrollmentId = fallback.enrollment_id;
          if (!classId) classId = fallback.class_id;
        }
      }

      // 오늘자 출결 기록이 있는지 확인
      const { data: existing } = await supabase
        .from('attendance')
        .select('*')
        .eq('student_id', student.student_id)
        .eq('attendance_date', today)
        .maybeSingle();

      let popupType = "in"; // 기본: 등원

      if (!existing) {
        // 기록 없음 -> 등원(출석) 처리
        await supabase.from('attendance').insert({
          student_id: student.student_id,
          class_id: classId,
          enrollment_id: enrollmentId, 
          attendance_date: today,
          status: '출석',
          check_in_time: timestamp
        });
      } else if (existing && !existing.check_out_time) {
        // 등원 기록은 있으나 하원 기록이 없음 -> 하원(종료) 처리
        await supabase.from('attendance').update({
          check_out_time: timestamp,
          status: '출석' 
        }).eq('attendance_id', existing.attendance_id);
        popupType = "out";
      } else if (existing && existing.check_out_time) {
        // 이미 등/하원 모두 완료된 경우
        popupType = "already";
      }

      setSuccessPopup({ name: student.name, type: popupType });

      // 3초 뒤에 초기화
      setTimeout(() => {
        setSuccessPopup(null);
        setDigits('');
        setMatchedList([]);
        setIsProcessing(false);
      }, 3000);

    } catch(e) {
      console.error("에러:", e);
      setSuccessPopup({ name: student.name, type: "in" });
      setTimeout(() => {
        setSuccessPopup(null);
        setDigits('');
        setMatchedList([]);
        setIsProcessing(false);
      }, 3000);
    }
  };

  // 팝업 종류별 UI 컴포넌트
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
          <div className="text-xl text-amber-600 font-bold">오늘은 이미 하원 처리되었습니다 ✨</div>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-12 bg-slate-100 font-pretendard select-none">
      <div className="flex w-[850px] h-[550px] bg-white rounded-[32px] shadow-2xl overflow-hidden relative border border-slate-200">
        
        {/* 결과 팝업 오버레이 */}
        {successPopup && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300">
            {renderPopupContent()}
          </div>
        )}

        {/* 로딩 오버레이 */}
        {isProcessing && !successPopup && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="text-[#002864] font-bold text-xl animate-pulse">DB 조회 및 처리 중...</div>
          </div>
        )}

        {/* 좌측 화면 (입력 피드백 및 학생 선택) */}
        <div className="w-1/2 flex flex-col p-10 bg-slate-50 justify-center relative">
          <div className="absolute bottom-8 left-10">
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-6 opacity-70 grayscale contrast-125" />
          </div>
          
          {matchedList.length > 0 ? (
            <div className="flex flex-col h-full mt-2 mb-8 animate-[fadeIn_0.3s_ease-out]">
              <div className="text-center text-xl font-bold text-slate-800 mb-6">출석할 학생을 선택해주세요</div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {matchedList.map(student => (
                  <button key={student.student_id} onClick={() => completeAttendance(student)}
                    className="w-full flex items-center p-5 bg-white rounded-2xl border-2 border-slate-200 hover:border-[#002864] hover:bg-blue-50 transition-all text-left group">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mr-4 group-hover:bg-blue-100 group-hover:text-[#002864] text-slate-400 transition-colors">
                      <IconUser />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-lg">{student.name} <span className="text-sm font-semibold text-[#002864] ml-1">({student.grade})</span></div>
                      <div className="text-sm text-slate-500 font-medium">{getClassName(student)}</div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => { setDigits(''); setMatchedList([]); }} className="mt-4 text-sm text-slate-400 hover:text-slate-600 underline font-medium">처음으로 돌아가기</button>
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
              <button onClick={() => { setDigits(''); setMatchedList([]); }} className="bg-[#152B69] hover:bg-[#11245A] active:bg-slate-900 text-[#85A1EB] rounded-2xl text-xl font-bold transition-colors">
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