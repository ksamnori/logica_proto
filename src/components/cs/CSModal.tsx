// src/components/cs/CSModal.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

interface CSModalProps {
  isOpen: boolean;
  reqData: any | null;
  currentUser: { instId: string; name: string; isAdmin: boolean };
  students: any[];
  instructors: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function CSModal({ 
  isOpen, 
  reqData, 
  currentUser, 
  students, 
  instructors, 
  onClose, 
  onSuccess 
}: CSModalProps) {
  const [modalData, setModalData] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 🌟 반 선택 & 학생 이름 검색 상태
  const [selectedClassId, setSelectedClassId] = useState<string>("all");
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [localEnrichedStudents, setLocalEnrichedStudents] = useState<any[]>([]);

  const [isSuperAdminOrAdmin, setIsSuperAdminOrAdmin] = useState(false);
  
  const [canDeletePost, setCanDeletePost] = useState(false);
  const [canDeleteOthersComment, setCanDeleteOthersComment] = useState(false);
  const [canSubmitAgenda, setCanSubmitAgenda] = useState(false); 

  const commentEndRef = useRef<HTMLDivElement>(null);

  // 부모 페이지(cs/page.tsx)에서 전달된 students에 enrollment가 없을 경우 자체 보강 로드
  useEffect(() => {
    if (!isOpen) return;
    const hasEnrollmentInfo = (students || []).some((s: any) => s.enrollment !== undefined);
    if (hasEnrollmentInfo) {
      setLocalEnrichedStudents(students);
      return;
    }

    let cancelled = false;
    const fetchEnrichedStudents = async () => {
      const tenantId = localStorage.getItem("logica_tenant_id");
      let q = supabase
        .from("student")
        .select("student_id, name, grade, enrollment(status, end_date, class(class_id, name))")
        .eq("status", "재원")
        .order("name");
      if (tenantId && tenantId !== "hq") {
        q = q.eq("tenant_id", tenantId);
      }
      const { data } = await q;
      if (!cancelled && data) {
        setLocalEnrichedStudents(data);
      } else if (!cancelled) {
        setLocalEnrichedStudents(students || []);
      }
    };
    fetchEnrichedStudents();
    return () => {
      cancelled = true;
    };
  }, [isOpen, students]);

  const effectiveStudents = useMemo(() => {
    const base = localEnrichedStudents.length > 0 ? localEnrichedStudents : (students || []);
    return base.map((s: any) => {
      const enrolls = Array.isArray(s.enrollment) ? s.enrollment : s.enrollment ? [s.enrollment] : [];
      const activeClasses: { id: string; name: string }[] = [];
      enrolls.forEach((e: any) => {
        if (isEndedEnrollment(e)) return;
        const cls = unwrap(e.class);
        const cid = cls?.class_id ? String(cls.class_id) : "";
        const cname = cls?.class_name || cls?.name || "";
        if (cid && cname && !activeClasses.some((c) => c.id === cid)) {
          activeClasses.push({ id: cid, name: cname });
        }
      });
      return {
        ...s,
        _activeClasses: activeClasses,
        _classNamesStr: activeClasses.map((c) => c.name).join(", "),
      };
    });
  }, [localEnrichedStudents, students]);

  // 전체 반 목록 추출
  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    effectiveStudents.forEach((s: any) => {
      (s._activeClasses || []).forEach((c: { id: string; name: string }) => {
        map.set(c.id, c.name);
      });
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  }, [effectiveStudents]);

  // 선택된 반 및 이름 검색어로 학생 목록 필터링
  const filteredStudents = useMemo(() => {
    const kw = studentSearch.trim().toLowerCase();
    return effectiveStudents.filter((s: any) => {
      // 1) 반 필터
      let matchClass = true;
      if (selectedClassId && selectedClassId !== "all") {
        if (selectedClassId === "unassigned") {
          matchClass = !s._activeClasses || s._activeClasses.length === 0;
        } else {
          matchClass = (s._activeClasses || []).some((c: any) => String(c.id) === String(selectedClassId));
        }
      }
      if (!matchClass) return false;

      // 2) 학생 이름 검색 필터
      if (kw) {
        const nameStr = String(s.name || "").toLowerCase();
        return nameStr.includes(kw);
      }
      return true;
    });
  }, [effectiveStudents, selectedClassId, studentSearch]);

  // 현재 선택된 학생이 필터 결과 바깥에 있더라도 셀렉트박스에 표시되도록 보장
  const selectStudentOptions = useMemo(() => {
    const currentId = modalData?.student_id ? String(modalData.student_id) : "";
    if (!currentId) return filteredStudents;
    const exists = filteredStudents.some((s: any) => String(s.student_id) === currentId);
    if (exists) return filteredStudents;
    const currentStu = effectiveStudents.find((s: any) => String(s.student_id) === currentId);
    return currentStu ? [currentStu, ...filteredStudents] : filteredStudents;
  }, [filteredStudents, effectiveStudents, modalData?.student_id]);

  useEffect(() => {
    const checkPerms = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id");

      const adminFlag = ["SUPER_ADMIN", "ADMIN"].includes(role.toUpperCase()) || 
                        ["최고관리자", "대장", "원장"].some(p => pos.includes(p));
      setIsSuperAdminOrAdmin(adminFlag);

      if (adminFlag) {
        setCanDeletePost(true);
        setCanDeleteOthersComment(true);
        setCanSubmitAgenda(true);
      } else if (tId) {
        const { data } = await supabase
          .from('tenant_role_permissions')
          .select('allowed_menus')
          .eq('tenant_id', tId)
          .eq('role_name', role)
          .maybeSingle();

        if (data && data.allowed_menus) {
          setCanDeletePost(data.allowed_menus.includes('action_delete_cs'));
          setCanDeleteOthersComment(data.allowed_menus.includes('action_delete_others_comment'));
          setCanSubmitAgenda(data.allowed_menus.includes('action_submit_cs_agenda'));
        } else {
          setCanDeletePost(false);
          setCanDeleteOthersComment(false);
          setCanSubmitAgenda(false);
        }
      }
    };

    if (isOpen) {
      checkPerms();
      setStudentSearch("");
      if (reqData) {
        setModalData({ ...reqData });
        setComments(reqData.comments || []);
        const sid = reqData.student_id ? String(reqData.student_id) : "";
        const matchedStu = effectiveStudents.find((s: any) => String(s.student_id) === sid);
        const firstCid = matchedStu?._activeClasses?.[0]?.id;
        setSelectedClassId(firstCid ? String(firstCid) : "all");
      } else {
        setSelectedClassId("all");
        setModalData({ 
          request_id: "", 
          student_id: "", 
          request_type: "상담/기타", 
          reason: "", 
          processed_instructor_id: currentUser.instId, 
          status: "대기", 
          is_private: false 
        });
        setComments([]);
      }
      setCommentInput("");
    }
  }, [isOpen, reqData, currentUser]);

