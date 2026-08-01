// src/components/cs/CSModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface CSModalProps {
  isOpen: boolean;
  reqData: any | null;
  currentUser: { instId: string; name: string; isAdmin: boolean };
  students: any[];
  instructors: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function CSModal({ isOpen, reqData, currentUser, students, instructors, onClose, onSuccess }: CSModalProps) {
  const [modalData, setModalData] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const commentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (reqData) {
        setModalData({ ...reqData });
        setComments(reqData.comments || []);
      } else {
        setModalData({ 
          request_id: "", student_id: "", request_type: "상담/기타", reason: "", 
          processed_instructor_id: currentUser.instId, status: "대기", is_private: false 
        });
        setComments([]);
      }
      setCommentInput("");
    }
  }, [isOpen, reqData, currentUser]);

  useEffect(() => {
    if (commentEndRef.current) {
      commentEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments]);

  const handleModalChange = (field: string, value: any) => {
    setModalData((prev: any) => ({ ...prev, [field]: value }));
  };

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
      await supabase.from("parent_request_log").update({ 
        comments: updatedComments,
        updated_at: currentTimeISO,
        last_updater_name: currentUser.name
      }).eq("request_id", modalData.request_id);

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
      await supabase.from("parent_request_log").update({ 
        comments: updatedComments,
        updated_at: new Date().toISOString(),
        last_updater_name: currentUser.name
      }).eq("request_id", modalData.request_id);
      
      setComments(updatedComments);
      onSuccess();
    } catch (e) {
      alert("댓글 삭제 실패");
    }
  };

  const saveCS = async () => {
    if (!modalData.student_id || !modalData.reason?.trim()) return alert("학생과 상세 내용은 필수 항목입니다.");

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
        await supabase.from("parent_request_log").update(payload).eq("request_id", modalData.request_id);
        alert("성공적으로 저장되었습니다.");
      } else {
        payload.author_id = currentUser.instId;
        payload.created_at = currentTimeISO;
        await supabase.from("parent_request_log").insert([payload]);
        alert("CS 기록이 등록되었습니다.");
      }
      onSuccess();
      onClose();
    } catch (e) { 
      alert("저장 실패"); 
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCS = async () => {
    if (!confirm("⚠️ 이 CS 요청 기록을 완전히 삭제하시겠습니까?\n댓글 및 처리 내역이 모두 사라집니다.")) return;
    try {
      await supabase.from("parent_request_log").delete().eq("request_id", modalData.request_id);
      alert("삭제되었습니다.");
      onSuccess();
      onClose();
    } catch (e) { alert("삭제 실패"); }
  };

  if (!isOpen || !modalData) return null;

  const isReadonly = modalData.request_id && !currentUser.isAdmin && String(modalData.author_id) !== String(currentUser.instId);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        
        {/* 헤더 */}
        <div className="bg-rose-600 p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-tight">🚨 CS / 학부모 요청 상세</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        {/* 💡 컨테이너 영역 */}
        <div className="flex-1 overflow-hidden p-6 flex flex-col gap-5 bg-slate-50">
          
          {/* 💡 상단 본문 영역 (50%) */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 gap-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-4 shrink-0">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-bold text-slate-500 mb-1">대상 학생 <span className="text-rose-500">*</span></label>
                <select 
                  value={modalData.student_id} onChange={(e) => handleModalChange("student_id", e.target.value)}
                  disabled={isReadonly}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-rose-600 bg-slate-50 disabled:opacity-70"
                >
                  <option value="">학생 선택</option>
                  {students.map(s => <option key={s.student_id} value={s.student_id}>{s.name} ({s.grade || '-'})</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-bold text-slate-500 mb-1">요청 분류 (유형) <span className="text-rose-500">*</span></label>
                <select 
                  value={modalData.request_type} onChange={(e) => handleModalChange("request_type", e.target.value)}
                  disabled={isReadonly}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm focus:outline-none focus:border-rose-600 bg-slate-50 disabled:opacity-70"
                >
                  <option value="결석/보강">결석/보강</option>
                  <option value="상담/기타">상담/기타</option>
                  <option value="수납/행정">수납/행정</option>
                  <option value="퇴원요청">퇴원요청</option>
                </select>
              </div>
            </div>

            {/* 💡 텍스트 에어리어가 남은 공간 꽉 채우기 */}
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
                <select value={modalData.status} onChange={(e) => handleModalChange("status", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-black text-sm focus:outline-none focus:border-rose-600 bg-white">
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
                  <span className="ml-2 text-xs font-bold text-slate-600 group-hover:text-slate-800 transition-colors">🔒 비공개 <span className="text-[10px] font-normal text-slate-400">(권한자 전용)</span></span>
                </label>
              </div>
            </div>
          </div>

          {/* 💡 하단 말꼬리 영역 (50%) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-700 text-sm">💬 처리 상황 / 코멘트</h3>
              <span className="text-[10px] font-bold text-slate-500">권한이 있는 작업자가 기록을 남길 수 있습니다.</span>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50/50 flex flex-col gap-3">
              {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-xs h-full">아직 등록된 코멘트가 없습니다.</div>
              ) : (
                comments.map(cmt => {
                  const isMe = cmt.authorName === currentUser.name;
                  const canDelete = isMe || currentUser.isAdmin; 
                  return (
                    <div key={cmt.id} className={`flex flex-col w-full group ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`flex items-center gap-2 mb-1 ${!isMe ? "ml-1 flex-row-reverse" : ""}`}>
                        {canDelete && <button onClick={() => handleDeleteComment(cmt.id)} className="hidden group-hover:block text-slate-300 hover:text-rose-500 font-black text-xs transition-colors p-1" title="댓글 삭제">✕</button>}
                        <span className="text-[10px] text-slate-500 font-bold">
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
        
        {/* 푸터 영역 */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
          {modalData.request_id && (currentUser.isAdmin || String(modalData.author_id) === String(currentUser.instId)) ? (
            <button onClick={deleteCS} className="px-5 py-2 bg-rose-50 text-rose-500 font-bold text-sm rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200 hover:border-transparent">요청 완전 삭제</button>
          ) : <div></div>}
          
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