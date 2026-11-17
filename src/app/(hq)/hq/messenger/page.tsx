// src/app/hq/messenger/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { subscribePostgresChanges } from "@/lib/postgresRealtimeHub";
import { useHqShell } from "@/components/hq/HqShellContext";
import { FALLBACK_TENANT_NAMES } from "@/lib/hq/constants";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";

export default function HqMessengerPage() {
  const { instId, me, refreshChatUnread } = useHqShell();
  const instName = me?.name || "본부 구성원";

  const [activeView, setActiveView] = useState<"list" | "room" | "new">("new");
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
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const activeChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingStaffName]);

  const loadRooms = async () => {
    if (!instId) return;
    try {
      const { data } = await supabase
        .from("internal_chat_member")
        .select(
          "room_id, internal_chat_room(title, room_type, created_at), last_read_at"
        )
        .eq("instructor_id", instId)
        .eq("is_active", true);

      let totalUnread = 0;
      const roomsWithData = await Promise.all(
        (data || []).map(async (r: any) => {
          const { data: msgs } = await supabase
            .from("internal_chat_message")
            .select("message_id, content, created_at, sender_id")
            .eq("room_id", r.room_id)
            .order("created_at", { ascending: false });

          let displayTitle = r.internal_chat_room?.title || "대화방";
          let displayAvatar: string | null = null;

          if (r.internal_chat_room?.room_type === "DIRECT") {
            const { data: otherMember } = await supabase
              .from("internal_chat_member")
              .select("instructor_id")
              .eq("room_id", r.room_id)
              .neq("instructor_id", instId)
              .maybeSingle();

            if (otherMember?.instructor_id) {
              const { data: instData } = await supabase
                .from("instructor")
                .select("name, position, chat_position, profile_image_url")
                .eq("instructor_id", otherMember.instructor_id)
                .maybeSingle();

              if (instData) {
                displayTitle = `${instData.name} ${
                  instData.chat_position || instData.position || "님"
                }`;
                displayAvatar = resolveStoragePublicUrl(
                  instData.profile_image_url
                );
              }
            }
          }

          const isRoomActive =
            document.hasFocus() && r.room_id === activeRoomIdRef.current;
          const unread = (msgs || []).filter(
            (m: any) =>
              m.sender_id !== instId &&
              new Date(m.created_at) >
                new Date(r.last_read_at || "1970-01-01T00:00:00Z")
          ).length;
          if (!isRoomActive) totalUnread += unread;

          return {
            ...r,
            displayTitle,
            displayAvatar,
            unreadCount: isRoomActive ? 0 : unread,
            latestMsg: msgs && msgs.length > 0 ? msgs[0] : null,
          };
        })
      );

      roomsWithData.sort((a, b) => {
        const aTime = a.latestMsg
          ? new Date(a.latestMsg.created_at).getTime()
          : new Date(a.internal_chat_room?.created_at || 0).getTime();
        const bTime = b.latestMsg
          ? new Date(b.latestMsg.created_at).getTime()
          : new Date(b.internal_chat_room?.created_at || 0).getTime();
        return bTime - aTime;
      });

      setRooms(roomsWithData);
      setUnreadCount(totalUnread);
      refreshChatUnread();
    } catch {
      // ignore
    }
  };

  const showNewChatView = async () => {
    setActiveView("new");
    setSearchKeyword("");
    setSelectedInstIds([]);
    try {
      const safeTenantMap: Record<string, string> = {
        ...FALLBACK_TENANT_NAMES,
      };
      try {
        const { data: tenantData } = await supabase
          .from("academy_tenant")
          .select("*");
        if (tenantData) {
          tenantData.forEach((t: any) => {
            safeTenantMap[String(t.tenant_id)] = t.name;
          });
        }
      } catch {
        // ignore
      }

      const { data: instData } = await supabase
        .from("instructor")
        .select("*")
        .eq("status", "재직")
        .order("name");

      if (instData) {
        const enrichedData = instData.map((inst: any) => ({
          ...inst,
          academy_tenant: {
            name: safeTenantMap[String(inst.tenant_id)] || "소속 미지정",
          },
        }));
        setAllInstructors(enrichedData);

        const tSet = new Set<string>();
        const dSet = new Set<string>();
        enrichedData.forEach((inst: any) => {
          const tName = (inst.academy_tenant.name || "소속 미지정").trim();
          const dName = (inst.department || "부서 미지정").trim();
          tSet.add(tName);
          dSet.add(`${tName}_${dName}`);
        });
        setExpandedTenants(Array.from(tSet));
        setExpandedDepts(Array.from(dSet));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const handleFocus = async () => {
      if (activeRoomIdRef.current && instId) {
        await supabase
          .from("internal_chat_member")
          .update({ last_read_at: new Date().toISOString() })
          .eq("room_id", activeRoomIdRef.current)
          .eq("instructor_id", instId);
        loadRooms();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instId]);

  useEffect(() => {
    if (!instId) return;
    showNewChatView();
    loadRooms();

    const unsubHqMsg = subscribePostgresChanges(
      { table: "internal_chat_message", events: ["INSERT"] },
      async (payload) => {
        if (!payload.new) return;
        setTypingStaffName(null);
        const isRoomActive =
          document.hasFocus() &&
          String(activeRoomIdRef.current) === String(payload.new.room_id);

        if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
          setMessages((prev) =>
            prev.find((m) => m.message_id === payload.new.message_id)
              ? prev
              : [...prev, payload.new]
          );
        }
        if (isRoomActive && payload.new.sender_id !== instId) {
          await supabase
            .from("internal_chat_member")
            .update({ last_read_at: new Date().toISOString() })
            .eq("room_id", payload.new.room_id)
            .eq("instructor_id", instId);
        }
        await supabase
          .from("internal_chat_member")
          .update({ is_active: true })
          .eq("room_id", payload.new.room_id)
          .eq("instructor_id", instId);
        loadRooms();
      }
    );

    const unsubHqMember = subscribePostgresChanges(
      { table: "internal_chat_member", events: ["INSERT", "UPDATE"] },
      (payload) => {
        if (payload.eventType === "UPDATE" && payload.new) {
          if (String(activeRoomIdRef.current) === String(payload.new.room_id)) {
            setRoomMembers((prev) =>
              prev.map((m) =>
                m.instructor_id === payload.new.instructor_id
                  ? { ...m, last_read_at: payload.new.last_read_at }
                  : m
              )
            );
          }
        }
        loadRooms();
      }
    );

    return () => {
      unsubHqMsg();
      unsubHqMember();
      if (activeChannelRef.current) {
        supabase.removeChannel(activeChannelRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instId]);

  const toggleInstSelection = (id: string) =>
    setSelectedInstIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );

  const openRoom = async (roomId: string, roomName: string) => {
    setActiveRoomId(roomId);
    setActiveRoomName(roomName);
    setActiveView("room");
    setMessages([]);
    setUnreadCount((prev) =>
      Math.max(
        0,
        prev - (rooms.find((r: any) => r.room_id === roomId)?.unreadCount || 0)
      )
    );
    setRooms((prev) =>
      prev.map((r: any) =>
        r.room_id === roomId ? { ...r, unreadCount: 0 } : r
      )
    );

    if (activeChannelRef.current) {
      supabase.removeChannel(activeChannelRef.current);
    }

    const roomChannelName = `staff_room_${roomId}`;
    supabase.getChannels().forEach((ch) => {
      if (ch.topic.includes(roomChannelName)) supabase.removeChannel(ch);
    });

    activeChannelRef.current = supabase
      .channel(roomChannelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.sender_id !== instId) {
          setTypingStaffName(payload.payload?.sender_name || "상대방");
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(
            () => setTypingStaffName(null),
            3000
          );
        }
      })
      .subscribe();

    try {
      await supabase
        .from("internal_chat_member")
        .update({ last_read_at: new Date().toISOString(), is_active: true })
        .eq("room_id", roomId)
        .eq("instructor_id", instId);

      const [msgRes, memRes] = await Promise.all([
        supabase
          .from("internal_chat_message")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
        supabase
          .from("internal_chat_member")
          .select(
            "instructor_id, last_read_at, instructor(name, position, chat_position, profile_image_url)"
          )
          .eq("room_id", roomId),
      ]);
      setMessages(msgRes.data || []);
      setRoomMembers(memRes.data || []);
      loadRooms();
    } catch {
      // ignore
    }
  };

  const handleStartGroupChat = async () => {
    if (selectedInstIds.length === 0) return;
    if (selectedInstIds.length === 1) {
      const target = allInstructors.find(
        (i: any) => i.instructor_id === selectedInstIds[0]
      );
      if (target) {
        const targetInstId = target.instructor_id;
        const targetName = target.name;
        const targetPos = target.chat_position || target.position;

        try {
          if (targetInstId === instId) {
            const { data: myRooms } = await supabase
              .from("internal_chat_member")
              .select("room_id")
              .eq("instructor_id", instId);
            const myRoomIds = myRooms?.map((r: any) => r.room_id) || [];
            if (myRoomIds.length > 0) {
              const { data: selfRoom } = await supabase
                .from("internal_chat_room")
                .select("room_id")
                .in("room_id", myRoomIds)
                .ilike("title", "%(나)%")
                .limit(1)
                .maybeSingle();
              if (selfRoom) {
                openRoom(selfRoom.room_id, `${targetName} (나)`);
                return;
              }
            }
            const titleWithPos = `${targetName} (나)`;
            const { data: newRoom } = await supabase
              .from("internal_chat_room")
              .insert({
                room_type: "DIRECT",
                title: titleWithPos,
                created_by: instId,
              })
              .select()
              .single();
            if (newRoom) {
              await supabase
                .from("internal_chat_member")
                .insert([{ room_id: newRoom.room_id, instructor_id: instId }]);
              openRoom(newRoom.room_id, titleWithPos);
            }
            return;
          }

          const { data: targetRooms } = await supabase
            .from("internal_chat_member")
            .select("room_id")
            .eq("instructor_id", targetInstId);
          let rId = null;
          if (targetRooms && targetRooms.length > 0) {
            const { data: commonMembers } = await supabase
              .from("internal_chat_member")
              .select("room_id, internal_chat_room!inner(room_type)")
              .eq("instructor_id", instId)
              .in(
                "room_id",
                targetRooms.map((r) => r.room_id)
              )
              .eq("internal_chat_room.room_type", "DIRECT");
            if (commonMembers && commonMembers.length > 0) {
              rId = commonMembers[0].room_id;
            }
          }
          if (!rId) {
            const titleWithPos = `${targetName} ${targetPos || "님"}`;
            const { data: newRoom } = await supabase
              .from("internal_chat_room")
              .insert({
                room_type: "DIRECT",
                title: titleWithPos,
                created_by: instId,
              })
              .select()
              .single();
            if (newRoom) {
              rId = newRoom.room_id;
              await supabase.from("internal_chat_member").insert([
                { room_id: rId, instructor_id: instId },
                { room_id: rId, instructor_id: targetInstId },
              ]);
            }
          }
          if (rId) openRoom(rId, `${targetName} ${targetPos || "님"}`);
        } catch {
          alert("대화방 생성 중 오류가 발생했습니다.");
        }
      }
      return;
    }

    const roomName = prompt(
      "새 그룹 채팅방 이름을 입력하세요.",
      "새 그룹 채팅방"
    );
    if (!roomName) return;

    try {
      const { data: newRoom } = await supabase
        .from("internal_chat_room")
        .insert({ room_type: "GROUP", title: roomName, created_by: instId })
        .select()
        .single();
      const membersToInsert = selectedInstIds.map((id) => ({
        room_id: newRoom.room_id,
        instructor_id: id,
      }));
      if (!selectedInstIds.includes(instId)) {
        membersToInsert.push({
          room_id: newRoom.room_id,
          instructor_id: instId,
        });
      }
      await supabase.from("internal_chat_member").insert(membersToInsert);
      openRoom(newRoom.room_id, roomName);
    } catch (e: any) {
      alert("그룹방 생성 오류: " + e.message);
    }
  };

  const sendMsg = async () => {
    const text = chatInput.trim();
    if (!text || !activeRoomId) return;
    setChatInput("");
    try {
      const { data: newMsg, error } = await supabase
        .from("internal_chat_message")
        .insert({ room_id: activeRoomId, sender_id: instId, content: text })
        .select()
        .single();
      if (error) throw error;
      if (newMsg) {
        setMessages((prev) => [...prev, newMsg]);
        await supabase
          .from("internal_chat_member")
          .update({ last_read_at: new Date().toISOString() })
          .eq("room_id", activeRoomId)
          .eq("instructor_id", instId);
        loadRooms();
      }
    } catch (e: any) {
      alert("메시지 전송 오류: " + e.message);
    }
  };

  const deleteRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("⚠️ 이 대화방을 목록에서 삭제(나가기) 하시겠습니까?")) return;
    try {
      await supabase
        .from("internal_chat_member")
        .update({ is_active: false })
        .eq("room_id", roomId)
        .eq("instructor_id", instId);
      const { count } = await supabase
        .from("internal_chat_member")
        .select("*", { count: "exact", head: true })
        .eq("room_id", roomId)
        .eq("is_active", true);
      if (count === 0) {
        await supabase
          .from("internal_chat_message")
          .delete()
          .eq("room_id", roomId);
        await supabase
          .from("internal_chat_member")
          .delete()
          .eq("room_id", roomId);
        await supabase
          .from("internal_chat_room")
          .delete()
          .eq("room_id", roomId);
      }
      loadRooms();
      if (activeRoomId === roomId) {
        setActiveRoomId(null);
        setActiveView("list");
      }
    } catch {
      alert("대화방 나가기 중 오류가 발생했습니다.");
    }
  };

  const meInst = allInstructors.find((i) => i.instructor_id === instId);
  const activeMyTenantName = (
    meInst?.academy_tenant?.name || "본사"
  ).trim();
  const activeMyDeptName = (
    me?.department ||
    meInst?.department ||
    "부서 미지정"
  ).trim();

  const filteredInstructors = allInstructors.filter((inst: any) => {
    const q = searchKeyword.trim();
    if (!q) return true;
    return (
      (inst?.name || "").includes(q) ||
      (inst?.department || "").includes(q) ||
      (inst?.academy_tenant?.name || "").includes(q)
    );
  });

  const orgTree: Record<string, Record<string, any[]>> = {};
  filteredInstructors.forEach((inst: any) => {
    const tenantName = (inst.academy_tenant?.name || "소속 미지정").trim();
    const deptName = (inst.department || "부서 미지정").trim();
    if (!orgTree[tenantName]) orgTree[tenantName] = {};
    if (!orgTree[tenantName][deptName]) orgTree[tenantName][deptName] = [];
    orgTree[tenantName][deptName].push(inst);
  });

  const toggleTenant = (t: string) =>
    setExpandedTenants((p) =>
      p.includes(t) ? p.filter((x) => x !== t) : [...p, t]
    );
  const toggleDept = (d: string) =>
    setExpandedDepts((p) =>
      p.includes(d) ? p.filter((x) => x !== d) : [...p, d]
    );

  return (
    <div className="flex-1 flex min-h-0 h-full overflow-hidden">
      {/* 좌측: 대화방 메인 영역 */}
      <div
        className={`${
          !activeRoomId ? "hidden md:flex" : "flex"
        } flex-1 flex-col bg-[#eef2f6] relative min-w-0 overflow-hidden`}
      >
        {activeRoomId ? (
          <>
            <div className="bg-white px-5 py-3.5 border-b border-slate-200 flex items-center gap-3 z-10 shrink-0 shadow-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveView("list");
                  setActiveRoomId(null);
                  loadRooms();
                }}
                className="md:hidden p-2 text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                ←
              </button>
              <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-full flex justify-center items-center text-slate-500 font-bold shrink-0 overflow-hidden relative">
                <span className="absolute z-0">💬</span>
                {rooms.find((r) => r.room_id === activeRoomId)
                  ?.displayAvatar && (
                  <img
                    src={
                      rooms.find((r) => r.room_id === activeRoomId)
                        ?.displayAvatar
                    }
                    className="absolute w-full h-full object-cover z-10"
                    alt="profile"
                  />
                )}
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="font-bold text-slate-800 text-[15px] truncate">
                  {activeRoomName}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3 custom-scroll">
              {messages.length === 0 ? (
                <div className="text-center text-slate-400 font-bold text-sm mt-20">
                  대화를 시작해보세요.
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.sender_id === instId;
                  const unreadBy = roomMembers.filter(
                    (m) =>
                      m.instructor_id !== instId &&
                      new Date(m.last_read_at || 0) < new Date(msg.created_at)
                  ).length;
                  const senderInfoRaw = roomMembers.find(
                    (m) => m.instructor_id === msg.sender_id
                  )?.instructor;
                  const senderInfo = Array.isArray(senderInfoRaw)
                    ? senderInfoRaw[0]
                    : senderInfoRaw;
                  const avatarUrl = resolveStoragePublicUrl(
                    senderInfo?.profile_image_url
                  );

                  return (
                    <div
                      key={msg.message_id}
                      className={`flex w-full mb-1 ${
                        isMe ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!isMe && (
                        <div className="relative w-9 h-9 bg-slate-300 rounded-full flex justify-center items-center text-white text-xs shrink-0 overflow-hidden shadow-xs mr-2">
                          <span className="absolute z-0 font-bold text-[14px]">
                            {senderInfo?.name?.slice(0, 1) || "T"}
                          </span>
                          {avatarUrl && (
                            <img
                              src={avatarUrl}
                              alt="profile"
                              className="absolute w-full h-full object-cover z-10"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                        </div>
                      )}
                      <div
                        className={`flex flex-col max-w-[75%] ${
                          isMe ? "items-end" : "items-start"
                        }`}
                      >
                        {!isMe && (
                          <span className="text-[12px] font-bold text-slate-600 mb-1 ml-1">
                            {senderInfo?.name || "구성원"}{" "}
                            <span className="font-normal text-xs text-slate-400 ml-0.5">
                              {senderInfo?.chat_position ||
                                senderInfo?.position ||
                                ""}
                            </span>
                          </span>
                        )}
                        <div
                          className={`flex items-end gap-1.5 ${
                            isMe ? "flex-row-reverse" : "flex-row"
                          }`}
                        >
                          <div
                            className={`px-4 py-2.5 rounded-2xl shadow-xs text-[14px] leading-relaxed break-words font-medium ${
                              isMe
                                ? "bg-slate-800 text-white rounded-tr-sm"
                                : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"
                            }`}
                          >
                            {String(msg.content)
                              .split("\n")
                              .map((line, i) => (
                                <React.Fragment key={i}>
                                  {line}
                                  <br />
                                </React.Fragment>
                              ))}
                          </div>
                          <div
                            className={`flex flex-col shrink-0 text-xs text-slate-500 font-bold ${
                              isMe ? "items-end" : "items-start"
                            }`}
                          >
                            {isMe && unreadBy > 0 && (
                              <span className="text-brand mb-0.5">
                                {unreadBy}
                              </span>
                            )}
                            <span className="whitespace-nowrap">
                              {new Date(msg.created_at).toLocaleTimeString(
                                "ko-KR",
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {typingStaffName && (
                <div className="flex justify-start w-full mb-1 mt-2">
                  <div className="px-4 py-2 rounded-2xl bg-white text-slate-400 text-xs font-bold border border-slate-200 animate-pulse">
                    {typingStaffName}님이 메시지를 입력 중입니다...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="bg-white p-4 border-t border-slate-200 flex items-end gap-3 z-10">
              <textarea
                rows={2}
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  activeChannelRef.current?.send({
                    type: "broadcast",
                    event: "typing",
                    payload: { sender_id: instId, sender_name: instName },
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMsg();
                  }
                }}
                className="flex-1 bg-slate-100 rounded-xl px-4 py-3 text-[14px] font-bold text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 custom-scroll"
                placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
              />
              <button
                type="button"
                onClick={sendMsg}
                disabled={!chatInput.trim()}
                className="px-5 py-3.5 bg-brand text-white rounded-xl hover:bg-brand-hover font-bold text-xs transition-colors shadow-sm disabled:opacity-50 shrink-0"
              >
                전송
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
            <div className="w-16 h-16 bg-white rounded-2xl border border-slate-200 flex items-center justify-center mb-3 text-3xl shadow-xs">
              💬
            </div>
            <p className="font-bold text-sm text-slate-600">
              우측 전사 조직도에서 대화 상대를 선택하거나 기존 채팅방을 열어주세요.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              본사 부서 및 전국 가맹점 구성원과 1:1 또는 그룹 대화를 나눌 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {/* 우측: 전사 조직도 & 대화방 목록 패널 */}
      <div
        className={`${
          activeRoomId ? "hidden md:flex" : "flex"
        } w-full md:w-[350px] flex-col bg-white border-l border-slate-200 shrink-0 z-10`}
      >
        <div className="flex px-4 pt-3 bg-slate-50 border-b border-slate-200 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              showNewChatView();
              setActiveRoomId(null);
            }}
            className={`flex-1 py-2.5 text-[13px] font-extrabold border-b-2 transition-colors ${
              activeView === "new"
                ? "border-brand text-brand"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            전사 조직도
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView("list");
              setActiveRoomId(null);
              loadRooms();
            }}
            className={`flex-1 py-2.5 text-[13px] font-extrabold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeView !== "new"
                ? "border-brand text-brand"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            <span>대화방 목록</span>
            {unreadCount > 0 && (
              <span className="bg-rose-500 text-white text-[11px] px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {activeView === "new" ? (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative">
            <div className="p-3 border-b border-slate-200 bg-white shrink-0">
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="구성원 이름, 부서, 가맹점 검색"
                className="w-full bg-slate-100 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-3.5 space-y-2.5 pb-20">
              {Object.keys(orgTree).length === 0 ? (
                <div className="text-center py-12 text-slate-400 font-bold text-xs">
                  검색 결과가 없습니다.
                </div>
              ) : (
                Object.keys(orgTree)
                  .sort((a, b) => {
                    const aTrim = a.trim();
                    const bTrim = b.trim();
                    if (aTrim === activeMyTenantName) return -1;
                    if (bTrim === activeMyTenantName) return 1;
                    if (aTrim === "본사") return -1;
                    if (bTrim === "본사") return 1;
                    return a.localeCompare(b, "ko");
                  })
                  .map((tenantName) => {
                    const isTenantExpanded =
                      expandedTenants.includes(tenantName) ||
                      searchKeyword.length > 0;
                    const tenantMembersCount = Object.values(
                      orgTree[tenantName]
                    ).reduce((acc, curr) => acc + curr.length, 0);
                    const isMyTenant = tenantName.trim() === activeMyTenantName;

                    return (
                      <div key={tenantName} className="mb-1.5">
                        <button
                          type="button"
                          onClick={() => toggleTenant(tenantName)}
                          className="w-full bg-slate-200/80 hover:bg-slate-300/70 text-slate-800 px-3.5 py-2.5 rounded-xl font-extrabold text-xs flex justify-between items-center transition-colors"
                        >
                          <span className="flex items-center gap-1.5">
                            <span>🏢 {tenantName}</span>
                            {isMyTenant && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-brand text-[10px] rounded font-bold">
                                내 소속
                              </span>
                            )}
                            <span className="text-[11px] font-normal text-slate-500">
                              ({tenantMembersCount}명)
                            </span>
                          </span>
                          <span className="text-[10px]">
                            {isTenantExpanded ? "▲" : "▼"}
                          </span>
                        </button>

                        {isTenantExpanded && (
                          <div className="mt-2 ml-2 border-l-2 border-slate-200 pl-2.5 space-y-2">
                            {Object.keys(orgTree[tenantName])
                              .sort((a, b) => {
                                if (isMyTenant && a.trim() === activeMyDeptName)
                                  return -1;
                                if (isMyTenant && b.trim() === activeMyDeptName)
                                  return 1;
                                return a.localeCompare(b, "ko");
                              })
                              .map((deptName) => {
                                const deptId = `${tenantName}_${deptName}`;
                                const isDeptExpanded =
                                  expandedDepts.includes(deptId) ||
                                  searchKeyword.length > 0;
                                const deptMembers =
                                  orgTree[tenantName][deptName];
                                const isMyDept =
                                  isMyTenant &&
                                  deptName.trim() === activeMyDeptName;

                                return (
                                  <div key={deptId}>
                                    <button
                                      type="button"
                                      onClick={() => toggleDept(deptId)}
                                      className="w-full bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg font-bold text-xs flex justify-between items-center border border-slate-200"
                                    >
                                      <span className="flex items-center gap-1">
                                        <span>📁 {deptName}</span>
                                        {isMyDept && (
                                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded font-bold">
                                            내 부서
                                          </span>
                                        )}
                                        <span className="text-[11px] font-normal text-slate-400">
                                          ({deptMembers.length})
                                        </span>
                                      </span>
                                      <span className="text-[10px] text-slate-400">
                                        {isDeptExpanded ? "▲" : "▼"}
                                      </span>
                                    </button>

                                    {isDeptExpanded && (
                                      <div className="mt-1.5 space-y-1.5">
                                        {[...deptMembers]
                                          .sort((a: any, b: any) => {
                                            if (a.instructor_id === instId)
                                              return -1;
                                            if (b.instructor_id === instId)
                                              return 1;
                                            return a.name.localeCompare(
                                              b.name,
                                              "ko"
                                            );
                                          })
                                          .map((inst: any) => {
                                            const isSelected =
                                              selectedInstIds.includes(
                                                inst.instructor_id
                                              );
                                            const avatarUrl =
                                              resolveStoragePublicUrl(
                                                inst.profile_image_url
                                              );
                                            const isMe =
                                              inst.instructor_id === instId;

                                            return (
                                              <div
                                                key={inst.instructor_id}
                                                onClick={() =>
                                                  toggleInstSelection(
                                                    inst.instructor_id
                                                  )
                                                }
                                                className={`bg-white p-2.5 rounded-xl border cursor-pointer transition-all flex items-center gap-2.5 ${
                                                  isSelected
                                                    ? "border-brand bg-blue-50/40"
                                                    : "border-slate-200 hover:border-slate-400"
                                                }`}
                                              >
                                                <div
                                                  className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
                                                    isSelected
                                                      ? "bg-brand border-brand text-white"
                                                      : "border-slate-300"
                                                  }`}
                                                >
                                                  {isSelected ? "✓" : ""}
                                                </div>
                                                <div className="relative w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 font-bold text-xs shrink-0 overflow-hidden">
                                                  <span>
                                                    {inst.name?.slice(0, 1) ||
                                                      "T"}
                                                  </span>
                                                  {avatarUrl && (
                                                    <img
                                                      src={avatarUrl}
                                                      alt="profile"
                                                      className="absolute inset-0 w-full h-full object-cover"
                                                      onError={(e) => {
                                                        e.currentTarget.style.display =
                                                          "none";
                                                      }}
                                                    />
                                                  )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                  <div className="font-bold text-slate-800 text-xs flex items-center gap-1">
                                                    <span className="truncate">
                                                      {inst.name}
                                                    </span>
                                                    {isMe && (
                                                      <span className="px-1 py-0.2 bg-brand text-white text-[10px] rounded font-bold">
                                                        나
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="text-[11px] text-slate-500 truncate">
                                                    {inst.chat_position ||
                                                      inst.position ||
                                                      "구성원"}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-3.5 bg-white border-t border-slate-200 z-20">
              <button
                type="button"
                onClick={handleStartGroupChat}
                disabled={selectedInstIds.length === 0}
                className={`w-full py-3 rounded-xl font-extrabold text-xs transition-colors ${
                  selectedInstIds.length > 0
                    ? "bg-brand text-white hover:bg-brand-hover shadow-sm"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                {selectedInstIds.length > 0
                  ? `${selectedInstIds.length}명과 메신저 시작`
                  : "대화 상대를 선택하세요"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-slate-50 p-3.5 space-y-2 custom-scroll">
            {rooms.length === 0 ? (
              <div className="text-center py-20 flex flex-col items-center gap-3">
                <span className="text-slate-400 font-bold text-xs">
                  진행중인 대화가 없습니다.
                </span>
                <button
                  type="button"
                  onClick={showNewChatView}
                  className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2.5 rounded-xl text-xs"
                >
                  조직도에서 대화 시작
                </button>
              </div>
            ) : (
              rooms.map((r) => {
                let previewText = r.latestMsg
                  ? r.latestMsg.content
                  : "대화 내역이 없습니다.";
                if (previewText.length > 26) {
                  previewText = `${previewText.slice(0, 26)}...`;
                }

                return (
                  <div
                    key={r.room_id}
                    onClick={() => openRoom(r.room_id, r.displayTitle)}
                    className={`bg-white p-3.5 rounded-xl border transition-all flex items-center gap-3 cursor-pointer group ${
                      activeRoomId === r.room_id
                        ? "border-brand ring-1 ring-brand/30"
                        : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="relative shrink-0 w-10 h-10">
                      <div className="relative w-full h-full bg-slate-100 border border-slate-200 rounded-full flex justify-center items-center text-slate-500 font-bold text-xs overflow-hidden">
                        <span>
                          {r.internal_chat_room?.room_type === "GROUP"
                            ? "👥"
                            : "💬"}
                        </span>
                        {r.internal_chat_room?.room_type !== "GROUP" &&
                          r.displayAvatar && (
                            <img
                              src={r.displayAvatar}
                              alt="profile"
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                      </div>
                      {r.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-extrabold rounded-full border border-white flex items-center justify-center">
                          {r.unreadCount > 99 ? "99+" : r.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="font-bold text-slate-800 text-xs truncate">
                          {r.displayTitle}
                        </span>
                        {r.latestMsg && (
                          <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                            {new Date(
                              r.latestMsg.created_at
                            ).toLocaleDateString("ko-KR", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] mt-0.5 truncate ${
                          r.unreadCount > 0
                            ? "text-slate-900 font-bold"
                            : "text-slate-500"
                        }`}
                      >
                        {previewText}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => deleteRoom(r.room_id, e)}
                      className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 shrink-0 text-xs font-bold"
                      title="대화방 나가기"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
