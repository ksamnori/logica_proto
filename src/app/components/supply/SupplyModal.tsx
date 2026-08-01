// src/components/supply/SupplyModal.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface SupplyModalProps {
  isOpen: boolean;
  reqData: any; 
  currentUser: { instId: string; name: string; isAdmin: boolean };
  onClose: () => void;
  onSuccess: () => void;
}

export default function SupplyModal({ isOpen, reqData, currentUser, onClose, onSuccess }: SupplyModalProps) {
  const [type, setType] = useState("사무용품");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [commentInput, setCommentInput] = useState("");

  const commentEndRef = useRef<HTMLDivElement>(null);

  const isReadonly = reqData && !currentUser.isAdmin && String(reqData.author_id) !== String(currentUser.instId);

  useEffect(() => {
    if (isOpen) {
      if (reqData) {
        setType(reqData.request_type || "사무용품");
        setContent(reqData.content || "");
      } else {
        setType("사무용품");
        setContent("");
      }
      setCommentInput("");
    }
  }, [isOpen, reqData]);

  useEffect(() => {
    if (commentEndRef.current) {
      commentEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [reqData?.comments]);

  const handleSubmit = async () => {
    if (!content.trim()) return alert("신청 내용을 입력해주세요.");
    setIsSubmitting(true);
    
    const currentTimeISO = new Date().toISOString();
    const primaryKey = reqData?.request_id || reqData?.id; 

    try {
      if (reqData) {
        const { error } = await supabase.from("supply_request").update({
          request_type: type,
          content,
          updated_at: currentTimeISO,
          last_updater_name: currentUser.name
        }).eq("request_id", primaryKey);
        
        if (error) throw error;
      } else {
        const { error } = await supabase.from("supply_request").insert({
          request_type: type,
          content,
          status: "대기",
          author_id: currentUser.instId,
          author_name: currentUser.name,
          created_at: currentTimeISO,
          updated_at: currentTimeISO,
          last_updater_name: currentUser.name
        });
        
        if (error) throw error;
      }
      
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(`오류 발생: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentInput.trim() || !reqData) return;
    
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentTimeISO = now.toISOString();

    const newComment = {
      id: Date.now(),
      text: commentInput.trim(),
      authorId: currentUser.instId,
      authorName: currentUser.name,
      createdAt: dateStr
    };
    
    const updatedComments = [...(reqData.comments || []), newComment];
    const primaryKey = reqData.request_id || reqData.id;
    
    try {
      await supabase.from("supply_request").update({ 
        comments: updatedComments,
        updated_at: currentTimeISO,
        last_updater_name: currentUser.name
      }).eq("request_id", primaryKey);
      
      reqData.comments = updatedComments; 
      setCommentInput("");
      onSuccess(); 
    } catch (e) {
      alert("댓글 등록에 실패했습니다.");
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
    const updatedComments = reqData.comments.filter((c: any) => c.id !== commentId);
    const primaryKey = reqData.request_id || reqData.id;

    try {
      await supabase.from("supply_request").update({ 
        comments: updatedComments,
        updated_at: new Date().toISOString(),
        last_updater_name: currentUser.name
      }).eq("request_id", primaryKey);
      
      reqData.comments = updatedComments;
      onSuccess();
    } catch (e) {
      alert("댓글 삭제 실패");
    }
  };

  const handleDelete = async () => {
    if (!confirm("⚠️ 정말 이 신청 내역을 삭제하시겠습니까?")) return;
    const primaryKey = reqData.request_id || reqData.id;
    try {
      await supabase.from("supply_request").delete().eq("request_id", primaryKey);
      onSuccess();
      onClose();
    } catch (e) {
      alert("삭제 실패");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden h-[95vh] animate-[fadeIn_0.2s_ease-out]">
        
        {/* 헤더 */}
        <div className="bg-[#002864] p-5 flex justify-between items-center shrink-0">
          <h2 className="text-white font-bold text-lg tracking-tight">📦 {reqData ? "비품 신청 상세 내용" : "새 비품 신청하기"}</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 transition-colors font-bold text-2xl leading-none">&times;</button>
        </div>

        {/* 💡 컨테이너 영역 */}
        <div className="flex-1 overflow-hidden p-6 flex flex-col gap-5 bg-slate-50">
          
          {/* 💡 상단 본문 영역 (50%) */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 gap-4 overflow-hidden">
            <div className="shrink-0">
              <label className="block text-xs font-bold text-slate-500 mb-1.5">분류 (태그) <span className="text-rose-500">*</span></label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value)} 
                disabled={isReadonly}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#002864] disabled:opacity-70"
              >
                <option value="사무용품">📌 사무용품</option>
                <option value="교재/도서">📚 교재/도서</option>
                <option value="비품/장비">🖥️ 비품/장비</option>
                <option value="기타">기타</option>
              </select>
            </div>

            {/* 💡 텍스트 에어리어가 남은 공간 꽉 채우기 */}
            <div className="flex flex-col flex-1 min-h-0">
              <label className="block text-xs font-bold text-slate-500 mb-1.5">신청 내용 (품목, 수량, 구매 링크 등) <span className="text-rose-500">*</span></label>
              <textarea 
                value={content} 
                onChange={(e) => setContent(e.target.value)} 
                disabled={isReadonly}
                placeholder="예: A4 용지 2박스 주문 부탁드립니다. (링크: ...)"
                className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002864] resize-none custom-scroll disabled:opacity-70"
              />
            </div>
          </div>

          {/* 💡 하단 말꼬리 영역 (50%) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-700 text-sm">💬 진행 상황 및 소통 노트</h3>
              <span className="text-[10px] font-bold text-slate-500">모든 작업자가 기록을 남길 수 있습니다.</span>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50/50 flex flex-col gap-3">
              {(!reqData || !reqData.comments || reqData.comments.length === 0) ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-xs h-full">아직 등록된 진행 상황 노트가 없습니다.</div>
              ) : (
                reqData.comments.map((c: any) => {
                  const isMe = c.authorName === currentUser.name;
                  const canDelete = isMe || currentUser.isAdmin; 
                  return (
                    <div key={c.id} className={`flex flex-col w-full group ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`flex items-center gap-2 mb-1 ${!isMe ? "ml-1 flex-row-reverse" : ""}`}>
                        {canDelete && <button onClick={() => handleDeleteComment(c.id)} className="hidden group-hover:block text-slate-300 hover:text-rose-500 font-black text-xs transition-colors p-1" title="댓글 삭제">✕</button>}
                        <span className="text-[10px] text-slate-500 font-bold">
                          {c.authorName} <span className="font-normal opacity-70 ml-1">{c.createdAt}</span>
                        </span>
                      </div>
                      <div className={`border px-3.5 py-2 rounded-2xl shadow-sm text-[13px] font-bold leading-snug max-w-[85%] break-words whitespace-pre-wrap ${isMe ? "bg-blue-100 text-[#002864] border-blue-200 rounded-tr-sm" : "bg-white text-slate-700 border-slate-200 rounded-tl-sm"}`}>
                        {c.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={commentEndRef} />
            </div>

            {reqData && (
              <div className="bg-white p-3 border-t border-slate-200 flex gap-2 items-end shrink-0">
                <textarea 
                  value={commentInput} 
                  onChange={(e) => {
                    setCommentInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = (e.target.scrollHeight) + 'px';
                  }}
                  onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                  rows={1}
                  placeholder="진행 상황이나 전달할 메모를 남겨주세요." 
                  className="flex-1 bg-slate-100 px-3 py-2 border border-transparent rounded-lg text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#002864] resize-none max-h-[80px] custom-scroll" 
                />
                <button onClick={handleAddComment} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors shrink-0">기록 남기기</button>
              </div>
            )}
          </div>
        </div>

        {/* 푸터 영역 */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
          {reqData && (currentUser.isAdmin || String(reqData.author_id) === String(currentUser.instId)) ? (
            <button onClick={handleDelete} className="px-5 py-2 bg-rose-50 text-rose-500 font-bold text-sm rounded-lg hover:bg-rose-600 hover:text-white transition-colors border border-rose-200 hover:border-transparent">신청서 완전 삭제</button>
          ) : (
            <div></div> 
          )}
          
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors">닫기</button>
            <button onClick={handleSubmit} disabled={isSubmitting || isReadonly} className="px-6 py-2.5 bg-[#002864] hover:bg-blue-900 text-white rounded-lg font-bold text-sm shadow-sm transition-colors disabled:opacity-50">
              {isSubmitting ? "저장 중..." : "변경사항 저장"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}