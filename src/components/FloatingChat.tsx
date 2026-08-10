// src/components/FloatingChat.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

// 🌟 개별 포스트잇 위젯 컴포넌트
function DraggableMemo({ 
  memo, 
  onUpdate, 
  onDelete, 
  onFocus 
}: { 
  memo: any; 
  onUpdate: (id: string, updates: any) => void; 
  onDelete: (id: string) => void; 
  onFocus: (id: string) => void; 
}) {
  const [content, setContent] = useState(memo.content || "");
  const [pos, setPos] = useState({ x: memo.pos_x || 100, y: memo.pos_y || 100 });
  const [isFolded, setIsFolded] = useState(false); 
  
  const memoRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef({ isDragging: false, startX: 0, startY: 0 });
  const typingTimer = useRef<any>(null);

  useEffect(() => {
    const foldedState = localStorage.getItem(`memo_folded_${memo.memo_id}`);
    if (foldedState === 'true') setIsFolded(true);
  }, [memo.memo_id]);

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
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      nextX = Math.max(0, Math.min(nextX, maxX));
      nextY = Math.max(0, Math.min(nextY, maxY));
    }

    setPos({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || !dragInfo.current.isDragging) return;
    dragInfo.current.isDragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onUpdate(memo.memo_id, { pos_x: pos.x, pos_y: pos.y });
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
      className={`fixed w-64 ${isFolded ? 'h-8 rounded-lg' : 'h-64 rounded-b-lg rounded-tr-lg'} ${memo.color} shadow-xl flex flex-col overflow-hidden border border-black/5 transition-[height,border-radius] duration-300 ease-in-out`}
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
        <span className="text-[10px] font-black text-black/40">Logica Memo</span>
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
        className={`flex-1 w-full bg-transparent resize-none p-3 focus:outline-none text-slate-800 text-[13px] font-medium placeholder:text-black/20 custom-scroll transition-opacity duration-200 ${isFolded ? 'opacity-0' : 'opacity-100'}`}
      />
      {!isFolded && <div className="absolute bottom-0 right-0 w-6 h-6 bg-black/5" style={{ clipPath: "polygon(100% 0, 0 100%, 100% 100%)" }}></div>}
    </div>
  );
}

