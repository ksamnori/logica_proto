// src/components/hq/mobile/HqMobileMessengerTab.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqOrgAccordionTree from "@/components/hq/messenger/HqOrgAccordionTree";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import {
  type DirectoryInstructorRow,
  fetchHqMessengerDirectory,
} from "@/lib/hq/messengerDirectoryClient";
import { subscribePostgresChanges } from "@/lib/postgresRealtimeHub";
import { supabase } from "@/lib/supabase";

interface Props {
  onChatRoomOpenChange?: (isOpen: boolean) => void;
}

interface ChatMessageItem {
  message_id: string;
  room_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

interface ChatRoomMeta {
  title?: string;
  room_type?: string;
  created_at?: string;
}

interface ChatRoomItem {
  room_id: string;
  last_read_at?: string | null;
  internal_chat_room?: ChatRoomMeta | null;
  displayTitle: string;
  displayAvatar: string | null;
  unreadCount: number;
  latestMsg: ChatMessageItem | null;
}

interface ChatSenderInfo {
  name?: string;
  position?: string;
  chat_position?: string;
  profile_image_url?: string | null;
}

interface ChatRoomMemberItem {
  instructor_id: string;
  last_read_at?: string | null;
  instructor?: ChatSenderInfo | ChatSenderInfo[] | null;
}

type DirectoryInstructorItem = DirectoryInstructorRow;

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

export default function HqMobileMessengerTab({ onChatRoomOpenChange }: Props) {
  const {
    instId,
    me,
    members: hqMembers,
    companySettings,
    refreshChatUnread,
  } = useHqShell();

  const instName = me?.name || "본부 구성원";

  const [tab, setTab] = useState<"list" | "new">("list");
  const [rooms, setRooms] = useState<ChatRoomItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomName, setActiveRoomName] = useState("");
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [roomMembers, setRoomMembers] = useState<ChatRoomMemberItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [typingStaffName, setTypingStaffName] = useState<string | null>(null);

