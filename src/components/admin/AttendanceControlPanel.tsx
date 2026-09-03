// src/components/admin/AttendanceControlPanel.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

interface AttendanceControlPanelProps {
  classStats: any[];
  todayIso: string;
  onQueueMessage: (msg: any) => void;
}

export default function AttendanceControlPanel({ classStats, todayIso, onQueueMessage }: AttendanceControlPanelProps) {
  const [selectedAttClassId, setSelectedAttClassId] = useState<string>("");
  const [attStudents, setAttStudents] = useState<any[]>([]);
  const [activeAttMenu, setActiveAttMenu] = useState<string | null>(null);
  const [manualModalData, setManualModalData] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({ status: "NONE", checkIn: "", checkOut: "" });

  useEffect(() => {
    if (classStats.length > 0 && !selectedAttClassId) {
      setSelectedAttClassId(classStats[0].class_id);
    }
  }, [classStats, selectedAttClassId]);

  const fetchAttendance = async (classId: string) => {
    if (!classId) return;
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];

    const { data: enrollData } = await supabase.from("enrollment").select("student_id").eq("class_id", classId);
    const allTargetIds = Array.from(new Set(enrollData?.map((e: any) => e.student_id) || []));

    if (allTargetIds.length === 0) {
      setAttStudents([]);
      return;
    }

    const { data: classStudents } = await supabase
      .from("student")
      .select(`student_id, name, parent(name, phone), attendance(attendance_id, status, check_in_time, check_out_time, attendance_date)`)
      .eq("status", "재원")
      .in("student_id", allTargetIds);
    
    const mappedAtt = (classStudents || []).map((st: any) => {
      const todayAtt = st.attendance?.find((a: any) => a.attendance_date === today);
      const parentInfo = unwrap(st.parent);
      return { 
        id: st.student_id, 
        name: st.name, 
        parentPhone: parentInfo?.phone || "",
        parentName: parentInfo?.name || "",
        att_id: todayAtt?.attendance_id, 
        status: todayAtt?.status || "NONE", 
        checkIn: todayAtt?.check_in_time,
        checkOut: todayAtt?.check_out_time
      };
    });

    setAttStudents(mappedAtt.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
  };

  // 🌟 1. 수동 새로고침
  useEffect(() => {
    if (selectedAttClassId) fetchAttendance(selectedAttClassId);
    else setAttStudents([]);
  }, [selectedAttClassId]);

  // 🌟 2. [핵심] 키오스크 및 관리자 패널의 DB 변경 실시간 감지 -> 대기열 자동 등록
  useEffect(() => {
    const realtimeChannel = supabase
      .channel('global_attendance_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        async (payload) => {
          console.log("🔄 실시간 DB 변경 감지:", payload);
          
          // 현재 화면에 띄워진 반이라면 UI 즉시 새로고침
          if (selectedAttClassId) fetchAttendance(selectedAttClassId);

          const newRecord = payload.new as any;
          if (!newRecord || !newRecord.student_id) return;

          // 어떤 상태로 변경되었는지 판별
          let statusLabel = "";
          if (payload.eventType === 'INSERT') {
            if (newRecord.status === '출석') statusLabel = '출석(등원)';
            else if (newRecord.status === '지각') statusLabel = '지각(등원)';
            else if (newRecord.status === '결석') statusLabel = '결석';
            else statusLabel = newRecord.status;
          } else if (payload.eventType === 'UPDATE') {
            if (newRecord.status === '조퇴') statusLabel = '조퇴(하원)';
            else if (newRecord.check_out_time) statusLabel = '수업 종료(하원)';
            else if (newRecord.status === '결석') statusLabel = '결석';
            else return; // 단순 업데이트는 무시
          } else {
            return;
          }

          // 해당 학생과 학부모 정보 즉시 조회
          const { data: stData } = await supabase
            .from("student")
            .select("name, parent(name, phone)")
            .eq("student_id", newRecord.student_id)
            .single();

          if (stData) {
            const parentInfo = unwrap(stData.parent);
            const parentPhone = parentInfo?.phone || "";
            if (!parentPhone) return;

            const isValidParentName = parentInfo?.name && parentInfo.name.trim() !== "" && parentInfo.name !== "미입력";
            const displayParentName = isValidParentName ? parentInfo.name : stData.name;

            const targetTime = newRecord.check_out_time || newRecord.check_in_time || Date.now();
            const nowStr = new Date(targetTime).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
            const todayIsoStr = new Date(newRecord.attendance_date).toISOString().split('T')[0];
            const timeString = `${todayIsoStr.replace(/-/g, '.')} ${nowStr}`;

            // 식별자를 '학생ID_상태' 로 고정하여 중복 방지
            onQueueMessage({
              id: `${newRecord.student_id}_${statusLabel}`, 
              parentPhone: parentPhone,
              parentName: displayParentName,
              studentName: stData.name,
              timeString: timeString,
              statusLabel: statusLabel,
              templateId: "KA01TP260826014520504X1Fplf8R0FH" 
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [selectedAttClassId, todayIso]);

  const attSummary = useMemo(() => {
    let total = 0, present = 0, earlyLeave = 0, absent = 0;
    attStudents.forEach(st => {
      total++;
      if (st.status === "결석") absent++;
      else if (st.status === "조퇴") earlyLeave++;
      else if (["출석", "지각"].includes(st.status)) present++;
    });
    return { total, present, leave: earlyLeave, absent };
  }, [attStudents]);

  // 대시보드 조작 함수 (여기서는 DB 조작만 수행. 알림톡 처리는 위 실시간 감지가 알아서 함)
  const handleAttAction = async (student: any, action: string) => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const nowTimestamp = new Date().toISOString();
    let payload: any = {};

    if (action === "ABSENT" && student.status !== "결석") {
      if (!confirm(`[${student.name}] 학생을 '결석' 처리하시겠습니까?`)) return;
    }

    if (action === "DELETE") {
      if (!confirm(`[${student.name}] 학생의 오늘 출결 기록을 초기화(삭제)하시겠습니까?`)) return;
      if (student.att_id) await supabase.from("attendance").delete().eq("attendance_id", student.att_id);
      fetchAttendance(selectedAttClassId);
      return;
    }

    if (action === "PRESENT") {
      payload = { status: "출석" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "LATE") {
      payload = { status: "지각" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "ABSENT") {
      payload = { status: "결석", check_in_time: null, check_out_time: null };
    } else if (action === "EARLY_LEAVE") {
      payload = { status: "조퇴" };
      if (!student.checkOut) payload.check_out_time = nowTimestamp;
    } else if (action === "ENDED") {
      payload = { check_out_time: nowTimestamp };
    }

    try {
      if (student.att_id) {
        await supabase.from("attendance").update(payload).eq("attendance_id", student.att_id);
      } else {
        const { data: fallback } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", student.id).eq("class_id", selectedAttClassId).maybeSingle();
        await supabase.from("attendance").insert({
          student_id: student.id, class_id: selectedAttClassId, enrollment_id: fallback?.enrollment_id || null, attendance_date: today, ...payload
        });
      }
    } catch (e) { console.error(e); } 
  };

  const bulkAttend = async () => {
    if (!confirm('현재 미처리된 모든 학생을 "출석" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => s.status === "NONE");
    for (const s of toUpdate) await handleAttAction(s, "PRESENT");
  };

  const bulkEnd = async () => {
    if (!confirm('현재 출석/지각 학생을 모두 "수업 종료" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => ["출석", "지각"].includes(s.status) && !s.checkOut);
    for (const s of toUpdate) await handleAttAction(s, "ENDED");
  };

  const formatTimeForInput = (isoStr: string) => {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const openManualModal = (student: any) => {
    setManualModalData(student);
    setManualForm({
      status: student.status === "NONE" ? "출석" : student.status,
      checkIn: formatTimeForInput(student.checkIn),
      checkOut: formatTimeForInput(student.checkOut)
    });
    setActiveAttMenu(null);
  };

  const handleManualSave = async () => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const toIsoString = (timeStr: string) => {
      if (!timeStr) return null;
      const [hh, mm] = timeStr.split(':');
      const d = new Date(`${today}T${hh}:${mm}:00+09:00`);
      return d.toISOString();
    };

    const { status, checkIn, checkOut } = manualForm;

    try {
      if (status === "NONE") {
        if (manualModalData.att_id) await supabase.from("attendance").delete().eq("attendance_id", manualModalData.att_id);
      } else {
        const payload: any = { status, check_in_time: toIsoString(checkIn), check_out_time: toIsoString(checkOut) };
        if (status === "결석") { payload.check_in_time = null; payload.check_out_time = null; }

        if (manualModalData.att_id) {
          await supabase.from("attendance").update(payload).eq("attendance_id", manualModalData.att_id);
        } else {
          const { data: fallback } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", manualModalData.id).eq("class_id", selectedAttClassId).maybeSingle();
          await supabase.from("attendance").insert({
            student_id: manualModalData.id, class_id: selectedAttClassId, enrollment_id: fallback?.enrollment_id || null, attendance_date: today, ...payload
          });
        }
      }
      alert("✅ 출결이 성공적으로 수동 반영되었습니다.");
    } catch (e) { alert("❌ 업데이트 중 오류가 발생했습니다."); } 
    finally { setManualModalData(null); }
  };

  return (
    <>
      <div className="mb-6">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-2xl border shadow-sm relative z-10">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <span>⏰</span> 전체 수강반 출결 중앙 제어 <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded ml-2">ADMIN 전용</span>
          </h3>
          
          <select 
            value={selectedAttClassId} 
            onChange={e => setSelectedAttClassId(e.target.value)}
            className="border border-indigo-300 rounded-lg py-1.5 px-3 text-xs font-bold text-indigo-900 bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm w-[250px]"
          >
            <option value="">수강반을 선택하세요...</option>
            {classStats.map(c => (
              <option key={c.class_id} value={c.class_id}>{c.name} ({c.instructor?.name || '미정'})</option>
            ))}
          </select>
        </div>
        
        <div className="flex flex-col lg:flex-row bg-white border border-t-0 border-slate-200 rounded-b-2xl shadow-sm overflow-hidden h-[380px]">
          
          <div className="w-full lg:w-[300px] bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-5 flex flex-col gap-5 flex-1">
              <div>
                <span className="text-[11px] font-bold text-slate-500 mb-2 block">오늘의 출결 요약</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm">
                    <span className="text-xs font-bold text-slate-400">전체</span>
                    <span className="text-xl font-black text-slate-800">{attSummary.total}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm">
                    <span className="text-xs font-bold text-slate-400">출석/지각</span>
                    <span className="text-xl font-black text-blue-600">{attSummary.present}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm">
                    <span className="text-xs font-bold text-slate-400">조퇴</span>
                    <span className="text-xl font-black text-indigo-500">{attSummary.leave}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm">
                    <span className="text-xs font-bold text-slate-400">결석</span>
                    <span className="text-xl font-black text-rose-500">{attSummary.absent}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex-1"></div>
              
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-slate-500 mb-0.5">일괄 출결 처리</span>
                <button onClick={bulkAttend} disabled={!selectedAttClassId} className="w-full text-xs font-bold bg-[#002864] text-white py-3 rounded-xl hover:bg-blue-900 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                  🚀 미처리 학생 전체 출석
                </button>
                <button onClick={bulkEnd} disabled={!selectedAttClassId} className="w-full text-xs font-bold bg-slate-700 text-white py-3 rounded-xl hover:bg-slate-900 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                  🏁 출석 학생 전체 수업 종료
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 p-5 overflow-y-auto custom-scroll bg-slate-50/50">
            {!selectedAttClassId ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                <span className="text-5xl opacity-40">👆</span>
                <span className="font-bold text-sm">상단의 드롭다운에서 출결을 관리할 수강반을 선택해주세요.</span>
              </div>
            ) : attStudents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">해당 반에 조회된 학생이 없습니다.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 pb-4">
                {attStudents.map(student => {
                  const isPresent = student.status === '출석';
                  const isAbsent = student.status === '결석';
                  const isLate = student.status === '지각';
                  const isEarlyLeave = student.status === '조퇴';
                  const isMenuOpen = activeAttMenu === student.id;

                  const timeInStr = student.checkIn ? new Date(student.checkIn).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";
                  const timeOutStr = student.checkOut ? new Date(student.checkOut).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";

                  return (
                    <div key={student.id} className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-center text-xs shadow-sm hover:border-indigo-300 transition-colors relative gap-3 min-h-[125px]">
                      <div className="flex justify-between items-center w-full">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 font-black text-sm">
                            {student.name.charAt(0)}
                          </div>
                          <span className="font-extrabold text-slate-800 text-[13px]">{student.name}</span>
                        </div>

                        <div className="relative inline-block shrink-0 kebab-container">
                          <button onClick={() => setActiveAttMenu(isMenuOpen ? null : student.id)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
                          </button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-8 w-32 bg-white shadow-xl rounded-xl border border-slate-200 z-50 py-1">
                              <button onClick={() => openManualModal(student)} className="w-full text-left px-4 py-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">⚙️ 수동 설정</button>
                              <hr className="border-slate-100 my-0.5" />
                              <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'DELETE'); }} className="w-full text-left px-4 py-2.5 text-[11px] font-bold text-rose-500 hover:bg-slate-50 flex items-center gap-2">🗑️ 기록 삭제</button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center w-full rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                        <button onClick={() => handleAttAction(student, 'PRESENT')} className={`flex-1 py-2.5 text-xs font-black transition-colors ${isPresent ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>출석</button>
                        <div className="w-px bg-slate-200 h-6"></div>
                        <button onClick={() => handleAttAction(student, 'ABSENT')} className={`flex-1 py-2.5 text-xs font-black transition-colors ${isAbsent ? 'bg-rose-400 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>결석</button>
                        <div className="w-px bg-slate-200 h-6"></div>
                        <button onClick={() => handleAttAction(student, 'LATE')} className={`flex-1 py-2.5 text-xs font-black transition-colors ${isLate ? 'bg-amber-400 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>지각</button>
                        <div className="w-px bg-slate-200 h-6"></div>
                        <button onClick={() => handleAttAction(student, 'EARLY_LEAVE')} className={`flex-1 py-2.5 text-xs font-black transition-colors ${isEarlyLeave ? 'bg-indigo-400 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>조퇴</button>
                      </div>

                      <div className="flex items-center justify-between h-[24px]">
                        <div className="flex items-center gap-2">
                          {(isPresent || isLate) && (
                             <span className={`text-[10px] font-black ${isLate ? 'text-amber-500' : 'text-emerald-600'}`}>{timeInStr} {isLate ? '지각' : '출석'}</span>
                          )}
                          {isEarlyLeave && (
                             <span className="text-[10px] font-black text-indigo-500">{timeOutStr} 조퇴</span>
                          )}
                        </div>

                        <div className="flex items-center">
                           {(isPresent || isLate) && !student.checkOut && (
                              <button onClick={() => handleAttAction(student, 'ENDED')} className="px-3 py-1 bg-slate-700 text-white text-[10px] font-extrabold rounded-md shadow-sm hover:bg-slate-900 transition-colors">수업종료</button>
                           )}
                           {student.checkOut && !isEarlyLeave && (
                              <span className="text-[10px] bg-slate-800 text-white px-2.5 py-1 rounded-md font-black shadow-sm flex items-center gap-1">
                                <span className="text-emerald-400">✓</span> 종료 <span className="text-slate-300 font-bold ml-0.5">{timeOutStr}</span>
                              </span>
                           )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {manualModalData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-black text-slate-800 mb-5 border-b border-slate-100 pb-3 flex items-center gap-2">⚙️ 수동 출결 설정 <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded ml-auto">{manualModalData.name}</span></h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-500 mb-1.5">출석 상태</label>
                <select value={manualForm.status} onChange={e => setManualForm({...manualForm, status: e.target.value})} className="border border-slate-300 p-2.5 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864] bg-slate-50">
                  <option value="출석">✅ 출석</option>
                  <option value="결석">❌ 결석</option>
                  <option value="지각">⏰ 지각</option>
                  <option value="조퇴">🏃 조퇴</option>
                  <option value="NONE">🗑️ 미처리 (초기화)</option>
                </select>
              </div>

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">출석(시작) 시간</label>
                  <input type="time" value={manualForm.checkIn} onChange={e => setManualForm({...manualForm, checkIn: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864]" />
                </div>
              )}

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">조퇴/종료 시간</label>
                  <input type="time" value={manualForm.checkOut} onChange={e => setManualForm({...manualForm, checkOut: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864]" />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-8">
              <button onClick={() => setManualModalData(null)} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-colors">취소</button>
              <button onClick={handleManualSave} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-xl text-sm shadow-md transition-colors">저장하기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}