  // 기존 요청을 열었을 때 학생의 반 정보가 뒤늦게 로드되면 반 선택값을 동기화
  useEffect(() => {
    if (isOpen && reqData?.student_id && selectedClassId === "all" && effectiveStudents.length > 0) {
      const matchedStu = effectiveStudents.find((s: any) => String(s.student_id) === String(reqData.student_id));
      const firstCid = matchedStu?._activeClasses?.[0]?.id;
      if (firstCid) setSelectedClassId(String(firstCid));
    }
  }, [isOpen, reqData?.student_id, effectiveStudents]);

  useEffect(() => {
    if (commentEndRef.current) {
      commentEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments]);

  const handleModalChange = (field: string, value: any) => {
    setModalData((prev: any) => ({ ...prev, [field]: value }));
  };

  // 반 변경 핸들러
  const handleClassChange = (nextClassId: string) => {
    setSelectedClassId(nextClassId);
    if (nextClassId !== "all" && modalData?.student_id) {
      const currentStu = effectiveStudents.find((s: any) => String(s.student_id) === String(modalData.student_id));
      if (currentStu) {
        const inSelectedClass =
          nextClassId === "unassigned"
            ? !currentStu._activeClasses || currentStu._activeClasses.length === 0
            : (currentStu._activeClasses || []).some((c: any) => String(c.id) === String(nextClassId));
        if (!inSelectedClass) {
          handleModalChange("student_id", "");
        }
      }
    }
  };

  // 이름 검색 입력 핸들러 (검색 결과 1명 일치 시 자동 선택 편의 제공)
  const handleStudentSearchChange = (val: string) => {
    setStudentSearch(val);
    const trimmed = val.trim().toLowerCase();
    if (!trimmed) return;

    const matches = effectiveStudents.filter((s: any) => {
      if (selectedClassId && selectedClassId !== "all") {
        if (selectedClassId === "unassigned") {
          if (s._activeClasses && s._activeClasses.length > 0) return false;
        } else if (!(s._activeClasses || []).some((c: any) => String(c.id) === String(selectedClassId))) {
          return false;
        }
      }
      return String(s.name || "").toLowerCase().includes(trimmed);
    });

    if (matches.length === 1) {
      handleModalChange("student_id", String(matches[0].student_id));
    } else {
      const exactMatch = matches.find((s: any) => String(s.name || "").toLowerCase() === trimmed);
      if (exactMatch) {
        handleModalChange("student_id", String(exactMatch.student_id));
      }
    }
  };

  // 🌟 [핵심 변경] 댓글 등록 시 전체 새로고침(깜빡임) 유발하는 onSuccess 제거
  const handleAddComment = async () => {
    if (!commentInput.trim() || !modalData?.request_id) return;
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentTimeISO = now.toISOString();

    const newComment = { 
      id: Date.now(), 
      authorName: currentUser.name, 
      text: commentInput.trim(), 
      createdAt: dateStr 
    };

    const updatedComments = [...comments, newComment];

    try {
      const { error } = await supabase.from("parent_request_log").update({ 
        comments: updatedComments,
        updated_at: currentTimeISO,
        last_updater_name: currentUser.name
      }).eq("request_id", modalData.request_id);

      if (error) throw error; 

      if (reqData) reqData.comments = updatedComments; // 부모 데이터 로컬 업데이트 (닫고 열 때 유지)
      setComments(updatedComments); // 즉각적인 UI 반영
      setCommentInput("");
      
      // onSuccess(); 🚫 제거됨 (화면 깜빡임 방지)
    } catch (e: any) {
      alert("댓글 등록 실패: " + e.message);
    }
  };

  // 🌟 [핵심 변경] 댓글 삭제 시 전체 새로고침(깜빡임) 유발하는 onSuccess 제거
  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
    const updatedComments = comments.filter(c => c.id !== commentId);
    
    try {
      const { error } = await supabase.from("parent_request_log").update({ 
        comments: updatedComments,
        updated_at: new Date().toISOString(),
        last_updater_name: currentUser.name
      }).eq("request_id", modalData.request_id);
      
      if (error) throw error;

      if (reqData) reqData.comments = updatedComments; // 부모 데이터 로컬 업데이트
      setComments(updatedComments); // 즉각적인 UI 반영
      
      // onSuccess(); 🚫 제거됨 (화면 깜빡임 방지)
    } catch (e: any) {
      alert("댓글 삭제 실패: " + e.message);
    }
  };

