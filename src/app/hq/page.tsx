// src/app/hq/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ProfileModal from "@/components/ProfileModal"; 

export default function HQWorkspacePage() {
  const router = useRouter();
  
  const [instId, setInstId] = useState("");
  const [instName, setInstName] = useState("");
  const [instPosition, setInstPosition] = useState(""); 
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [activeView, setActiveView] = useState<"list" | "room" | "new">("list");
  const [rooms, setRooms] = useState<any[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomName, setActiveRoomName] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  
  const [allInstructors, setAllInstructors] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const [roomMembers, setRoomMembers] = useState<any[]>([]);
  
  const [typingStaffName, setTypingStaffName] = useState<string | null>(null);
  const [expandedTenants, setExpandedTenants] = useState<string[]>([]);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);

  const activeRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  const activeChannelRef = useRef<any>(null); 
  const globalChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);

  useEffect(() => {
    const id = localStorage.getItem("logica_instructor_id");
    if (!id) {
      alert("로그인이 필요합니다.");
      router.push("/hq-login"); 
      return;
    }
    setInstId(id);
    setInstName(localStorage.getItem("logica_instructor_name") || "본사 직원");
    setInstPosition(localStorage.getItem("logica_instructor_position") || "직원");
  }, [router]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typingStaffName]);

  useEffect(() => {
    const handleFocus = async () => {
      if (activeRoomIdRef.current && instId) {
        await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() })
          .eq("room_id", activeRoomIdRef.current)
          .eq("instructor_id", instId);
        loadRooms();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [instId]);

  const getProfileImageUrl = (path: string | null | undefined) => {
    if (!path || path.trim() === "") return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("system_images").getPublicUrl(path);
    return data.publicUrl;
  };

  const loadRooms = async () => {
    if (!instId) return;
    try {
      const { data } = await supabase.from('internal_chat_member')
        .select('room_id, internal_chat_room(title, room_type, created_at), last_read_at')
        .eq('instructor_id', instId).eq('is_active', true); 
      
      let totalUnread = 0;
      const roomsWithData = await Promise.all((data || []).map(async (r: any) => {
        const { data: msgs } = await supabase.from('internal_chat_message')
          .select('message_id, content, created_at, sender_id')
          .eq('room_id', r.room_id).order('created_at', { ascending: false });

        let displayTitle = r.internal_chat_room?.title || '선생님 대화방';
        let displayAvatar = null;
        
        if (r.internal_chat_room?.room_type === 'DIRECT') {
          const { data: otherMember } = await supabase.from('internal_chat_member').select('instructor_id').eq('room_id', r.room_id).neq('instructor_id', instId).maybeSingle();
          if (otherMember?.instructor_id) {
            const { data: instData } = await supabase.from('instructor').select('name, position, chat_position, profile_image_url').eq('instructor_id', otherMember.instructor_id).maybeSingle();
            if (instData) {
              displayTitle = `${instData.name} ${instData.chat_position || instData.position || '선생님'}`;
              if (instData.profile_image_url) displayAvatar = getProfileImageUrl(instData.profile_image_url);
            }
          }
        }

        const isRoomActive = document.hasFocus() && r.room_id === activeRoomIdRef.current;
        const unread = (msgs || []).filter((m:any) => m.sender_id !== instId && new Date(m.created_at) > new Date(r.last_read_at || '1970-01-01T00:00:00Z')).length;
        if (!isRoomActive) totalUnread += unread;

        return { ...r, displayTitle, displayAvatar, unreadCount: isRoomActive ? 0 : unread, latestMsg: msgs && msgs.length > 0 ? msgs[0] : null };
      }));

      roomsWithData.sort((a, b) => {
        const aTime = a.latestMsg ? new Date(a.latestMsg.created_at).getTime() : new Date(a.internal_chat_room?.created_at || 0).getTime();
        const bTime = b.latestMsg ? new Date(b.latestMsg.created_at).getTime() : new Date(b.internal_chat_room?.created_at || 0).getTime();
        return bTime - aTime;
      });

      setRooms(roomsWithData);
      setUnreadCount(totalUnread);
    } catch(e) {}
  };

  useEffect(() => {
    if (!instId) return;
    loadRooms(); 

    const channelName = `hq_global_${instId}`;
    supabase.getChannels().forEach(ch => { if (ch.topic.includes(channelName)) supabase.removeChannel(ch); });

    globalChannelRef.current = supabase.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_chat_message" }, async (payload) => {
        setTypingStaffName(null); 
        const isRoomActive = document.hasFocus() && String(activeRoomIdRef.current) === String(payload.new.room_id);

        if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
          setMessages(prev => prev.find(m => m.message_id === payload.new.message_id) ? prev : [...prev, payload.new]);
        }
        if (isRoomActive && payload.new.sender_id !== instId) {
          await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() }).eq("room_id", payload.new.room_id).eq("instructor_id", instId);
        }
        await supabase.from("internal_chat_member").update({ is_active: true }).eq("room_id", payload.new.room_id).eq("instructor_id", instId);
        loadRooms(); 
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "internal_chat_member" }, (payload) => {
        if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
          setRoomMembers(prev => prev.map(m => m.instructor_id === payload.new.instructor_id ? { ...m, last_read_at: payload.new.last_read_at } : m));
        }
        loadRooms(); 
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_chat_member" }, () => loadRooms())
      .subscribe();

    return () => { 
      if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current); 
      if (activeChannelRef.current) supabase.removeChannel(activeChannelRef.current);
    };
  }, [instId]);

  const showNewChatView = async () => {
    setActiveView("new"); setSearchKeyword(""); setSelectedInstIds([]);
    try {
      const safeTenantMap: Record<string, string> = {
        '1ff4299c-d72b-4d99-97b0-45fee08e3b73': '대치 본원',
        'd59395b0-8c9c-4dd3-9e25-ff569da98abc': '본사',
        'e24e540f-ebdd-40eb-b20b-696c113def6d': '서초 가맹점'
      };

      try {
        const { data: tenantData } = await supabase.from("academy_tenant").select("*");
        if (tenantData) tenantData.forEach((t: any) => { safeTenantMap[String(t.tenant_id)] = t.name; });
      } catch (e) {}

      const { data: instData } = await supabase.from("instructor").select("*").neq("instructor_id", instId).eq("status", "재직").order("name");
      
      if (instData) {
        const enrichedData = instData.map((inst: any) => ({ ...inst, academy_tenant: { name: safeTenantMap[String(inst.tenant_id)] || '소속 미지정' } }));
        setAllInstructors(enrichedData);

        const tSet = new Set<string>(); const dSet = new Set<string>();
        enrichedData.forEach((inst: any) => {
          const tName = inst.academy_tenant.name; const dName = inst.department || '부서 미지정';
          tSet.add(tName); dSet.add(`${tName}_${dName}`);
        });
        setExpandedTenants(Array.from(tSet)); setExpandedDepts(Array.from(dSet));
      }
    } catch(e) {}
  };

  const toggleInstSelection = (id: string) => setSelectedInstIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleStartGroupChat = async () => {
    if (selectedInstIds.length === 0) return;
    if (selectedInstIds.length === 1) {
      const target = allInstructors.find((i: any) => i.instructor_id === selectedInstIds[0]);
      if (target) {
        try {
          const { data: targetRooms } = await supabase.from('internal_chat_member').select('room_id').eq('instructor_id', target.instructor_id);
          let rId = null;
          if (targetRooms && targetRooms.length > 0) {
            const { data: commonMembers } = await supabase.from('internal_chat_member').select('room_id, internal_chat_room!inner(room_type)').eq('instructor_id', instId).in('room_id', targetRooms.map(r=>r.room_id)).eq('internal_chat_room.room_type', 'DIRECT');
            if (commonMembers && commonMembers.length > 0) rId = commonMembers[0].room_id;
          }
          if (!rId) {
            const titleWithPos = `${target.name} ${target.chat_position || target.position || '선생님'}`;
            const { data: newRoom } = await supabase.from('internal_chat_room').insert({ room_type: 'DIRECT', title: titleWithPos, created_by: instId }).select().single();
            if (newRoom) {
              rId = newRoom.room_id;
              await supabase.from('internal_chat_member').insert([{ room_id: rId, instructor_id: instId }, { room_id: rId, instructor_id: target.instructor_id }]);
            }
          }
          if (rId) openRoom(rId, `${target.name} ${target.chat_position || target.position || '선생님'}`);
        } catch(e) { alert("방 생성 에러"); }
      }
      return;
    }

    const roomName = prompt("새 그룹 채팅방 이름을 입력하세요.", "새 그룹 채팅방");
    if (!roomName) return;

    try {
      const { data: newRoom } = await supabase.from('internal_chat_room').insert({ room_type: 'GROUP', title: roomName, created_by: instId }).select().single();
      const membersToInsert = selectedInstIds.map(id => ({ room_id: newRoom.room_id, instructor_id: id }));
      membersToInsert.push({ room_id: newRoom.room_id, instructor_id: instId }); 
      await supabase.from('internal_chat_member').insert(membersToInsert);
      openRoom(newRoom.room_id, roomName);
    } catch (e: any) { alert("그룹방 생성 에러: " + e.message); }
  };

  const openRoom = async (roomId: string, roomName: string) => {
    setActiveRoomId(roomId); setActiveRoomName(roomName); setActiveView("room"); setMessages([]);
    setUnreadCount(prev => Math.max(0, prev - (rooms.find((r: any) => r.room_id === roomId)?.unreadCount || 0)));
    setRooms(prev => prev.map((r: any) => r.room_id === roomId ? { ...r, unreadCount: 0 } : r));

    if (activeChannelRef.current) supabase.removeChannel(activeChannelRef.current);
    
    const roomChannelName = `staff_room_${roomId}`;
    supabase.getChannels().forEach((ch) => { if (ch.topic.includes(roomChannelName)) supabase.removeChannel(ch); });

    activeChannelRef.current = supabase.channel(roomChannelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.sender_id !== instId) { 
          setTypingStaffName(payload.payload?.sender_name || "알 수 없는"); 
          clearTimeout(typingTimerRef.current); 
          typingTimerRef.current = setTimeout(() => setTypingStaffName(null), 3000); 
        }
      }).subscribe();

    try {
      await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString(), is_active: true }).eq("room_id", roomId).eq("instructor_id", instId);
      const [msgRes, memRes] = await Promise.all([
        supabase.from("internal_chat_message").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
        supabase.from("internal_chat_member").select("instructor_id, last_read_at, instructor(name, position, chat_position, profile_image_url)").eq("room_id", roomId)
      ]);
      setMessages(msgRes.data || []);
      setRoomMembers(memRes.data || []);
      loadRooms(); 
    } catch (e) {}
  };

  const sendMsg = async () => {
    const text = chatInput.trim();
    if (!text || !activeRoomId) return;
    setChatInput("");
    try {
      const { data: newMsg, error } = await supabase.from("internal_chat_message").insert({ room_id: activeRoomId, sender_id: instId, content: text }).select().single();
      if (error) throw error;
      if (newMsg) {
        setMessages(prev => [...prev, newMsg]);
        await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString() }).eq("room_id", activeRoomId).eq("instructor_id", instId);
        loadRooms(); 
      }
    } catch (e: any) { alert("메시지 전송 에러: " + e.message); }
  };

  const deleteRoom = async (roomId: string, e: React.MouseEvent) => {
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
      loadRooms();
      if (activeRoomId === roomId) { setActiveRoomId(null); setActiveView('list'); }
    } catch (error) { alert("삭제 중 오류가 발생했습니다."); }
  };

  const handleLogout = () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      localStorage.clear();
      router.push('/hq-login');
    }
  };

  const filteredInstructors = allInstructors.filter((inst: any) => (inst?.name || "").includes(searchKeyword));
  const orgTree: Record<string, Record<string, any[]>> = {};
  filteredInstructors.forEach((inst: any) => {
    const tenantName = inst.academy_tenant?.name || '소속 미지정';
    const deptName = inst.department || '부서 미지정';
    if (!orgTree[tenantName]) orgTree[tenantName] = {};
    if (!orgTree[tenantName][deptName]) orgTree[tenantName][deptName] = [];
    orgTree[tenantName][deptName].push(inst);
  });

  const toggleTenant = (t: string) => setExpandedTenants(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleDept = (d: string) => setExpandedDepts(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  if (!instId) return <div className="min-h-screen bg-slate-100 flex items-center justify-center font-bold text-slate-400">데이터 로딩 중...</div>;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-200 font-pretendard">
      
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 sm:px-5 py-3 flex justify-between items-center shadow-md z-20 shrink-0 gap-2">
        <div className="flex items-center min-w-0">
          <div className="min-w-0">
            <h1 className="text-[14px] sm:text-[16px] font-black leading-tight truncate">천종현수학연구소 통합 메신저</h1>
            <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 leading-tight truncate">전사 소통 채널 (B2B / 사내)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          
          <button onClick={() => setIsProfileOpen(true)} className="p-1.5 sm:p-2 bg-slate-700/50 hover:bg-slate-700 rounded-full transition-colors group relative shrink-0" title="내 정보 수정 및 자동응답 설정">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-200 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          </button>
          
          {/* 💡 [수정] 톱니바퀴와 로그아웃 사이로 이름/직책 이동 (모바일에서도 노출) */}
          <div className="text-right flex flex-col justify-center mx-1">
            <div className="text-[12px] sm:text-[13px] font-bold leading-tight truncate max-w-[65px] sm:max-w-[120px]">{instName}</div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 font-normal truncate max-w-[65px] sm:max-w-[120px]">{instPosition}</div>
          </div>

          <div className="w-px h-5 bg-slate-600 shrink-0"></div>
          
          <button onClick={handleLogout} className="whitespace-nowrap text-[11px] font-bold text-rose-300 hover:text-rose-400 bg-rose-500/10 px-2 sm:px-3 py-1.5 rounded-lg transition-colors shrink-0">로그아웃</button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* 좌측 사이드바 */}
        <div className={`${activeRoomId ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] flex-col bg-white border-r border-slate-300 shrink-0 z-10 shadow-lg`}>
          <div className="flex px-4 pt-4 pb-0 bg-slate-50 border-b border-slate-200 gap-2">
            <button onClick={() => { showNewChatView(); setActiveRoomId(null); }} className={`flex-1 py-2.5 text-[14px] font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${activeView === "new" ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
              조직도
            </button>
            <button onClick={() => { setActiveView("list"); setActiveRoomId(null); loadRooms(); }} className={`flex-1 py-2.5 text-[14px] font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${activeView !== "new" ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
              채팅 목록 {unreadCount > 0 && <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full">{unreadCount}</span>}
            </button>
          </div>

          {activeView === "new" ? (
            <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative">
              <div className="p-3 border-b border-slate-200 bg-white shrink-0">
                <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="직원 또는 가맹점 검색" className="w-full bg-slate-100 rounded-lg px-4 py-2 text-[13px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 pb-20">
                {Object.keys(orgTree).length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm">검색 결과가 없습니다.</div> :
                  Object.keys(orgTree).sort((a, b) => {
                    if (a === '본사') return -1;
                    if (b === '본사') return 1;
                    return a.localeCompare(b);
                  }).map(tenantName => {
                    const isTenantExpanded = expandedTenants.includes(tenantName) || searchKeyword.length > 0;
                    const tenantMembersCount = Object.values(orgTree[tenantName]).reduce((acc, curr) => acc + curr.length, 0);
                    return (
                      <div key={tenantName} className="mb-2">
                        <button onClick={() => toggleTenant(tenantName)} className="w-full bg-slate-200/80 hover:bg-slate-300/80 text-slate-800 px-4 py-3 rounded-xl font-extrabold text-[13px] flex justify-between items-center transition-colors shadow-sm">
                          <span>🏢 {tenantName} <span className="text-[11px] font-normal ml-1">({tenantMembersCount}명)</span></span>
                          <svg className={`w-4 h-4 transform transition-transform ${isTenantExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        {isTenantExpanded && (
                          <div className="mt-2 ml-2 border-l-2 border-slate-200 pl-3 space-y-2">
                            {Object.keys(orgTree[tenantName]).sort().map(deptName => {
                              const deptId = `${tenantName}_${deptName}`;
                              const isDeptExpanded = expandedDepts.includes(deptId) || searchKeyword.length > 0;
                              const deptMembers = orgTree[tenantName][deptName];
                              return (
                                <div key={deptId} className="mb-1">
                                  <button onClick={() => toggleDept(deptId)} className="w-full bg-white hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-lg font-bold text-[12px] flex justify-between items-center border border-slate-200 transition-colors shadow-sm">
                                    <span>📁 {deptName} <span className="text-[10px] font-normal ml-1 text-slate-400">({deptMembers.length}명)</span></span>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transform transition-transform ${isDeptExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                  </button>
                                  {isDeptExpanded && (
                                    <div className="mt-1.5 space-y-1.5">
                                      {deptMembers.map((inst: any) => {
                                        const isSelected = selectedInstIds.includes(inst.instructor_id);
                                        const avatarUrl = getProfileImageUrl(inst.profile_image_url);
                                        return (
                                          <div key={inst.instructor_id} onClick={() => toggleInstSelection(inst.instructor_id)} className={`bg-white p-3 rounded-lg border shadow-sm cursor-pointer transition-all flex items-center gap-3 ${isSelected ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border ${isSelected ? 'bg-slate-800 border-slate-800 text-white' : 'border-slate-300'}`}>
                                              {isSelected && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                            </div>
                                            <div className="relative w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 font-bold text-[13px] shrink-0 overflow-hidden">
                                              <span className="absolute z-0">T</span>
                                              {avatarUrl && <img src={avatarUrl} alt="profile" className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                                            </div>
                                            <div className="flex-1">
                                              <div className="font-bold text-slate-800 text-sm">
                                                {inst.name}
                                              </div>
                                              <div className="text-[11px] text-slate-500 font-bold mt-0.5">{inst.chat_position || inst.position || '직원'}</div>
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
                }
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-20">
                <button onClick={handleStartGroupChat} disabled={selectedInstIds.length === 0} className={`w-full py-3.5 rounded-xl font-extrabold text-[14px] transition-colors shadow-sm ${selectedInstIds.length > 0 ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                  {selectedInstIds.length > 0 ? `${selectedInstIds.length}명과 메신저 시작` : '대화 상대를 선택하세요'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-2">
              {rooms.length === 0 ? (
                 <div className="text-center py-20 flex flex-col items-center gap-3">
                   <span className="text-slate-400 font-bold text-sm">진행중인 대화가 없습니다.</span>
                   <button onClick={showNewChatView} className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-5 py-3 rounded-xl text-xs transition-colors shadow-sm">조직도에서 찾기</button>
                 </div>
              ) : (
                rooms.map((r, idx) => {
                  let previewText = r.latestMsg ? r.latestMsg.content : '대화 내역이 없습니다.';
                  if (previewText.length > 25) previewText = previewText.substring(0, 25) + '...';

                  return (
                    <div key={idx} onClick={() => openRoom(r.room_id, r.displayTitle)} className={`bg-white p-4 rounded-xl border shadow-sm transition-all flex items-center gap-3 cursor-pointer group ${activeRoomId === r.room_id ? 'border-slate-500 ring-1 ring-slate-500' : 'border-slate-200 hover:border-slate-400'}`}>
                      <div className="relative shrink-0 w-12 h-12">
                        <div className="relative w-full h-full bg-slate-100 border border-slate-200 rounded-full flex justify-center items-center text-slate-500 font-black overflow-hidden">
                          <span className="absolute z-0">{r.internal_chat_room?.room_type === 'GROUP' ? '👥' : 'T'}</span>
                          {r.internal_chat_room?.room_type !== 'GROUP' && r.displayAvatar && <img src={r.displayAvatar} alt="profile" className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        </div>
                        {r.unreadCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 bg-rose-500 text-white text-[11px] font-black rounded-full border-2 border-white flex items-center justify-center z-20 shadow-sm">{r.unreadCount > 99 ? '99+' : r.unreadCount}</span>}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-slate-800 text-[14px] truncate">{r.displayTitle}</span>
                          {r.latestMsg && <span className="text-[10px] font-bold text-slate-400 shrink-0">{new Date(r.latestMsg.created_at).toLocaleDateString('ko-KR', {month:'short', day:'numeric'})}</span>}
                        </div>
                        <div className="mt-1"><span className={`text-[12px] ${r.unreadCount > 0 ? 'text-slate-800 font-bold' : 'text-slate-500 font-medium'} truncate block`}>{previewText}</span></div>
                      </div>
                      <button onClick={(e) => deleteRoom(r.room_id, e)} className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 우측 메인 채팅방 */}
        <div className={`${!activeRoomId ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-[#eef2f6] relative`}>
          {activeRoomId ? (
            <>
              <div className="bg-white px-5 py-3.5 border-b border-slate-200 flex items-center gap-3 z-10 shrink-0 shadow-sm">
                <button onClick={() => { setActiveView("list"); setActiveRoomId(null); loadRooms(); }} className="md:hidden p-2 text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-full flex justify-center items-center text-slate-500 font-bold shrink-0 overflow-hidden relative">
                    <span className="absolute z-0">💬</span>
                    {rooms.find(r => r.room_id === activeRoomId)?.displayAvatar && <img src={rooms.find(r => r.room_id === activeRoomId)?.displayAvatar} className="absolute w-full h-full object-cover z-10" alt="profile"/>}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-extrabold text-slate-800 text-[16px] truncate">{activeRoomName}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
                {messages.length === 0 ? <div className="text-center text-slate-400 font-bold text-sm mt-20">대화를 시작해보세요.</div> :
                  messages.map(msg => {
                    const isMe = msg.sender_id === instId;
                    const unreadBy = roomMembers.filter(m => m.instructor_id !== instId && new Date(m.last_read_at || 0) < new Date(msg.created_at)).length;
                    const senderInfo = roomMembers.find(m => m.instructor_id === msg.sender_id)?.instructor;
                    const avatarUrl = getProfileImageUrl(senderInfo?.profile_image_url);

                    return (
                      <div key={msg.message_id} className={`flex w-full mb-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        {!isMe && (
                          <div className="relative w-9 h-9 bg-slate-300 rounded-full flex justify-center items-center text-white text-xs shrink-0 overflow-hidden shadow-sm mr-2">
                            <span className="absolute z-0 font-bold text-[14px]">T</span>
                            {avatarUrl && <img src={avatarUrl} alt="profile" className="absolute w-full h-full object-cover z-10" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                          </div>
                        )}
                        <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                          {!isMe && (
                            <span className="text-[12px] font-bold text-slate-600 mb-1 ml-1">
                              {senderInfo?.name || '알수없음'} 
                              <span className="font-normal text-[10px] text-slate-400 ml-0.5">{senderInfo?.chat_position || senderInfo?.position || '선생님'}</span>
                            </span>
                          )}
                          <div className={`flex items-end gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`px-4 py-2.5 rounded-2xl shadow-sm text-[14px] leading-relaxed break-words font-medium ${isMe ? 'bg-slate-800 text-white rounded-tr-sm' : 'bg-white text-slate-800 rounded-tl-sm border border-slate-100'}`}>
                              {String(msg.content).split('\n').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
                            </div>
                            <div className={`flex flex-col shrink-0 text-[10px] text-slate-500 font-bold ${isMe ? 'items-end' : 'items-start'}`}>
                              {isMe && unreadBy > 0 && <span className="text-[#002864] mb-0.5">{unreadBy}</span>}
                              <span className="whitespace-nowrap">{new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                }

                {typingStaffName && (
                  <div className="flex justify-start w-full mb-1 mt-2">
                    <div className="relative w-9 h-9 bg-slate-300 rounded-full flex justify-center items-center text-white text-xs shrink-0 overflow-hidden shadow-sm mr-2">
                      <span className="absolute z-0 font-bold text-[14px]">T</span>
                      {rooms.find(r => r.room_id === activeRoomId)?.displayAvatar && <img src={rooms.find(r => r.room_id === activeRoomId)?.displayAvatar} className="absolute w-full h-full object-cover z-10" alt="profile"/>}
                    </div>
                    <div className="flex flex-col items-start max-w-[75%]">
                      <span className="text-[12px] font-bold text-slate-600 mb-1 ml-1">{typingStaffName}</span>
                      <div className="px-4 py-2.5 rounded-2xl shadow-sm font-bold text-[13px] bg-white text-slate-400 rounded-tl-sm border border-slate-100 animate-pulse">
                        메시지를 입력 중입니다...
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              
              <div className="bg-white p-4 border-t border-slate-200 flex items-end gap-3 z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.02)]">
                <textarea 
                  rows={2} 
                  value={chatInput} 
                  onChange={e => { 
                    setChatInput(e.target.value); 
                    activeChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { sender_id: instId, sender_name: instName } }); 
                  }} 
                  onKeyPress={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }}} 
                  className="flex-1 bg-slate-100 rounded-xl px-4 py-3 text-[14px] font-bold text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 custom-scroll" 
                  placeholder="메시지를 입력하세요" 
                />
                <button onClick={sendMsg} disabled={!chatInput.trim()} className="p-4 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed shrink-0">
                  <svg className="w-5 h-5 translate-x-[2px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <div className="w-20 h-20 bg-slate-200/50 rounded-full flex items-center justify-center mb-4 text-4xl shadow-inner">💬</div>
              <p className="font-extrabold text-[15px] text-slate-500">대화방을 선택하거나 새 메시지를 시작하세요.</p>
            </div>
          )}
        </div>
      </div>

      <ProfileModal 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        instId={instId} 
        instructorName={instName} 
        isHQ={true}
      />
    </div>
  );
}