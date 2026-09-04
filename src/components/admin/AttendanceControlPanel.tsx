// src/components/admin/AttendanceControlPanel.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const getKSTDateStr = (offsetDays = 0) => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000) + (offsetDays * 86400000));
  return kst.toISOString().split('T')[0];
};

const formatTimeAsKST = (isoStr: string) => {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
};

interface AttendanceControlPanelProps {
  classStats: any[];
  todayIso: string;
  onQueueMessage: (msgOrMsgs: any | any[]) => void;
}

export default function AttendanceControlPanel({ classStats, todayIso, onQueueMessage }: AttendanceControlPanelProps) {
  const [selectedAttClassId, setSelectedAttClassId] = useState<string>("all");
  const [attStudents, setAttStudents] = useState<any[]>([]);
  const [activeAttMenu, setActiveAttMenu] = useState<string | null>(null);
  const [manualModalData, setManualModalData] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({ status: "NONE", checkIn: "", checkOut: "" });

  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  const fetchTimeoutRef = useRef<any>(null);
  const isBulkProcessing = useRef<boolean>(false);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('.kebab-container')) return;
      setActiveAttMenu(null);
    };

    document.addEventListener("mousedown", closeMenu);
    return () => { document.removeEventListener("mousedown", closeMenu); };
  }, []);

  useEffect(() => {
    const savedMode = localStorage.getItem("logica_att_view_mode");
    if (savedMode === "list" || savedMode === "card") {
      setViewMode(savedMode);
    }
  }, []);

  const handleViewModeChange = (mode: "card" | "list") => {
    setViewMode(mode);
    localStorage.setItem("logica_att_view_mode", mode);
  };

  const requestFetch = (classId: string) => {
    if (isBulkProcessing.current) return; 
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      fetchAttendance(classId);
    }, 800); 
  };

  const fetchAttendance = async (classId: string) => {
    if (!classId) return;
    const today = getKSTDateStr();
    const yesterday = getKSTDateStr(-1);
    const tId = localStorage.getItem("logica_tenant_id");

    let stQuery = supabase.from("student").select(`
      student_id, name, status, parent(name, phone), 
      attendance(attendance_id, status, check_in_time, check_out_time, attendance_date),
      enrollment(enrollment_id, class_id, class(name))
    `).eq("status", "재원");
    
    if (tId && tId !== 'hq') stQuery = stQuery.eq("tenant_id", tId);

    const clinicQuery = supabase
      .from("clinic_session_state")
      .select("student_id, ended_at, started_at, last_seen_at, session_date")
      .in("session_date", [today, yesterday]);

    const [stRes, clinicRes] = await Promise.all([stQuery, clinicQuery]);
    
    if (stRes.error || !stRes.data) {
      console.error("데이터 로딩 오류:", stRes.error);
      setAttStudents([]);
      return;
    }

    const todayClinics = clinicRes.data || [];
    let targetStudents = stRes.data;
    
    if (classId !== "all") {
      targetStudents = stRes.data.filter(st => 
        st.enrollment && st.enrollment.some((e: any) => e.class_id === classId)
      );
    }

    const mappedAtt = targetStudents.map((st: any) => {
      const todayAtt = st.attendance?.find((a: any) => a.attendance_date === today);
      const parentInfo = unwrap(st.parent);
      
      let mainEnroll = st.enrollment && st.enrollment.length > 0 ? st.enrollment[0] : null;
      if (classId !== "all" && st.enrollment) {
         mainEnroll = st.enrollment.find((e:any) => e.class_id === classId) || mainEnroll;
      }

      const className = mainEnroll?.class ? unwrap(mainEnroll.class)?.name : "미배정";
      let currentStatus = todayAtt?.status || "NONE";

      const studentClinics = todayClinics.filter(c => String(c.student_id) === String(st.student_id));
      const isActiveInClinic = studentClinics.some(c => {
          if (c.ended_at) return false; 
          const targetTime = c.last_seen_at || c.started_at;
          if (!targetTime) return false;
          return (Date.now() - new Date(targetTime).getTime()) < 3 * 60 * 1000;
      });

      if (isActiveInClinic && !['하원', '조퇴'].includes(currentStatus)) {
          currentStatus = "클리닉중";
      }
      
      return { 
        id: st.student_id, 
        name: st.name, 
        className: className,
        classId: mainEnroll?.class_id || null,
        enrollId: mainEnroll?.enrollment_id || null,
        parentPhone: parentInfo?.phone || "",
        parentName: parentInfo?.name || "",
        att_id: todayAtt?.attendance_id, 
        status: currentStatus, 
        checkIn: todayAtt?.check_in_time,
        checkOut: todayAtt?.check_out_time
      };
    });

    setAttStudents(mappedAtt.sort((a: any, b: any) => {
      if (a.className !== b.className) return (a.className || "").localeCompare(b.className || "");
      return (a.name || "").localeCompare(b.name || "");
    }));
  };

  useEffect(() => {
    if (selectedAttClassId) {
      requestFetch(selectedAttClassId);
      
      const syncInterval = setInterval(() => {
        if (!isBulkProcessing.current) {
          fetchAttendance(selectedAttClassId);
        }
      }, 5000);

      return () => clearInterval(syncInterval);
    } else {
      setAttStudents([]);
    }
  }, [selectedAttClassId]);

  useEffect(() => {
    const attChannel = supabase
      .channel('global_attendance_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        async (payload) => {
          if (isBulkProcessing.current) return; 
          if (selectedAttClassId) requestFetch(selectedAttClassId);

          const newRecord = payload.new as any;
          if (!newRecord || !newRecord.student_id) return;

          let statusLabel = "";
          if (['출석', '등원'].includes(newRecord.status)) statusLabel = '등원';
          else if (newRecord.status === '지각') statusLabel = '지각';
          else if (newRecord.status === '결석') statusLabel = '결석';
          else if (newRecord.status === '조퇴') statusLabel = '조퇴';
          else if (newRecord.status === '하원') statusLabel = '하원';
          else return; 

          const { data: stData } = await supabase.from("student").select("name, parent(name, phone)").eq("student_id", newRecord.student_id).single();

          if (stData) {
            const parentInfo = unwrap(stData.parent);
            const parentPhone = parentInfo?.phone || "";
            if (!parentPhone) return;

            const isValidParentName = parentInfo?.name && parentInfo.name.trim() !== "" && parentInfo.name !== "미입력";
            const displayParentName = isValidParentName ? parentInfo.name : stData.name;

            const targetTime = newRecord.check_out_time || newRecord.check_in_time || new Date().toISOString();
            const nowStr = formatTimeAsKST(targetTime);
            const todayIsoStr = newRecord.attendance_date;
            const timeString = `${todayIsoStr.replace(/-/g, '.')} ${nowStr}`;

            onQueueMessage({
              id: `${newRecord.student_id}_${statusLabel}`, 
              parentPhone: parentPhone,
              parentName: displayParentName,
              studentName: stData.name,
              timeString: timeString,
              statusLabel: statusLabel,
              previewTitle: `[출결] ${statusLabel}`,
              previewDesc: `${parentPhone} • ${timeString}`,
              templateId: "KA01TP260826014520504X1Fplf8R0FH" 
            });
          }
        }
      )
      .subscribe();

    const clinicChannel = supabase
      .channel('global_clinic_realtime_radar')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clinic_session_state' },
        () => {
          if (isBulkProcessing.current) return;
          if (selectedAttClassId) requestFetch(selectedAttClassId);
        }
      )
      .subscribe();

    return () => { 
      supabase.removeChannel(attChannel); 
      supabase.removeChannel(clinicChannel); 
    };
  }, [selectedAttClassId, todayIso]);

  const groupedStudents = useMemo(() => {
    const groups: Record<string, any[]> = {};
    attStudents.forEach(st => {
      const cName = st.className || '미배정';
      if (!groups[cName]) groups[cName] = [];
      groups[cName].push(st);
    });
    return groups;
  }, [attStudents]);

  const flowSummary = useMemo(() => {
    let notArrived = 0, inClass = 0, inClinic = 0, goneHome = 0, absent = 0;
    attStudents.forEach(st => {
      if (st.status === 'NONE') notArrived++;
      else if (st.status === '결석') absent++;
      else if (st.status === '클리닉중') inClinic++;
      else if (['출석', '등원', '지각'].includes(st.status)) inClass++;
      else if (['하원', '조퇴'].includes(st.status)) goneHome++;
    });
    return { notArrived, inClass, inClinic, goneHome, absent };
  }, [attStudents]);

  const handleAttAction = async (student: any, action: string) => {
    const today = getKSTDateStr();
    const nowTimestamp = new Date().toISOString();
    let payload: any = {};

    if (action === "ABSENT" && student.status !== "결석") {
      if (!confirm(`[${student.name}] 학생을 '결석' 처리하시겠습니까?`)) return;
    }

    const { data: existingRecords } = await supabase
      .from("attendance")
      .select("attendance_id")
      .eq("student_id", student.id)
      .eq("attendance_date", today);
      
    const existingId = existingRecords && existingRecords.length > 0 ? existingRecords[0].attendance_id : student.att_id;

    if (action === "DELETE") {
      if (!confirm(`[${student.name}] 학생의 오늘 출결 기록을 완벽히 초기화(삭제)하시겠습니까?\n\n※ 주의: 테스트/실수로 생성된 조교(클리닉) 기록도 함께 파기되어 '미등원' 상태로 강제 리셋됩니다.`)) return;
      
      if (existingId) {
        await supabase.from("attendance").delete().eq("attendance_id", existingId);
      }
      
      await supabase.from("clinic_session_state").delete().eq("student_id", student.id).in("session_date", [today, getKSTDateStr(-1)]);
      
      requestFetch(selectedAttClassId);
      return;
    }

    if (action === "PRESENT") {
      payload = { status: "등원" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "LATE") {
      payload = { status: "지각" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "ABSENT") {
      payload = { status: "결석", check_in_time: null, check_out_time: null };
    } else if (action === "EARLY_LEAVE") {
      payload = { status: "조퇴" };
      if (!student.checkOut) payload.check_out_time = nowTimestamp;
    } else if (action === "CLINIC") {
      payload = { status: "클리닉중" };
    } else if (action === "GO_HOME") {
      payload = { status: "하원", check_out_time: nowTimestamp }; 
    }

    setAttStudents(prev => prev.map(s => 
      s.id === student.id ? { ...s, ...payload } : s
    ));

    if (['PRESENT', 'LATE', 'ABSENT', 'EARLY_LEAVE', 'GO_HOME'].includes(action)) {
        let statusLabel = action === 'PRESENT' ? '등원' :
                          action === 'LATE' ? '지각' :
                          action === 'ABSENT' ? '결석' :
                          action === 'EARLY_LEAVE' ? '조퇴' : '하원';
        
        const nowStr = formatTimeAsKST(nowTimestamp);
        const timeString = `${today.replace(/-/g, '.')} ${nowStr}`;
        
        if (statusLabel && student.parentPhone) {
            onQueueMessage({
              id: `${student.id}_${statusLabel}_${Date.now()}`,
              parentPhone: student.parentPhone,
              parentName: student.parentName || student.name,
              studentName: student.name,
              timeString: timeString,
              statusLabel: statusLabel,
              previewTitle: `[출결] ${statusLabel}`,
              previewDesc: `${student.parentPhone} • ${timeString}`,
              templateId: "KA01TP260826014520504X1Fplf8R0FH"
            });
        }
    }

    try {
      if (existingId) {
        await supabase.from("attendance").update(payload).eq("attendance_id", existingId);
      } else {
        await supabase.from("attendance").insert({
          student_id: student.id, class_id: student.classId, enrollment_id: student.enrollId, attendance_date: today, ...payload
        });
      }
    } catch (e) { console.error("업데이트 에러:", e); }
    finally { requestFetch(selectedAttClassId); }
  };

  const bulkAttend = async () => {
    if (!confirm(`현재 미처리된 전체 학생을 일괄 "등원" 처리하시겠습니까?\n(알림톡이 전송될 수 있습니다)`)) return;
    
    const toUpdate = attStudents.filter(s => s.status === "NONE");
    if (toUpdate.length === 0) {
      alert("일괄 처리할 미등원 학생이 없습니다.");
      return;
    }

    const today = getKSTDateStr();
    const nowTimestamp = new Date().toISOString();
    const nowStr = formatTimeAsKST(nowTimestamp);
    const timeString = `${today.replace(/-/g, '.')} ${nowStr}`;

    setAttStudents(prev => prev.map(s => 
      s.status === "NONE" ? { ...s, status: "등원", checkIn: nowTimestamp } : s
    ));

    isBulkProcessing.current = true;

    const newMessages = toUpdate.filter(s => s.parentPhone).map(s => ({
        id: `${s.id}_등원_${Date.now()}`,
        parentPhone: s.parentPhone,
        parentName: s.parentName || s.name,
        studentName: s.name,
        timeString: timeString,
        statusLabel: '등원',
        previewTitle: `[출결] 등원`,
        previewDesc: `${s.parentPhone} • ${timeString}`,
        templateId: "KA01TP260826014520504X1Fplf8R0FH"
    }));

    if (newMessages.length > 0) {
        onQueueMessage(newMessages); 
    }

    const inserts = toUpdate.map(s => ({
      student_id: s.id,
      class_id: s.classId,
      enrollment_id: s.enrollId,
      attendance_date: today,
      status: "등원",
      check_in_time: nowTimestamp
    }));

    try {
      await supabase.from("attendance").insert(inserts);
    } catch (e) {
      console.error(e);
      alert("일괄 처리 중 오류가 발생했습니다.");
    } finally {
      setTimeout(() => {
        isBulkProcessing.current = false;
        fetchAttendance(selectedAttClassId);
      }, 1500);
    }
  };

  const bulkGoHome = async () => {
    if (!confirm(`현재 등원/클리닉 중인 전체 학생을 일괄 "하원" 처리하시겠습니까?\n(알림톡이 전송될 수 있습니다)`)) return;
    
    const toUpdate = attStudents.filter(s => s.att_id && !['하원', '조퇴', '결석', 'NONE'].includes(s.status));
    if (toUpdate.length === 0) {
      alert("일괄 처리할 하원 대상 학생이 없습니다.");
      return;
    }

    const today = getKSTDateStr();
    const nowTimestamp = new Date().toISOString();
    const nowStr = formatTimeAsKST(nowTimestamp);
    const timeString = `${today.replace(/-/g, '.')} ${nowStr}`;

    setAttStudents(prev => prev.map(s => 
      (s.att_id && !['하원', '조퇴', '결석', 'NONE'].includes(s.status)) 
        ? { ...s, status: "하원", checkOut: nowTimestamp } 
        : s
    ));

    isBulkProcessing.current = true;

    const newMessages = toUpdate.filter(s => s.parentPhone).map(s => ({
        id: `${s.id}_하원_${Date.now()}`,
        parentPhone: s.parentPhone,
        parentName: s.parentName || s.name,
        studentName: s.name,
        timeString: timeString,
        statusLabel: '하원',
        previewTitle: `[출결] 하원`,
        previewDesc: `${s.parentPhone} • ${timeString}`,
        templateId: "KA01TP260826014520504X1Fplf8R0FH"
    }));

    if (newMessages.length > 0) {
        onQueueMessage(newMessages); 
    }

    try {
      await Promise.all(toUpdate.map(s => 
        supabase.from("attendance").update({ status: "하원", check_out_time: nowTimestamp }).eq("attendance_id", s.att_id)
      ));
    } catch (e) {
      console.error(e);
      alert("일괄 처리 중 오류가 발생했습니다.");
    } finally {
      setTimeout(() => {
        isBulkProcessing.current = false;
        fetchAttendance(selectedAttClassId);
      }, 1500);
    }
  };

  const openManualModal = (student: any) => {
    setManualModalData(student);
    setManualForm({
      status: student.status === "NONE" ? "등원" : student.status,
      checkIn: formatTimeAsKST(student.checkIn),
      checkOut: formatTimeAsKST(student.checkOut)
    });
    setActiveAttMenu(null);
  };

  const handleManualSave = async () => {
    const today = getKSTDateStr();
    const toIsoString = (timeStr: string) => {
      if (!timeStr) return null;
      const [hh, mm] = timeStr.split(':');
      const d = new Date(`${today}T${hh}:${mm}:00+09:00`);
      return d.toISOString();
    };

    const { status, checkIn, checkOut } = manualForm;

    if (['등원', '지각', '결석', '조퇴', '하원'].includes(status) && manualModalData.parentPhone) {
        const timeTarget = status === '조퇴' || status === '하원' ? checkOut : checkIn;
        const nowStr = timeTarget || formatTimeAsKST(new Date().toISOString());
        const timeString = `${today.replace(/-/g, '.')} ${nowStr}`;
        onQueueMessage({
          id: `${manualModalData.id}_${status}_${Date.now()}`,
          parentPhone: manualModalData.parentPhone,
          parentName: manualModalData.parentName || manualModalData.name,
          studentName: manualModalData.name,
          timeString: timeString,
          statusLabel: status,
          previewTitle: `[출결] ${status}`,
          previewDesc: `${manualModalData.parentPhone} • ${timeString}`,
          templateId: "KA01TP260826014520504X1Fplf8R0FH"
        });
    }

    const { data: existingRecords } = await supabase.from("attendance").select("attendance_id").eq("student_id", manualModalData.id).eq("attendance_date", today);
    const existingId = existingRecords && existingRecords.length > 0 ? existingRecords[0].attendance_id : manualModalData.att_id;

    try {
      if (status === "NONE") {
        if (existingId) await supabase.from("attendance").delete().eq("attendance_id", existingId);
      } else {
        const payload: any = { status, check_in_time: toIsoString(checkIn), check_out_time: toIsoString(checkOut) };
        if (status === "결석") { payload.check_in_time = null; payload.check_out_time = null; }

        if (existingId) {
          await supabase.from("attendance").update(payload).eq("attendance_id", existingId);
        } else {
          await supabase.from("attendance").insert({
            student_id: manualModalData.id, class_id: manualModalData.classId, enrollment_id: manualModalData.enrollId, attendance_date: today, ...payload
          });
        }
      }
      alert("✅ 상태가 성공적으로 수동 반영되었습니다.");
    } catch (e) { alert("❌ 업데이트 중 오류가 발생했습니다."); } 
    finally { setManualModalData(null); requestFetch(selectedAttClassId); }
  };

  return (
    <>
      <div className="mb-6">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0 bg-white rounded-t-2xl border shadow-sm relative z-10">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <span>📡</span> 실시간 동선 관제 레이더 <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded ml-2">데스크 전용</span>
          </h3>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="bg-slate-100 p-1 rounded-lg flex items-center shadow-inner shrink-0">
              <button 
                onClick={() => handleViewModeChange('card')} 
                className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${viewMode === 'card' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:text-slate-600'}`}
              >
                🗃️ 카드
              </button>
              <button 
                onClick={() => handleViewModeChange('list')} 
                className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${viewMode === 'list' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50' : 'text-slate-400 hover:text-slate-600'}`}
              >
                🗂️ 리스트
              </button>
            </div>

            <select 
              value={selectedAttClassId} 
              onChange={e => setSelectedAttClassId(e.target.value)}
              className="border border-indigo-300 rounded-lg py-1.5 px-3 text-xs font-bold text-indigo-900 bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm w-full sm:w-[250px]"
            >
              <option value="all">🌐 학원 전체 요약 보기</option>
              {classStats.map(c => (
                <option key={c.class_id} value={c.class_id}>{c.name} ({c.instructor?.name || '미정'})</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="flex flex-col lg:flex-row bg-white border border-t-0 border-slate-200 rounded-b-2xl shadow-sm overflow-hidden min-h-[450px]">
          
          <div className="w-full lg:w-[260px] bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-5 flex flex-col gap-4 flex-1">
              <div>
                <span className="text-[11px] font-bold text-slate-500 mb-2 block">
                  {selectedAttClassId === 'all' ? '학원 전체 동선 요약' : '반별 동선 요약'}
                </span>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                    <span className="text-[11px] font-bold text-slate-500">🏫 원내 체류</span><span className="text-sm font-black text-blue-600">{flowSummary.inClass}명</span>
                  </div>
                  <div className="flex justify-between items-center bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                    <span className="text-[11px] font-bold text-slate-500">✍️ 클리닉중</span><span className="text-sm font-black text-purple-600">{flowSummary.inClinic}명</span>
                  </div>
                  <div className="flex justify-between items-center bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                    <span className="text-[11px] font-bold text-slate-500">👋 하원 완료</span><span className="text-sm font-black text-emerald-600">{flowSummary.goneHome}명</span>
                  </div>
                </div>
              </div>
              
              <div className="flex-1"></div>
              
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-slate-500 mb-0.5">일괄 출결 처리</span>
                <button onClick={bulkAttend} disabled={!selectedAttClassId} className="w-full text-xs font-bold bg-[#002864] text-white py-3 rounded-xl hover:bg-blue-900 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                  일괄 등원 처리 (카톡발송)
                </button>
                <button onClick={bulkGoHome} disabled={!selectedAttClassId} className="w-full text-xs font-bold bg-emerald-600 text-white py-3 rounded-xl hover:bg-emerald-700 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                  일괄 하원 처리 (카톡발송)
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">
            {attStudents.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-sm">조회된 학생이 없습니다.</div>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scroll p-4 pb-8">
                
                {/* 💡 리스트 뷰: 등원 열 옆에 '하원' 열 추가 */}
                {viewMode === "list" ? (
                  <div className="overflow-x-auto w-full bg-white rounded-xl border border-slate-200 shadow-sm">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="py-2.5 px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider w-20">이름</th>
                          <th className="py-2.5 px-2 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider w-20 text-center">상태</th>
                          <th className="py-2.5 px-2 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider w-16 text-center">등원</th>
                          <th className="py-2.5 px-2 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider w-16 text-center">하원</th>
                          <th className="py-2.5 px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider text-right">출결 관리 (빠른 액션)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(groupedStudents).sort(([a], [b]) => a === '미배정' ? 1 : b === '미배정' ? -1 : a.localeCompare(b)).map(([cName, students]) => (
                          <React.Fragment key={cName}>
                            <tr className="bg-slate-100/60 border-b border-slate-200">
                              <td colSpan={5} className="py-2 px-3 text-[11px] font-black text-indigo-700">
                                <span className="w-1.5 h-3 bg-indigo-500 inline-block align-middle mr-1.5 rounded-full"></span>
                                {cName} <span className="text-slate-400 font-bold ml-1">({students.length}명)</span>
                              </td>
                            </tr>
                            {students.map(student => {
                              const isNotArrived = student.status === 'NONE';
                              let flowIcon = "❓"; let flowText = "미등원"; let flowColor = "text-slate-500 bg-slate-100 border-slate-200";
                              if (['출석', '등원', '지각'].includes(student.status)) { flowIcon = "🏫"; flowText = "원내(등원)"; flowColor = "text-blue-700 bg-blue-50 border-blue-200"; }
                              else if (student.status === '클리닉중') { flowIcon = "✍️"; flowText = "클리닉중"; flowColor = "text-purple-700 bg-purple-50 border-purple-200"; }
                              else if (['하원', '조퇴'].includes(student.status)) { flowIcon = "👋"; flowText = "하원완료"; flowColor = "text-emerald-700 bg-emerald-50 border-emerald-200"; }
                              else if (student.status === '결석') { flowIcon = "❌"; flowText = "결석"; flowColor = "text-rose-700 bg-rose-50 border-rose-200"; }
                              
                              const timeInStr = student.checkIn ? formatTimeAsKST(student.checkIn) : "-";
                              // 💡 새로 추가된 하원 시간 문자열 생성 로직
                              const timeOutStr = student.checkOut ? formatTimeAsKST(student.checkOut) : "-";

                              return (
                                <tr key={student.id} className={`border-b border-slate-100 last:border-0 hover:bg-indigo-50/40 transition-colors ${isNotArrived ? 'opacity-80 grayscale-[0.3]' : ''}`}>
                                  <td className="py-2 px-3">
                                    <span className={`text-[12px] font-extrabold ${isNotArrived ? 'text-slate-500' : 'text-slate-800'}`}>{student.name}</span>
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${flowColor} whitespace-nowrap`}>
                                      {flowIcon} {flowText}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-center text-[11px] font-bold text-slate-500">{timeInStr}</td>
                                  <td className="py-2 px-2 text-center text-[11px] font-bold text-slate-500">{timeOutStr}</td>
                                  <td className="py-2 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button onClick={() => handleAttAction(student, 'PRESENT')} className="px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-md text-[10px] transition-colors border border-blue-100">등원</button>
                                      <button onClick={() => handleAttAction(student, 'LATE')} className="px-2 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold rounded-md text-[10px] transition-colors border border-amber-100">지각</button>
                                      <button onClick={() => handleAttAction(student, 'CLINIC')} className="px-2 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-md text-[10px] transition-colors border border-purple-100">클리닉</button>
                                      <button onClick={() => handleAttAction(student, 'EARLY_LEAVE')} className="px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-md text-[10px] transition-colors border border-indigo-100">조퇴</button>
                                      <button onClick={() => handleAttAction(student, 'GO_HOME')} className="px-2 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-md text-[10px] transition-colors border border-emerald-100">하원</button>
                                      <button onClick={() => handleAttAction(student, 'ABSENT')} className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-md text-[10px] transition-colors border border-rose-100">결석</button>
                                      
                                      <div className="w-[1px] h-4 bg-slate-200 mx-1"></div>
                                      
                                      <button onClick={() => openManualModal(student)} className="px-2 py-1.5 text-slate-500 hover:bg-slate-100 border border-slate-200 font-bold rounded-md text-[10px] transition-colors flex items-center gap-1" title="수동 설정">
                                        ⚙️ 수동
                                      </button>
                                      <button onClick={() => handleAttAction(student, 'DELETE')} className="px-2 py-1.5 text-rose-500 hover:bg-rose-50 border border-rose-200 font-bold rounded-md text-[10px] transition-colors flex items-center gap-1" title="기록 삭제">
                                        🗑️ 삭제
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {Object.entries(groupedStudents)
                      .sort(([a], [b]) => {
                        if (a === '미배정') return 1;
                        if (b === '미배정') return -1;
                        return a.localeCompare(b);
                      })
                      .map(([cName, students]) => (
                      <div key={cName}>
                        <h4 className="text-xs font-extrabold text-slate-700 mb-2.5 flex items-center gap-1.5 pl-1">
                          <span className="w-1.5 h-3.5 bg-indigo-500 rounded-full"></span>
                          {cName} <span className="text-[10px] font-bold text-slate-400 ml-1">총 {students.length}명</span>
                        </h4>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                          {students.map(student => {
                            const isMenuOpen = activeAttMenu === student.id;
                            const isNotArrived = student.status === 'NONE';

                            let flowIcon = "❓"; let flowText = "미등원"; let flowColor = "text-slate-500 bg-slate-200/50 border-slate-300";
                            if (['출석', '등원', '지각'].includes(student.status)) { flowIcon = "🏫"; flowText = "원내(등원)"; flowColor = "text-blue-700 bg-blue-50 border-blue-200"; }
                            else if (student.status === '클리닉중') { flowIcon = "✍️"; flowText = "클리닉중"; flowColor = "text-purple-700 bg-purple-50 border-purple-200"; }
                            else if (['하원', '조퇴'].includes(student.status)) { flowIcon = "👋"; flowText = "하원완료"; flowColor = "text-emerald-700 bg-emerald-50 border-emerald-200"; }
                            else if (student.status === '결석') { flowIcon = "❌"; flowText = "결석"; flowColor = "text-rose-700 bg-rose-50 border-rose-200"; }

                            const timeInStr = student.checkIn ? formatTimeAsKST(student.checkIn) : "";
                            
                            const cardBgClass = isNotArrived 
                              ? "bg-slate-100 border-slate-300 border-dashed opacity-80 hover:opacity-100" 
                              : "bg-white border-slate-200 hover:border-indigo-300";

                            return (
                              <div key={student.id} className={`p-2 rounded-xl border flex flex-col text-xs transition-all relative gap-1 ${cardBgClass} ${isMenuOpen ? 'z-50 shadow-lg ring-2 ring-indigo-200' : 'z-10 shadow-sm'}`}>
                                <div className="flex justify-between items-start w-full">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-extrabold text-slate-800 text-[12px] truncate max-w-[50px]">{student.name}</span>
                                      <span className={`px-1 py-0.5 rounded text-[9px] font-black border ${flowColor} whitespace-nowrap`}>
                                        {flowIcon} {flowText}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-bold text-slate-400 pl-0.5 mt-0.5">
                                      {timeInStr ? `${timeInStr} 등원` : '시간 기록없음'}
                                    </span>
                                  </div>

                                  <div className="relative inline-block shrink-0 kebab-container">
                                    <button onClick={() => setActiveAttMenu(isMenuOpen ? null : student.id)} className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors mt-0.5">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
                                    </button>
                                    
                                    {isMenuOpen && (
                                      <div className="absolute right-0 top-6 w-28 bg-white shadow-2xl rounded-xl border border-slate-200 z-[9999] py-1 text-left">
                                        <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'LATE'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-amber-600 hover:bg-slate-50 flex items-center gap-1.5">⏰ 지각 처리</button>
                                        <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'EARLY_LEAVE'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-indigo-600 hover:bg-slate-50 flex items-center gap-1.5">🏃 조퇴 처리</button>
                                        <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'ABSENT'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-rose-600 hover:bg-slate-50 flex items-center gap-1.5">❌ 결석 처리</button>
                                        <hr className="border-slate-100 my-0.5" />
                                        <button onClick={() => openManualModal(student)} className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">⚙️ 수동 설정</button>
                                        <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'DELETE'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-rose-500 hover:bg-slate-50 flex items-center gap-1.5">🗑️ 기록 삭제</button>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex gap-1 mt-1 pt-1.5 border-t border-slate-200/60">
                                  <button onClick={() => handleAttAction(student, 'PRESENT')} className="flex-1 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-[4px] text-[10px] transition-colors border border-blue-100">등원</button>
                                  <button onClick={() => handleAttAction(student, 'CLINIC')} className="flex-1 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-[4px] text-[10px] transition-colors border border-purple-100">클리닉</button>
                                  <button onClick={() => handleAttAction(student, 'GO_HOME')} className="flex-1 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-[4px] text-[10px] transition-colors border border-emerald-100">하원</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </div>

      {manualModalData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-black text-slate-800 mb-5 border-b border-slate-100 pb-3 flex items-center gap-2">⚙️ 수동 상태 설정 <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded ml-auto">{manualModalData.name}</span></h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-500 mb-1.5">위치 / 상태</label>
                <select value={manualForm.status} onChange={e => setManualForm({...manualForm, status: e.target.value})} className="border border-slate-300 p-2.5 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 bg-slate-50">
                  <option value="등원">🏫 원내체류 (등원)</option>
                  <option value="클리닉중">✍️ 클리닉중</option>
                  <option value="하원">👋 하원 완료</option>
                  <option value="결석">❌ 결석</option>
                  <option value="지각">⏰ 지각</option>
                  <option value="조퇴">🏃 조퇴</option>
                  <option value="NONE">🗑️ 미처리 (초기화)</option>
                </select>
              </div>

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">등원 시간</label>
                  <input type="time" value={manualForm.checkIn} onChange={e => setManualForm({...manualForm, checkIn: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
                </div>
              )}

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">종료/하원 시간</label>
                  <input type="time" value={manualForm.checkOut} onChange={e => setManualForm({...manualForm, checkOut: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-8">
              <button onClick={() => setManualModalData(null)} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-colors">취소</button>
              <button onClick={handleManualSave} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm shadow-md transition-colors">저장하기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}