  const saveCS = async () => {
    if (!modalData.student_id || !modalData.reason?.trim()) return alert("학생과 상세 내용은 필수 항목입니다.");

    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === 'hq' ? 'd59395b0-8c9c-4dd3-9e25-ff569da98abc' : myTenantId; 

    setIsSaving(true);
    const currentTimeISO = new Date().toISOString();

    const payload: any = {
      student_id: modalData.student_id,
      request_type: modalData.request_type,
      reason: modalData.reason,
      processed_instructor_id: modalData.processed_instructor_id || null,
      status: modalData.status,
      is_private: modalData.is_private,
      target_date: currentTimeISO.split('T')[0],
      comments: comments,
      updated_at: currentTimeISO,
      last_updater_name: currentUser.name
    };

    try {
      if (modalData.request_id) {
        const { error } = await supabase.from("parent_request_log").update(payload).eq("request_id", modalData.request_id);
        if (error) throw error; 
        alert("성공적으로 저장되었습니다.");
      } else {
        if (!validTenantId) { alert("소속 지점 정보가 없습니다."); setIsSaving(false); return; }
        
        payload.author_id = currentUser.instId;
        payload.created_at = currentTimeISO;
        payload.tenant_id = validTenantId; 
        const { error } = await supabase.from("parent_request_log").insert([payload]);
        if (error) throw error; 
        alert("CS 기록이 등록되었습니다.");
      }
      onSuccess(); // 🌟 본문 저장 시에는 창을 닫아야 하므로 유지
      onClose();
    } catch (e: any) { 
      alert("저장 실패: " + (e.message || "서버 통신 오류")); 
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCS = async () => {
    if (!confirm("⚠️ 이 CS 요청 기록을 완전히 삭제하시겠습니까?\n댓글 및 처리 내역이 모두 사라집니다.")) return;
    try {
      const { error } = await supabase.from("parent_request_log").delete().eq("request_id", modalData.request_id);
      if (error) throw error;
      alert("삭제되었습니다.");
      onSuccess();
      onClose();
    } catch (e: any) { alert("삭제 실패: " + e.message); }
  };

  const submitAgenda = async () => {
    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === 'hq' ? 'd59395b0-8c9c-4dd3-9e25-ff569da98abc' : myTenantId;
    if (!validTenantId) return alert("소속 지점 정보가 없습니다.");

    try {
      const studentName = effectiveStudents.find((s: any) => String(s.student_id) === String(modalData.student_id))?.name || "학생";
      const { error } = await supabase.from("agenda").insert({
        title: `[CS요청] ${studentName} 학생 건`,
        content: modalData.reason,
        type: "CS",
        source: "CS",
        source_id: modalData.request_id,
        created_by: currentUser.instId,
        tenant_id: validTenantId 
      });
      if (error) throw error;
      alert("해당 CS 요청건이 회의 안건으로 상정되었습니다.");
    } catch (e: any) {
      alert("안건 상정 실패: " + e.message);
    }
  };

  if (!isOpen || !modalData) return null;

  const isReadonly = modalData.request_id && !isSuperAdminOrAdmin && String(modalData.author_id) !== String(currentUser.instId);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        
        <div className="bg-rose-600 p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-tight">🚨 CS / 학부모 요청 상세</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="flex-1 overflow-hidden p-6 flex flex-col gap-5 bg-slate-50">
          
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 gap-4 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 shrink-0 items-start">
              {/* 🌟 좌상단: 대상 학생 선택 도구 (반 선택 + 학생 선택 + 학생 이름 검색) */}
              <div className="sm:col-span-8 flex flex-col gap-2 bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-600">
                    대상 학생 <span className="text-rose-500">*</span>
                    <span className="ml-1.5 text-[11px] font-bold text-rose-500">({filteredStudents.length}명)</span>
                  </label>
                  {/* 학생 이름 검색 입력창 */}
                  <div className="relative w-44 sm:w-48">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">🔍</span>
                    <input
                      type="text"
                      value={studentSearch}
                      onChange={(e) => handleStudentSearchChange(e.target.value)}
                      disabled={isReadonly}
                      placeholder="학생 이름 검색..."
                      className="w-full pl-7 pr-6 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-rose-500 disabled:opacity-70"
                    />
                    {studentSearch && !isReadonly && (
                      <button
                        type="button"
                        onClick={() => setStudentSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                        title="검색어 지우기"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 반 선택 드롭다운 + 학생 선택 드롭다운 2분할 */}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={selectedClassId}
                    onChange={(e) => handleClassChange(e.target.value)}
                    disabled={isReadonly}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 font-bold text-xs sm:text-sm text-slate-700 focus:outline-none focus:border-rose-600 bg-white disabled:opacity-70 truncate"
                  >
                    <option value="all">🏫 전체 반 ({effectiveStudents.length}명)</option>
                    {classOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="unassigned">반 미배정</option>
                  </select>

                  <select 
                    value={modalData.student_id}
                    onChange={(e) => handleModalChange("student_id", e.target.value)}
                    disabled={isReadonly}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 font-bold text-xs sm:text-sm text-slate-800 focus:outline-none focus:border-rose-600 bg-white disabled:opacity-70 truncate"
                  >
                    <option value="">
                      {filteredStudents.length === 0 ? "검색 결과 없음" : `학생 선택 (${filteredStudents.length}명)`}
                    </option>
                    {selectStudentOptions.map((s: any) => (
                      <option key={s.student_id} value={s.student_id}>
                        {s.name} ({s.grade || "-"}
                        {selectedClassId === "all" && s._classNamesStr ? ` · ${s._classNamesStr}` : ""})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 우상단: 요청 분류 (유형) */}
              <div className="sm:col-span-4 flex flex-col justify-between h-full">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">요청 분류 (유형) <span className="text-rose-500">*</span></label>
                  <select 
                    value={modalData.request_type} onChange={(e) => handleModalChange("request_type", e.target.value)}
                    disabled={isReadonly}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-rose-600 bg-slate-50 disabled:opacity-70"
                  >
                    <option value="결석/보강">결석/보강</option>
                    <option value="상담/기타">상담/기타</option>
                    <option value="수납/행정">수납/행정</option>
                    <option value="퇴원요청">퇴원요청</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-col flex-1 min-h-0">
              <label className="block text-xs font-bold text-slate-500 mb-1">요청 상세 내용 (사유) <span className="text-rose-500">*</span></label>
              <textarea 
                value={modalData.reason} onChange={(e) => handleModalChange("reason", e.target.value)}
                disabled={isReadonly}
                className="flex-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-medium text-sm focus:outline-none focus:border-rose-600 resize-none custom-scroll disabled:opacity-70" placeholder="학부모님의 요청 사항을 입력해주세요."
              ></textarea>
            </div>
            
            <div className="border-t border-slate-100 pt-3 grid grid-cols-2 lg:grid-cols-3 gap-4 items-end shrink-0">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">처리 담당자 배정</label>
                <select 
                  value={modalData.processed_instructor_id || ""} onChange={(e) => handleModalChange("processed_instructor_id", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-rose-600 bg-white"
                >
                  <option value="">지정 안 함</option>
                  {instructors.map(i => <option key={i.instructor_id} value={i.instructor_id}>{i.name} {i.position || '선생님'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">진행 상태</label>
                <select value={modalData.status} onChange={(e) => handleModalChange("status", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-rose-600 bg-white">
                  <option value="대기" className="text-rose-600">대기 (미처리)</option>
                  <option value="처리중" className="text-amber-600">처리 중</option>
                  <option value="완료" className="text-emerald-600">완료됨</option>
                </select>
              </div>
              <div className="col-span-2 lg:col-span-1 flex items-center h-[38px]">
                <label className="relative inline-flex items-center cursor-pointer group">
                  <input 
                    type="checkbox" checked={modalData.is_private} onChange={(e) => handleModalChange("is_private", e.target.checked)}
                    disabled={isReadonly}
                    className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-800"></div>
                  <span className="ml-2 text-xs font-bold text-slate-600 group-hover:text-slate-800 transition-colors">🔒 비공개 <span className="text-xs font-normal text-slate-400">(권한자 전용)</span></span>
                </label>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-700 text-sm">💬 처리 상황 / 코멘트</h3>
              <span className="text-xs font-bold text-slate-500">권한이 있는 작업자가 기록을 남길 수 있습니다.</span>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50/50 flex flex-col gap-3">
              {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-xs h-full">아직 등록된 코멘트가 없습니다.</div>
              ) : (
                comments.map(cmt => {
                  const isMe = cmt.authorName === currentUser.name;
                  const canDelete = isMe || isSuperAdminOrAdmin || canDeleteOthersComment; 
                  
                  return (
                    <div key={cmt.id} className={`flex flex-col w-full group ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`flex items-center gap-2 mb-1 ${!isMe ? "ml-1 flex-row-reverse" : ""}`}>
                        {canDelete && (
                          <button onClick={() => handleDeleteComment(cmt.id)} className="hidden group-hover:block text-slate-300 hover:text-rose-500 font-bold text-xs transition-colors p-1" title="댓글 삭제">✕</button>
                        )}
                        <span className="text-xs text-slate-500 font-bold">
                          {cmt.authorName} <span className="font-normal opacity-70 ml-1">{cmt.createdAt}</span>
                        </span>
                      </div>
                      <div className={`border px-3.5 py-2 rounded-2xl shadow-sm text-[13px] font-bold leading-snug max-w-[85%] break-words whitespace-pre-wrap ${isMe ? "bg-rose-100 text-rose-800 border-rose-200 rounded-tr-sm" : "bg-white text-slate-700 border-slate-200 rounded-tl-sm"}`}>
                        {cmt.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={commentEndRef} />
            </div>

            <div className="bg-white p-3 border-t border-slate-200 flex gap-2 items-end shrink-0">
              <textarea 
                value={commentInput} 
                onChange={(e) => {
                  setCommentInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = (e.target.scrollHeight) + 'px';
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                rows={1} className="flex-1 bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-rose-600 resize-none max-h-[80px] custom-scroll" placeholder="처리 과정이나 결과, 전달할 메모를 남겨주세요."
              ></textarea>
              <button onClick={handleAddComment} className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors shrink-0">기록 남기기</button>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
          <div className="flex gap-2 items-center">
            {modalData.request_id && (isSuperAdminOrAdmin || canDeletePost || String(modalData.author_id) === String(currentUser.instId)) && (
              <button onClick={deleteCS} className="px-4 py-2.5 bg-rose-50 text-rose-500 font-bold text-[13px] rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200 hover:border-transparent">요청 삭제</button>
            )}
            
            {modalData.request_id && (isSuperAdminOrAdmin || canSubmitAgenda) && (
              <button onClick={submitAgenda} className="px-4 py-2.5 bg-slate-100 text-brand font-bold text-[13px] rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors border border-slate-200 hover:border-blue-200 flex items-center gap-1.5">
                🎙️ 회의 안건 상정
              </button>
            )}
          </div>
          
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors">닫기</button>
            <button onClick={saveCS} disabled={isSaving || isReadonly} className="px-6 py-2.5 bg-rose-600 text-white font-bold text-sm rounded-lg hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50">
              {isSaving ? "저장 중..." : "변경사항 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}