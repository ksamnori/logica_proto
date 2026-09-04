// src/components/parent/ChatWidget.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

const getProfileImageUrl = (path: string | null | undefined) => {
  if (!path || path.trim() === "") return null;
  if (path.startsWith("http")) return path;
  const { data } = supabase.storage.from("system_images").getPublicUrl(path);
  return data.publicUrl;
};

const formatPosition = (pos: string | null | undefined) => {
  if (!pos) return "선생님";
  if (pos.includes("부원장")) return "부원장";
  if (pos.includes("원장")) return "원장";
  if (pos.includes("실장")) return "실장";
  return "선생님";
};

export default function ChatWidget({ parentId }: { parentId: string }) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatView, setActiveChatView] = useState<"list" | "room">("list");
  const [staffList, setStaffList] = useState<any[]>([]);
  const [chatRooms, setChatRooms] = useState<any[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeStaffName, setActiveStaffName] = useState("");
  const [activeStaffAvatar, setActiveStaffAvatar] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // 🌟 모바일 호환성을 위한 핵심 상태
  const [isMobile, setIsMobile] = useState(false);
  const [isKakao, setIsKakao] = useState(false); // 💡 브라우저 환경 판단
  const [viewportHeight, setViewportHeight] = useState('100dvh');
  const [isKeyboardUp, setIsKeyboardUp] = useState(false); 
  const [isInputFocused, setIsInputFocused] = useState(false); 
  const [keyboardMargin, setKeyboardMargin] = useState('320px');

  const activeChannelRef = useRef<any>(null);
  const globalChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);
  
  const activeRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);
  
  const isChatOpenRef = useRef(isChatOpen);
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);

  // 💡 [핵심 교정] 브라우저 환경 스캔 (User-Agent 확인)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
      // 카카오톡 인앱 브라우저인지 확인
      setIsKakao(/KAKAOTALK/i.test(ua));
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobileCheck = window.innerWidth < 640;
      setIsMobile(mobileCheck);
      
      if (window.visualViewport) {
        const vvHeight = window.visualViewport.height;
        const innerHeight = window.innerHeight;
        const gap = innerHeight - vvHeight;
        
        const isUp = vvHeight < innerHeight * 0.85;
        setIsKeyboardUp(isUp);
        setViewportHeight(`${vvHeight}px`);

        if (gap > 100) {
            setKeyboardMargin(`${gap}px`);
        } else {
            setKeyboardMargin('320px'); // 아이폰 최신 기종들도 커버하는 넉넉한 마진
        }
      } else {
        setViewportHeight('100dvh');
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
    };
  }, []);

  // 💡 [초강력 방어막] 오직 '카카오톡 브라우저'에서, '뷰포트가 안 줄어들었을 때'만 강제로 밀어올립니다.
  const needsManualPush = isMobile && isInputFocused && isKakao && !isKeyboardUp;

  useEffect(() => {
    if (isMobile && isChatOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, isChatOpen]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  };

  useEffect(() => { scrollToBottom(); }, [chatMessages, isTyping, viewportHeight, needsManualPush]);

  useEffect(() => {
    const handleFocus = async () => {
      if (isChatOpenRef.current && activeRoomIdRef.current) {
        await supabase.from("chat_message").update({ is_read: true })
          .eq("room_id", activeRoomIdRef.current)
          .eq("sender_type", "instructor")
          .eq("is_read", false);
        loadChatRooms();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    if (parentId) {
      loadAvailableStaff();
      loadChatRooms();
      initRealtimeSystem();
    }
    return () => {
      if (globalChannelRef.current) { supabase.removeChannel(globalChannelRef.current); globalChannelRef.current = null; }
      if (activeChannelRef.current) { supabase.removeChannel(activeChannelRef.current); activeChannelRef.current = null; }
    };
  }, [parentId]);

  const loadAvailableStaff = async () => {
    try {
      const { data: sData } = await supabase.from("student").select("tenant_id, enrollment(class(instructor_id))").eq("parent_id", parentId);
      
      let instructorIds = new Set<string>();
      let tenantIds = new Set<string>(); 

      sData?.forEach((s: any) => { 
        if (s.tenant_id) tenantIds.add(s.tenant_id);
        s.enrollment?.forEach((e: any) => { 
          if (e.class?.instructor_id) instructorIds.add(e.class.instructor_id); 
        }); 
      });

      if (tenantIds.size === 0) return setStaffList([]);

      let orQuery = "position.ilike.%실장%";
      if (instructorIds.size > 0) orQuery += `,instructor_id.in.(${Array.from(instructorIds).join(",")})`;
      
      const { data } = await supabase
        .from("instructor")
        .select("*")
        .eq("status", "재직")
        .in("tenant_id", Array.from(tenantIds))
        .or(orQuery);
        
      let filteredList = data || [];
      
      filteredList.sort((a, b) => {
        const aIsManager = (a.position || "").includes("실장") ? -1 : 1;
        const bIsManager = (b.position || "").includes("실장") ? -1 : 1;
        if (aIsManager !== bIsManager) return aIsManager - bIsManager;
        return a.name.localeCompare(b.name);
      });
      
      setStaffList(filteredList);
    } catch (e) { console.error(e); }
  };

  const loadChatRooms = async () => {
    try {
      const { data } = await supabase.from("chat_room")
        .select("room_id, instructor_id, instructor(name, position, profile_image_url), chat_message(message_id, content, created_at, sender_type, is_read)")
        .eq("parent_id", parentId).order("created_at", { ascending: false });
      setChatRooms(data || []);
      let totalUnread = 0;
      data?.forEach((r: any) => {
        totalUnread += (r.chat_message || []).filter((m: any) => (r.room_id !== activeRoomIdRef.current) && m.sender_type === "instructor" && !m.is_read).length;
      });
      setUnreadCount(totalUnread);
    } catch (e) { console.error(e); }
  };

  const createOrOpenRoom = async (instructorId: string, staffTitle: string, avatarUrl: string | null) => {
    try {
      const { data: existing } = await supabase.from("chat_room").select("room_id").eq("instructor_id", instructorId).eq("parent_id", parentId).maybeSingle();
      let roomId = existing?.room_id;
      if (!roomId) {
        const { data: newRoom } = await supabase.from("chat_room").insert({ instructor_id: instructorId, parent_id: parentId }).select().single();
        roomId = newRoom?.room_id;
      }
      openChatRoom(roomId, staffTitle, avatarUrl);
    } catch (e) { alert("채팅방 연결 오류"); }
  };

  const openChatRoom = async (roomId: string, staffName: string, avatarUrl: string | null) => {
    setActiveRoomId(roomId); 
    setActiveStaffName(staffName); 
    setActiveStaffAvatar(avatarUrl);
    setActiveChatView("room"); 
    setChatMessages([]);

    if (activeChannelRef.current) { supabase.removeChannel(activeChannelRef.current); activeChannelRef.current = null; }
    
    const roomChannelName = `room_${roomId}`;
    supabase.getChannels().forEach((ch) => { if (ch.topic.includes(roomChannelName)) supabase.removeChannel(ch); });
    
    activeChannelRef.current = supabase.channel(roomChannelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.sender_type === "instructor") {
          setIsTyping(true); 
          clearTimeout(typingTimerRef.current); 
          typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000);
        }
      }).subscribe();

    try {
      await supabase.from("chat_message").update({ is_read: true }).eq("room_id", roomId).eq("sender_type", "instructor").eq("is_read", false);
      const { data } = await supabase.from("chat_message").select("*").eq("room_id", roomId).order("created_at", { ascending: true });
      setChatMessages(data || []);
      loadChatRooms(); 
    } catch (e) { console.error(e); }
  };

  const deleteChatRoom = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!confirm("해당 상담 대화방과 대화 내역을 모두 삭제하시겠습니까?\n삭제된 내용은 복구할 수 없습니다.")) return;
    try {
      await supabase.from("chat_room").delete().eq("room_id", roomId);
      loadChatRooms();
    } catch (e) {
      alert("대화방 삭제 중 오류가 발생했습니다.");
    }
  };

  const sendParentMsg = async () => {
    const text = chatInput.trim();
    if (!text || !activeRoomId) return;
    setChatInput("");
    setIsInputFocused(false);
    try {
      const { data: roomData } = await supabase.from("chat_room").select("instructor(chat_allow_start, chat_allow_end, auto_reply_message, auto_reply_active)").eq("room_id", activeRoomId).single();
      let isDND = false; let autoReplyMsg = "선생님께 메시지가 전달되었습니다. 내일 확인하여 답변드리겠습니다.";

      if (roomData?.instructor) {
        const inst: any = roomData.instructor;
        if (inst.auto_reply_message) autoReplyMsg = inst.auto_reply_message;
        if (inst.auto_reply_active !== false && inst.chat_allow_start && inst.chat_allow_end) {
          const now = new Date(); const currentM = now.getHours() * 60 + now.getMinutes();
          const [sH, sM] = inst.chat_allow_start.split(":").map(Number); const [eH, eM] = inst.chat_allow_end.split(":").map(Number);
          const startTotal = sH * 60 + sM; const endTotal = eH * 60 + eM;
          if (startTotal <= endTotal) { if (currentM < startTotal || currentM >= endTotal) isDND = true; } 
          else { if (currentM < startTotal && currentM >= endTotal) isDND = true; }
        }
      }
      const { data: newMsg } = await supabase.from("chat_message").insert({ room_id: activeRoomId, sender_type: "parent", content: text, is_read: false }).select().single();
      if (newMsg) setChatMessages(prev => [...prev, newMsg]);
      if (isDND) { setTimeout(async () => { await supabase.from("chat_message").insert({ room_id: activeRoomId, sender_type: "instructor", content: `[자동응답] ${autoReplyMsg}`, is_read: false }); }, 500); }
    } catch (e) { alert("메시지 전송 실패"); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeRoomId) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif'].includes(fileExt || '');
      const fileName = `chat_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `chat_images/${parentId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('system_images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('system_images').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      const contentString = isImage ? `[IMAGE]${publicUrl}` : `[FILE]${publicUrl}`;

      const { data: newMsg } = await supabase.from("chat_message").insert({ 
        room_id: activeRoomId, 
        sender_type: "parent", 
        content: contentString, 
        is_read: false 
      }).select().single();
      
      if (newMsg) setChatMessages(prev => [...prev, newMsg]);

    } catch (error) {
      console.error("파일 업로드 실패:", error);
      alert("파일 전송에 실패했습니다.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const initRealtimeSystem = () => {
    if (globalChannelRef.current) return;
    const channelName = "parent_chat_" + parentId;
    supabase.getChannels().forEach((ch) => { if (ch.topic.includes(channelName)) supabase.removeChannel(ch); });

    globalChannelRef.current = supabase.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_message" }, async (payload) => {
        const msg = payload.new; setIsTyping(false);
        const isRoomActive = document.hasFocus() && isChatOpenRef.current && String(activeRoomIdRef.current) === String(msg.room_id);

        if (activeRoomIdRef.current && String(msg.room_id) === String(activeRoomIdRef.current)) {
          if (msg.sender_type === "instructor") {
            setChatMessages(prev => prev.find(m => m.message_id === msg.message_id) ? prev : [...prev, msg]);
            if (isRoomActive) {
              await supabase.from("chat_message").update({ is_read: true }).eq("message_id", msg.message_id);
            }
          }
        }
        loadChatRooms();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_message" }, (payload) => {
        if (payload.new.is_read) setChatMessages(prev => prev.map(m => m.message_id === payload.new.message_id ? { ...m, is_read: true } : m));
      }).subscribe();
  };

  return (
    <>
      <button 
        onClick={() => {
          if (isChatOpen) { setActiveRoomId(null); setActiveChatView("list"); setIsInputFocused(false); }
          setIsChatOpen(!isChatOpen);
        }} 
        className={`fixed w-14 h-14 bg-[#002864] text-white rounded-full shadow-[0_8px_20px_rgba(0,40,100,0.4)] flex items-center justify-center hover:bg-blue-900 transition-transform hover:scale-105 active:scale-95 z-[9999] bottom-6 right-6 sm:bottom-10 sm:right-10 ${isChatOpen && isMobile ? 'hidden' : ''}`}
      >
        <svg className="w-7 h-7 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
        {unreadCount > 0 && !isChatOpen && <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 bg-rose-500 text-white text-[11px] font-bold rounded-full border-2 border-white flex items-center justify-center shadow-sm pointer-events-none">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {/* 💡 [패널 래퍼] 카톡일 때만 paddingBottom을 적용하여 튕김 없이 부드럽게 방어 */}
      <div 
        className={`fixed bg-white flex flex-col overflow-hidden border border-slate-200 z-[9998] transition-all duration-300
          ${isChatOpen ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-95'}
          ${isMobile
            ? 'top-0 left-0 right-0 bottom-0 rounded-none' 
            : 'right-10 bottom-[90px] w-[360px] h-[550px] rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.15)] origin-bottom-right' 
          }
        `} 
        style={isMobile ? { 
          height: viewportHeight, 
          paddingBottom: needsManualPush ? keyboardMargin : '0px',
        } : {}}
      >
        <div className="bg-[#002864] text-white px-5 py-4 flex justify-between items-center shrink-0 touch-none">
          <h3 className="font-lexend font-bold text-[15px] flex items-center gap-2 pointer-events-none"><span>💬</span> 학원 및 선생님 상담</h3>
          <button onClick={() => { setIsChatOpen(false); setActiveRoomId(null); setActiveChatView("list"); setIsInputFocused(false); }} className="text-blue-200 hover:text-white transition-colors p-1.5 z-10 relative">
            <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {activeChatView === "list" ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
            <div className="shrink-0 p-3 pb-1 border-b border-slate-200 bg-white shadow-sm">
              <h3 className="text-[11px] font-extrabold text-[#002864] mb-2.5 flex items-center gap-1">👩‍🏫 상담 가능한 선생님</h3>
              <div className="flex gap-3 overflow-x-auto custom-scroll pb-2 px-1">
                {staffList.length === 0 ? <div className="text-[10px] text-slate-400 py-2">현재 배정된 선생님이 없습니다.</div> :
                  staffList.map(staff => {
                    const avatarUrl = getProfileImageUrl(staff.profile_image_url);
                    return (
                      <div key={staff.instructor_id} onClick={() => createOrOpenRoom(staff.instructor_id, `${staff.name} ${formatPosition(staff.position)}`, avatarUrl)} className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 w-14">
                        <div className="relative w-11 h-11 rounded-full bg-[#002864]/5 border border-[#002864]/10 flex items-center justify-center text-[#002864] text-lg font-black group-hover:bg-[#002864] group-hover:text-white transition-colors shadow-sm overflow-hidden">
                          <span className="absolute z-0">{staff.name.substring(1) || staff.name}</span>
                          {avatarUrl && <img src={avatarUrl} alt="profile" className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        </div>
                        <span className="text-[10px] font-bold text-slate-700 truncate w-full text-center group-hover:text-[#002864] mt-0.5">
                          {staff.name} {formatPosition(staff.position)}
                        </span>
                      </div>
                    );
                  })
                }
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-3">
              <h3 className="text-[11px] font-extrabold text-slate-400 mb-2 px-1">진행 중인 대화</h3>
              <div className="space-y-2">
                {chatRooms.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm">진행 중인 대화가 없습니다.<br/>선생님을 선택해 대화를 시작하세요.</div> :
                  chatRooms.map(r => {
                    const staffName = r.instructor ? `${r.instructor.name} ${formatPosition(r.instructor.position)}` : '알 수 없음';
                    const avatarUrl = getProfileImageUrl(r.instructor?.profile_image_url);
                    const sorted = (r.chat_message || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                    let preview = sorted.length > 0 ? sorted[0].content : '내역 없음';
                    
                    if (preview.startsWith("[IMAGE]")) preview = "📷 사진을 보냈습니다.";
                    else if (preview.startsWith("[FILE]")) preview = "📎 첨부파일을 보냈습니다.";
                    else if (preview.length > 18) preview = preview.substring(0, 18) + '...';
                    
                    const isUnread = sorted.filter((m: any) => m.sender_type === "instructor" && !m.is_read).length;
                    return (
                      <div key={r.room_id} onClick={() => openChatRoom(r.room_id, staffName, avatarUrl)} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-[#002864] transition-all flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="relative w-10 h-10 bg-slate-100 rounded-full flex justify-center items-center text-slate-600 font-bold shrink-0 border border-slate-200 text-lg overflow-hidden">
                            <span className="absolute z-0">👨‍🏫</span>
                            {avatarUrl && <img src={avatarUrl} alt="profile" className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-bold text-slate-700 text-sm truncate group-hover:text-[#002864] transition-colors">{staffName}</span>
                            <div className="flex justify-between items-center mt-0.5"><span className={`text-[11.5px] ${isUnread > 0 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'} truncate flex-1 pr-2`}>{preview}</span>{isUnread > 0 && <div className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">{isUnread > 99 ? '99+' : isUnread}</div>}</div>
                          </div>
                        </div>
                        <button onClick={(e) => deleteChatRoom(e, r.room_id)} className="p-2 ml-1 text-slate-300 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-colors" title="대화방 삭제">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative bg-[#b2c7d9]">
            <div className="bg-white/90 backdrop-blur px-3 py-2 border-b border-slate-200 flex items-center gap-2 shrink-0 shadow-sm z-10 sticky top-0">
              <button onClick={() => { setActiveChatView("list"); setActiveRoomId(null); loadChatRooms(); setIsInputFocused(false); }} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
              </button>
              <div className="flex flex-col flex-1 min-w-0"><span className="font-bold text-slate-800 text-[13px] truncate">{activeStaffName}</span><span className="text-[10px] font-bold text-emerald-600">실시간 연결됨</span></div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scroll p-4 flex flex-col gap-3 pb-2">
              {chatMessages.length === 0 ? <div className="text-center text-slate-400 font-bold text-xs mt-10 bg-white/50 p-4 rounded-xl mx-4">대화 내역이 없습니다.</div> :
                chatMessages.map(msg => (
                  <div key={msg.message_id} className={`flex ${msg.sender_type === "parent" ? "justify-end" : "justify-start"} w-full mb-1`}>
                    <div className={`flex items-end gap-1.5 max-w-[85%] ${msg.sender_type === "parent" ? "flex-row-reverse" : ""}`}>
                      
                      {msg.sender_type !== "parent" && (
                        <div className="relative w-7 h-7 rounded-full bg-slate-200 border border-slate-300 flex justify-center items-center shrink-0 mt-0.5 text-xs overflow-hidden">
                          <span className="absolute z-0">👨‍🏫</span>
                          {activeStaffAvatar && <img src={activeStaffAvatar} className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        </div>
                      )}

                      <div className={`px-3.5 py-2 rounded-2xl shadow-sm font-medium text-[13px] leading-snug break-words ${msg.sender_type === "parent" ? "bg-[#fef01b] text-slate-800 rounded-tr-sm" : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"}`}>
                        {msg.content?.startsWith("[IMAGE]") ? (
                          <img src={msg.content.replace("[IMAGE]", "")} alt="uploaded" className="max-w-[180px] sm:max-w-[220px] rounded-lg border border-slate-200/50 cursor-pointer object-cover my-1" onClick={() => window.open(msg.content.replace("[IMAGE]", ""), "_blank")} />
                        ) : msg.content?.startsWith("[FILE]") ? (
                          <a href={msg.content.replace("[FILE]", "")} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 bg-slate-100/80 rounded-xl border border-slate-200 hover:bg-slate-200 transition-colors my-1 text-slate-700 w-fit">
                            <span className="text-xl">📎</span>
                            <span className="underline font-bold text-blue-600 text-[12px]">첨부파일 열기</span>
                          </a>
                        ) : (
                          String(msg.content).split('\n').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)
                        )}
                      </div>
                      <div className="flex flex-col items-end shrink-0 text-[9px] text-slate-500">
                        {msg.sender_type === 'parent' && !msg.is_read && <span className="text-[#002864] font-bold mb-0.5">1</span>}
                        <span>{new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                ))
              }

              {isTyping && (
                <div className="flex justify-start w-full mb-1">
                  <div className="flex items-end gap-1.5 max-w-[85%]">
                    <div className="relative w-7 h-7 rounded-full bg-slate-200 border border-slate-300 flex justify-center items-center shrink-0 mt-0.5 text-xs overflow-hidden">
                      <span className="absolute z-0">👨‍🏫</span>
                      {activeStaffAvatar && <img src={activeStaffAvatar} className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    </div>
                    <div className="px-3.5 py-2 rounded-2xl shadow-sm font-bold text-[13px] leading-snug break-words bg-white text-slate-400 rounded-tl-sm border border-slate-100 animate-pulse">
                      선생님이 메시지를 입력 중입니다...
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-1" />
            </div>
            
            <div className="bg-white p-3 border-t border-slate-200 shrink-0 flex items-end gap-2 relative z-20">
              <input type="file" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="p-2.5 text-slate-400 hover:text-[#002864] transition-colors rounded-xl bg-slate-50 hover:bg-blue-50 shrink-0 border border-slate-200 shadow-sm" title="사진/파일 전송">
                {isUploading ? (
                  <div className="w-5 h-5 border-2 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                )}
              </button>
              <textarea 
                rows={1} 
                value={chatInput} 
                onChange={(e) => { setChatInput(e.target.value); activeChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { sender_type: "parent" } }); }} 
                onFocus={() => {
                  setIsInputFocused(true);
                  setTimeout(scrollToBottom, 200);
                }}
                onBlur={() => {
                  setIsInputFocused(false);
                }}
                onKeyPress={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendParentMsg(); }}} 
                className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#002864] resize-none max-h-[100px] custom-scroll" 
                placeholder="메시지를 입력하세요..." 
              />
              <button onClick={sendParentMsg} className="p-2.5 bg-[#002864] text-white rounded-xl hover:bg-blue-900 transition-colors shadow-sm shrink-0"><svg className="w-5 h-5 translate-x-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg></button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}