// src/components/hq/HqChatDrawer.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { subscribePostgresChanges } from "@/lib/postgresRealtimeHub";
import { useHqShell } from "./HqShellContext";
import { FALLBACK_TENANT_NAMES } from "@/lib/hq/constants";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";
import { toCanonicalHqPath } from "@/lib/hq/hqRouteUtils";

function formatShortTime(iso?: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) {
    return dt.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `${dt.getMonth() + 1}.${dt.getDate()}`;
}

function formatDateDivider(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function HqChatDrawer() {
  const pathname = usePathname();
  const canonicalPath = toCanonicalHqPath(pathname);
  const router = useRouter();
  const hqHref = useHqHref();

  const {
    instId,
    me,
    unreadChatCount,
    chatDrawerOpen,
    closeChatDrawer,
    refreshChatUnread,
  } = useHqShell();

  const instName = me?.name || "본부 구성원";

  const [tab, setTab] = useState<"list" | "new">("list");
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomName, setActiveRoomName] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [roomMembers, setRoomMembers] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [typingStaffName, setTypingStaffName] = useState<string | null>(null);

  const [allInstructors, setAllInstructors] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const [expandedTenants, setExpandedTenants] = useState<string[]>([]);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);

  const activeRoomIdRef = useRef<string | null>(null);
  const drawerOpenRef = useRef<boolean>(false);
  const activeChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<any>(null);
  const hasAutoSelectedTabRef = useRef(false);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    drawerOpenRef.current = chatDrawerOpen;
  }, [chatDrawerOpen]);

  // 전체화면 메신저 페이지 진입 시 미니 드로어 자동 닫기
  useEffect(() => {
    if (canonicalPath === "/hq/messenger" && chatDrawerOpen) {
      closeChatDrawer();
    }
  }, [canonicalPath, chatDrawerOpen, closeChatDrawer]);

  // ESC 키로 닫기
  useEffect(() => {
    if (!chatDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChatDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatDrawerOpen, closeChatDrawer]);

  useEffect(() => {
    if (!chatDrawerOpen || !activeRoomId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingStaffName, chatDrawerOpen, activeRoomId]);

  const loadRooms = useCallback(async () => {
    if (!instId) return;
    setLoadingRooms(true);
    try {
      const { data } = await supabase
        .from("internal_chat_member")
        .select(
          "room_id, internal_chat_room(title, room_type, created_at), last_read_at"
        )
        .eq("instructor_id", instId)
        .eq("is_active", true);

      const roomsWithData = await Promise.all(
        (data || []).map(async (r: any) => {
          const { data: msgs } = await supabase
            .from("internal_chat_message")
            .select("message_id, content, created_at, sender_id")
            .eq("room_id", r.room_id)
            .order("created_at", { ascending: false })
            .limit(40);

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
            drawerOpenRef.current &&
            document.hasFocus() &&
            String(r.room_id) === String(activeRoomIdRef.current);

          const unread = (msgs || []).filter(
            (m: any) =>
              m.sender_id !== instId &&
              new Date(m.created_at) >
                new Date(r.last_read_at || "1970-01-01T00:00:00Z")
          ).length;

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
      if (!hasAutoSelectedTabRef.current) {
        hasAutoSelectedTabRef.current = true;
        setTab(roomsWithData.length > 0 ? "list" : "new");
      }
      refreshChatUnread();
    } catch {
      // ignore
    } finally {
      setLoadingRooms(false);
    }
  }, [instId, refreshChatUnread]);

  const loadDirectory = useCallback(async () => {
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
        const enriched = instData.map((inst: any) => ({
          ...inst,
          academy_tenant: {
            name: safeTenantMap[String(inst.tenant_id)] || "소속 미지정",
          },
        }));
        setAllInstructors(enriched);

        const tSet = new Set<string>();
        const dSet = new Set<string>();
        enriched.forEach((inst: any) => {
          const tName = (inst.academy_tenant.name || "소속 미지정").trim();
          const dName = (inst.department || "부서 미지정").trim();
          if (tName === "본사") {
            tSet.add(tName);
            dSet.add(`${tName}_${dName}`);
          }
        });
        setExpandedTenants(Array.from(tSet));
        setExpandedDepts(Array.from(dSet));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!chatDrawerOpen || !instId) return;
    loadRooms();
    if (allInstructors.length === 0) {
      loadDirectory();
    }

    const unsubMsg = subscribePostgresChanges(
      { table: "internal_chat_message", events: ["INSERT"] },
      async (payload) => {
        if (!payload.new) return;
        setTypingStaffName(null);
        const isCurrentOpenRoom =
          drawerOpenRef.current &&
          String(activeRoomIdRef.current) === String(payload.new.room_id);

        if (isCurrentOpenRoom) {
          setMessages((prev) =>
            prev.find((m) => m.message_id === payload.new.message_id)
              ? prev
              : [...prev, payload.new]
          );
          if (document.hasFocus() && payload.new.sender_id !== instId) {
            await supabase
              .from("internal_chat_member")
              .update({ last_read_at: new Date().toISOString() })
              .eq("room_id", payload.new.room_id)
              .eq("instructor_id", instId);
          }
        }

        await supabase
          .from("internal_chat_member")
          .update({ is_active: true })
          .eq("room_id", payload.new.room_id)
          .eq("instructor_id", instId);

        loadRooms();
      }
    );

    const unsubMember = subscribePostgresChanges(
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
      unsubMsg();
      unsubMember();
    };
  }, [chatDrawerOpen, instId, allInstructors.length, loadRooms, loadDirectory]);

  // 드로어가 닫힐 때 브로드캐스트 채널 정리
  useEffect(() => {
    if (!chatDrawerOpen && activeChannelRef.current) {
      supabase.removeChannel(activeChannelRef.current);
      activeChannelRef.current = null;
    }
  }, [chatDrawerOpen]);

  const openRoom = async (roomId: string, roomName: string) => {
    setActiveRoomId(roomId);
    setActiveRoomName(roomName);
    setMessages([]);
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
      refreshChatUnread();
      loadRooms();
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch {
      // ignore
    }
  };

  const startDirectWith = async (target: any) => {
    if (!target || !instId) return;
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

      let rId: string | null = null;
      if (targetRooms && targetRooms.length > 0) {
        const { data: commonMembers } = await supabase
          .from("internal_chat_member")
          .select("room_id, internal_chat_room!inner(room_type)")
          .eq("instructor_id", instId)
          .in(
            "room_id",
            targetRooms.map((r: any) => r.room_id)
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

      if (rId) {
        setSelectedInstIds([]);
        openRoom(rId, `${targetName} ${targetPos || "님"}`);
      }
    } catch {
      alert("대화방 생성 중 오류가 발생했습니다.");
    }
  };

  const handleStartSelectedChat = async () => {
    if (selectedInstIds.length === 0) return;
    if (selectedInstIds.length === 1) {
      const target = allInstructors.find(
        (i: any) => i.instructor_id === selectedInstIds[0]
      );
      if (target) await startDirectWith(target);
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
      setSelectedInstIds([]);
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
        setMessages((prev) =>
          prev.find((m) => m.message_id === newMsg.message_id)
            ? prev
            : [...prev, newMsg]
        );
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

  const leaveRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("이 대화방을 목록에서 나가기 하시겠습니까?")) return;
    try {
      await supabase
        .from("internal_chat_member")
        .update({ is_active: false })
        .eq("room_id", roomId)
        .eq("instructor_id", instId);
      if (activeRoomId === roomId) {
        setActiveRoomId(null);
      }
      loadRooms();
    } catch {
      alert("대화방 나가기 중 오류가 발생했습니다.");
    }
  };

  if (!chatDrawerOpen) return null;

  const meInst = allInstructors.find((i) => i.instructor_id === instId);
  const activeMyTenantName = (meInst?.academy_tenant?.name || "본사").trim();
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
    const tName = (inst.academy_tenant?.name || "소속 미지정").trim();
    const dName = (inst.department || "부서 미지정").trim();
    if (!orgTree[tName]) orgTree[tName] = {};
    if (!orgTree[tName][dName]) orgTree[tName][dName] = [];
    orgTree[tName][dName].push(inst);
  });

  const currentRoomObj = rooms.find((r) => r.room_id === activeRoomId);

  return (
    <aside className="print:hidden fixed top-16 right-0 bottom-0 w-full sm:w-[396px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col overflow-hidden">
      {/* 상단 드로어 헤더 */}
      <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-2 shrink-0">
        {activeRoomId ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                setActiveRoomId(null);
                setTab("list");
                loadRooms();
              }}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs font-extrabold shrink-0"
              title="대화방 목록으로"
            >
              ←
            </button>
            <div className="relative w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold overflow-hidden shrink-0">
              <span>💬</span>
              {currentRoomObj?.displayAvatar && (
                <img
                  src={currentRoomObj.displayAvatar}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold truncate">
                {activeRoomName}
              </div>
              {roomMembers.length > 0 && (
                <div className="text-[10px] text-slate-300">
                  참여 {roomMembers.length}명
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-extrabold">💬 사내 메신저</span>
            {unreadChatCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold">
                안 읽음 {unreadChatCount > 99 ? "99+" : unreadChatCount}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              closeChatDrawer();
              router.push(hqHref("/hq/messenger"));
            }}
            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-slate-200 hover:text-white transition-colors"
            title="메신저 전체화면으로 열기"
          >
            전체화면 ↗
          </button>
          <button
            type="button"
            onClick={closeChatDrawer}
            className="w-7 h-7 rounded-lg hover:bg-white/15 flex items-center justify-center text-sm font-bold text-slate-300 hover:text-white"
            title="채팅창 닫기 (ESC)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 본문: 대화방 진입 상태 vs 목록/조직도 */}
      {activeRoomId ? (
        <>
          <div className="flex-1 overflow-y-auto p-3.5 bg-[#eef2f6] flex flex-col gap-2.5 custom-scroll">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 py-16">
                <div className="text-2xl mb-1.5">👋</div>
                <p className="text-xs font-bold">첫 메시지를 보내 대화를 시작하세요.</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isMe = msg.sender_id === instId;
                const prevMsg = idx > 0 ? messages[idx - 1] : null;
                const showDate =
                  !prevMsg ||
                  String(prevMsg.created_at).slice(0, 10) !==
                    String(msg.created_at).slice(0, 10);

                const unreadBy = roomMembers.filter(
                  (m) =>
                    m.instructor_id !== instId &&
                    new Date(m.last_read_at || 0) < new Date(msg.created_at)
                ).length;

                const senderRaw = roomMembers.find(
                  (m) => m.instructor_id === msg.sender_id
                )?.instructor;
                const sender = Array.isArray(senderRaw)
                  ? senderRaw[0]
                  : senderRaw;
                const avatarUrl = resolveStoragePublicUrl(
                  sender?.profile_image_url
                );

                return (
                  <React.Fragment key={msg.message_id}>
                    {showDate && (
                      <div className="flex justify-center my-1.5">
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-300/60 text-slate-600 text-[10px] font-bold">
                          {formatDateDivider(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`flex w-full ${
                        isMe ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!isMe && (
                        <div className="relative w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden mr-2 mt-0.5">
                          <span>{sender?.name?.slice(0, 1) || "구"}</span>
                          {avatarUrl && (
                            <img
                              src={avatarUrl}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                        </div>
                      )}

                      <div
                        className={`flex flex-col max-w-[78%] ${
                          isMe ? "items-end" : "items-start"
                        }`}
                      >
                        {!isMe && (
                          <span className="text-[11px] font-bold text-slate-600 mb-0.5 ml-1">
                            {sender?.name || "구성원"}{" "}
                            <span className="font-normal text-slate-400">
                              {sender?.chat_position || sender?.position || ""}
                            </span>
                          </span>
                        )}
                        <div
                          className={`flex items-end gap-1 ${
                            isMe ? "flex-row-reverse" : "flex-row"
                          }`}
                        >
                          <div
                            className={`px-3.5 py-2 rounded-2xl shadow-xs text-[13px] leading-relaxed break-words font-medium ${
                              isMe
                                ? "bg-slate-800 text-white rounded-tr-sm"
                                : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"
                            }`}
                          >
                            {String(msg.content)
                              .split("\n")
                              .map((line, i, arr) => (
                                <React.Fragment key={i}>
                                  {line}
                                  {i < arr.length - 1 && <br />}
                                </React.Fragment>
                              ))}
                          </div>
                          <div
                            className={`flex flex-col shrink-0 text-[10px] text-slate-400 font-bold ${
                              isMe ? "items-end" : "items-start"
                            }`}
                          >
                            {isMe && unreadBy > 0 && (
                              <span className="text-brand leading-none mb-0.5">
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
                  </React.Fragment>
                );
              })
            )}

            {typingStaffName && (
              <div className="flex justify-start">
                <div className="px-3 py-1.5 rounded-2xl bg-white text-slate-400 text-[11px] font-bold border border-slate-200 animate-pulse">
                  {typingStaffName}님이 입력 중...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-white border-t border-slate-200 flex items-end gap-2 shrink-0">
            <textarea
              ref={inputRef}
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
              placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)"
              className="flex-1 bg-slate-100 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-brand/40 custom-scroll"
            />
            <button
              type="button"
              onClick={sendMsg}
              disabled={!chatInput.trim()}
              className="px-3.5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold disabled:opacity-40 shrink-0 transition-colors"
            >
              전송
            </button>
          </div>
        </>
      ) : (
        <>
          {/* 탭 바 */}
          <div className="flex px-3 pt-2 bg-slate-50 border-b border-slate-200 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setTab("list");
                loadRooms();
              }}
              className={`flex-1 py-2 text-xs font-extrabold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                tab === "list"
                  ? "border-brand text-brand"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <span>대화방 목록</span>
              {unreadChatCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] leading-none">
                  {unreadChatCount > 99 ? "99+" : unreadChatCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("new");
                if (allInstructors.length === 0) loadDirectory();
              }}
              className={`flex-1 py-2 text-xs font-extrabold border-b-2 transition-colors ${
                tab === "new"
                  ? "border-brand text-brand"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              전사 조직도 · 새 대화
            </button>
          </div>

          {tab === "list" ? (
            <div className="flex-1 flex flex-col min-h-0 bg-white">
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scroll">
                {loadingRooms && rooms.length === 0 ? (
                  <div className="py-16 text-center text-xs font-bold text-slate-400">
                    대화 목록을 불러오는 중입니다...
                  </div>
                ) : rooms.length === 0 ? (
                  <div className="py-16 px-6 text-center space-y-3">
                    <div className="text-3xl">💬</div>
                    <p className="text-xs font-bold text-slate-500">
                      아직 참여 중인 대화방이 없습니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => setTab("new")}
                      className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold"
                    >
                      + 조직도에서 대화 상대 선택
                    </button>
                  </div>
                ) : (
                  rooms.map((r) => {
                    const isGroup = r.internal_chat_room?.room_type === "GROUP";
                    return (
                      <div
                        key={r.room_id}
                        onClick={() => openRoom(r.room_id, r.displayTitle)}
                        className="group px-4 py-3 hover:bg-slate-50 cursor-pointer flex items-center gap-3 transition-colors"
                      >
                        <div className="relative w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-sm shrink-0 overflow-hidden">
                          <span>{isGroup ? "👥" : "💬"}</span>
                          {r.displayAvatar && (
                            <img
                              src={r.displayAvatar}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-slate-800 truncate">
                              {r.displayTitle}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                              {formatShortTime(r.latestMsg?.created_at)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p
                              className={`text-xs truncate ${
                                r.unreadCount > 0
                                  ? "font-bold text-slate-800"
                                  : "text-slate-500"
                              }`}
                            >
                              {r.latestMsg?.content || "대화를 시작해보세요."}
                            </p>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.unreadCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold leading-none">
                                  {r.unreadCount}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => leaveRoom(r.room_id, e)}
                                className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-opacity"
                                title="대화방 나가기"
                              >
                                나가기
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0">
                <button
                  type="button"
                  onClick={() => setTab("new")}
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition-colors"
                >
                  + 새 1:1 · 그룹 대화 시작
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative">
              <div className="p-3 bg-white border-b border-slate-200 shrink-0">
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="구성원 이름 · 부서 · 지점 검색"
                  className="w-full bg-slate-100 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-2 pb-16">
                {Object.keys(orgTree).length === 0 ? (
                  <div className="py-12 text-center text-xs font-bold text-slate-400">
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
                        searchKeyword.trim().length > 0;
                      const count = Object.values(orgTree[tenantName]).reduce(
                        (acc, curr) => acc + curr.length,
                        0
                      );

                      return (
                        <div key={tenantName}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTenants((prev) =>
                                prev.includes(tenantName)
                                  ? prev.filter((x) => x !== tenantName)
                                  : [...prev, tenantName]
                              )
                            }
                            className="w-full px-3 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-300/70 text-slate-800 text-xs font-extrabold flex items-center justify-between"
                          >
                            <span>
                              🏢 {tenantName}{" "}
                              <span className="font-normal text-slate-500">
                                ({count}명)
                              </span>
                            </span>
                            <span className="text-[10px]">
                              {isTenantExpanded ? "▲" : "▼"}
                            </span>
                          </button>

                          {isTenantExpanded && (
                            <div className="mt-1.5 ml-2 pl-2 border-l-2 border-slate-200 space-y-1.5">
                              {Object.keys(orgTree[tenantName])
                                .sort((a, b) => {
                                  if (a.trim() === activeMyDeptName) return -1;
                                  if (b.trim() === activeMyDeptName) return 1;
                                  return a.localeCompare(b, "ko");
                                })
                                .map((deptName) => {
                                  const deptKey = `${tenantName}_${deptName}`;
                                  const isDeptExpanded =
                                    expandedDepts.includes(deptKey) ||
                                    searchKeyword.trim().length > 0;
                                  const members = orgTree[tenantName][deptName];

                                  return (
                                    <div key={deptKey}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedDepts((prev) =>
                                            prev.includes(deptKey)
                                              ? prev.filter((x) => x !== deptKey)
                                              : [...prev, deptKey]
                                          )
                                        }
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between"
                                      >
                                        <span>
                                          {deptName} ({members.length})
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                          {isDeptExpanded ? "−" : "+"}
                                        </span>
                                      </button>

                                      {isDeptExpanded && (
                                        <div className="mt-1 space-y-1">
                                          {members.map((inst: any) => {
                                            const checked =
                                              selectedInstIds.includes(
                                                inst.instructor_id
                                              );
                                            const avatar =
                                              resolveStoragePublicUrl(
                                                inst.profile_image_url
                                              );
                                            return (
                                              <div
                                                key={inst.instructor_id}
                                                className={`px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 bg-white ${
                                                  checked
                                                    ? "border-brand bg-blue-50/40"
                                                    : "border-slate-200/80"
                                                }`}
                                              >
                                                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() =>
                                                      setSelectedInstIds((p) =>
                                                        p.includes(
                                                          inst.instructor_id
                                                        )
                                                          ? p.filter(
                                                              (x) =>
                                                                x !==
                                                                inst.instructor_id
                                                            )
                                                          : [
                                                              ...p,
                                                              inst.instructor_id,
                                                            ]
                                                      )
                                                    }
                                                    className="w-3.5 h-3.5 rounded accent-brand shrink-0"
                                                  />
                                                  <div className="relative w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-700 overflow-hidden shrink-0">
                                                    <span>
                                                      {(inst.name || "?").slice(
                                                        0,
                                                        1
                                                      )}
                                                    </span>
                                                    {avatar && (
                                                      <img
                                                        src={avatar}
                                                        alt=""
                                                        className="absolute inset-0 w-full h-full object-cover"
                                                      />
                                                    )}
                                                  </div>
                                                  <div className="min-w-0">
                                                    <div className="text-xs font-bold text-slate-800 truncate">
                                                      {inst.name}
                                                      {inst.instructor_id ===
                                                        instId && (
                                                        <span className="ml-1 text-[10px] text-brand font-extrabold">
                                                          (나)
                                                        </span>
                                                      )}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 truncate">
                                                      {inst.chat_position ||
                                                        inst.position ||
                                                        "구성원"}
                                                    </div>
                                                  </div>
                                                </label>

                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    startDirectWith(inst)
                                                  }
                                                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-brand hover:text-white text-[11px] font-bold text-slate-700 shrink-0 transition-colors"
                                                >
                                                  대화
                                                </button>
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

              {selectedInstIds.length > 0 && (
                <div className="absolute bottom-3 left-3 right-3">
                  <button
                    type="button"
                    onClick={handleStartSelectedChat}
                    className="w-full py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-lg transition-colors"
                  >
                    💬 선택한 {selectedInstIds.length}명과{" "}
                    {selectedInstIds.length > 1 ? "그룹 대화" : "1:1 대화"} 시작
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
