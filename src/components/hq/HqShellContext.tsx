// src/components/hq/HqShellContext.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { subscribePostgresChanges } from "@/lib/postgresRealtimeHub";
import {
  fetchContestAccess,
  hasSupabaseSession,
} from "@/app/(dashboard)/contest-db/useContestDb";
import type { ContestAccessLevel } from "@/app/(dashboard)/contest-db/contestUtils";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqAttendanceRecord,
  HqMember,
  HqWorkMode,
} from "@/lib/hq/types";

interface HqShellState {
  instId: string;
  me: HqMember | null;
  members: HqMember[];
  isHrManager: boolean;
  isHqAdmin: boolean;
  canAccessAnalytics: boolean;
  contestAccess: ContestAccessLevel;
  pendingApprovalCount: number;
  unsignedContractCount: number;
  unreadChatCount: number;
  myTodayAttendance: HqAttendanceRecord | null;
  myWeeklyMinutes: number;
  schemaMissing: boolean;
  sessionExpired: boolean;
  isBooting: boolean;
  refreshMembers: () => Promise<void>;
  refreshApprovalBadge: () => Promise<void>;
  refreshAttendanceState: () => Promise<void>;
  refreshContractBadge: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  refreshChatUnread: () => Promise<void>;
  quickCheckIn: (workMode?: HqWorkMode, locationNote?: string) => Promise<void>;
  quickCheckOut: () => Promise<void>;
  openProfileModal: () => void;
  logout: () => Promise<void>;
}

const HqShellContext = createContext<HqShellState | null>(null);

export function useHqShell(): HqShellState {
  const ctx = useContext(HqShellContext);
  if (!ctx) {
    throw new Error("useHqShell must be used inside HqShellProvider");
  }
  return ctx;
}

