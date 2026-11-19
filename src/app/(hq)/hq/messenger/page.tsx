// src/app/hq/messenger/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { subscribePostgresChanges } from "@/lib/postgresRealtimeHub";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqMessengerLeftHub from "@/components/hq/messenger/HqMessengerLeftHub";
import HqOrgAccordionTree from "@/components/hq/messenger/HqOrgAccordionTree";
import { FALLBACK_TENANT_NAMES } from "@/lib/hq/constants";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";

const ROOM_PINS_STORAGE_KEY = "hq_chat_room_pins_v1";

export default function HqMessengerPage() {
  const {
    instId,
    me,
    members: hqMembers,
    companySettings,
    canAccessMenu,
    refreshChatUnread,
  } = useHqShell();
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
  const [leftHubOpen, setLeftHubOpen] = useState(true);
  const [pinnedByRoom, setPinnedByRoom] = useState<Record<string, string>>({});
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ROOM_PINS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setPinnedByRoom(parsed);
        }
      }
    } catch {
      // ignore storage error
    }
  }, []);

  const handleSaveRoomPin = (roomId: string, text: string) => {
    setPinnedByRoom((prev) => {
      const next = { ...prev };
      if (text) next[roomId] = text;
      else delete next[roomId];
      try {
        localStorage.setItem(ROOM_PINS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage error
      }
      return next;
    });
  };

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
      if (activeRoomIdRef.current) {
        const matchedActive = roomsWithData.find(
          (r) => String(r.room_id) === String(activeRoomIdRef.current)
        );
        if (matchedActive?.displayTitle) {
          setActiveRoomName(matchedActive.displayTitle);
        }
      }
      setUnreadCount(totalUnread);
      refreshChatUnread();
    } catch {
      // ignore
    }
  };

  const loadDirectoryInstructors = async () => {
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
      }
    } catch {
      // ignore
    }
  };

  const showNewChatView = async () => {
    setActiveView("new");
    setSearchKeyword("");
    setSelectedInstIds([]);
    await loadDirectoryInstructors();
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

    let handoffRoomId: string | null = null;
    let handoffRoomName = "";
    let handoffDraft = "";

    try {
      const rawHandoff = sessionStorage.getItem("hq_messenger_open_room");
      if (rawHandoff) {
        sessionStorage.removeItem("hq_messenger_open_room");
        const parsed = JSON.parse(rawHandoff);
        if (parsed?.roomId) {
          handoffRoomId = String(parsed.roomId);
          handoffRoomName = String(parsed.roomName || "");
          handoffDraft = String(parsed.draftText || "");
        }
      }
    } catch {
      // ignore storage error
    }

    if (!handoffRoomId && typeof window !== "undefined") {
      const qRoomId = new URLSearchParams(window.location.search).get("roomId");
      if (qRoomId) {
        handoffRoomId = qRoomId;
      }
    }

    loadDirectoryInstructors();
    loadRooms();

    if (handoffRoomId) {
      openRoom(handoffRoomId, handoffRoomName || "대화방");
      if (handoffDraft) {
        setChatInput(handoffDraft);
      }
    } else {
      setActiveView("new");
      setSearchKeyword("");
      setSelectedInstIds([]);
    }

    const onOpenRoomEvent = (evt: Event) => {
      const custom = evt as CustomEvent<{
        roomId?: string;
        roomName?: string;
        draftText?: string;
      }>;
      const rId = custom.detail?.roomId;
      if (!rId) return;
      try {
        sessionStorage.removeItem("hq_messenger_open_room");
      } catch {
        // ignore
      }
      openRoom(rId, custom.detail?.roomName || "대화방");
      if (custom.detail?.draftText) {
        setChatInput(custom.detail.draftText);
      }
    };
    window.addEventListener("hq:open-messenger-room", onOpenRoomEvent);

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
      window.removeEventListener("hq:open-messenger-room", onOpenRoomEvent);
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
    setMsgSearchOpen(false);
    setMsgSearchQuery("");
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
      if (rId) {
        setSelectedInstIds([]);
        openRoom(rId, `${targetName} ${targetPos || "님"}`);
      }
    } catch {
      alert("대화방 생성 중 오류가 발생했습니다.");
    }
  };

  const handleStartGroupChat = async () => {
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

  const activeRoomObj = rooms.find((r) => r.room_id === activeRoomId);
  const currentRoomPin = activeRoomId ? pinnedByRoom[activeRoomId] || "" : "";

  const displayedMessages = useMemo(() => {
    const q = msgSearchQuery.trim().toLowerCase();
    if (!msgSearchOpen || !q) return messages;
    return messages.filter((m) =>
      String(m.content || "")
        .toLowerCase()
        .includes(q)
    );
  }, [messages, msgSearchOpen, msgSearchQuery]);

  return (
    <div className="flex-1 flex min-h-0 h-full overflow-hidden">
      {/* 좌측 3단 컨텍스트 허브 (1순위: 상대 근무상태 / 3순위: 핀·공유링크 / 2순위: 전사공지·이슈) */}
      {leftHubOpen && (
        <HqMessengerLeftHub
          activeRoomId={activeRoomId}
          activeRoomName={activeRoomName}
          roomType={activeRoomObj?.internal_chat_room?.room_type}
          roomMembers={roomMembers}
          messages={messages}
          allInstructors={allInstructors}
          myInstId={instId}
          myMember={me}
          hqMembers={hqMembers}
          orgNodes={companySettings?.extra_settings?.org_chart_nodes}
          canAccessMenu={canAccessMenu}
          pinnedText={currentRoomPin}
          onSavePinnedText={(txt) => {
            if (activeRoomId) handleSaveRoomPin(activeRoomId, txt);
          }}
          msgSearchOpen={msgSearchOpen}
          msgSearchQuery={msgSearchQuery}
          msgMatchCount={displayedMessages.length}
          onToggleMsgSearch={() => {
            setMsgSearchOpen((v) => {
              if (v) setMsgSearchQuery("");
              return !v;
            });
          }}
          onChangeMsgSearch={setMsgSearchQuery}
          onQuickStartDirect={startDirectWith}
        />
      )}

      {/* 중앙: 대화방 메인 영역 */}
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
              <button
                type="button"
                onClick={() => setLeftHubOpen((v) => !v)}
                className="hidden lg:inline-flex px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-bold text-slate-600 shrink-0 transition-colors"
                title={leftHubOpen ? "좌측 허브 패널 접기" : "좌측 허브 패널 펼치기"}
              >
                {leftHubOpen ? "◧ 허브 접기" : "◨ 허브 열기"}
              </button>
              <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-full flex justify-center items-center text-slate-500 font-bold shrink-0 overflow-hidden relative">
                <span className="absolute z-0">💬</span>
                {activeRoomObj?.displayAvatar && (
                  <img
                    src={activeRoomObj.displayAvatar}
                    className="absolute w-full h-full object-cover z-10"
                    alt="profile"
                  />
                )}
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="font-bold text-slate-800 text-[15px] truncate">
                  {activeRoomName}
                </span>
                {roomMembers.length > 0 && (
                  <span className="text-[11px] text-slate-400 font-semibold">
                    참여 {roomMembers.length}명
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setMsgSearchOpen((v) => {
                    if (v) setMsgSearchQuery("");
                    return !v;
                  })
                }
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors shrink-0 ${
                  msgSearchOpen
                    ? "bg-brand text-white border-brand"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600"
                }`}
              >
                🔍 검색
              </button>
            </div>

            {currentRoomPin && (
              <div className="bg-amber-50/95 border-b border-amber-200/80 px-5 py-2 flex items-center justify-between gap-3 text-xs shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-extrabold text-amber-800 shrink-0">
                    📌 공지
                  </span>
                  <span className="text-slate-700 font-semibold truncate">
                    {currentRoomPin}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSaveRoomPin(activeRoomId, "")}
                  className="text-[11px] font-bold text-amber-700/80 hover:text-rose-600 shrink-0"
                  title="고정 해제"
                >
                  해제
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3 custom-scroll">
              {displayedMessages.length === 0 ? (
                <div className="text-center text-slate-400 font-bold text-sm mt-20">
                  {msgSearchOpen && msgSearchQuery.trim()
                    ? `'${msgSearchQuery}' 검색 결과가 없습니다.`
                    : "대화를 시작해보세요."}
                </div>
              ) : (
                displayedMessages.map((msg) => {
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
                      className={`group/msg flex w-full mb-1 ${
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
                        className={`flex flex-col max-w-[78%] ${
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
                            <button
                              type="button"
                              onClick={() =>
                                handleSaveRoomPin(
                                  activeRoomId,
                                  String(msg.content || "").trim()
                                )
                              }
                              title="이 메시지를 대화방 공지로 고정"
                              className="opacity-0 group-hover/msg:opacity-100 text-[11px] text-slate-400 hover:text-amber-600 mb-0.5 transition-opacity"
                            >
                              📌
                            </button>
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
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center relative">
            {!leftHubOpen && (
              <button
                type="button"
                onClick={() => setLeftHubOpen(true)}
                className="hidden lg:inline-flex absolute left-4 top-4 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 shadow-2xs"
              >
                ◨ 소통 허브 열기
              </button>
            )}
            <div className="max-w-sm bg-white/90 backdrop-blur-xs rounded-3xl border border-slate-200/80 p-8 shadow-xs">
              <div className="w-14 h-14 mx-auto bg-blue-50 text-brand rounded-2xl border border-blue-100 flex items-center justify-center mb-3.5 text-2xl">
                💬
              </div>
              <p className="font-extrabold text-sm text-slate-800">
                전사 소통 메신저 워크스페이스
              </p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed break-keep">
                좌측에서 본부 근무 현황과 최근 공지를 확인하고, 우측 다단계 조직도에서 상대를 선택해 1:1 또는 그룹 대화를 시작하세요.
              </p>
              {rooms.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveView("list")}
                  className="mt-4 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition-colors"
                >
                  진행 중인 대화방 보기 ({rooms.length})
                </button>
              )}
            </div>
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

            <div className="flex-1 overflow-y-auto custom-scroll p-3.5 pb-20">
              <HqOrgAccordionTree
                variant="page"
                instructors={allInstructors}
                hqMembers={hqMembers}
                orgNodes={companySettings?.extra_settings?.org_chart_nodes}
                myInstId={instId}
                myMember={me}
                searchKeyword={searchKeyword}
                selectedInstIds={selectedInstIds}
                onToggleSelect={toggleInstSelection}
              />
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
