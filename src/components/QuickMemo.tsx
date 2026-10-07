// src/components/QuickMemo.tsx
// 퀵 메모(포스트잇) — 플로팅 버튼에서 상단 헤더(알림 종 옆)로 옮겨온 기능
// - 헤더의 메모 버튼을 누르면 새 포스트잇이 생깁니다.
// - 포스트잇은 화면 어디로든 끌어서 옮길 수 있고, 내용은 1초 뒤 자동 저장됩니다.
// - 제목줄 더블클릭 = 접기/펼치기, X = 삭제
// - 권한: 최고관리자 또는 권한 설정의 '퀵 메모 (포스트잇) 이용'(action_use_memo)이 켜진 역할만 보입니다.
"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";

export interface QuickMemoRecord {
  memo_id: string;
  content: string;
  pos_x: number;
  pos_y: number;
  color: string;
  z_index: number;
  memo_type?: string;
  author_name?: string;
}

function DraggableMemo({
  memo,
  onUpdate,
  onDelete,
  onFocus,
}: {
  memo: QuickMemoRecord;
  onUpdate: (id: string, updates: Partial<QuickMemoRecord>) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const [content, setContent] = useState(memo.content || "");
  const [pos, setPos] = useState({
    x: Math.round(memo.pos_x || 100),
    y: Math.round(memo.pos_y || 100),
  });
  const [isFolded, setIsFolded] = useState(false);

  const memoRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef({ isDragging: false, startX: 0, startY: 0 });
  const typingTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const foldedState = localStorage.getItem(`memo_folded_${memo.memo_id}`);
    if (foldedState === "true") setIsFolded(true);
  }, [memo.memo_id]);

  // 창 크기가 줄어들어 메모가 화면 밖으로 나가는 것 방지
  useEffect(() => {
    const clamp = () => {
      if (!memoRef.current) return;
      const rect = memoRef.current.getBoundingClientRect();
      setPos((p) => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - rect.width)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - rect.height)),
      }));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfo.current = { isDragging: true, startX: e.clientX - pos.x, startY: e.clientY - pos.y };
    onFocus(memo.memo_id);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfo.current.isDragging || !e.isPrimary) return;
    let nextX = e.clientX - dragInfo.current.startX;
    let nextY = e.clientY - dragInfo.current.startY;
    if (memoRef.current) {
      const rect = memoRef.current.getBoundingClientRect();
      nextX = Math.max(0, Math.min(nextX, window.innerWidth - rect.width));
      nextY = Math.max(0, Math.min(nextY, window.innerHeight - rect.height));
    }
    setPos({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || !dragInfo.current.isDragging) return;
    dragInfo.current.isDragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onUpdate(memo.memo_id, { pos_x: Math.round(pos.x), pos_y: Math.round(pos.y) });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      onUpdate(memo.memo_id, { content: val });
    }, 1000);
  };

  const toggleFold = () => {
    const nextState = !isFolded;
    setIsFolded(nextState);
    localStorage.setItem(`memo_folded_${memo.memo_id}`, String(nextState));
  };

  let headerColor = "bg-yellow-300";
  if (memo.color === "bg-pink-200") headerColor = "bg-pink-300";
  else if (memo.color === "bg-blue-200") headerColor = "bg-blue-300";
  else if (memo.color === "bg-emerald-200") headerColor = "bg-emerald-300";

  return (
    <div
      ref={memoRef}
      onPointerDown={() => onFocus(memo.memo_id)}
      className={`fixed w-64 ${isFolded ? "h-8 rounded-lg" : "h-64 rounded-b-lg rounded-tr-lg"} ${memo.color} shadow-xl flex flex-col overflow-hidden border border-black/5 transition-[height,border-radius] duration-300 ease-in-out allow-guest-interaction`}
      style={{ left: 0, top: 0, transform: `translate(${pos.x}px, ${pos.y}px)`, zIndex: memo.z_index || 9900 }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={toggleFold}
        className={`h-8 ${headerColor} cursor-move flex justify-between items-center pl-3 pr-1.5 shrink-0 touch-none select-none`}
      >
        <span className="text-xs font-bold text-black/40">Logica Memo</span>
        <div className="flex items-center gap-0.5">
          <button onPointerDown={(e) => e.stopPropagation()} onClick={toggleFold} className="text-black/30 hover:text-black/70 transition-colors p-1.5" title={isFolded ? "펼치기" : "접기"}>
            {isFolded ? (
              <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
            ) : (
              <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"></path></svg>
            )}
          </button>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDelete(memo.memo_id)} className="text-black/30 hover:text-rose-500 transition-colors p-1.5" title="삭제">
            <svg className="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>

      <textarea
        value={content}
        onChange={handleContentChange}
        placeholder="내용을 입력하세요..."
        className={`flex-1 w-full bg-transparent resize-none p-3 focus:outline-none text-slate-800 text-[13px] font-medium placeholder:text-black/20 custom-scroll transition-opacity duration-200 ${isFolded ? "opacity-0" : "opacity-100"}`}
      />
      {!isFolded && <div className="absolute bottom-0 right-0 w-6 h-6 bg-black/5" style={{ clipPath: "polygon(100% 0, 0 100%, 100% 100%)" }}></div>}
    </div>
  );
}