export default function FloatingChat({ instId, onMicClick }: { instId: string; onMicClick?: () => void }) {
  const getProfileImageUrl = (path: string | null | undefined) => {
    if (!path || path.trim() === "") return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("system_images").getPublicUrl(path);
    return data.publicUrl;
  };

  const [isHQ, setIsHQ] = useState(false); 
  const [myTenantName, setMyTenantName] = useState<string>(""); 
  const [myDeptName, setMyDeptName] = useState<string>("");

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"parent" | "staff">("staff"); 

  const [activeChatView, setActiveChatView] = useState<"list" | "room" | "new">("list");
  const [chatRooms, setChatRooms] = useState<any[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeParentName, setActiveParentName] = useState("");
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newChatParents, setNewChatParents] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);

  const [staffChatView, setStaffChatView] = useState<"list" | "room" | "new">("list");
  const [staffRooms, setStaffRooms] = useState<any[]>([]);
  const [activeStaffRoomId, setActiveStaffRoomId] = useState<string | null>(null);
  const [activeStaffRoomName, setActiveStaffRoomName] = useState("");
  const [staffMessages, setStaffMessages] = useState<any[]>([]);
  const [staffChatInput, setStaffChatInput] = useState("");
  const [staffUnreadCount, setStaffUnreadCount] = useState(0);
  const [allInstructors, setAllInstructors] = useState<any[]>([]);
  const [staffSearchKeyword, setStaffSearchKeyword] = useState("");
  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const [staffRoomMembers, setStaffRoomMembers] = useState<any[]>([]);
  
  const [typingStaffName, setTypingStaffName] = useState<string | null>(null);

  const [expandedTenants, setExpandedTenants] = useState<string[]>([]);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);

  const [memos, setMemos] = useState<any[]>([]);
  const [highestZ, setHighestZ] = useState(9900);

  const activeRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  const activeStaffRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeStaffRoomIdRef.current = activeStaffRoomId; }, [activeStaffRoomId]);

  const activeTabRef = useRef<"parent" | "staff">(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const isChatOpenRef = useRef<boolean>(isChatOpen);
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);

  const activeChannelRef = useRef<any>(null);
  const activeStaffChannelRef = useRef<any>(null); 
  const globalChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);
  const staffTypingTimerRef = useRef<any>(null); 

  const iconRef = useRef<HTMLDivElement>(null);
  const iconDrag = useRef({ 
    isDragging: false, startX: 0, startY: 0, clickX: 0, clickY: 0, 
    minX: -9999, maxX: 9999, minY: -9999, maxY: 9999,
    targetNode: null as EventTarget | null 
  });
  const iconPos = useRef({ x: 0, y: 0 });

  const handleIconDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const baseLeft = rect.left - iconPos.current.x;
    const baseTop = rect.top - iconPos.current.y;
    iconDrag.current = {
      isDragging: true, startX: e.clientX - iconPos.current.x, startY: e.clientY - iconPos.current.y,
      clickX: e.clientX, clickY: e.clientY,
      minX: -baseLeft, maxX: window.innerWidth - rect.width - baseLeft,
      minY: -baseTop, maxY: window.innerHeight - rect.height - baseTop,
      targetNode: e.target 
    };
  };
  
  const handleIconMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!iconDrag.current.isDragging || !iconRef.current) return;
    let nextX = Math.max(iconDrag.current.minX, Math.min(e.clientX - iconDrag.current.startX, iconDrag.current.maxX));
    let nextY = Math.max(iconDrag.current.minY, Math.min(e.clientY - iconDrag.current.startY, iconDrag.current.maxY));
    iconPos.current = { x: nextX, y: nextY };
    iconRef.current.style.transform = `translate(${nextX}px, ${nextY}px)`;
  };
  
  const handleIconUp = (e: React.PointerEvent<HTMLDivElement>) => {
    iconDrag.current.isDragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    if (Math.abs(e.clientX - iconDrag.current.clickX) < 5 && Math.abs(e.clientY - iconDrag.current.clickY) < 5) {
      const target = iconDrag.current.targetNode as HTMLElement;
      if (target && target.closest('.memo-btn')) {
        createMemo();
      } else if (target && target.closest('.chat-btn')) {
        if (isChatOpen) { setActiveRoomId(null); setActiveChatView("list"); setActiveStaffRoomId(null); setStaffChatView("list"); }
        setIsChatOpen(!isChatOpen);
      } else if (target && target.closest('.mic-btn')) {
        if (onMicClick) onMicClick();
      }
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const panelPos = useRef({ x: 0, y: 0 });
  const panelDrag = useRef({ isDragging: false, startX: 0, startY: 0, minX: -9999, maxX: 9999, minY: -9999, maxY: 9999 });

  const handlePanelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return; 
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!panelRef.current) return;
    
    const rect = panelRef.current.getBoundingClientRect();
    const baseLeft = rect.left - panelPos.current.x;
    const baseTop = rect.top - panelPos.current.y;
    
    let minX = -baseLeft;
    let maxX = window.innerWidth - rect.width - baseLeft;
    let minY = -baseTop;
    let maxY = window.innerHeight - rect.height - baseTop;

    if (maxX < minX) maxX = minX;
    if (maxY < minY) maxY = minY;

    panelDrag.current = {
      isDragging: true, 
      startX: e.clientX - panelPos.current.x, 
      startY: e.clientY - panelPos.current.y,
      minX, maxX, minY, maxY
    };
  };

  const handlePanelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelDrag.current.isDragging || !panelRef.current || !e.isPrimary) return;
    
    let nextX = e.clientX - panelDrag.current.startX;
    let nextY = e.clientY - panelDrag.current.startY;
    
    nextX = Math.max(panelDrag.current.minX, Math.min(nextX, panelDrag.current.maxX));
    nextY = Math.max(panelDrag.current.minY, Math.min(nextY, panelDrag.current.maxY));
    
    panelPos.current = { x: nextX, y: nextY };
    panelRef.current.style.transform = `translate(${nextX}px, ${nextY}px) scale(${isChatOpen ? 1 : 0.95})`; 
  };

  const handlePanelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    panelDrag.current.isDragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
  useEffect(() => { scrollToBottom(); }, [chatMessages, staffMessages, isTyping, typingStaffName, activeTab]);

  useEffect(() => {
    const handleFocus = async () => {
      if (isChatOpenRef.current) {
        if (activeTabRef.current === "parent" && activeRoomIdRef.current) {
          await supabase.from("chat_message").update({ is_read: true })
            .eq("room_id", activeRoomIdRef.current)
            .eq("sender_type", "parent")
            .eq("is_read", false);
          loadChatRooms();
        } else if (activeTabRef.current === "staff" && activeStaffRoomIdRef.current) {
          await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() })
            .eq("room_id", activeStaffRoomIdRef.current)
            .eq("instructor_id", instId);
          loadStaffRooms();
        }
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [instId]);

  useEffect(() => {
    if (!instId) return;

    const checkHQStatus = async () => {
      const { data: me } = await supabase.from('instructor').select('tenant_id, department').eq('instructor_id', instId).maybeSingle();
      if (me) {
        setMyDeptName(me.department || ""); 
        if (me.tenant_id) {
          const { data: myTenant } = await supabase.from('academy_tenant').select('tenant_type, name').eq('tenant_id', me.tenant_id).maybeSingle();
          if (myTenant) {
            setMyTenantName(myTenant.name || ""); 
            if (myTenant.tenant_type === 'HQ') {
              setIsHQ(true);
              setActiveTab('staff'); 
            } else {
              loadChatRooms(); 
            }
          } else {
            loadChatRooms();
          }
        } else {
          loadChatRooms(); 
        }
      }
    };

    checkHQStatus();
    loadStaffRooms(); 
    loadMemos();

    const channelName = `inst_global_${instId}`;
    supabase.getChannels().forEach(ch => { if (ch.topic.includes(channelName)) supabase.removeChannel(ch); });

    globalChannelRef.current = supabase.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_message" }, async (payload) => {
        setIsTyping(false);
        const isRoomActive = document.hasFocus() && isChatOpenRef.current && activeTabRef.current === "parent" && String(activeRoomIdRef.current) === String(payload.new.room_id);

        if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
          setChatMessages(prev => prev.find(m => m.message_id === payload.new.message_id) ? prev : [...prev, payload.new]);
        }
        if (isRoomActive && payload.new.sender_type === "parent") {
          await supabase.from("chat_message").update({ is_read: true }).eq("message_id", payload.new.message_id);
        }
        loadChatRooms(); 
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_message" }, (payload) => {
        if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
          setChatMessages(prev => prev.map(m => m.message_id === payload.new.message_id ? { ...m, is_read: payload.new.is_read } : m));
        }
        loadChatRooms();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_room" }, () => loadChatRooms())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_chat_message" }, async (payload) => {
        setTypingStaffName(null); 
        const isRoomActive = document.hasFocus() && isChatOpenRef.current && activeTabRef.current === "staff" && String(activeStaffRoomIdRef.current) === String(payload.new.room_id);

        if (String(activeStaffRoomIdRef.current) === String(payload.new.room_id)) {
          setStaffMessages(prev => prev.find(m => m.message_id === payload.new.message_id) ? prev : [...prev, payload.new]);
        }
        if (isRoomActive && payload.new.sender_id !== instId) {
          await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() }).eq("room_id", payload.new.room_id).eq("instructor_id", instId);
        }
        
        await supabase.from("internal_chat_member").update({ is_active: true }).eq("room_id", payload.new.room_id).eq("instructor_id", instId);
        loadStaffRooms(); 
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "internal_chat_member" }, (payload) => {
        if (String(activeStaffRoomIdRef.current) === String(payload.new.room_id)) {
          setStaffRoomMembers(prev => prev.map(m => m.instructor_id === payload.new.instructor_id ? { ...m, last_read_at: payload.new.last_read_at } : m));
        }
        loadStaffRooms(); 
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_chat_member" }, () => loadStaffRooms())
      .subscribe();

    return () => { 
      if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current); 
      if (activeChannelRef.current) supabase.removeChannel(activeChannelRef.current);
      if (activeStaffChannelRef.current) supabase.removeChannel(activeStaffChannelRef.current);
    };
  }, [instId]);

  const loadMemos = async () => {
    const { data } = await supabase.from('instructor_quick_memo').select('*').eq('instructor_id', instId).order('z_index', { ascending: true });
    if (data && data.length > 0) {
      setMemos(data);
      const maxZ = Math.max(...data.map(m => m.z_index || 9900));
      setHighestZ(maxZ + 1);
    }
  };

  const createMemo = async () => {
    const colors = ["bg-yellow-200", "bg-pink-200", "bg-blue-200", "bg-emerald-200"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newZ = highestZ + 1;
    
    const count = memos.length;
    let startX = window.innerWidth - 290 - ((count % 10) * 20); 
    let startY = 80 + ((count % 10) * 40); 
    
    startX = Math.max(0, startX);
    startY = Math.max(0, startY);

    const { data } = await supabase.from('instructor_quick_memo').insert({
      instructor_id: instId,
      color: randomColor,
      pos_x: startX,
      pos_y: startY,
      z_index: newZ
    }).select().single();

    if (data) {
      setMemos(prev => [...prev, data]);
      setHighestZ(newZ);
    }
  };

  const updateMemo = async (memoId: string, updates: any) => {
    await supabase.from('instructor_quick_memo').update(updates).eq('memo_id', memoId);
    setMemos(prev => prev.map(m => m.memo_id === memoId ? { ...m, ...updates } : m));
  };

  const deleteMemo = async (memoId: string) => {
    if(!confirm("이 메모를 삭제하시겠습니까?")) return;
    await supabase.from('instructor_quick_memo').delete().eq('memo_id', memoId);
    setMemos(prev => prev.filter(m => m.memo_id !== memoId));
    localStorage.removeItem(`memo_folded_${memoId}`);
  };

  const focusMemo = async (memoId: string) => {
    const targetMemo = memos.find(m => m.memo_id === memoId);
    if (targetMemo && targetMemo.z_index !== highestZ) {
      const newZ = highestZ + 1;
      setHighestZ(newZ);
      await updateMemo(memoId, { z_index: newZ });
    }
  };

  const loadChatRooms = async () => {
    if (isHQ) return; 

    const { data } = await supabase.from("chat_room")
      .select("room_id, parent_id, parent(phone, student(name)), chat_message(message_id, content, created_at, sender_type, is_read)")
      .eq("instructor_id", instId);

    let totalUnread = 0;
    const rooms = (data || []).map((r: any) => {
      const msgs = r.chat_message || [];
      const isRoomActive = isChatOpenRef.current && activeTabRef.current === "parent" && r.room_id === activeRoomIdRef.current;
      const unread = msgs.filter((m: any) => m.sender_type === "parent" && !m.is_read && !isRoomActive).length;
      if (!isRoomActive) totalUnread += unread;
      const sortedMsgs = msgs.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return { ...r, chat_message: sortedMsgs, unreadCount: isRoomActive ? 0 : unread };
    });

    rooms.sort((a, b) => {
      const aTime = a.chat_message.length > 0 ? new Date(a.chat_message[0].created_at).getTime() : 0;
      const bTime = b.chat_message.length > 0 ? new Date(b.chat_message[0].created_at).getTime() : 0;
      return bTime - aTime;
    });

    setChatRooms(rooms);
    setUnreadCount(totalUnread);
  };

  const loadStaffRooms = async () => {
    try {
      const { data } = await supabase.from('internal_chat_member')
        .select('room_id, internal_chat_room(title, room_type, created_at), last_read_at')
        .eq('instructor_id', instId)
        .eq('is_active', true); 
      
      let totalUnread = 0;
      const roomsWithData = await Promise.all((data || []).map(async (r: any) => {
        const { data: msgs } = await supabase.from('internal_chat_message')
          .select('message_id, content, created_at, sender_id')
          .eq('room_id', r.room_id)
          .order('created_at', { ascending: false });

        let displayTitle = r.internal_chat_room?.title || '선생님 대화방';
        let displayAvatar = null;
        
        if (r.internal_chat_room?.room_type === 'DIRECT') {
          const { data: otherMember } = await supabase.from('internal_chat_member')
            .select('instructor_id')
            .eq('room_id', r.room_id)
            .neq('instructor_id', instId)
            .maybeSingle();
          
          if (otherMember?.instructor_id) {
            const { data: instData } = await supabase.from('instructor')
              .select('name, position, chat_position, profile_image_url')
              .eq('instructor_id', otherMember.instructor_id)
              .maybeSingle();
            
            if (instData) {
              displayTitle = `${instData.name} ${instData.chat_position || instData.position || '선생님'}`;
              if (instData.profile_image_url) displayAvatar = getProfileImageUrl(instData.profile_image_url);
            }
          }
        }

        const isRoomActive = isChatOpenRef.current && activeTabRef.current === "staff" && r.room_id === activeStaffRoomIdRef.current;
        const unread = (msgs || []).filter(m => m.sender_id !== instId && new Date(m.created_at) > new Date(r.last_read_at || '1970-01-01T00:00:00Z')).length;
        if (!isRoomActive) totalUnread += unread;

        return { 
          ...r, 
          displayTitle, 
          displayAvatar, 
          unreadCount: isRoomActive ? 0 : unread, 
          latestMsg: msgs && msgs.length > 0 ? msgs[0] : null 
        };
      }));

      roomsWithData.sort((a, b) => {
        const aTime = a.latestMsg ? new Date(a.latestMsg.created_at).getTime() : new Date(a.internal_chat_room?.created_at || 0).getTime();
        const bTime = b.latestMsg ? new Date(b.latestMsg.created_at).getTime() : new Date(b.internal_chat_room?.created_at || 0).getTime();
        return bTime - aTime;
      });

      setStaffRooms(roomsWithData);
      setStaffUnreadCount(totalUnread);
    } catch(e) {}
  };

  const showNewChatView = async () => {
    setActiveChatView("new"); setSearchKeyword(""); setExpandedClasses([]);
    const { data } = await supabase.from("student").select("student_id, name, parent_id, parent(phone), enrollment(class(name))").not("parent_id", "is", null).eq("status", "재원");
    setNewChatParents(data || []);
  };

  const handleCreateOrOpenRoom = async (parentId: string, studentName: string) => {
    try {
      const { data: existing } = await supabase.from("chat_room").select("room_id").eq("instructor_id", instId).eq("parent_id", parentId).maybeSingle();
      let roomId = existing?.room_id;
      if (!roomId) {
        const { data: newRoom } = await supabase.from("chat_room").insert({ instructor_id: instId, parent_id: parentId }).select().single();
        roomId = newRoom?.room_id;
        const myName = localStorage.getItem("logica_instructor_name") || "선생님";
        await supabase.from("chat_message").insert({ room_id: roomId, sender_type: "instructor", content: `안녕하세요, ${studentName} 학생 학부모님. 담당 강사 ${myName} 선생님입니다. 궁금하신 점이 있으시면 언제든 편하게 메시지 남겨주세요.`, is_read: false });
      }
      openChatRoom(roomId, `${studentName} 학부모님`);
    } catch (e) { alert("방 개설 중 오류가 발생했습니다."); }
  };

  const openChatRoom = async (roomId: string, parentName: string) => {
    setActiveRoomId(roomId); setActiveParentName(parentName); setActiveChatView("room"); setChatMessages([]);
    
    setUnreadCount(prev => Math.max(0, prev - (chatRooms.find(r => r.room_id === roomId)?.unreadCount || 0)));
    setChatRooms(prev => prev.map(r => r.room_id === roomId ? { ...r, unreadCount: 0 } : r));

    if (activeChannelRef.current) supabase.removeChannel(activeChannelRef.current);
    const roomChannelName = `room_${roomId}`;
    activeChannelRef.current = supabase.channel(roomChannelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.sender_type === "parent") { 
          setIsTyping(true); 
          clearTimeout(typingTimerRef.current); 
          typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000); 
        }
      }).subscribe();
    
    await supabase.from("chat_message").update({ is_read: true }).eq("room_id", roomId).eq("sender_type", "parent").eq("is_read", false);
    const { data } = await supabase.from("chat_message").select("*").eq("room_id", roomId).order("created_at", { ascending: true });
    setChatMessages(data || []);
    loadChatRooms();
  };

  const deleteChatRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("⚠️ 삭제하시겠습니까?")) return;
    await supabase.from("chat_message").delete().eq("room_id", roomId);
    await supabase.from("chat_room").delete().eq("room_id", roomId);
    loadChatRooms();
  };

  const deleteStaffChatRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("⚠️ 이 대화방을 목록에서 삭제(나가기) 하시겠습니까?")) return;
    try {
      await supabase.from("internal_chat_member").update({ is_active: false }).eq("room_id", roomId).eq("instructor_id", instId);
      const { count } = await supabase.from("internal_chat_member").select("*", { count: "exact", head: true }).eq("room_id", roomId).eq("is_active", true);
      if (count === 0) {
        await supabase.from("internal_chat_message").delete().eq("room_id", roomId);
        await supabase.from("internal_chat_member").delete().eq("room_id", roomId);
        await supabase.from("internal_chat_room").delete().eq("room_id", roomId);
      }
      loadStaffRooms();
    } catch (error) {
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  const sendMsg = async () => {
    const text = chatInput.trim();
    if (!text || !activeRoomId) return;
    setChatInput("");
    const { data: newMsg } = await supabase.from("chat_message").insert({ room_id: activeRoomId, sender_type: "instructor", content: text, is_read: false }).select().single();
    if (newMsg) {
      setChatMessages(prev => [...prev, newMsg]);
      loadChatRooms();
    }
  };

  const showNewStaffChatView = async () => {
    setStaffChatView("new"); setStaffSearchKeyword(""); setSelectedInstIds([]);
    try {
      const safeTenantMap: Record<string, string> = {
        '1ff4299c-d72b-4d99-97b0-45fee08e3b73': '대치 본원',
        'd59395b0-8c9c-4dd3-9e25-ff569da98abc': '본사',
        'e24e540f-ebdd-40eb-b20b-696c113def6d': '서초 가맹점'
      };

      try {
        const { data: tenantData } = await supabase.from("academy_tenant").select("*");
        if (tenantData) {
          tenantData.forEach((t: any) => { 
            safeTenantMap[String(t.tenant_id)] = t.name; 
          });
        }
      } catch (e) {}

      const { data: instData } = await supabase.from("instructor")
        .select("*")
        .eq("status", "재직")
        .order("name");
      
      if (instData) {
        const enrichedData = instData.map((inst: any) => ({
           ...inst,
           academy_tenant: { name: safeTenantMap[String(inst.tenant_id)] || '소속 미지정' }
        }));

        setAllInstructors(enrichedData);

        // 🌟 [핵심 변경] 리스트 로드 시 내 소속 정보를 현재 DB 데이터와 100% 동기화시킵니다.
        const me = enrichedData.find((i: any) => String(i.instructor_id) === String(instId));
        let exactMyTenant = '소속 미지정';
        let exactMyDept = '부서 미지정';
        if (me) {
          exactMyTenant = me.academy_tenant.name.trim();
          exactMyDept = (me.department || '부서 미지정').trim();
          setMyTenantName(exactMyTenant);
          setMyDeptName(exactMyDept);
        }

        const tSet = new Set<string>();
        const dSet = new Set<string>();
        enrichedData.forEach((inst: any) => {
          const tName = (inst.academy_tenant.name || '소속 미지정').trim();
          const dName = (inst.department || '부서 미지정').trim();
          tSet.add(tName);
          dSet.add(`${tName}_${dName}`);
        });
        setExpandedTenants(Array.from(tSet));
        setExpandedDepts(Array.from(dSet));
      }
    } catch(e) {
      console.error(e);
    }
  };

  const toggleInstSelection = (id: string) => {
    setSelectedInstIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleCreateOrOpenStaffRoom = async (targetInstId: string, targetName: string, targetPos?: string) => {
    try {
      if (targetInstId === instId) {
        const { data: myRooms } = await supabase.from('internal_chat_member').select('room_id').eq('instructor_id', instId);
        const myRoomIds = myRooms?.map((r: any) => r.room_id) || [];
        if (myRoomIds.length > 0) {
           const { data: selfRoom } = await supabase.from('internal_chat_room')
              .select('room_id')
              .in('room_id', myRoomIds)
              .ilike('title', '%(나)%')
              .limit(1).maybeSingle();
           if (selfRoom) {
               openStaffChatRoom(selfRoom.room_id, `${targetName} (나)`);
               return;
           }
        }
        const titleWithPos = `${targetName} (나)`;
        const { data: newRoom, error: roomError } = await supabase.from('internal_chat_room').insert({ room_type: 'DIRECT', title: titleWithPos, created_by: instId }).select().single();
        if (roomError) throw roomError;
        if (newRoom) {
          await supabase.from('internal_chat_member').insert([{ room_id: newRoom.room_id, instructor_id: instId }]);
          openStaffChatRoom(newRoom.room_id, titleWithPos);
        }
        return;
      }

      const { data: targetRooms, error: targetError } = await supabase.from('internal_chat_member').select('room_id').eq('instructor_id', targetInstId);
      if (targetError) throw targetError;

      const targetRoomIds = targetRooms?.map((r: any) => r.room_id) || [];
      let roomId = null;
      if (targetRoomIds.length > 0) {
        const { data: commonMembers } = await supabase.from('internal_chat_member').select('room_id, internal_chat_room!inner(room_type)').eq('instructor_id', instId).in('room_id', targetRoomIds).eq('internal_chat_room.room_type', 'DIRECT');
        if (commonMembers && commonMembers.length > 0) roomId = commonMembers[0].room_id;
      }

      if (!roomId) {
        const titleWithPos = `${targetName} ${targetPos || '선생님'}`;
        const { data: newRoom, error: roomError } = await supabase.from('internal_chat_room').insert({ room_type: 'DIRECT', title: titleWithPos, created_by: instId }).select().single();
        if (roomError) throw roomError;
        if (newRoom) {
          roomId = newRoom.room_id;
          await supabase.from('internal_chat_member').insert([{ room_id: roomId, instructor_id: instId }, { room_id: roomId, instructor_id: targetInstId }]);
        }
      }
      if (roomId) openStaffChatRoom(roomId, `${targetName} ${targetPos || '선생님'}`);
    } catch (e: any) { alert("방 생성 에러: " + e.message); }
  };

  const handleStartGroupChat = async () => {
    if (selectedInstIds.length === 0) return;
    if (selectedInstIds.length === 1) {
      const target = allInstructors.find((i: any) => i.instructor_id === selectedInstIds[0]);
      if (target) await handleCreateOrOpenStaffRoom(target.instructor_id, target.name, target.chat_position || target.position);
      return;
    }
    const roomName = prompt("새 그룹 채팅방 이름을 입력하세요.", "새 그룹 채팅방");
    if (!roomName) return;

    try {
      const { data: newRoom } = await supabase.from('internal_chat_room').insert({ room_type: 'GROUP', title: roomName, created_by: instId }).select().single();
      const membersToInsert = selectedInstIds.map(id => ({ room_id: newRoom.room_id, instructor_id: id }));
      if (!selectedInstIds.includes(instId)) membersToInsert.push({ room_id: newRoom.room_id, instructor_id: instId }); 
      
      await supabase.from('internal_chat_member').insert(membersToInsert);
      openStaffChatRoom(newRoom.room_id, roomName);
    } catch (e: any) { alert("그룹방 생성 에러: " + e.message); }
  };

  const openStaffChatRoom = async (roomId: string, roomName: string) => {
    setActiveStaffRoomId(roomId); setActiveStaffRoomName(roomName); setStaffChatView("room"); setStaffMessages([]);
    
    setStaffUnreadCount(prev => Math.max(0, prev - (staffRooms.find((r: any) => r.room_id === roomId)?.unreadCount || 0)));
    setStaffRooms(prev => prev.map((r: any) => r.room_id === roomId ? { ...r, unreadCount: 0 } : r));

    if (activeStaffChannelRef.current) supabase.removeChannel(activeStaffChannelRef.current);
    const staffRoomChannelName = `staff_room_${roomId}`;
    supabase.getChannels().forEach((ch) => { if (ch.topic.includes(staffRoomChannelName)) supabase.removeChannel(ch); });

    activeStaffChannelRef.current = supabase.channel(staffRoomChannelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.sender_id !== instId) { 
          setTypingStaffName(payload.payload?.sender_name || "알 수 없는"); 
          clearTimeout(staffTypingTimerRef.current); 
          staffTypingTimerRef.current = setTimeout(() => setTypingStaffName(null), 3000); 
        }
      }).subscribe();

    try {
      await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString(), is_active: true }).eq("room_id", roomId).eq("instructor_id", instId);
      
      const [msgRes, memRes] = await Promise.all([
        supabase.from("internal_chat_message").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
        supabase.from("internal_chat_member").select("instructor_id, last_read_at, instructor(name, position, chat_position, profile_image_url)").eq("room_id", roomId)
      ]);
      
      setStaffMessages(msgRes.data || []);
      setStaffRoomMembers(memRes.data || []);
      loadStaffRooms(); 
    } catch (e) {}
  };

  const sendStaffMsg = async () => {
    const text = staffChatInput.trim();
    if (!text || !activeStaffRoomId) return;
    setStaffChatInput("");
    try {
      const { data: newMsg, error } = await supabase.from("internal_chat_message").insert({ room_id: activeStaffRoomId, sender_id: instId, content: text }).select().single();
      if (error) throw error;
      if (newMsg) {
        setStaffMessages(prev => [...prev, newMsg]);
        await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() }).eq("room_id", activeStaffRoomId).eq("instructor_id", instId);
        loadStaffRooms(); 
      }
    } catch (e: any) { alert("메시지 전송 에러: " + e.message); }
  };

  const filteredParents = newChatParents.filter((s: any) => (s?.name || "").toLowerCase().includes(searchKeyword.toLowerCase()));
  const groupedParents: Record<string, any[]> = {};
  filteredParents.forEach((s: any) => {
    let classes: string[] = [];
    if (s.enrollment && s.enrollment.length > 0) s.enrollment.forEach((e: any) => { if (e.class?.name) classes.push(e.class.name); });
    if (classes.length === 0) classes.push("반 미배정");
    classes.forEach(cName => {
      if (!groupedParents[cName]) groupedParents[cName] = [];
      if (!groupedParents[cName].find(x => x.student_id === s.student_id)) groupedParents[cName].push(s);
    });
  });

  const filteredInstructors = allInstructors.filter((inst: any) => (inst?.name || "").includes(staffSearchKeyword));
  const orgTree: Record<string, Record<string, any[]>> = {};
  
  filteredInstructors.forEach((inst: any) => {
    const tenantName = (inst.academy_tenant?.name || '소속 미지정').trim();
    const deptName = (inst.department || '부서 미지정').trim();
    
    if (!orgTree[tenantName]) orgTree[tenantName] = {};
    if (!orgTree[tenantName][deptName]) orgTree[tenantName][deptName] = [];
    
    orgTree[tenantName][deptName].push(inst);
  });

  const toggleTenant = (t: string) => setExpandedTenants(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleDept = (d: string) => setExpandedDepts(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  return (
    <>
      {memos.map(memo => (
        <DraggableMemo 
          key={memo.memo_id} 
          memo={memo} 
          onUpdate={updateMemo} 
          onDelete={deleteMemo} 
          onFocus={focusMemo} 
        />
      ))}

      <div
        ref={iconRef} 
        onPointerDown={handleIconDown} 
        onPointerMove={handleIconMove} 
        onPointerUp={handleIconUp} 
        onPointerCancel={handleIconUp}
        style={{ touchAction: "none" }}
        className="fixed bottom-6 right-6 sm:bottom-10 sm:right-10 flex flex-col items-center gap-3 z-[9999] cursor-grab active:cursor-grabbing"
      >
        {onMicClick && (
          <button
            className="mic-btn w-12 h-12 bg-rose-500 text-white rounded-full shadow-[0_4px_15px_rgba(243,24,71,0.5)] flex items-center justify-center hover:bg-rose-600 hover:scale-105 transition-all"
            title="AI 실시간 음성 녹음"
          >
            <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
          </button>
        )}

        <button
          className="memo-btn w-12 h-12 bg-amber-400 text-amber-900 rounded-full shadow-[0_4px_15px_rgba(251,191,36,0.5)] flex items-center justify-center hover:bg-amber-500 hover:scale-105 transition-all"
          title="새 메모(포스트잇) 추가"
        >
          <svg className="w-6 h-6 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        </button>

        <button
          className="chat-btn w-14 h-14 bg-[#002864] text-white rounded-full shadow-[0_8px_20px_rgba(0,40,100,0.4)] flex items-center justify-center hover:bg-blue-900 transition-colors relative"
          title="메신저 열기"
        >
          <svg className="w-7 h-7 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
          {unreadCount + staffUnreadCount > 0 && !isChatOpen && <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 bg-rose-500 text-white text-[11px] font-bold rounded-full border-2 border-white flex items-center justify-center shadow-sm pointer-events-none">{unreadCount + staffUnreadCount > 99 ? '99+' : unreadCount + staffUnreadCount}</span>}
        </button>
      </div>

      <div 
        ref={panelRef}
        className={`fixed bottom-[90px] right-6 sm:bottom-[110px] sm:right-10 w-[360px] h-[680px] max-h-[85vh] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden border border-slate-200 z-[9998] transition-opacity duration-300 ${isChatOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ transform: `scale(${isChatOpen ? 1 : 0.95})`, transformOrigin: 'bottom right' }}
      >
        <div onPointerDown={handlePanelDown} onPointerMove={handlePanelMove} onPointerUp={handlePanelUp} onPointerCancel={handlePanelUp} className="bg-[#002864] text-white flex flex-col shrink-0 cursor-move touch-none select-none">
          <div className="px-5 py-3.5 flex justify-between items-center">
            <h3 className="font-lexend font-bold text-[15px] flex items-center gap-2 pointer-events-none"><span>💬</span> Logica 메신저</h3>
            <div className="flex gap-1.5 items-center z-10 relative">
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => { setIsChatOpen(false); setActiveRoomId(null); setActiveStaffRoomId(null); }} className="text-blue-200 hover:text-white transition-colors p-1.5 relative">
                <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          </div>
          
          <div className="flex px-3">
            <button 
              onPointerDown={(e) => e.stopPropagation()} 
              onClick={() => { 
                if (activeTab === "staff") { staffChatView === "list" ? showNewStaffChatView() : setStaffChatView("list"); } else { setActiveTab("staff"); setStaffChatView("list"); }
                setActiveStaffRoomId(null); 
                loadStaffRooms(); 
              }}
              className={`flex-1 py-2 text-[13px] font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${activeTab === "staff" || isHQ ? "border-white text-white" : "border-transparent text-blue-300 hover:text-blue-100 hover:border-blue-300"}`}
            >
              👥 사내 메신저 {staffUnreadCount > 0 && <span className="bg-rose-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">{staffUnreadCount}</span>}
            </button>

            {!isHQ && (
              <button 
                onPointerDown={(e) => e.stopPropagation()} 
                onClick={() => { 
                  if (activeTab === "parent") { activeChatView === "list" ? showNewChatView() : setActiveChatView("list"); } else { setActiveTab("parent"); setActiveChatView("list"); }
                  setActiveRoomId(null); 
                  loadChatRooms(); 
                }}
                className={`flex-1 py-2 text-[13px] font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${activeTab === "parent" ? "border-white text-white" : "border-transparent text-blue-300 hover:text-blue-100 hover:border-blue-300"}`}
              >
                👨‍👩‍👧‍👦 학부모 상담 {unreadCount > 0 && <span className="bg-rose-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
              </button>
            )}
          </div>
        </div>

        {activeTab === "parent" && !isHQ ? (
          activeChatView === "new" ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-50 relative">
              <div className="p-3 border-b border-slate-200 bg-white flex items-center gap-2 shrink-0">
                <button onClick={() => { setActiveChatView("list"); loadChatRooms(); }} className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="학생 이름 검색 (재원생)" className="flex-1 bg-slate-100 rounded px-3 py-1.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#002864]" />
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-2">
                {Object.keys(groupedParents).length === 0 ? (
                  <div className="text-center py-10 text-slate-400 font-bold text-sm">검색 결과가 없습니다.</div>
                ) : (
                  Object.keys(groupedParents).sort().map((className, idx) => {
                    const students = groupedParents[className];
                    const isExpanded = searchKeyword.length > 0 || expandedClasses.includes(className);
                    return (
                      <div key={idx} className="mb-2.5">
                        <button onClick={() => setExpandedClasses(prev => prev.includes(className) ? prev.filter(c => c !== className) : [...prev, className])} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-3 rounded-xl font-bold text-[13px] flex justify-between items-center transition-colors border border-slate-200 shadow-sm">
                          <span>🏷️ {className} <span className="text-[11px] text-slate-500 font-normal ml-1.5">({students.length}명)</span></span>
                          <svg className={`w-4 h-4 text-slate-400 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        {isExpanded && (
                          <div className="mt-2">
                            {students.map((s: any) => (
                              <div key={s.student_id} onClick={() => handleCreateOrOpenRoom(s.parent_id, s.name)} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer transition-all flex items-center justify-between mb-2 last:mb-0 ml-2">
                                <div>
                                  <div className="font-bold text-slate-700 text-sm">{s.name} 학생 학부모님</div>
                                  <div className="text-[11px] text-slate-400 font-bold mt-0.5">{s.parent?.phone || '번호없음'}</div>
                                </div>
                                <button className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-100 transition-colors">대화 시작</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : activeChatView === "list" ? (
            <div className="flex-1 overflow-y-auto custom-scroll p-3 bg-slate-50">
              <div className="space-y-2">
                {chatRooms.length === 0 ? (
                  <div className="text-center py-10 flex flex-col items-center gap-3">
                    <span className="text-slate-400 font-bold text-sm">개설된 상담방이 없습니다.</span>
                    <button onClick={showNewChatView} className="bg-[#002864] hover:bg-blue-900 text-white font-bold px-4 py-2.5 rounded-lg shadow-md text-xs transition-colors">+ 새 채팅방 개설하기</button>
                  </div>
                ) : (
                  chatRooms.map(r => {
                    const phone = r.parent?.phone || '번호없음';
                    const pName = `${r.parent?.student?.[0]?.name || '알 수 없는'} 학부모님`;
                    let previewText = r.chat_message?.length > 0 ? r.chat_message[0].content : '대화 내역이 없습니다.';
                    if (previewText.length > 18) previewText = previewText.substring(0, 18) + '...';

                    return (
                      <div key={r.room_id} onClick={() => openChatRoom(r.room_id, pName)} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 transition-all flex items-center justify-between cursor-pointer mb-2 group">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 bg-blue-50 rounded-full flex justify-center items-center text-blue-500 font-bold shrink-0 relative">P{r.unreadCount > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white"></span>}</div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-bold text-slate-700 text-sm truncate">{pName}</span>
                            <div className="flex justify-between items-center mt-0.5"><span className={`text-[11.5px] ${r.unreadCount > 0 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'} truncate`}>{previewText}</span>{r.unreadCount > 0 && <div className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{r.unreadCount > 99 ? '99+' : r.unreadCount}</div>}</div>
                          </div>
                        </div>
                        <button onClick={(e) => deleteChatRoom(r.room_id, e)} className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 shrink-0"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative bg-[#b2c7d9]">
              <div className="bg-white/90 backdrop-blur px-3 py-2 border-b border-slate-200 flex items-center gap-2 shrink-0 shadow-sm z-10 sticky top-0">
                <button onClick={() => { setActiveChatView("list"); setActiveRoomId(null); loadChatRooms(); }} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <div className="flex flex-col flex-1 min-w-0"><span className="font-bold text-slate-800 text-[13px] truncate">{activeParentName}</span><span className="text-[10px] font-bold text-emerald-600">실시간 연결됨</span></div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll p-4 flex flex-col gap-3 pb-2">
                {chatMessages.length === 0 ? <div className="text-center text-slate-400 font-bold text-xs mt-10 bg-white/50 p-4 rounded-xl mx-4">대화 내역이 없습니다.</div> :
                  chatMessages.map(msg => (
                    <div key={msg.message_id} className={`flex w-full mb-1 ${msg.sender_type === "parent" ? "justify-start" : "justify-end"}`}>
                      {msg.sender_type === "parent" && (
                        <div className="w-7 h-7 rounded-full bg-white border border-slate-300 flex justify-center items-center shrink-0 mt-0.5 text-xs mr-2">P</div>
                      )}
                      
                      <div className={`flex flex-col max-w-[85%] ${msg.sender_type !== "parent" ? "items-end" : "items-start"}`}>
                        {msg.sender_type === "parent" && (
                          <span className="text-[11px] font-bold text-slate-600 mb-1 ml-1">{activeParentName}</span>
                        )}
                        
                        <div className={`flex items-end gap-1.5 ${msg.sender_type !== "parent" ? "flex-row-reverse" : "flex-row"}`}>
                          <div className={`px-3.5 py-2 rounded-2xl shadow-sm font-medium text-[13px] leading-snug break-words ${msg.sender_type !== "parent" ? "bg-[#fef01b] text-slate-800 rounded-tr-sm" : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"}`}>
                            {String(msg.content).split('\n').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
                          </div>
                          <div className={`flex flex-col shrink-0 text-[9px] text-slate-500 ${msg.sender_type !== "parent" ? "items-end" : "items-start"}`}>
                            {msg.sender_type !== 'parent' && !msg.is_read && <span className="text-[#002864] font-bold mb-0.5">1</span>}
                            <span>{new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                }

                {isTyping && (
                  <div className="flex justify-start w-full mb-1">
                    <div className="w-7 h-7 rounded-full bg-white border border-slate-300 flex justify-center items-center shrink-0 mt-0.5 text-xs mr-2">P</div>
                    <div className="flex flex-col items-start max-w-[85%]">
                      <span className="text-[11px] font-bold text-slate-600 mb-1 ml-1">{activeParentName}</span>
                      <div className="px-3.5 py-2 rounded-2xl shadow-sm font-bold text-[13px] leading-snug break-words bg-white text-slate-400 rounded-tl-sm border border-slate-100 animate-pulse">
                        메시지를 입력 중입니다...
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
              <div className="bg-white p-3 border-t flex items-end gap-2">
                <textarea rows={1} value={chatInput} onChange={(e) => { setChatInput(e.target.value); activeChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { sender_type: "instructor" } }); }} onKeyPress={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }}} className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#002864] resize-none max-h-[100px] custom-scroll" placeholder="메시지를 입력하세요..." />
                <button onClick={sendMsg} className="p-2.5 bg-[#002864] text-white rounded-xl hover:bg-blue-900 transition-colors shadow-sm shrink-0"><svg className="w-5 h-5 translate-x-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg></button>
              </div>
            </div>
          )
        ) : (
          staffChatView === "new" ? (
            <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative">
              <div className="p-3 border-b border-slate-200 bg-white flex items-center gap-2 shrink-0">
                <button onClick={() => { setStaffChatView("list"); loadStaffRooms(); }} className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                <input type="text" value={staffSearchKeyword} onChange={e => setStaffSearchKeyword(e.target.value)} placeholder="이름 또는 부서 검색" className="flex-1 bg-slate-100 rounded px-3 py-1.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-3 pb-16">
                {filteredInstructors.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 font-bold text-sm">검색 결과가 없습니다.</div>
                ) : (
                  Object.keys(orgTree).sort((a, b) => {
                    const aTrim = a.trim();
                    const bTrim = b.trim();
                    const myT = (myTenantName || '소속 미지정').trim();

                    if (aTrim === bTrim) return 0;
                    
                    // 🌟 1순위: 내 지점 (소속 미지정 포함)
                    if (aTrim === myT) return -1;
                    if (bTrim === myT) return 1;
                    
                    // 🌟 2순위: 본사
                    if (aTrim === '본사') return -1;
                    if (bTrim === '본사') return 1;
                    
                    return aTrim.localeCompare(bTrim);
                  }).map(tenantName => {
                    const isTenantExpanded = expandedTenants.includes(tenantName) || staffSearchKeyword.length > 0;
                    const tenantMembersCount = Object.values(orgTree[tenantName]).reduce((acc, curr) => acc + curr.length, 0);
                    
                    const myT = (myTenantName || '소속 미지정').trim();
                    const isMyTenant = tenantName.trim() === myT;
                    
                    return (
                      <div key={tenantName} className="mb-2">
                        <button onClick={() => toggleTenant(tenantName)} className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-extrabold text-[13px] flex justify-between items-center transition-colors shadow-sm">
                          <span className="flex items-center">
                            🏢 {tenantName} 
                            {isMyTenant && <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[9px] rounded font-black">내 지점</span>}
                            <span className="text-[11px] font-normal ml-1">({tenantMembersCount}명)</span>
                          </span>
                          <svg className={`w-4 h-4 transform transition-transform ${isTenantExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        {isTenantExpanded && (
                          <div className="mt-1.5 ml-2 border-l-2 border-slate-200 pl-2 space-y-2">
                            {Object.keys(orgTree[tenantName]).sort((a, b) => {
                              const aTrim = a.trim();
                              const bTrim = b.trim();
                              const myD = (myDeptName || '부서 미지정').trim();

                              if (aTrim === bTrim) return 0;
                              
                              // 🌟 내 지점 안에서만 내 부서를 최상단으로 끌어올림
                              if (isMyTenant) {
                                if (aTrim === myD) return -1;
                                if (bTrim === myD) return 1;
                              }
                              
                              return aTrim.localeCompare(bTrim);
                            }).map(deptName => {
                              const deptId = `${tenantName}_${deptName}`;
                              const isDeptExpanded = expandedDepts.includes(deptId) || staffSearchKeyword.length > 0;
                              const deptMembers = orgTree[tenantName][deptName];
                              
                              const myD = (myDeptName || '부서 미지정').trim();
                              const isMyDept = isMyTenant && deptName.trim() === myD;
                              
                              return (
                                <div key={deptId} className="mb-1">
                                  <button onClick={() => toggleDept(deptId)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg font-bold text-[12px] flex justify-between items-center transition-colors">
                                    <span className="flex items-center">
                                      📁 {deptName} 
                                      {isMyDept && <span className="ml-1.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-600 text-[9px] rounded font-black">내 부서</span>}
                                      <span className="text-[10px] font-normal ml-1">({deptMembers.length}명)</span>
                                    </span>
                                    <svg className={`w-3.5 h-3.5 transform transition-transform ${isDeptExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                  </button>
                                  {isDeptExpanded && (
                                    <div className="mt-1.5 ml-2 space-y-1.5">
                                      {[...deptMembers].sort((a: any, b: any) => {
                                        // 🌟 1. 나 자신은 무조건 최상단
                                        if (a.instructor_id === instId) return -1;
                                        if (b.instructor_id === instId) return 1;
                                        
                                        // 🌟 2. 직급 순서 정렬
                                        const posOrder: any = { '최고관리자': 1, '원장': 2, '부원장': 3, '실장': 4, '전임강사': 5, '파트강사': 6, '조교': 7 };
                                        const orderA = posOrder[a.position] || 99;
                                        const orderB = posOrder[b.position] || 99;
                                        if (orderA !== orderB) return orderA - orderB;
                                        
                                        // 🌟 3. 마지막은 가나다순
                                        return a.name.localeCompare(b.name);
                                      }).map((inst: any) => {
                                        const isSelected = selectedInstIds.includes(inst.instructor_id);
                                        const avatarUrl = getProfileImageUrl(inst.profile_image_url);
                                        const isMe = inst.instructor_id === instId;

                                        return (
                                          <div key={inst.instructor_id} onClick={() => toggleInstSelection(inst.instructor_id)} className={`bg-white p-2.5 rounded-lg border shadow-sm cursor-pointer transition-all flex items-center gap-3 ${isSelected ? 'border-slate-500 bg-slate-100' : 'border-slate-200 hover:border-slate-400'}`}>
                                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border ${isSelected ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-300'}`}>
                                              {isSelected && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                            </div>
                                            <div className="relative w-9 h-9 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 font-bold text-[11px] shrink-0 overflow-hidden">
                                              <span className="absolute z-0">T</span>
                                              {avatarUrl && (
                                                <img 
                                                  src={avatarUrl} 
                                                  alt="profile" 
                                                  className="absolute w-full h-full object-cover z-10" 
                                                  onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                                                />
                                              )}
                                            </div>
                                            <div className="flex-1 flex flex-col">
                                              <div className="font-bold text-slate-700 text-sm flex items-center">
                                                {inst.name}
                                                {isMe && <span className="ml-1 px-1.5 py-0.5 bg-[#002864] text-white text-[9px] rounded font-bold">나</span>}
                                              </div>
                                              <div className="text-[11px] text-slate-400 font-bold mt-0.5">{inst.chat_position || inst.position || '강사'}</div>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-white border-t border-slate-200 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] z-20">
                <button 
                  onClick={handleStartGroupChat}
                  disabled={selectedInstIds.length === 0}
                  className={`w-full py-3 rounded-xl font-bold text-[14px] transition-colors ${selectedInstIds.length > 0 ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                  {selectedInstIds.length > 0 ? `${selectedInstIds.length}명과 대화 시작` : '대화 상대를 선택하세요'}
                </button>
              </div>
            </div>
          ) : staffChatView === "list" ? (
            <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
              {staffRooms.length === 0 ? (
                 <div className="text-center py-10 flex flex-col items-center gap-3">
                   <span className="text-slate-400 font-bold text-sm">참여중인 대화방이 없습니다.</span>
                   <button onClick={showNewStaffChatView} className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-lg text-xs transition-colors">+ 조직도 열기</button>
                 </div>
              ) : (
                staffRooms.map((r, idx) => {
                  let previewText = r.latestMsg ? r.latestMsg.content : '대화 내역이 없습니다.';
                  if (previewText.length > 18) previewText = previewText.substring(0, 18) + '...';

                  return (
                    <div key={idx} onClick={() => openStaffChatRoom(r.room_id, r.displayTitle)} className="bg-white p-3 rounded-xl border shadow-sm hover:border-slate-400 flex items-center gap-3 cursor-pointer mb-2 group">
                      <div className="relative shrink-0 w-10 h-10">
                        <div className="relative w-full h-full bg-slate-200 rounded-full flex justify-center items-center text-slate-600 font-bold overflow-hidden">
                          <span className="absolute z-0">{r.internal_chat_room?.room_type === 'GROUP' ? '👥' : 'T'}</span>
                          {r.internal_chat_room?.room_type !== 'GROUP' && r.displayAvatar && (
                            <img 
                              src={r.displayAvatar} 
                              alt="profile" 
                              className="absolute w-full h-full object-cover z-10" 
                              onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                            />
                          )}
                        </div>
                        {r.unreadCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full border-2 border-white flex items-center justify-center z-20">{r.unreadCount > 99 ? '99+' : r.unreadCount}</span>}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-bold text-slate-700 text-sm truncate">{r.displayTitle}</span>
                        <div className="flex justify-between items-center mt-0.5">
                          <span className={`text-[11.5px] ${r.unreadCount > 0 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'} truncate`}>{previewText}</span>
                        </div>
                      </div>
                      
                      <button onClick={(e) => deleteStaffChatRoom(r.room_id, e)} className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 relative bg-[#f1f3f5]">
              <div className="bg-white px-3 py-2 border-b flex items-center gap-2 z-10 sticky top-0">
                <button onClick={() => { setStaffChatView("list"); setActiveStaffRoomId(null); loadStaffRooms(); }} className="p-1.5 text-slate-500 rounded-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                <span className="font-bold text-slate-800 text-[13px]">{activeStaffRoomName}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {staffMessages.length === 0 ? <div className="text-center text-slate-400 font-bold text-xs mt-10">메시지가 없습니다.</div> :
                  staffMessages.map(msg => {
                    const unreadBy = staffRoomMembers.filter(m => m.instructor_id !== instId && new Date(m.last_read_at || 0) < new Date(msg.created_at)).length;
                    const senderInfo = staffRoomMembers.find(m => m.instructor_id === msg.sender_id)?.instructor;
                    const avatarUrl = getProfileImageUrl(senderInfo?.profile_image_url);

                    return (
                      <div key={msg.message_id} className={`flex w-full mb-1 ${msg.sender_id === instId ? 'justify-end' : 'justify-start'}`}>
                        {msg.sender_id !== instId && (
                          <div className="relative w-7 h-7 bg-slate-300 rounded-full flex justify-center items-center text-white text-xs shrink-0 overflow-hidden mr-2">
                            <span className="absolute z-0 font-bold">T</span>
                            {avatarUrl && (
                              <img 
                                src={avatarUrl} 
                                alt="profile" 
                                className="absolute w-full h-full object-cover z-10" 
                                onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                              />
                            )}
                          </div>
                        )}
                        <div className={`flex flex-col max-w-[85%] ${msg.sender_id === instId ? 'items-end' : 'items-start'}`}>
                          {msg.sender_id !== instId && (
                            <span className="text-[11px] font-bold text-slate-600 mb-1 ml-0.5">
                              {senderInfo?.name || '알수없음'} 
                              <span className="font-normal text-[10px] text-slate-400 ml-0.5">{senderInfo?.chat_position || senderInfo?.position || '선생님'}</span>
                            </span>
                          )}
                          
                          <div className={`flex items-end gap-1.5 ${msg.sender_id === instId ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`px-3.5 py-2 rounded-2xl shadow-sm text-[13px] ${msg.sender_id === instId ? 'bg-slate-700 text-white rounded-tr-sm' : 'bg-white text-slate-800 rounded-tl-sm border border-slate-100'}`}>
                              {String(msg.content).split('\n').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
                            </div>
                            <div className={`flex flex-col shrink-0 text-[9px] text-slate-500 ${msg.sender_id === instId ? 'items-end' : 'items-start'}`}>
                              {msg.sender_id === instId && unreadBy > 0 && <span className="text-slate-600 font-bold mb-0.5">{unreadBy}</span>}
                              <span className="whitespace-nowrap">{new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                }

                {typingStaffName && (
                  <div className="flex justify-start w-full mb-1">
                    <div className="relative w-7 h-7 bg-slate-300 rounded-full flex justify-center items-center text-white text-xs shrink-0 overflow-hidden mr-2">
                      <span className="absolute z-0">T</span>
                      {staffRooms.find(r => r.room_id === activeStaffRoomId)?.displayAvatar && (
                        <img 
                          src={staffRooms.find(r => r.room_id === activeStaffRoomId)?.displayAvatar} 
                          alt="profile" 
                          className="absolute w-full h-full object-cover z-10" 
                          onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                        />
                      )}
                    </div>
                    <div className="flex flex-col items-start max-w-[85%]">
                      <span className="text-[11px] font-bold text-slate-600 mb-1 ml-0.5">{typingStaffName}</span>
                      <div className="px-3.5 py-2 rounded-2xl shadow-sm font-bold text-[13px] leading-snug break-words bg-white text-slate-400 rounded-tl-sm border border-slate-100 animate-pulse">
                        메시지를 입력 중입니다...
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
              <div className="bg-white p-3 border-t flex items-end gap-2">
                <textarea 
                  rows={1} 
                  value={staffChatInput} 
                  onChange={e => { 
                    setStaffChatInput(e.target.value); 
                    const myName = localStorage.getItem("logica_instructor_name") || "선생님";
                    activeStaffChannelRef.current?.send({ 
                      type: "broadcast", 
                      event: "typing", 
                      payload: { sender_id: instId, sender_name: myName } 
                    }); 
                  }} 
                  onKeyPress={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendStaffMsg(); }}} 
                  className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-[14px] resize-none focus:outline-none" 
                  placeholder="선생님 메시지 입력..." 
                />
                <button onClick={sendStaffMsg} className="p-2.5 bg-slate-700 text-white rounded-xl hover:bg-slate-800"><svg className="w-5 h-5 translate-x-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg></button>
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}