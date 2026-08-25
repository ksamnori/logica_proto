// src/components/student/StudentEditModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase"; 

interface StudentEditModalProps {
  isOpen: boolean;
  studentId: string;
  student: any;
  enrollments: any[];
  allClasses: any[];
  onClose: () => void;
  onSuccess: () => void;
}

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

export default function StudentEditModal({ 
  isOpen, 
  studentId, 
  student, 
  enrollments, 
  allClasses, 
  onClose, 
  onSuccess 
}: StudentEditModalProps) {
  
  const [editForm, setEditForm] = useState({
    name: "", 
    gender: "", 
    status: "재원", 
    school: "", 
    grade: "", 
    phone: "",
    passwordHash: "", // 💡 비밀번호 상태 추가
    parentId: "", 
    parentName: "", 
    parentRel: "", 
    parentPhone: "", 
    newClassId: ""
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role") || "";
    const position = localStorage.getItem("logica_instructor_position") || "";
    const adminFlag = ["SUPER_ADMIN", "ADMIN"].includes(role.toUpperCase()) || 
                      ["최고관리자", "대장", "원장"].some(p => position.includes(p));
    setIsSuperAdmin(adminFlag);

    if (isOpen && student) {
      const parentObj = unwrap(student.parent);

      setEditForm({
        name: student.name || "", 
        gender: student.gender || "", 
        status: student.status || "재원", 
        school: student.school || "", 
        grade: student.grade || "", 
        phone: student.phone || "",
        passwordHash: student.password_hash || "", // 💡 기존 DB 비밀번호 불러오기
        parentId: student.parent_id || parentObj?.parent_id || "", 
        parentName: parentObj?.name || "", 
        parentRel: parentObj?.relationship || "", 
        // 더미 번호인 경우 화면에는 빈칸으로 보여줍니다.
        parentPhone: parentObj?.phone?.includes('unassigned') ? "" : (parentObj?.phone || ""), 
        newClassId: ""
      });
    }
  }, [isOpen, student]);

  const formatPhone = (val: string) => {
    let v = val.replace(/[^0-9]/g, '');
    if (v.length > 3 && v.length <= 7) return v.replace(/(\d{3})(\d+)/, '$1-$2');
    if (v.length > 7) return v.replace(/(\d{3})(\d{4})(\d+)/, '$1-$2-$3');
    return v;
  };

  const submitEditStudent = async () => {
    // 💡 비밀번호 자릿수 검증 (값이 비어있지 않은데 4자리가 아닌 경우 차단)
    if (editForm.passwordHash && editForm.passwordHash.length !== 4) {
      alert("비밀번호(PIN)는 숫자 4자리로 설정해주세요.");
      return;
    }

    setIsSaving(true);
    try {
      let finalParentId = editForm.parentId || null;
      const inputPhone = editForm.parentPhone.trim();
      const inputName = editForm.parentName.trim();
      const inputRel = editForm.parentRel.trim();

      // 🌟 [핵심 변경] 연락처 입력 여부와 관계없이 완벽하게 동작하는 우회/연결 로직
      if (!inputPhone && !inputName && !inputRel) {
        // 학부모 정보가 아예 비워져 있다면 연결 해제
        finalParentId = null;
      } else {
        if (inputPhone) {
          // 1. 번호가 입력된 경우: 기존 학부모 스캔 및 연결
          const { data: existingParent } = await supabase
            .from("parent")
            .select("parent_id")
            .eq("phone", inputPhone)
            .maybeSingle();

          if (existingParent) {
            finalParentId = existingParent.parent_id;
            const { error: pUpdateErr } = await supabase
              .from("parent")
              .update({ name: inputName, relationship: inputRel })
              .eq("parent_id", finalParentId);
            if (pUpdateErr) throw pUpdateErr;
          } else if (finalParentId) {
            const { error: pUpdateErr } = await supabase
              .from("parent")
              .update({ phone: inputPhone, name: inputName, relationship: inputRel })
              .eq("parent_id", finalParentId);
            if (pUpdateErr) throw pUpdateErr;
          } else {
            const { data: newParent, error: pInsertErr } = await supabase
              .from("parent")
              .insert({ phone: inputPhone, name: inputName, relationship: inputRel })
              .select()
              .single();
            if (pInsertErr) throw pInsertErr;
            finalParentId = newParent.parent_id;
          }
        } else {
          // 2. 번호가 비워져 있는 경우 (하지만 이름/관계는 입력됨)
          if (finalParentId) {
            // 기존 학부모 업데이트: 번호 갱신은 생략하여 NOT NULL 위반 방지
            const { error: pUpdateErr } = await supabase
              .from("parent")
              .update({ name: inputName, relationship: inputRel })
              .eq("parent_id", finalParentId);
            if (pUpdateErr) throw pUpdateErr;
          } else {
            // 신규 생성인데 번호가 없는 경우: DB 에러를 막기 위한 임시 더미 번호 강제 주입
            const dummyPhone = `unassigned_${Date.now()}`;
            const { data: newParent, error: pInsertErr } = await supabase
              .from("parent")
              .insert({ phone: dummyPhone, name: inputName, relationship: inputRel })
              .select()
              .single();
            if (pInsertErr) throw pInsertErr;
            finalParentId = newParent.parent_id;
          }
        }
      }

      // 💡 학생 정보 완벽 업데이트 (+ password_hash 추가)
      const studentUpdates = { 
        name: editForm.name, 
        gender: editForm.gender || null, 
        status: editForm.status, 
        school: editForm.school, 
        grade: editForm.grade, 
        phone: editForm.phone,
        password_hash: editForm.passwordHash || null, // 입력란을 비우면 DB에서도 null로 처리
        parent_id: finalParentId
      };

      const { error: studentUpdateError } = await supabase
        .from("student")
        .update(studentUpdates)
        .eq("student_id", studentId);
        
      if (studentUpdateError) throw studentUpdateError;

      alert("학생 및 학부모 정보가 성공적으로 수정되었습니다.");
      onSuccess();
      onClose();
    } catch (e: any) { 
      console.error("업데이트 에러 세부정보:", e);
      // 에러 메시지 텍스트 강제 추출 안전장치
      const errMsg = e.message || e.details || JSON.stringify(e) || "알 수 없는 에러";
      
      if (errMsg.includes("unique constraint") || e.code === "23505") {
        alert("저장 실패: 입력하신 학부모 연락처가 이미 다른 학부모의 번호로 등록되어 있습니다.");
      } else {
        alert("정보 저장 실패: " + errMsg); 
      }
    } finally {
      setIsSaving(false);
    }
  };

  const addEnrollment = async () => {
    if (!editForm.newClassId) return alert("추가할 수강반을 선택해주세요.");
    const existing = enrollments.find(e => e.class_id.toString() === editForm.newClassId);
    if (existing) return alert("이미 해당 수강반에 배정되어 있습니다.");

    try {
      const { error } = await supabase.from("enrollment").insert({ 
        student_id: studentId, 
        class_id: editForm.newClassId, 
        start_date: new Date().toISOString().split('T')[0], 
        status: "예약" 
      });
      
      if (error) throw error;
      
      alert("수강반 배정이 추가되었습니다.");
      setEditForm({ ...editForm, newClassId: "" });
      onSuccess();
    } catch (e: any) { 
      alert("배정 추가 실패: " + e.message); 
    }
  };

  const removeEnrollment = async (enrollId: string) => {
    if (!confirm("⚠️ [경고] 해당 수강반 배정 기록과 연결된 모든 출석 기록(테스트 데이터)이 강제 삭제됩니다.\n정말로 진행하시겠습니까?")) return;
    
    try {
      const { error: childError } = await supabase.from("attendance").delete().eq("enrollment_id", enrollId);
      if (childError) console.warn("연관 출석 데이터 삭제 중 문제 발생:", childError);

      const { error: parentError } = await supabase.from("enrollment").delete().eq("enrollment_id", enrollId);
      if (parentError) throw parentError;

      alert("관련 테스트 데이터까지 모두 강제 삭제되었습니다.");
      onSuccess();
    } catch (e: any) {
      alert("❌ 강제 삭제 실패: " + e.message);
    }
  };

  const deleteStudent = async () => {
    if (!confirm(`[🚨 초강력 경고]\n정말 [${editForm.name}] 학생을 영구 삭제하시겠습니까?\n\n이 작업은 절대 되돌릴 수 없으며, 학생의 출석, 성적, 오답노트, 상담 내역 등 모든 연관 데이터가 흔적도 없이 연쇄 파괴됩니다.`)) return;

    setIsSaving(true);
    try {
      const { data: enrs } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", studentId);
      if (enrs && enrs.length > 0) {
        const enrIds = enrs.map(e => e.enrollment_id);
        await supabase.from("attendance").delete().in("enrollment_id", enrIds);
      }
      await supabase.from("enrollment").delete().eq("student_id", studentId);

      await Promise.all([
        supabase.from("student_answer").delete().eq("student_id", studentId),
        supabase.from("student_exam_result").delete().eq("student_id", studentId),
        supabase.from("student_progress").delete().eq("student_id", studentId),
        supabase.from("student_incorrect_record").delete().eq("student_id", studentId), 
        supabase.from("admission_application").delete().eq("student_id", studentId),
        supabase.from("individual_makeup").delete().eq("student_id", studentId),
        supabase.from("parent_request_log").delete().eq("student_id", studentId)
      ]);

      const { error: delErr } = await supabase.from("student").delete().eq("student_id", studentId);
      if (delErr) throw delErr;

      alert(`🎉 [${editForm.name}] 학생의 모든 데이터가 완벽하게 삭제되었습니다.`);
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(`❌ 학생 영구 삭제 실패:\n${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 font-pretendard">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-[fadeIn_0.2s_ease-out]">
        
        {/* 모달 헤더 */}
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
          <h3 className="text-lg font-extrabold">학생 정보 수정</h3>
          <button onClick={onClose} className="text-white hover:text-rose-400 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        {/* 모달 본문 */}
        <div className="p-6 overflow-y-auto custom-scroll flex-1 space-y-6 bg-slate-50">
          
          {/* 기본 정보 영역 */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="font-bold text-sm text-[#0ea5e9] mb-4 border-b border-slate-100 pb-2">기본 정보</h4>
            <div className="grid grid-cols-2 gap-4">
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">이름</label>
                <input 
                  type="text" 
                  value={editForm.name} 
                  onChange={e => setEditForm({...editForm, name: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">성별</label>
                <select 
                  value={editForm.gender} 
                  onChange={e => setEditForm({...editForm, gender: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]"
                >
                  <option value="">선택 안 함</option>
                  <option value="남학생">남학생</option>
                  <option value="여학생">여학생</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
                <select 
                  value={editForm.status} 
                  onChange={e => setEditForm({...editForm, status: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]"
                >
                  <option value="재원">재원</option>
                  <option value="휴원">휴원</option>
                  <option value="퇴원">퇴원</option>
                  <option value="입학테스트">입학테스트</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학년</label>
                <select 
                  value={editForm.grade} 
                  onChange={e => setEditForm({...editForm, grade: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]"
                >
                  <option value="초1">초1</option>
                  <option value="초2">초2</option>
                  <option value="초3">초3</option>
                  <option value="초4">초4</option>
                  <option value="초5">초5</option>
                  <option value="초6">초6</option>
                  <option value="중1">중1</option>
                  <option value="중2">중2</option>
                  <option value="중3">중3</option>
                  <option value="고1">고1</option>
                  <option value="고2">고2</option>
                  <option value="고3">고3</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학교</label>
                <input 
                  type="text" 
                  value={editForm.school} 
                  onChange={e => setEditForm({...editForm, school: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학생 연락처</label>
                <input 
                  type="text" 
                  value={editForm.phone} 
                  onChange={e => setEditForm({...editForm, phone: formatPhone(e.target.value)})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                />
              </div>

              {/* 💡 신규 추가된 비밀번호(PIN) 입력 필드 (학교와 학생 연락처 바로 아래 줄에 위치) */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center justify-between">
                  비밀번호 (PIN 4자리)
                  {editForm.passwordHash ? (
                    <span className="text-[10px] text-blue-500 font-normal">설정됨</span>
                  ) : (
                    <span className="text-[10px] text-amber-500 font-normal">미설정</span>
                  )}
                </label>
                <input 
                  type="text" 
                  maxLength={4}
                  placeholder="미설정 (0000 등으로 자동 로그인됨)"
                  value={editForm.passwordHash} 
                  onChange={e => {
                    // 숫자만 입력 가능하도록 정규식 처리
                    const onlyNums = e.target.value.replace(/[^0-9]/g, '');
                    setEditForm({...editForm, passwordHash: onlyNums});
                  }} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-[#002864] focus:outline-none focus:border-[#002864] placeholder:text-slate-300 placeholder:font-normal" 
                />
              </div>
              
              <div className="col-span-2 bg-blue-50/50 p-4 rounded-lg border border-blue-100 mt-2">
                <label className="block text-xs font-bold text-slate-600 mb-2">현재 소속된 수강반</label>
                <ul className="mb-4 space-y-2">
                  {enrollments.length === 0 ? (
                    <li className="text-xs text-slate-400 font-bold bg-white px-3 py-2 rounded-lg border border-slate-200">
                      배정된 수강반이 없습니다.
                    </li>
                  ) : (
                    enrollments.map(e => (
                      <li key={e.enrollment_id} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm">
                        <span className="text-sm font-bold text-[#002864]">{e.class?.name || '미배정'}</span>
                        <button 
                          onClick={() => removeEnrollment(e.enrollment_id)} 
                          className="px-2.5 py-1 bg-rose-50 text-rose-500 rounded hover:bg-rose-100 transition-colors text-xs font-bold border border-rose-100"
                        >
                          제외(강제삭제)
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <label className="block text-xs font-bold text-slate-600 mb-2 border-t border-blue-200 pt-3">새 수강반 배정 추가</label>
                <div className="flex gap-2">
                  <select 
                    value={editForm.newClassId} 
                    onChange={e => setEditForm({...editForm, newClassId: e.target.value})} 
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-[#002864] focus:outline-none focus:border-[#002864]"
                  >
                    <option value="">선택 안함</option>
                    {allClasses.map(c => (
                      <option key={c.class_id} value={c.class_id.toString()}>
                        {c.name} ({c.level_name})
                      </option>
                    ))}
                  </select>
                  <button 
                    onClick={addEnrollment} 
                    className="shrink-0 px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-xs hover:bg-blue-900 transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* 학부모 정보 영역 */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="font-bold text-sm text-emerald-600 mb-4 border-b border-slate-100 pb-2">학부모 정보</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학부모 성함</label>
                <input 
                  type="text" 
                  value={editForm.parentName} 
                  onChange={e => setEditForm({...editForm, parentName: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">관계</label>
                <input 
                  type="text" 
                  value={editForm.parentRel} 
                  onChange={e => setEditForm({...editForm, parentRel: e.target.value})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">학부모 연락처</label>
                <input 
                  type="text" 
                  value={editForm.parentPhone} 
                  onChange={e => setEditForm({...editForm, parentPhone: formatPhone(e.target.value)})} 
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" 
                  placeholder="연락처를 비워두면 저장/업데이트가 가능합니다."
                />
              </div>
            </div>
          </div>

        </div>
        
        {/* 모달 하단 버튼 영역 */}
        <div className="p-5 bg-white border-t border-slate-200 flex justify-between gap-3 shrink-0 rounded-b-2xl">
          {isSuperAdmin ? (
            <button 
              onClick={deleteStudent} 
              disabled={isSaving} 
              className="px-5 py-2 bg-rose-50 text-rose-500 font-bold rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200 hover:border-transparent disabled:opacity-50"
            >
              학생 영구 삭제
            </button>
          ) : (
            <div></div> 
          )}
          
          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              className="px-5 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-colors"
            >
              닫기
            </button>
            <button 
              onClick={submitEditStudent} 
              disabled={isSaving} 
              className="px-5 py-2 bg-[#002864] text-white font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors disabled:opacity-50"
            >
              저장하기
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}