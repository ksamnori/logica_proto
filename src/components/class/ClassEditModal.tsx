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
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
      searchAllStudents("");
    }
  }, [isOpen, classItem]);

  const fetchClassStudents = async (classId: string) => {
    const { data: enrollData } = await supabase.from("enrollment").select("student_id").eq("class_id", classId);
    const enrollIds = enrollData?.map(e => e.student_id) || [];
    if (enrollIds.length === 0) { setClassStudents([]); return; }
    const { data } = await supabase.from("student").select("*, parent(phone), enrollment(class(name))").in("student_id", enrollIds);
    setClassStudents(data || []);
  };

  const searchAllStudents = async (grade: string) => {
    setSearchGrade(grade);
    let query = supabase.from("student").select("student_id, name, phone, grade, school_name, school").order("name").limit(300); 
    if (grade) {
      const gradeMap: any = {
        '1': ['1', '초1', '초등 1학년'], '2': ['2', '초2', '초등 2학년'], '3': ['3', '초3', '초등 3학년'],
        '4': ['4', '초4', '초등 4학년'], '5': ['5', '초5', '초등 5학년'], '6': ['6', '초6', '초등 6학년'],
        '7': ['7', '중1', '중등 1학년'], '8': ['8', '중2', '중등 2학년'], '9': ['9', '중3', '중등 3학년'],
        '10': ['10', '고1', '고등 1학년'], '11': ['11', '고2', '고등 2학년'], '12': ['12', '고3', '고등 3학년']
      };
      query = query.in("grade", gradeMap[grade] || [grade]);
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
      const visibleText = `${s.name} (${s.school_name || s.school || '학교미상'}, ${s.grade || '학년미상'}, ${contactEnd})`;
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

  // 🌟 [수정] 개별 학생 제외 시에도 연관 출결 기록(attendance)을 먼저 지워줍니다.
  const removeStudent = async (studentId: string) => {
    if (!confirm("정말 수강생 목록에서 제외하시겠습니까?\n(이 반에서 발생한 해당 학생의 출결 기록도 함께 삭제됩니다.)")) return;
    
    // 1. 제외하려는 enrollment_id 찾기
    const { data: targetEnroll } = await supabase
      .from("enrollment")
      .select("enrollment_id")
      .match({ student_id: studentId, class_id: modalData.class_id })
      .single();

    // 2. 해당 enrollment_id에 묶인 출결 삭제
    if (targetEnroll) {
      await supabase.from("attendance").delete().eq("enrollment_id", targetEnroll.enrollment_id);
    }

    // 3. 최종 명단(enrollment) 삭제
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
      const updateData = {
        code: modalData.code, name: modalData.name, target_grade: modalData.target_grade,
        schedule_days: scheduleDaysArr.join(", "), status: modalData.status,
        instructor_id: modalData.instructor_id || null, tuition_fee: parseInt(modalData.tuition_fee) || 0
      };

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
      onSuccess();
    } catch (e: any) { 
      console.error(e);
      alert(`저장 중 오류가 발생했습니다.\n${e.message}`); 
    } finally { 
      setIsSaving(false); 
    }
  };

  // 🌟 [완전삭제 해결 핵심] enrollment_id를 먼저 확보하여 출결 기록부터 완벽하게 삭제합니다.
  const deleteClass = async () => {
    if (!confirm(`⚠️ 경고: [${modalData.name}] 반을 정말 삭제하시겠습니까?\n이 반과 연결된 명단, 시간표, 배정된 교재, 출결 기록, 과제/시험 등이 모두 함께 삭제되며 절대 복구할 수 없습니다.`)) return;
    
    setIsSaving(true);
    try {
      const cId = modalData.class_id;

      // 1-1. 시험 기록 삭제
      const { data: exData } = await supabase.from("exam_assignment").select("assignment_id").eq("class_id", cId);
      if (exData && exData.length > 0) {
        const exIds = exData.map(e => e.assignment_id);
        await supabase.from("student_answer").delete().in("exam_assignment_id", exIds);
        await supabase.from("exam_assignment").delete().eq("class_id", cId);
      }

      // 1-2. 과제 기록 삭제
      const { data: hwData } = await supabase.from("homework_assignment").select("homework_id").eq("class_id", cId);
      if (hwData && hwData.length > 0) {
        const hwIds = hwData.map(h => h.homework_id);
        await supabase.from("student_homework_answer").delete().in("homework_id", hwIds);
        await supabase.from("student_homework_result").delete().in("homework_id", hwIds);
        await supabase.from("homework_assignment").delete().eq("class_id", cId);
      }

      // 🌟 1-3. 출결(attendance) 기록 완벽 삭제 (enrollment_id 기반)
      const { data: enrollData } = await supabase.from("enrollment").select("enrollment_id").eq("class_id", cId);
      if (enrollData && enrollData.length > 0) {
        const enrollIds = enrollData.map(e => e.enrollment_id);
        const { error: attErr } = await supabase.from("attendance").delete().in("enrollment_id", enrollIds);
        if (attErr) throw new Error(`[출결 기록] 삭제 실패: ${attErr.message}`);
      }
      
      // 혹시 몰라 class_id로도 삭제 시도 (보험용)
      await supabase.from("attendance").delete().eq("class_id", cId);

      // 1-4. 나머지 브릿지 데이터 완전 청소 (attendance는 이미 지웠으므로 배열에서 뺌)
      const cleanupTables = [
        { name: 'class_textbook', label: '교재 배정 내역' },
        { name: 'class_schedule', label: '시간표' },
        { name: 'class_holiday', label: '휴강일' },
        { name: 'class_extra_session', label: '보강 일정' },
        { name: 'enrollment', label: '수강 명단' }
      ];

      for (const table of cleanupTables) {
        const { error } = await supabase.from(table.name).delete().eq("class_id", cId);
        if (error) {
          throw new Error(`[${table.label}] 삭제 실패: ${error.message}`);
        }
      }

      // 1-5. 학생 테이블에 남아있을 수 있는 class_id 연결 끊기
      await supabase.from("student").update({ class_id: null }).eq("class_id", cId);

      // 🌟 2. 하위 데이터 청소가 무사히 끝났다면 최종 반 삭제 진행
      const { error: finalError } = await supabase.from("class").delete().eq("class_id", cId);
      
      if (finalError) {
        throw new Error(`최종 반 삭제 실패: ${finalError.message}`);
      }
      
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
              <ClassWeekCalendar 
                classId={modalData.class_id}
                className={modalData.name}
                scheduleDays={modalSchedules.filter(s => s.checked).map(s => s.day)}
                canEdit={canEdit}
              />
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

          {/* 학생 리스트 및 배정 */}
          <div className="flex justify-between items-end mb-3 border-b border-slate-200 pb-2">
            <h3 className="font-bold text-slate-800">👨‍🎓 수강 학생 리스트</h3>
            {isEditMode && canEdit && (
              <div className="flex items-center gap-2">
                <select value={searchGrade} onChange={e => searchAllStudents(e.target.value)} className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold shadow-sm focus:outline-none">
                  <option value="">전체 학년</option>
                  <option value="1">초1</option><option value="2">초2</option><option value="3">초3</option>
                  <option value="4">초4</option><option value="5">초5</option><option value="6">초6</option>
                  <option value="7">중1</option><option value="8">중2</option><option value="9">중3</option>
                  <option value="10">고1</option><option value="11">고2</option><option value="12">고3</option>
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
                    const text = `${s.name} (${s.school_name || s.school || '학교미상'}, ${s.grade || '학년미상'}, ${contactEnd})`;
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