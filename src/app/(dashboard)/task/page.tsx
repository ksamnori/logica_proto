// src/components/task/TaskModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface TaskModalProps {
  isOpen: boolean;
  task: any | null;
  currentUser: { instId: string; name: string; isAdmin: boolean };
  onClose: () => void;
  onSuccess: () => void;
}

export default function TaskModal({ 
  isOpen, 
  task, 
  currentUser, 
  onClose, 
  onSuccess 
}: TaskModalProps) {
  const [modalData, setModalData] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  const [isSuperAdminOrAdmin, setIsSuperAdminOrAdmin] = useState(false);
  
  // 🌟 세부 권한 상태
  const [canDeletePost, setCanDeletePost] = useState(false);
  const [canDeleteOthersComment, setCanDeleteOthersComment] = useState(false);
  const [canSubmitAgenda, setCanSubmitAgenda] = useState(false); // 🌟 회의 안건 상정 권한 추가

  const commentEndRef = useRef<HTMLDivElement>(null);

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
        setCanSubmitAgenda(true); // 🌟 최고관리자 무조건 허용
      } else if (tId) {
        const { data } = await supabase
          .from('tenant_role_permissions')
          .select('allowed_menus')
          .eq('tenant_id', tId)
          .eq('role_name', role)
          .maybeSingle();

        if (data && data.allowed_menus) {
          setCanDeletePost(data.allowed_menus.includes('action_delete_task'));
          setCanDeleteOthersComment(data.allowed_menus.includes('action_delete_others_comment'));
          setCanSubmitAgenda(data.allowed_menus.includes('action_submit_task_agenda')); // 🌟 안건 상정 권한 확인
        } else {
          setCanDeletePost(false);
          setCanDeleteOthersComment(false);
          setCanSubmitAgenda(false);
        }
      }
    };

    if (isOpen) {
      checkPerms();
      if (task) {
        setModalData({ ...task });
        setComments(task.comments || []);
      } else {
        setModalData({ memo_id: "", memo_type: "일반공지", content: "", status: "할일" });
        setComments([]);
      }
      setCommentInput("");
    }
  }, [isOpen, task]);

  useEffect(() => {
    if (commentEndRef.current) {
      commentEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments]);

  const handleModalChange = (field: string, value: string) => {
    setModalData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleAddComment = async () => {
    if (!commentInput.trim() || !modalData?.memo_id) return;
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
      await supabase.from("instructor_memo").update({ 
        comments: updatedComments,
        updated_at: currentTimeISO,
        last_updater_name: currentUser.name
      }).eq("memo_id", modalData.memo_id);

      setComments(updatedComments);
      setCommentInput("");
      onSuccess(); 
    } catch (e) {
      alert("댓글 등록에 실패했습니다.");
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
    const updatedComments = comments.filter(c => c.id !== commentId);
    
    try {
      await supabase.from("instructor_memo").update({ 
        comments: updatedComments,
        updated_at: new Date().toISOString(),
        last_updater_name: currentUser.name
      }).eq("memo_id", modalData.memo_id);
      
      setComments(updatedComments);
      onSuccess();
    } catch (e) {
      alert("댓글 삭제 실패");
    }
  };

  const saveTask = async () => {
    if (!modalData.content?.trim()) return alert("본문 내용을 입력해주세요.");

    const myTenantId = localStorage.getItem("logica_tenant_id");

    setIsSaving(true);
    const currentTimeISO = new Date().toISOString();

    const payload: any = {
      memo_type: modalData.memo_type,
      content: modalData.content,
      status: modalData.status,
      comments: comments,
      updated_at: currentTimeISO,
      last_updater_name: currentUser.name
    };

    try {
      if (modalData.memo_id) {
        await supabase.from("instructor_memo").update(payload).eq("memo_id", modalData.memo_id);
        alert("성공적으로 저장되었습니다.");
      } else {
        if (!myTenantId) { alert("소속 지점 정보가 없습니다."); setIsSaving(false); return; }
        
        payload.instructor_id = currentUser.instId;
        payload.author_name = currentUser.name;
        payload.created_at = currentTimeISO;
        payload.tenant_id = myTenantId; 
        await supabase.from("instructor_memo").insert([payload]);
        alert("업무(공지)가 등록되었습니다.");
      }
      onSuccess();
      onClose();
    } catch (e) { 
      alert("저장 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTask = async () => {
    if (!confirm("⚠️ 이 업무/공지 기록을 완전히 삭제하시겠습니까?\n댓글 등 모든 내역이 사라집니다.")) return;
    try {
      await supabase.from("instructor_memo").delete().eq("memo_id", modalData.memo_id);
      alert("삭제되었습니다.");
      onSuccess();
      onClose();
    } catch (e) { alert("삭제 실패"); }
  };

  const submitAgenda = async () => {
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다.");

    try {
      await supabase.from("agenda").insert({
        title: `[업무공유] ${modalData.memo_type}`,
        content: modalData.content,
        type: "업무",
        source: "Task",
        source_id: modalData.memo_id,
        created_by: currentUser.instId,
        tenant_id: myTenantId
      });
      alert("해당 업무가 회의 안건으로 상정되었습니다.");
    } catch (e) {
      alert("안건 상정 실패");
    }
  };

  if (!isOpen || !modalData) return null;

  const isReadonly = modalData.memo_id && !isSuperAdminOrAdmin && String(modalData.instructor_id) !== String(currentUser.instId);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        
        <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-tight">📌 업무 공유 / 상세 공지</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="flex-1 overflow-hidden p-6 bg-slate-50 flex flex-col gap-5">
          
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 gap-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-4 shrink-0">
              <div className="col-span-1">
                <label className="block text-xs font-bold text-slate-500 mb-1">분류 (태그) <span className="text-rose-500">*</span></label>
                <select 
                  value={modalData.memo_type} onChange={(e) => handleModalChange("memo_type", e.target.value)}
                  disabled={isReadonly}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-[#002864] bg-slate-50 disabled:opacity-70"
                >
                  <option value="긴급공지">🚨 긴급공지</option>
                  <option value="일반공지">📢 일반공지</option>
                  <option value="학생인계">🤝 학생인계</option>
                  <option value="행정요청">📝 행정요청</option>
                </select>
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-bold text-slate-500 mb-1">진행 상태</label>
                <select value={modalData.status} onChange={(e) => handleModalChange("status", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-black text-sm focus:outline-none focus:border-[#002864] bg-white">
                  <option value="할일" className="text-slate-600">할 일 (To-Do)</option>
                  <option value="진행중" className="text-blue-600">진행 중</option>
                  <option value="완료" className="text-emerald-600">완료됨</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col flex-1 min-h-0">
              <label className="block text-xs font-bold text-slate-500 mb-1">본문 내용 작성 <span className="text-rose-500">*</span></label>
              <textarea 
                value={modalData.content} onChange={(e) => handleModalChange("content", e.target.value)} 
                disabled={isReadonly}
                className="flex-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-medium text-sm focus:outline-none focus:border-[#002864] resize-none custom-scroll disabled:opacity-70" placeholder="내용을 입력하세요."
              ></textarea>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-700 text-sm">💬 업무 처리 노트 및 소통 (말꼬리)</h3>
              <span className="text-[10px] font-bold text-slate-500">모든 작업자가 기록을 남길 수 있습니다.</span>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50/50 flex flex-col gap-3">
              {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-xs h-full">아직 등록된 소통 노트가 없습니다.</div>
              ) : (
                comments.map(cmt => {
                  const isMe = cmt.authorName === currentUser.name;
                  const canDelete = isMe || isSuperAdminOrAdmin || canDeleteOthersComment; 
                  
                  return (
                    <div key={cmt.id} className={`flex flex-col w-full group ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`flex items-center gap-2 mb-1 ${!isMe ? "ml-1 flex-row-reverse" : ""}`}>
                        {canDelete && (
                          <button onClick={() => handleDeleteComment(cmt.id)} className="hidden group-hover:block text-slate-300 hover:text-rose-500 font-black text-xs transition-colors p-1" title="댓글 삭제">✕</button>
                        )}
                        <span className="text-[10px] text-slate-500 font-bold">
                          {cmt.authorName} <span className="font-normal opacity-70 ml-1">{cmt.createdAt}</span>
                        </span>
                      </div>
                      <div className={`border px-3.5 py-2 rounded-2xl shadow-sm text-[13px] font-bold leading-snug max-w-[85%] break-words whitespace-pre-wrap ${isMe ? "bg-blue-100 text-[#002864] border-blue-200 rounded-tr-sm" : "bg-white text-slate-700 border-slate-200 rounded-tl-sm"}`}>
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
                rows={1} className="flex-1 bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#002864] resize-none max-h-[80px] custom-scroll" placeholder="진행 상황이나 피드백 메모를 남겨주세요."
              ></textarea>
              <button onClick={handleAddComment} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors shrink-0">기록 남기기</button>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
          <div className="flex gap-2 items-center">
            {modalData.memo_id && (isSuperAdminOrAdmin || canDeletePost || String(modalData.instructor_id) === String(currentUser.instId)) && (
              <button onClick={deleteTask} className="px-4 py-2.5 bg-rose-50 text-rose-500 font-bold text-[13px] rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200 hover:border-transparent">업무 삭제</button>
            )}
            
            {/* 🌟 [수정] 권한이 있는 경우에만 '회의 안건 상정' 버튼 노출 */}
            {modalData.memo_id && (isSuperAdminOrAdmin || canSubmitAgenda) && (
              <button onClick={submitAgenda} className="px-4 py-2.5 bg-slate-100 text-[#002864] font-bold text-[13px] rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors border border-slate-200 hover:border-blue-200 flex items-center gap-1.5">
                🎙️ 회의 안건 상정
              </button>
            )}
          </div>
          
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors">닫기</button>
            <button onClick={saveTask} disabled={isSaving || isReadonly} className="px-6 py-2.5 bg-[#002864] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm disabled:opacity-50">
              {isSaving ? "저장 중..." : "변경사항 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}