  const [allInstructors, setAllInstructors] = useState<
    DirectoryInstructorItem[]
  >([]);
  const [viewerIsItStrategy, setViewerIsItStrategy] = useState<
    boolean | undefined
  >(undefined);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);

  const activeRoomIdRef = useRef<string | null>(null);
  const activeChannelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitTabRef = useRef(false);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
    onChatRoomOpenChange?.(Boolean(activeRoomId));
  }, [activeRoomId, onChatRoomOpenChange]);

  useEffect(() => {
    return () => {
      onChatRoomOpenChange?.(false);
      if (activeChannelRef.current) {
        supabase.removeChannel(activeChannelRef.current);
        activeChannelRef.current = null;
      }
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, [onChatRoomOpenChange]);

  useEffect(() => {
    if (!activeRoomId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingStaffName, activeRoomId]);

  const fetchRooms = useCallback(async () => {
    if (!instId) return;
    try {
      const { data } = await supabase
        .from("internal_chat_member")
        .select(
          "room_id, internal_chat_room(title, room_type, created_at), last_read_at"
        )
        .eq("instructor_id", instId)
        .eq("is_active", true);

      const rawList = (data || []) as Array<{
        room_id: string;
        last_read_at?: string | null;
        internal_chat_room?: ChatRoomMeta | ChatRoomMeta[] | null;
      }>;

      const roomsWithData: ChatRoomItem[] = await Promise.all(
        rawList.map(async (r) => {
          const roomMeta = Array.isArray(r.internal_chat_room)
            ? r.internal_chat_room[0]
            : r.internal_chat_room;

          const { data: msgsData } = await supabase
            .from("internal_chat_message")
            .select("message_id, room_id, content, created_at, sender_id")
            .eq("room_id", r.room_id)
            .order("created_at", { ascending: false })
            .limit(40);

          const msgs = (msgsData || []) as ChatMessageItem[];
          let displayTitle = roomMeta?.title || "대화방";
          let displayAvatar: string | null = null;

          if (roomMeta?.room_type === "DIRECT") {
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
            String(r.room_id) === String(activeRoomIdRef.current);
          const unread = msgs.filter(
            (m) =>
              m.sender_id !== instId &&
              new Date(m.created_at) >
                new Date(r.last_read_at || "1970-01-01T00:00:00Z")
          ).length;

          return {
            room_id: String(r.room_id),
            last_read_at: r.last_read_at,
            internal_chat_room: roomMeta || null,
            displayTitle,
            displayAvatar,
            unreadCount: isRoomActive ? 0 : unread,
            latestMsg: msgs.length > 0 ? msgs[0] : null,
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
      if (!didInitTabRef.current) {
        didInitTabRef.current = true;
        setTab(roomsWithData.length > 0 ? "list" : "new");
      }
      void refreshChatUnread();
    } catch {
      // ignore
    } finally {
      setLoadingRooms(false);
    }
  }, [instId, refreshChatUnread]);

  const fetchDirectory = useCallback(async () => {
    if (!instId) return;
    try {
      const res = await fetchHqMessengerDirectory({
        myInstId: instId,
        myMember: me,
      });
      setAllInstructors(res.instructors);
      setViewerIsItStrategy(res.callerIsItStrategy);
    } catch {
      // ignore
    }
  }, [instId, me]);

  useEffect(() => {
    if (!instId) return;
    const initTimer = window.setTimeout(() => {
      void fetchRooms();
      void fetchDirectory();
    }, 0);

    const unsubMsg = subscribePostgresChanges(
      { table: "internal_chat_message", events: ["INSERT"] },
      async (payload) => {
        const incoming = payload.new as ChatMessageItem | undefined;
        if (!incoming) return;
        setTypingStaffName(null);
        const isCurrentOpenRoom =
          String(activeRoomIdRef.current) === String(incoming.room_id);

        if (isCurrentOpenRoom) {
          setMessages((prev) =>
            prev.find((m) => m.message_id === incoming.message_id)
              ? prev
              : [...prev, incoming]
          );
          if (incoming.sender_id !== instId) {
            await supabase
              .from("internal_chat_member")
              .update({ last_read_at: new Date().toISOString() })
              .eq("room_id", incoming.room_id)
              .eq("instructor_id", instId);
          }
        }

        await supabase
          .from("internal_chat_member")
          .update({ is_active: true })
          .eq("room_id", incoming.room_id)
          .eq("instructor_id", instId);

        void fetchRooms();
      }
    );

    const unsubMember = subscribePostgresChanges(
      { table: "internal_chat_member", events: ["INSERT", "UPDATE"] },
      (payload) => {
        const updated = payload.new as
          | { room_id?: string; instructor_id?: string; last_read_at?: string }
          | undefined;
        if (payload.eventType === "UPDATE" && updated) {
          if (String(activeRoomIdRef.current) === String(updated.room_id)) {
            setRoomMembers((prev) =>
              prev.map((m) =>
                m.instructor_id === updated.instructor_id
                  ? { ...m, last_read_at: updated.last_read_at }
                  : m
              )
            );
          }
        }
        void fetchRooms();
      }
    );

    return () => {
      window.clearTimeout(initTimer);
      unsubMsg();
      unsubMember();
    };
  }, [fetchDirectory, fetchRooms, instId]);

  const openRoom = async (roomId: string, roomName: string) => {
    setActiveRoomId(roomId);
    setActiveRoomName(roomName);
    setMessages([]);
    setRooms((prev) =>
      prev.map((r) => (r.room_id === roomId ? { ...r, unreadCount: 0 } : r))
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
      .on(
        "broadcast",
        { event: "typing" },
        (payload: {
          payload?: { sender_id?: string; sender_name?: string };
        }) => {
          if (payload.payload?.sender_id !== instId) {
            setTypingStaffName(payload.payload?.sender_name || "상대방");
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(
              () => setTypingStaffName(null),
              3000
            );
          }
        }
      )
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
      setMessages((msgRes.data || []) as ChatMessageItem[]);
      setRoomMembers((memRes.data || []) as ChatRoomMemberItem[]);
      void refreshChatUnread();
      void fetchRooms();
    } catch {
      // ignore
    }
  };

  const closeRoom = () => {
    setActiveRoomId(null);
    setActiveRoomName("");
    setTypingStaffName(null);
    if (activeChannelRef.current) {
      supabase.removeChannel(activeChannelRef.current);
      activeChannelRef.current = null;
    }
    void fetchRooms();
  };

  const startDirectWith = async (target: DirectoryInstructorItem) => {
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
        const myRoomIds =
          (myRooms as Array<{ room_id: string }> | null)?.map(
            (r) => r.room_id
          ) || [];
        if (myRoomIds.length > 0) {
          const { data: selfRoom } = await supabase
            .from("internal_chat_room")
            .select("room_id")
            .in("room_id", myRoomIds)
            .ilike("title", "%(나)%")
            .limit(1)
            .maybeSingle();
          if (selfRoom) {
            await openRoom(String(selfRoom.room_id), `${targetName} (나)`);
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
          await openRoom(String(newRoom.room_id), titleWithPos);
        }
        return;
      }

      const { data: targetRooms } = await supabase
        .from("internal_chat_member")
        .select("room_id")
        .eq("instructor_id", targetInstId);

      let rId: string | null = null;
      const targetRoomIds =
        (targetRooms as Array<{ room_id: string }> | null)?.map(
          (r) => r.room_id
        ) || [];

      if (targetRoomIds.length > 0) {
        const { data: commonMembers } = await supabase
          .from("internal_chat_member")
          .select("room_id, internal_chat_room!inner(room_type)")
          .eq("instructor_id", instId)
          .in("room_id", targetRoomIds)
          .eq("internal_chat_room.room_type", "DIRECT");
        if (commonMembers && commonMembers.length > 0) {
          rId = String(commonMembers[0].room_id);
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
          rId = String(newRoom.room_id);
          await supabase.from("internal_chat_member").insert([
            { room_id: rId, instructor_id: instId },
            { room_id: rId, instructor_id: targetInstId },
          ]);
        }
      }

      if (rId) {
        setSelectedInstIds([]);
        await openRoom(rId, `${targetName} ${targetPos || "님"}`);
      }
    } catch {
      alert("대화방 생성 중 오류가 발생했습니다.");
    }
  };

  const handleStartSelectedChat = async () => {
    if (selectedInstIds.length === 0) return;
    if (selectedInstIds.length === 1) {
      const target = allInstructors.find(
        (i) => i.instructor_id === selectedInstIds[0]
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
      await openRoom(String(newRoom.room_id), roomName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "오류 발생";
      alert("그룹방 생성 오류: " + msg);
    }
  };

  const handleInputChange = (val: string) => {
    setChatInput(val);
    if (activeChannelRef.current && activeRoomId) {
      activeChannelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { sender_id: instId, sender_name: instName },
      });
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
        const typedMsg = newMsg as ChatMessageItem;
        setMessages((prev) =>
          prev.find((m) => m.message_id === typedMsg.message_id)
            ? prev
            : [...prev, typedMsg]
        );
        await supabase
          .from("internal_chat_member")
          .update({ last_read_at: new Date().toISOString() })
          .eq("room_id", activeRoomId)
          .eq("instructor_id", instId);
      }
    } catch {
      alert("메시지 전송에 실패했습니다.");
    }
  };

  if (activeRoomId) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#dbeafe]/35">
        <div className="h-13 bg-white border-b border-slate-200 px-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={closeRoom}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-700 font-extrabold text-base flex items-center justify-center shrink-0"
            >
              ←
            </button>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-slate-900 truncate">
                {activeRoomName}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold">
                참여자 {roomMembers.length}명
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
          {messages.length === 0 ? (
            <div className="py-16 text-center text-xs font-bold text-slate-400">
              첫 메시지를 보내 대화를 시작해 보세요 💬
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMe = String(msg.sender_id) === String(instId);
              const prev = idx > 0 ? messages[idx - 1] : null;
              const showDateDivider =
                !prev ||
                String(prev.created_at || "").slice(0, 10) !==
                  String(msg.created_at || "").slice(0, 10);

              const senderObj = roomMembers.find(
                (rm) => String(rm.instructor_id) === String(msg.sender_id)
              );
              const senderInst = Array.isArray(senderObj?.instructor)
                ? senderObj?.instructor[0]
                : senderObj?.instructor;
              const senderName = senderInst?.name || "구성원";
              const senderPos =
                senderInst?.chat_position || senderInst?.position || "";
              const senderAvatar = resolveStoragePublicUrl(
                senderInst?.profile_image_url
              );

              const msgTimeMs = new Date(msg.created_at).getTime();
              const unreadCount = roomMembers.filter(
                (rm) =>
                  String(rm.instructor_id) !== String(msg.sender_id) &&
                  new Date(
                    rm.last_read_at || "1970-01-01T00:00:00Z"
                  ).getTime() < msgTimeMs
              ).length;

              return (
                <React.Fragment key={msg.message_id || idx}>
                  {showDateDivider && msg.created_at && (
                    <div className="flex justify-center my-2">
                      <span className="px-3 py-0.5 rounded-full bg-slate-900/10 text-[10px] font-bold text-slate-600">
                        {formatDateDivider(msg.created_at)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex items-end gap-1.5 ${
                      isMe ? "justify-end" : "justify-start"
                    }`}
                  >
                    {!isMe && (
                      <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-xs font-bold text-slate-600 overflow-hidden shrink-0 self-start mt-0.5">
                        {senderAvatar ? (
                          <img
                            src={senderAvatar}
                            alt={senderName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{senderName.slice(0, 1)}</span>
                        )}
                      </div>
                    )}

                    {isMe && (
                      <div className="text-right text-[10px] leading-tight shrink-0">
                        {unreadCount > 0 && (
                          <div className="font-extrabold text-amber-600">
                            {unreadCount}
                          </div>
                        )}
                        <div className="text-slate-400">
                          {formatShortTime(msg.created_at)}
                        </div>
                      </div>
                    )}

                    <div
                      className={`max-w-[74%] space-y-1 ${
                        isMe ? "items-end" : "items-start"
                      }`}
                    >
                      {!isMe && (
                        <div className="text-[11px] font-bold text-slate-600 pl-0.5">
                          {senderName}{" "}
                          <span className="text-slate-400 font-medium">
                            {senderPos}
                          </span>
                        </div>
                      )}
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words shadow-xs ${
                          isMe
                            ? "bg-[#fee500] text-[#191919] font-semibold rounded-br-sm"
                            : "bg-white text-slate-800 border border-slate-200/80 font-medium rounded-bl-sm"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>

                    {!isMe && (
                      <div className="text-left text-[10px] leading-tight shrink-0">
                        {unreadCount > 0 && (
                          <div className="font-extrabold text-amber-600">
                            {unreadCount}
                          </div>
                        )}
                        <div className="text-slate-400">
                          {formatShortTime(msg.created_at)}
                        </div>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })
          )}

          {typingStaffName && (
            <div className="text-[11px] font-bold text-slate-500 pl-2 animate-pulse">
              ✍️ {typingStaffName}님이 입력 중...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="bg-white border-t border-slate-200 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] flex items-end gap-2 shrink-0">
          <textarea
            rows={1}
            value={chatInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void sendMsg();
              }
            }}
            placeholder="메시지를 입력하세요..."
            className="flex-1 max-h-24 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none resize-none"
          />
          <button
            type="button"
            disabled={!chatInput.trim()}
            onClick={() => void sendMsg()}
            className="px-4 py-2.5 rounded-2xl bg-[#fee500] disabled:bg-slate-200 text-[#191919] disabled:text-slate-400 text-xs font-extrabold shrink-0 transition-colors"
          >
            전송
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 shrink-0">
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab("list")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              tab === "list"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            💬 내 대화방 ({rooms.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              tab === "new"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            🏢 조직도 · 새 대화
          </button>
        </div>
      </div>

      {tab === "list" ? (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
          {loadingRooms ? (
            <div className="py-16 text-center text-xs font-bold text-slate-400">
              대화방을 불러오는 중입니다...
            </div>
          ) : rooms.length === 0 ? (
            <div className="p-10 text-center space-y-2.5">
              <div className="text-2xl">💬</div>
              <p className="text-xs font-bold text-slate-500">
                진행 중인 대화가 없습니다.
              </p>
              <button
                type="button"
                onClick={() => setTab("new")}
                className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-extrabold"
              >
                조직도에서 동료 선택하기
              </button>
            </div>
          ) : (
            rooms.map((r) => (
              <button
                key={r.room_id}
                type="button"
                onClick={() => void openRoom(r.room_id, r.displayTitle)}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-slate-50 transition-colors"
              >
                <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-extrabold text-slate-600 overflow-hidden shrink-0">
                  {r.displayAvatar ? (
                    <img
                      src={r.displayAvatar}
                      alt={r.displayTitle}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>
                      {r.internal_chat_room?.room_type === "GROUP"
                        ? "👥"
                        : r.displayTitle?.slice(0, 1) || "H"}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-900 truncate">
                      {r.displayTitle}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatShortTime(
                        r.latestMsg?.created_at ||
                          r.internal_chat_room?.created_at
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-xs text-slate-500 truncate">
                      {r.latestMsg?.content || "대화 내용이 없습니다."}
                    </p>
                    {r.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
                        {r.unreadCount > 99 ? "99+" : r.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
          <div className="p-3 border-b border-slate-100 shrink-0">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="본부 부서 · 전국 가맹점 이름 검색..."
              className="w-full rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 outline-none"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <HqOrgAccordionTree
              variant="drawer"
              instructors={allInstructors}
              hqMembers={hqMembers}
              orgNodes={companySettings?.extra_settings?.org_chart_nodes}
              myInstId={instId}
              myMember={me}
              viewerIsItStrategy={viewerIsItStrategy}
              searchKeyword={searchKeyword}
              selectedInstIds={selectedInstIds}
              onToggleSelect={(id) =>
                setSelectedInstIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              onDirectChat={(inst) =>
                void startDirectWith(inst as DirectoryInstructorItem)
              }
              preferredTenantName="본사"
              expandAllMyTenantBranches
            />
          </div>

          {selectedInstIds.length > 0 && (
            <div className="border-t border-slate-200 p-3 bg-white shrink-0">
              <button
                type="button"
                onClick={() => void handleStartSelectedChat()}
                className="w-full py-3 rounded-xl bg-brand text-white text-xs font-extrabold shadow-sm"
              >
                {selectedInstIds.length === 1
                  ? "선택한 구성원과 1:1 대화 시작"
                  : `선택한 ${selectedInstIds.length}명과 그룹 채팅 시작`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
