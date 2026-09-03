// src/components/class/ClassEditModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import ClassWeekCalendar from "./ClassWeekCalendar";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
// 🌟 대치 본원 고유 ID
const DAECHI_TENANT_ID = "1ff4299c-d72b-4d99-97b0-45fee08e3b73";

interface ClassEditModalProps {
  isOpen: boolean;
  classItem: any;
  instructors: any[]; 
  currentUser: { instId: string; name: string; isAdmin: boolean };
  onClose: () => void;
  onSuccess: () => void;
}

export default function ClassEditModal({ isOpen, classItem, currentUser, onClose, onSuccess }: ClassEditModalProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [modalData, setModalData] = useState<any>({});
  const [modalSchedules, setModalSchedules] = useState<any[]>([]);
  
  const [classStudents, setClassStudents] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [searchGrade, setSearchGrade] = useState("");
  const [searchStatus, setSearchStatus] = useState("재원"); // 🌟 기본값을 재원으로 설정
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [daechiInstructors, setDaechiInstructors] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      const fetchDaechiInstructors = async () => {
        const { data } = await supabase
          .from("instructor")
          .select("instructor_id, name")
          .eq("tenant_id", DAECHI_TENANT_ID) 
          .eq("status", "재직") 
          .order("name");
        
        if (data) {
          setDaechiInstructors(data);
        }
      };
      fetchDaechiInstructors();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && classItem) {
      setModalData({ ...classItem, originalName: classItem.name, originalCode: classItem.code });
      const schedules = DAYS.map(day => {
        const exist = (classItem.class_schedule || []).find((s: any) => s.day_of_week === day);
        return { day, checked: !!exist, start_time: exist?.start_time?.substring(0, 5) || "", end_time: exist?.end_time?.substring(0, 5) || "" };
      });
      setModalSchedules(schedules);
      setIsEditMode(false);
      setSearchKeyword("");

      fetchClassStudents(classItem.class_id);
      searchAllStudents("", "재원"); // 🌟 모달 열릴 때 상태 초기화
    }
  }, [isOpen, classItem]);

  const fetchClassStudents = async (classId: string) => {
    const { data: enrollData } = await supabase.from("enrollment").select("student_id").eq("class_id", classId);
    const enrollIds = enrollData?.map(e => e.student_id) || [];
    if (enrollIds.length === 0) { setClassStudents([]); return; }
    const { data } = await supabase.from("student").select("*, parent(phone), enrollment(class(name))").in("student_id", enrollIds);
    setClassStudents(data || []);
  };

  // 🌟 학년 및 상태 필터 연동 로직
  const searchAllStudents = async (grade: string, status: string) => {
    setSearchGrade(grade);
    setSearchStatus(status);
    
    // limit를 1000으로 늘려 데이터 누락 방지 및 상태(status) 정보 추가 호출
    let query = supabase.from("student").select("student_id, name, phone, grade, school_name, school, status").order("name").limit(1000); 
    
    if (grade) {
      const gradeMap: any = {
        '1': ['1', '초1', '초등 1학년'], '2': ['2', '초2', '초등 2학년'], '3': ['3', '초3', '초등 3학년'],
        '4': ['4', '초4', '초등 4학년'], '5': ['5', '초5', '초등 5학년'], '6': ['6', '초6', '초등 6학년'],
        '7': ['7', '중1', '중등 1학년'], '8': ['8', '중2', '중등 2학년'], '9': ['9', '중3', '중등 3학년'],
        '10': ['10', '고1', '고등 1학년'], '11': ['11', '고2', '고등 2학년'], '12': ['12', '고3', '고등 3학년']
      };
      query = query.in("grade", gradeMap[grade] || [grade]);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data } = await query;
    setAllStudents(data || []);
  };

  const handleModalChange = (field: string, value: any) => {
    let newData = { ...modalData, [field]: value };
    if (field === "name") {
      const suffix = modalData.originalCode.replace(modalData.originalName, "");
      newData.code = value.trim() + suffix;
    }
    setModalData(newData);
  };

  const handleScheduleChange = (day: string, field: string, value: any) => {
    setModalSchedules(prev => prev.map(s => {
      if (s.day !== day) return s;
      let updated = { ...s, [field]: value };
      if (field === "checked" && value) {
        const firstChecked = prev.find(p => p.checked);
        if (firstChecked) {
          updated.start_time = updated.start_time || firstChecked.start_time;
          updated.end_time = updated.end_time || firstChecked.end_time;
        }
      } else if (field === "checked" && !value) {
        updated.start_time = ""; updated.end_time = "";
      }
      return updated;
    }));
  };

  const assignStudent = async () => {
    const selected = allStudents.find(s => {
      let contactEnd = "번호없음";
      if (s.phone) {
        const match = s.phone.match(/(\d{4})(?:-\d+)?$/);
        if (match) contactEnd = match[1];
      }
      // 🌟 표시 텍스트와 정확히 매칭되도록 상태값 포함
      const visibleText = `[${s.status || '상태미상'}] ${s.name} (${s.school_name || s.school || '학교미상'}, ${s.grade || '학년미상'}, ${contactEnd})`;
      return visibleText === searchKeyword;
    });

    if (!selected) return alert("검색 목록에서 학생을 정확히 선택해주세요.");

    const { data: existing } = await supabase.from("enrollment").select("enrollment_id").match({ student_id: selected.student_id, class_id: modalData.class_id });
    if (existing && existing.length > 0) return alert("이미 이 반에 배정된 학생입니다.");

    const { error } = await supabase.from("enrollment").insert([{ student_id: selected.student_id, class_id: modalData.class_id, start_date: new Date().toISOString().split("T")[0] }]);
    if (error) {
      return alert("배정 실패: " + error.message);
    }

    setSearchKeyword(""); fetchClassStudents(modalData.class_id);
    onSuccess(); 
  };

  const removeStudent = async (studentId: string) => {
    if (!confirm("정말 수강생 목록에서 제외하시겠습니까?\n(이 반에서 발생한 해당 학생의 출결 기록도 함께 삭제됩니다.)")) return;
    
    const { data: targetEnroll } = await supabase
      .from("enrollment")
      .select("enrollment_id")
      .match({ student_id: studentId, class_id: modalData.class_id })
      .single();

    if (targetEnroll) {
      await supabase.from("attendance").delete().eq("enrollment_id", targetEnroll.enrollment_id);
    }

    const { error } = await supabase.from("enrollment").delete().match({ student_id: studentId, class_id: modalData.class_id });
    if (error) {
      return alert("제외 실패: " + error.message);
    }
    
    fetchClassStudents(modalData.class_id);
    onSuccess();
  };

  const saveEditedClass = async () => {
    const checkedSchedules = modalSchedules.filter(s => s.checked);
    if (checkedSchedules.length === 0) return alert("실제 요일을 1개 이상 선택해야 합니다.");
    for (const s of checkedSchedules) { if (!s.start_time) return alert(`${s.day}요일의 시작 시간을 입력해주세요!`); }

    setIsSaving(true);
    try {
      const scheduleDaysArr = checkedSchedules.map(s => s.day);
      const updateData: any = {
        code: modalData.code, name: modalData.name, target_grade: modalData.target_grade,
        schedule_days: scheduleDaysArr.join(", "), status: modalData.status,
        instructor_id: modalData.instructor_id || null, tuition_fee: parseInt(modalData.tuition_fee) || 0
      };

      if (modalData.class_type === 'SPECIAL' || modalData.class_type === 'MAKEUP') {
        updateData.start_date = modalData.start_date || null;
        updateData.end_date = modalData.end_date || null;
        updateData.total_sessions = modalData.total_sessions ? parseInt(modalData.total_sessions) : null;
      }

      const { error: updateErr } = await supabase.from("class").update(updateData).eq("class_id", modalData.class_id);
      if (updateErr) throw updateErr;

      await supabase.from("class_schedule").delete().eq("class_id", modalData.class_id);
      
      const insertSchedules = checkedSchedules.map(s => ({
        class_id: modalData.class_id, day_of_week: s.day, start_time: s.start_time, end_time: s.end_time || null
      }));
      
      const { error: insertErr } = await supabase.from("class_schedule").insert(insertSchedules);
      if (insertErr) throw insertErr;

      alert("✅ 반 정보 및 일정이 성공적으로 저장되었습니다!");
      setIsEditMode(false);
      setScheduleRefreshKey(k => k + 1);
      onSuccess();
    } catch (e: any) { 
      console.error(e);
      alert(`저장 중 오류가 발생했습니다.\n${e.message}`); 
    } finally { 
      setIsSaving(false); 
    }
  };

  const deleteClass = async () => {
    if (!confirm(`⚠️ 경고: [${modalData.name}] 반을 정말 삭제하시겠습니까?\n이 반과 연결된 명단, 시간표, 배정된 교재, 출결 기록, 과제/시험, 수업 일지 등이 모두 함께 삭제되며 절대 복구할 수 없습니다.`)) return;
    
    setIsSaving(true);
    try {
      const cId = modalData.class_id;

      // 1. 시험 및 답안 삭제
      const { data: exData } = await supabase.from("exam_assignment").select("assignment_id").eq("class_id", cId);
      if (exData && exData.length > 0) {
        const exIds = exData.map(e => e.assignment_id);
        await supabase.from("student_answer").delete().in("exam_assignment_id", exIds);
        await supabase.from("exam_assignment").delete().eq("class_id", cId);
      }

      // 2. 과제 및 결과 삭제
      const { data: hwData } = await supabase.from("homework_assignment").select("homework_id").eq("class_id", cId);
      if (hwData && hwData.length > 0) {
        const hwIds = hwData.map(h => h.homework_id);
        await supabase.from("student_homework_answer").delete().in("homework_id", hwIds);
        await supabase.from("student_homework_result").delete().in("homework_id", hwIds);
        await supabase.from("homework_assignment").delete().eq("class_id", cId);
      }

      // 3. 수업 일지 및 진도 기록 삭제
      const { data: lessonLogs } = await supabase.from("daily_lesson_log").select("lesson_log_id").eq("class_id", cId);
      if (lessonLogs && lessonLogs.length > 0) {
        const logIds = lessonLogs.map(l => l.lesson_log_id);
        await supabase.from("lesson_progress").delete().in("log_id", logIds);
        await supabase.from("daily_lesson_log").delete().in("lesson_log_id", logIds);
      }

      // 4. 출결 기록 삭제
      const { data: enrollData } = await supabase.from("enrollment").select("enrollment_id").eq("class_id", cId);
      if (enrollData && enrollData.length > 0) {
        const enrollIds = enrollData.map(e => e.enrollment_id);
        await supabase.from("attendance").delete().in("enrollment_id", enrollIds);
      }
      await supabase.from("attendance").delete().eq("class_id", cId);

      // 5. 기타 연관 테이블 일괄 삭제
      const cleanupTables = [
        { name: 'class_textbook', label: '교재 배정 내역' },
        { name: 'class_schedule', label: '시간표' },
        { name: 'class_holiday', label: '휴강일' },
        { name: 'class_extra_session', label: '보강 일정' },
        { name: 'class_syllabus', label: '진도 계획표' },
        { name: 'class_instructor_history', label: '강사 배정 이력' },
        { name: 'class_performance', label: '반 성적 통계' },
        { name: 'enrollment', label: '수강 명단' }
      ];

      for (const table of cleanupTables) {
         await supabase.from(table.name).delete().eq("class_id", cId);
      }

      // 7. 최종 반 삭제
      const { error: finalError } = await supabase.from("class").delete().eq("class_id", cId);
      if (finalError) throw new Error(`최종 반 삭제 실패: ${finalError.message}`);
      
      alert("✅ 반 정보가 연관 데이터와 함께 완벽하게 삭제되었습니다.");
      onSuccess();
      onClose();
    } catch (e: any) { 
      console.error(e);
      alert(`❌ 삭제 실패: 반을 삭제하는 도중 문제가 발생하여 중단되었습니다.\n\n상세 로그: ${e.message}`); 
    } finally { 
      setIsSaving(false); 
    }
  };

  if (!isOpen) return null;

  const canEdit = currentUser.isAdmin || String(modalData.instructor_id) === String(currentUser.instId);
  const isSpecialOrMakeup = modalData.class_type === 'SPECIAL' || modalData.class_type === 'MAKEUP';

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold tracking-tight">🏫 반 상세 정보 및 수강생 관리</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
            <h3 className="font-bold text-slate-800">📋 기본 정보</h3>
            {!canEdit && <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">조회 전용 (수정 권한 없음)</span>}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">반 코드 (자동 부여)</label>
              <input type="text" value={modalData.code || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100 uppercase" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">반 이름 <span className="text-blue-500 font-normal">(수정 시 코드 반영)</span></label>
              <input type="text" value={modalData.name || ""} readOnly={!isEditMode} onChange={e => handleModalChange("name", e.target.value)} className={`w-full px-3 py-2 rounded border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : ''}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">대상 학년</label>
              <input type="text" value={modalData.target_grade || ""} readOnly={!isEditMode} onChange={e => handleModalChange("target_grade", e.target.value)} className={`w-full px-3 py-2 rounded border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : ''}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">월 정규 수강료</label>
              <div className="flex items-center gap-2">
                <input type="number" value={modalData.tuition_fee || 0} readOnly={!isEditMode} onChange={e => handleModalChange("tuition_fee", e.target.value)} className={`w-full px-3 py-2 rounded border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : ''}`} />
                <span className="font-bold text-slate-500">원</span>
              </div>
            </div>

            {/* 🌟 특강/메이크업용 기간/회차 표시 및 수정 영역 */}
            {isSpecialOrMakeup && (
              <div className="col-span-2 bg-indigo-50 border border-indigo-200 rounded-lg p-4 grid grid-cols-3 gap-4">
                <div>
                   <label className="block text-sm font-bold text-slate-700 mb-1">시작 일자</label>
                   <input type="date" value={modalData.start_date || ""} readOnly={!isEditMode} onChange={e => handleModalChange("start_date", e.target.value)} className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : 'focus:outline-none focus:ring-2 focus:ring-indigo-600'}`} />
                </div>
                <div>
                   <label className="block text-sm font-bold text-slate-700 mb-1">종료 일자</label>
                   <input type="date" value={modalData.end_date || ""} readOnly={!isEditMode} onChange={e => handleModalChange("end_date", e.target.value)} className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : 'focus:outline-none focus:ring-2 focus:ring-indigo-600'}`} />
                </div>
                <div>
                   <label className="block text-sm font-bold text-slate-700 mb-1">총 회차 (세션 수)</label>
                   <input type="number" min="1" value={modalData.total_sessions || ""} readOnly={!isEditMode} onChange={e => handleModalChange("total_sessions", e.target.value)} className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : 'focus:outline-none focus:ring-2 focus:ring-indigo-600'}`} placeholder="예: 12" />
                </div>
              </div>
            )}

            <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
              <label className="block text-xs font-bold text-slate-500 mb-3">수업 요일 및 시간 설정</label>
              <div className="flex flex-col gap-2">
                {modalSchedules.map(s => (
                  <div key={s.day} className={`flex items-center gap-4 bg-white p-2.5 rounded-lg border transition-colors ${s.checked && isEditMode ? 'border-[#002864] ring-1 ring-[#002864]' : 'border-slate-200'}`}>
                    <label className="flex items-center gap-2 cursor-pointer w-16 shrink-0">
                      <input type="checkbox" disabled={!isEditMode} checked={s.checked} onChange={e => handleScheduleChange(s.day, "checked", e.target.checked)} className="w-5 h-5 accent-[#002864]" />
                      <span className={`font-bold ${s.day === '토' ? 'text-blue-600' : s.day === '일' ? 'text-red-500' : 'text-slate-700'}`}>{s.day}</span>
                    </label>
                    {s.checked && (
                      <div className="flex-1 flex items-center gap-2">
                        <input type="time" disabled={!isEditMode} value={s.start_time} onChange={e => handleScheduleChange(s.day, "start_time", e.target.value)} className={`px-3 py-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm w-full font-bold ${!isEditMode ? 'bg-slate-100' : ''}`} />
                        <span className="font-bold text-slate-400">~</span>
                        <input type="time" disabled={!isEditMode} value={s.end_time} onChange={e => handleScheduleChange(s.day, "end_time", e.target.value)} className={`px-3 py-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] text-sm w-full font-bold ${!isEditMode ? 'bg-slate-100' : ''}`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {modalData.class_id && (
              <div className="col-span-2">
                {isSpecialOrMakeup && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-3">
                    <div className="text-sm font-bold text-slate-700">
                      {modalData.start_date && modalData.end_date ? (
                        <p>📅 특강 기간: {modalData.start_date} ~ {modalData.end_date} (총 {modalData.total_sessions || '-'}회)</p>
                      ) : (
                        <p className="text-slate-500">📅 특강 시작/종료 일자가 설정되지 않았습니다.</p>
                      )}
                    </div>
                  </div>
                )}
                <ClassWeekCalendar
                  classId={modalData.class_id}
                  className={modalData.name}
                  canEdit={canEdit}
                  scheduleRefreshKey={scheduleRefreshKey}
                  isSpecialOrMakeup={isSpecialOrMakeup}
                  specialStartDate={modalData.start_date}
                  specialEndDate={modalData.end_date}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
              <select disabled={!isEditMode} value={modalData.status || "예정"} onChange={e => handleModalChange("status", e.target.value)} className={`w-full px-3 py-2 rounded border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : ''}`}>
                <option value="예정">예정</option><option value="진행중">진행중</option><option value="종료">종료</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">담당 강사</label>
              <select disabled={!isEditMode} value={modalData.instructor_id || ""} onChange={e => handleModalChange("instructor_id", e.target.value)} className={`w-full px-3 py-2 rounded border border-slate-300 font-bold ${!isEditMode ? 'bg-slate-100' : ''}`}>
                <option value="">미지정</option>
                {daechiInstructors.map(inst => <option key={inst.instructor_id} value={inst.instructor_id}>{inst.name} 선생님</option>)}
              </select>
            </div>
          </div>

          {/* 🌟 상태 필터가 추가된 수강 학생 배정 영역 */}
          <div className="flex justify-between items-end mb-3 border-b border-slate-200 pb-2">
            <h3 className="font-bold text-slate-800">👨‍🎓 수강 학생 리스트</h3>
            {isEditMode && canEdit && (
              <div className="flex items-center gap-2">
                <select value={searchGrade} onChange={e => searchAllStudents(e.target.value, searchStatus)} className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold shadow-sm focus:outline-none">
                  <option value="">전체 학년</option>
                  <option value="1">초1</option><option value="2">초2</option><option value="3">초3</option>
                  <option value="4">초4</option><option value="5">초5</option><option value="6">초6</option>
                  <option value="7">중1</option><option value="8">중2</option><option value="9">중3</option>
                  <option value="10">고1</option><option value="11">고2</option><option value="12">고3</option>
                </select>
                <select value={searchStatus} onChange={e => searchAllStudents(searchGrade, e.target.value)} className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold shadow-sm focus:outline-none">
                  <option value="">전체 상태</option>
                  <option value="재원">재원</option>
                  <option value="퇴원">퇴원</option>
                  <option value="휴원">휴원</option>
                  <option value="입학테스트">입학테스트(대기)</option>
                </select>
                <input 
                  list="all_students_list" 
                  value={searchKeyword} 
                  onChange={e => setSearchKeyword(e.target.value)} 
                  placeholder="학생 선택 (이름 등)" 
                  className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold w-64 shadow-sm"
                />
                <datalist id="all_students_list">
                  {allStudents.map(s => {
                    let contactEnd = s.phone?.match(/(\d{4})(?:-\d+)?$/)?.[1] || "번호없음";
                    // 🌟 데이터 리스트에 상태값 노출
                    const text = `[${s.status || '상태미상'}] ${s.name} (${s.school_name || s.school || '학교미상'}, ${s.grade || '학년미상'}, ${contactEnd})`;
                    return <option key={s.student_id} value={text} />;
                  })}
                </datalist>
                <button onClick={assignStudent} className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm font-bold shadow-sm">배정하기</button>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-bold text-slate-500">이름</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500">학년</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500">수강반</th>
                  <th className="py-2.5 px-4 font-bold text-slate-500 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {classStudents.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400 font-bold">배정된 학생이 없습니다.</td></tr>
                ) : (
                  classStudents.map(s => {
                    const uniqueClasses = Array.from(new Set(s.enrollment?.map((e: any) => e.class?.name).filter(Boolean))).join(", ") || "-";
                    return (
                      <tr key={s.student_id}>
                        <td className="py-2.5 px-4 font-bold text-[#002864]">{s.name}</td>
                        <td className="py-2.5 px-4 text-slate-600 text-xs font-bold">{s.grade || "-"}</td>
                        <td className="py-2.5 px-4 text-slate-600 text-xs font-bold max-w-[150px] truncate">{uniqueClasses}</td>
                        <td className="py-2.5 px-4 text-right">
                          {isEditMode && canEdit && (
                            <button onClick={() => removeStudent(s.student_id)} className="text-xs bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white border border-rose-200 px-3 py-1.5 rounded transition-colors font-bold shadow-sm">반에서 제외</button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
          <div>
            {isEditMode && canEdit && <button onClick={deleteClass} disabled={isSaving} className="px-5 py-2.5 bg-rose-50 text-rose-500 font-bold rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200">반 삭제 (위험)</button>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 shadow-sm">닫기</button>
            {canEdit && (
              !isEditMode ? (
                <button onClick={() => setIsEditMode(true)} className="px-5 py-2.5 bg-[#002864] text-white font-bold rounded-lg shadow-sm">반 정보 수정</button>
              ) : (
                <button onClick={saveEditedClass} disabled={isSaving} className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-lg shadow-sm">{isSaving ? "저장 중..." : "변경사항 저장"}</button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}