/**
 * 상단 헤더용 메모 버튼 + 포스트잇 렌더링.
 * 헤더 알약(pill)은 backdrop-blur가 걸려 있어 그 안의 fixed 요소가 헤더 기준으로 갇히므로,
 * 포스트잇은 document.body로 포털을 띄워 화면 전체에 자유롭게 배치합니다.
 */
export default function QuickMemo({ instId: propInstId }: { instId?: string }) {
  const [instId, setInstId] = useState<string>(propInstId || "");
  const [memos, setMemos] = useState<QuickMemoRecord[]>([]);
  const [highestZ, setHighestZ] = useState(9900);
  const [canUseMemo, setCanUseMemo] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (propInstId) { setInstId(propInstId); return; }
    const localId = localStorage.getItem("logica_instructor_id");
    if (localId) setInstId(localId);
  }, [propInstId]);

  // 권한 확인 (기존 플로팅 버튼과 동일한 기준)
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      if (role === "SUPER_ADMIN") { setCanUseMemo(true); return; }
      if (role && tId) {
        const { data } = await supabase
          .from("tenant_role_permissions")
          .select("allowed_menus")
          .eq("tenant_id", tId)
          .eq("role_name", role)
          .maybeSingle();
        setCanUseMemo(!!(data && data.allowed_menus && data.allowed_menus.includes("action_use_memo")));
      }
    };
    checkAccess();
  }, [instId]);

  // 메모 불러오기
  useEffect(() => {
    if (!instId || !canUseMemo) return;
    const loadMemos = async () => {
      const { data } = await supabase
        .from("instructor_quick_memo")
        .select("*")
        .eq("instructor_id", instId)
        .order("z_index", { ascending: true });
      const rawMemos = (data as unknown as QuickMemoRecord[]) || [];
      setMemos(rawMemos);
      if (rawMemos.length > 0) {
        const maxZ = Math.max(...rawMemos.map((m) => m.z_index || 9900));
        setHighestZ(maxZ + 1);
      }
    };
    loadMemos();
  }, [instId, canUseMemo]);

  const createMemo = async () => {
    if (!instId || isCreating) return;
    setIsCreating(true);
    try {
      const colors = ["bg-yellow-200", "bg-pink-200", "bg-blue-200", "bg-emerald-200"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const newZ = highestZ + 1;

      // 헤더 바로 아래, 오른쪽에서부터 계단식으로 배치
      const count = memos.length;
      const startX = Math.max(0, window.innerWidth - 300 - (count % 10) * 20);
      const startY = Math.max(0, 90 + (count % 10) * 30);

      const { data } = await supabase
        .from("instructor_quick_memo")
        .insert({ instructor_id: instId, color: randomColor, pos_x: startX, pos_y: startY, z_index: newZ })
        .select()
        .single();

      if (data) {
        setMemos((prev) => [...prev, data as unknown as QuickMemoRecord]);
        setHighestZ(newZ);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const updateMemo = async (memoId: string, updates: Partial<QuickMemoRecord>) => {
    await supabase.from("instructor_quick_memo").update(updates).eq("memo_id", memoId);
    setMemos((prev) => prev.map((m) => (m.memo_id === memoId ? { ...m, ...updates } : m)));
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 메모를 삭제하시겠습니까?")) return;
    await supabase.from("instructor_quick_memo").delete().eq("memo_id", memoId);
    setMemos((prev) => prev.filter((m) => m.memo_id !== memoId));
    localStorage.removeItem(`memo_folded_${memoId}`);
  };

  const focusMemo = async (memoId: string) => {
    const targetMemo = memos.find((m) => m.memo_id === memoId);
    if (targetMemo && targetMemo.z_index !== highestZ) {
      const newZ = highestZ + 1;
      setHighestZ(newZ);
      await updateMemo(memoId, { z_index: newZ });
    }
  };

  if (!canUseMemo) return null;

  return (
    <>
      <button
        type="button"
        onClick={createMemo}
        disabled={isCreating}
        className="relative w-10 h-10 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center hover:bg-amber-100 transition-colors focus:outline-none disabled:opacity-60 allow-guest-interaction"
        title="새 메모(포스트잇) 추가"
        aria-label="새 메모 추가"
      >
        <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        {memos.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-amber-400 text-amber-950 text-xs font-bold rounded-full border-2 border-white flex items-center justify-center leading-none pointer-events-none">
            {memos.length > 99 ? "99+" : memos.length}
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          <>
            {memos.map((memo) => (
              <DraggableMemo key={memo.memo_id} memo={memo} onUpdate={updateMemo} onDelete={deleteMemo} onFocus={focusMemo} />
            ))}
          </>,
          document.body
        )}
    </>
  );
}