export function HqShellProvider({
  children,
  onOpenProfile,
}: {
  children: React.ReactNode;
  onOpenProfile: () => void;
}) {
  const router = useRouter();

  const [instId, setInstId] = useState("");
  const [me, setMe] = useState<HqMember | null>(null);
  const [members, setMembers] = useState<HqMember[]>([]);
  const [isHrManager, setIsHrManager] = useState(false);
  const [isHqAdmin, setIsHqAdmin] = useState(false);
  const [canAccessAnalytics, setCanAccessAnalytics] = useState(false);
  const [contestAccess, setContestAccess] = useState<ContestAccessLevel>(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [unsignedContractCount, setUnsignedContractCount] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [myTodayAttendance, setMyTodayAttendance] =
    useState<HqAttendanceRecord | null>(null);
  const [myWeeklyMinutes, setMyWeeklyMinutes] = useState(0);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isBooting, setIsBooting] = useState(true);

  const logout = useCallback(async () => {
    document.cookie =
      "sb-access-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie =
      "logica_tenant_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    localStorage.clear();
    sessionStorage.clear();
    await supabase.auth.signOut().catch(() => {});
    router.replace("/hq/login");
  }, [router]);

  const refreshMembers = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        schemaMissing: boolean;
        extSchemaMissing?: boolean;
        data: {
          meId: string;
          isHrManager: boolean;
          isHqAdmin: boolean;
          members: HqMember[];
        };
      }>("/api/hq/members");

      setSchemaMissing(Boolean(res.schemaMissing || res.extSchemaMissing));
      setIsHrManager(Boolean(res.data.isHrManager));
      setIsHqAdmin(Boolean(res.data.isHqAdmin));
      setMembers(res.data.members || []);

      const myRow =
        (res.data.members || []).find((m) => m.instructor_id === res.data.meId) ||
        null;
      setMe(myRow);
      if (myRow) {
        localStorage.setItem("logica_instructor_name", myRow.name);
        localStorage.setItem("logica_instructor_position", myRow.job_title);
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (/403|본부\(HQ\) 소속/.test(msg)) {
        alert("🏢 본부(HQ) 임직원 전용 워크스페이스입니다.");
        router.replace("/home");
      } else if (/401|만료|로그인/.test(msg)) {
        setSessionExpired(true);
      }
    }
  }, [router]);

  const refreshApprovalBadge = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        schemaMissing: boolean;
        data: { myPendingCount: number };
      }>("/api/hq/approvals");
      if (res.schemaMissing) setSchemaMissing(true);
      setPendingApprovalCount(Number(res.data?.myPendingCount || 0));
    } catch {
      // ignore badge fetch errors when offline/unauth
    }
  }, []);

  const refreshAttendanceState = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        schemaMissing: boolean;
        data: {
          myToday: HqAttendanceRecord | null;
          myWeeklyMinutes: number;
        };
      }>("/api/hq/attendance");
      if (res.schemaMissing) setSchemaMissing(true);
      setMyTodayAttendance(res.data?.myToday || null);
      setMyWeeklyMinutes(Number(res.data?.myWeeklyMinutes || 0));
    } catch {
      // ignore
    }
  }, []);

  const refreshContractBadge = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        schemaMissing: boolean;
        data: { myUnsignedCount: number };
      }>("/api/hq/contracts");
      if (res.schemaMissing) setSchemaMissing(true);
      setUnsignedContractCount(Number(res.data?.myUnsignedCount || 0));
    } catch {
      // ignore
    }
  }, []);

  const quickCheckIn = useCallback(
    async (workMode: HqWorkMode = "OFFICE", locationNote?: string) => {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHECK_IN",
          work_mode: workMode,
          location_note: locationNote,
        },
      });
      await refreshAttendanceState();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("hq:attendance-updated"));
      }
    },
    [refreshAttendanceState]
  );

  const quickCheckOut = useCallback(async () => {
    await hqFetch("/api/hq/attendance", {
      method: "POST",
      body: { action: "CHECK_OUT" },
    });
    await refreshAttendanceState();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hq:attendance-updated"));
    }
  }, [refreshAttendanceState]);

  const refreshPermissions = useCallback(async () => {
    if (!(await hasSupabaseSession())) {
      setContestAccess(null);
      setCanAccessAnalytics(false);
      setSessionExpired(true);
      return;
    }
    setSessionExpired(false);
    fetchContestAccess().then(setContestAccess);
    supabase
      .rpc("has_hq_permission", { p_permission: "admission_analytics" })
      .then(({ data }) => setCanAccessAnalytics(data === true));
    supabase
      .rpc("is_hq_admin")
      .then(({ data }) => {
        if (data === true) setIsHqAdmin(true);
      });
  }, []);

  const refreshChatUnread = useCallback(async () => {
    const uid = instId || localStorage.getItem("logica_instructor_id") || "";
    if (!uid) return;
    try {
      const { data: myRooms } = await supabase
        .from("internal_chat_member")
        .select("room_id, last_read_at")
        .eq("instructor_id", uid)
        .eq("is_active", true);

      if (!myRooms || myRooms.length === 0) {
        setUnreadChatCount(0);
        return;
      }

      const roomIds = myRooms.map((r: any) => r.room_id);
      const { data: msgs } = await supabase
        .from("internal_chat_message")
        .select("room_id, sender_id, created_at")
        .in("room_id", roomIds)
        .neq("sender_id", uid)
        .order("created_at", { ascending: false })
        .limit(300);

      const readMap = new Map<string, number>();
      myRooms.forEach((r: any) => {
        readMap.set(
          String(r.room_id),
          new Date(r.last_read_at || "1970-01-01T00:00:00Z").getTime()
        );
      });

      let unread = 0;
      (msgs || []).forEach((m: any) => {
        const lastRead = readMap.get(String(m.room_id)) || 0;
        if (new Date(m.created_at).getTime() > lastRead) unread++;
      });
      setUnreadChatCount(unread);
    } catch {
      // ignore
    }
  }, [instId]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      let uid =
        session?.user?.id || localStorage.getItem("logica_instructor_id") || "";
      if (!uid) {
        router.replace("/hq/login");
        return;
      }

      if (session?.access_token) {
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=86400;`;
        localStorage.setItem("logica_instructor_id", session.user.id);
        uid = session.user.id;
      }

      if (!mounted) return;
      setInstId(uid);

      await Promise.all([
        refreshMembers(),
        refreshApprovalBadge(),
        refreshAttendanceState(),
        refreshContractBadge(),
        refreshPermissions(),
      ]);

      if (mounted) setIsBooting(false);
    };

    boot();
    return () => {
      mounted = false;
    };
  }, [
    router,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
    refreshContractBadge,
    refreshPermissions,
  ]);

  useEffect(() => {
    if (!instId) return;
    refreshChatUnread();

    const unsubMsg = subscribePostgresChanges(
      { table: "internal_chat_message", events: ["INSERT"] },
      () => {
        refreshChatUnread();
      }
    );

    const onApprovalChange = () => {
      refreshApprovalBadge();
      refreshMembers();
      refreshAttendanceState();
    };
    const onAttendanceChange = () => {
      refreshAttendanceState();
    };
    const onContractChange = () => {
      refreshContractBadge();
      refreshMembers();
    };

    window.addEventListener("hq:approval-updated", onApprovalChange);
    window.addEventListener("hq:attendance-updated", onAttendanceChange);
    window.addEventListener("hq:contract-updated", onContractChange);

    return () => {
      unsubMsg();
      window.removeEventListener("hq:approval-updated", onApprovalChange);
      window.removeEventListener("hq:attendance-updated", onAttendanceChange);
      window.removeEventListener("hq:contract-updated", onContractChange);
    };
  }, [
    instId,
    refreshChatUnread,
    refreshApprovalBadge,
    refreshMembers,
    refreshAttendanceState,
    refreshContractBadge,
  ]);

  return (
    <HqShellContext.Provider
      value={{
        instId,
        me,
        members,
        isHrManager,
        isHqAdmin,
        canAccessAnalytics,
        contestAccess,
        pendingApprovalCount,
        unsignedContractCount,
        unreadChatCount,
        myTodayAttendance,
        myWeeklyMinutes,
        schemaMissing,
        sessionExpired,
        isBooting,
        refreshMembers,
        refreshApprovalBadge,
        refreshAttendanceState,
        refreshContractBadge,
        refreshPermissions,
        refreshChatUnread,
        quickCheckIn,
        quickCheckOut,
        openProfileModal: onOpenProfile,
        logout,
      }}
    >
      {children}
    </HqShellContext.Provider>
  );
}
