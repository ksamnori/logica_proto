// src/components/TopHeader.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import QuickMemo from "@/components/QuickMemo";

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

interface BoardPreviewItem {
  id: string;
  stage: "todo" | "in_progress";
  stageLabel: string;
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  time: Date;
  link: string;
  isUrgentOrAssigned?: boolean;
  isRead?: boolean;
}

function DigitalClock() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!time) return <div className="w-[120px] h-[48px] shrink-0 mr-4"></div>;
  return (
    <div className="shrink-0 mr-5 font-mono text-xl md:text-2xl font-bold text-slate-800 bg-slate-100/80 px-4 py-1.5 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center tracking-widest">
      {time.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </div>
  );
}

interface TopHeaderProps {
  instId: string;
  instructorName: string;
  profileImgUrl: string;
  isSuperAdmin?: boolean;
  onOpenProfile?: () => void;
  onLogout: () => void;
}

export default function TopHeader({
  instId,
  instructorName,
  profileImgUrl,
  isSuperAdmin,
  onOpenProfile,
  onLogout,
}: TopHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);

  // 소통 및 업무관리 3종 (To-Do + In Progress) 칸반 개수 및 미리보기 상태
  const [taskTodoCount, setTaskTodoCount] = useState(0);
  const [taskInProgressCount, setTaskInProgressCount] = useState(0);
  const [urgentTaskActiveCount, setUrgentTaskActiveCount] = useState(0);
  const [taskTodoItems, setTaskTodoItems] = useState<BoardPreviewItem[]>([]);
  const [taskInProgressItems, setTaskInProgressItems] = useState<BoardPreviewItem[]>([]);

  const [supplyTodoCount, setSupplyTodoCount] = useState(0);
  const [supplyInProgressCount, setSupplyInProgressCount] = useState(0);
  const [supplyTodoItems, setSupplyTodoItems] = useState<BoardPreviewItem[]>([]);
  const [supplyInProgressItems, setSupplyInProgressItems] = useState<BoardPreviewItem[]>([]);

  const [csTodoCount, setCsTodoCount] = useState(0);
  const [csInProgressCount, setCsInProgressCount] = useState(0);
  const [assignedCsActiveCount, setAssignedCsActiveCount] = useState(0);
  const [csTodoItems, setCsTodoItems] = useState<BoardPreviewItem[]>([]);
  const [csInProgressItems, setCsInProgressItems] = useState<BoardPreviewItem[]>([]);

  const [openMenuKey, setOpenMenuKey] = useState<"task" | "supply" | "cs" | null>(null);
  const [activePopoverTab, setActivePopoverTab] = useState<
    Record<"task" | "supply" | "cs", "todo" | "in_progress">
  >({
    task: "todo",
    supply: "todo",
    cs: "todo",
  });

  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentUid, setCurrentUid] = useState(instId);
  useEffect(() => {
    if (instId && instId !== currentUid) setCurrentUid(instId);
  }, [instId]);

  const [currentName, setCurrentName] = useState(instructorName);
  const [currentProfileImg, setCurrentProfileImg] = useState(profileImgUrl);
  const [imgError, setImgError] = useState(false);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [isGuest, setIsGuest] = useState(false);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    if (role === "GUEST" || pos.includes("테스트") || pos.includes("체험")) {
      setIsGuest(true);
    }
  }, []);

  useEffect(() => {
    if (profileImgUrl && profileImgUrl !== "null" && profileImgUrl !== "undefined") {
      setCurrentProfileImg(profileImgUrl);
      setImgError(false);
    }
  }, [profileImgUrl]);

  useEffect(() => {
    if (instructorName) setCurrentName(instructorName);
  }, [instructorName]);

  useEffect(() => {
    setImgError(false);
    setOpenMenuKey(null);
  }, [pathname]);

  useEffect(() => {
    let isMounted = true;
    const verifyAndFetchUserInfo = async () => {
      const {
        data: { session },
        error: authError,
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (authError || !user) return;

      if (isMounted) setCurrentUid(user.id);

      const { data: instructorData, error: dbError } = await supabase
        .from("instructor")
        .select("*")
        .eq("instructor_id", user.id)
        .single();

      if (dbError || !instructorData || !isMounted) return;

      if (instructorData.name) {
        setCurrentName((prev) => (prev !== instructorData.name ? instructorData.name : prev));
      }

      const dbImg = instructorData.profile_image_url || instructorData.profile_image;
      if (dbImg && dbImg !== "null" && dbImg !== "undefined") {
        setCurrentProfileImg((prevImg) => {
          if (prevImg !== dbImg) {
            setImgError(false);
            return dbImg;
          }
          return prevImg;
        });
      }
    };

    verifyAndFetchUserInfo();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * 🌟 소통 및 업무관리 3종 보드(/task, /supply, /cs)의 미완료(To-Do + In Progress) 통합 로드
   * - 아이콘 배지에는 (To-Do + In Progress) 미완료 합산 개수를 1개의 숫자로 깔끔하게 표시합니다.
   * - 마우스 호버 시 열리는 팝오버 상단 탭에서 `To-Do (N)` / `In Progress (M)`를 분리해 보여줍니다.
   * - 긴급공지와 개인 배정 CS는 읽음 처리를 했더라도 미완료 상태면 배지 숫자와 강조 표시가 그대로 유지됩니다.
   */
  const loadBoardTodoCounts = useCallback(async () => {
    if (!currentUid) return;

    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tenantId = localStorage.getItem("logica_tenant_id") || "";

    const isAdmin =
      !!isSuperAdmin ||
      ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) ||
      ["최고관리자", "대장", "원장", "실장"].some((p: string) => pos.includes(p));

    const clearedStr = localStorage.getItem(`noti_cleared_at_${currentUid}`);
    const clearedTime = clearedStr ? new Date(clearedStr).getTime() : 0;

    try {
      // 1. 업무 공유 (/task) - instructor_memo
      let taskQuery = supabase
        .from("instructor_memo")
        .select("memo_id, author_name, content, memo_type, status, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (tenantId && tenantId !== "hq") {
        taskQuery = taskQuery.eq("tenant_id", tenantId);
      }

      // 2. 비품 신청 (/supply) - supply_request
      let supplyQuery = supabase
        .from("supply_request")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (tenantId && tenantId !== "hq") {
        supplyQuery = supplyQuery.eq("tenant_id", tenantId);
      }

      // 3. 학부모 요청/CS (/cs) - parent_request_log
      let hasViewAllCs = isAdmin;
      if (!hasViewAllCs && tenantId && role) {
        const { data: permData } = await supabase
          .from("tenant_role_permissions")
          .select("allowed_menus")
          .eq("tenant_id", tenantId)
          .eq("role_name", role)
          .maybeSingle();
        if (
          permData?.allowed_menus?.includes("ALL") ||
          permData?.allowed_menus?.includes("action_view_all_cs")
        ) {
          hasViewAllCs = true;
        }
      }

      let csQuery = supabase
        .from("parent_request_log")
        .select(
          "request_id, request_type, reason, created_at, updated_at, status, author_id, processed_instructor_id, is_private, student_id, student(name)"
        );
      if (tenantId && tenantId !== "hq") {
        csQuery = csQuery.eq("tenant_id", tenantId);
      }

      if (!hasViewAllCs) {
        const { data: myClasses } = await supabase
          .from("class")
          .select("class_id")
          .eq("instructor_id", currentUid);
        const myClassIds = myClasses ? myClasses.map((c: any) => c.class_id) : [];
        let myStudentIds: string[] = [];
        if (myClassIds.length > 0) {
          const { data: enrolls } = await supabase
            .from("enrollment")
            .select("student_id, status, end_date")
            .in("class_id", myClassIds);
          myStudentIds = Array.from(
            new Set(
              (enrolls || [])
                .filter((e: any) => !isEndedEnrollment(e))
                .map((e: any) => e.student_id)
            )
          );
        }
        let orStr = `processed_instructor_id.eq.${currentUid},author_id.eq.${currentUid}`;
        if (myStudentIds.length > 0) {
          orStr += `,student_id.in.(${myStudentIds.join(",")})`;
        }
        csQuery = csQuery.or(orStr);
      }

      const [taskRes, supplyRes, csRes] = await Promise.all([
        taskQuery,
        supplyQuery,
        csQuery.order("created_at", { ascending: false }).limit(500),
      ]);

      const sortPreview = (arr: BoardPreviewItem[]) =>
        [...arr].sort((a, b) => {
          if (a.isUrgentOrAssigned !== b.isUrgentOrAssigned) {
            return a.isUrgentOrAssigned ? -1 : 1;
          }
          return b.time.getTime() - a.time.getTime();
        });

      // --- (1) 업무 공유 (/task) To-Do & In Progress 집계 ---
      const allTasks = taskRes.data || [];
      const todoTasks = allTasks.filter(
        (t: any) => !t.status || t.status === "할일" || t.status === "대기"
      );
      const inProgTasks = allTasks.filter((t: any) => t.status === "진행중");
      const urgentActiveTasks = [...todoTasks, ...inProgTasks].filter(
        (t: any) => t.memo_type === "긴급공지"
      );

      const mapTaskItem = (t: any, stage: "todo" | "in_progress"): BoardPreviewItem => {
        const isUrgent = t.memo_type === "긴급공지";
        const itemTime = new Date(t.updated_at || t.created_at);
        const isRead = clearedTime > 0 && itemTime.getTime() <= clearedTime;
        return {
          id: `task_${t.memo_id}`,
          stage,
          stageLabel: stage === "todo" ? "To-Do" : "In Progress",
          badge: isUrgent ? "🚨 긴급공지" : t.memo_type || "업무",
          badgeColor: isUrgent
            ? "bg-rose-100 text-rose-700 border-rose-200"
            : "bg-indigo-50 text-indigo-700 border-indigo-200",
          title: `${t.author_name || "작성자"} 선생님`,
          subtitle: t.content || "내용 없음",
          time: itemTime,
          link: "/task",
          isUrgentOrAssigned: isUrgent,
          isRead,
        };
      };

      setTaskTodoCount(todoTasks.length);
      setTaskInProgressCount(inProgTasks.length);
      setUrgentTaskActiveCount(urgentActiveTasks.length);
      setTaskTodoItems(sortPreview(todoTasks.map((t: any) => mapTaskItem(t, "todo"))).slice(0, 15));
      setTaskInProgressItems(
        sortPreview(inProgTasks.map((t: any) => mapTaskItem(t, "in_progress"))).slice(0, 15)
      );

      // --- (2) 비품 신청 (/supply) To-Do & In Progress 집계 ---
      const allSupplies = supplyRes.data || [];
      const todoSupplies = allSupplies.filter((r: any) => !r.status || r.status === "대기");
      const inProgSupplies = allSupplies.filter((r: any) => r.status === "진행중");

      const mapSupplyItem = (r: any, stage: "todo" | "in_progress"): BoardPreviewItem => {
        const itemTime = new Date(r.updated_at || r.created_at);
        return {
          id: `supply_${r.request_id || r.id}`,
          stage,
          stageLabel: stage === "todo" ? "Requested" : "In Progress",
          badge: r.request_type || "비품",
          badgeColor:
            r.request_type === "비품/장비"
              ? "bg-rose-50 text-rose-600 border-rose-200"
              : r.request_type === "교재/도서"
              ? "bg-blue-50 text-blue-600 border-blue-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200",
          title: `${r.author_name || "신청자"} 선생님`,
          subtitle: r.content || "신청 내용 없음",
          time: itemTime,
          link: "/supply",
        };
      };

      setSupplyTodoCount(todoSupplies.length);
      setSupplyInProgressCount(inProgSupplies.length);
      setSupplyTodoItems(todoSupplies.map((r: any) => mapSupplyItem(r, "todo")).slice(0, 15));
      setSupplyInProgressItems(
        inProgSupplies.map((r: any) => mapSupplyItem(r, "in_progress")).slice(0, 15)
      );

      // --- (3) 학부모 요청/CS (/cs) To-Do & In Progress 집계 ---
      const rawCs = (csRes.data || []).filter((req: any) => {
        if (req.is_private) {
          if (hasViewAllCs) return true;
          if (String(req.author_id) === String(currentUid)) return true;
          if (String(req.processed_instructor_id) === String(currentUid)) return true;
          return false;
        }
        return true;
      });
      const todoCs = rawCs.filter((r: any) => !r.status || r.status === "대기");
      const inProgCs = rawCs.filter(
        (r: any) => r.status === "처리중" || r.status === "진행중"
      );
      const myAssignedActiveCs = [...todoCs, ...inProgCs].filter(
        (r: any) => String(r.processed_instructor_id) === String(currentUid)
      );

      const mapCsItem = (c: any, stage: "todo" | "in_progress"): BoardPreviewItem => {
        const sName = Array.isArray(c.student) ? c.student[0]?.name : c.student?.name;
        const isMyAssigned = String(c.processed_instructor_id) === String(currentUid);
        const itemTime = new Date(c.updated_at || c.created_at);
        const isRead = clearedTime > 0 && itemTime.getTime() <= clearedTime;
        return {
          id: `cs_${c.request_id}`,
          stage,
          stageLabel: stage === "todo" ? "To-Do" : "In Progress",
          badge: isMyAssigned ? "🎯 내 배정 CS" : c.request_type || "CS 요청",
          badgeColor: isMyAssigned
            ? "bg-rose-100 text-rose-700 border-rose-200"
            : "bg-slate-100 text-slate-700 border-slate-200",
          title: `${sName || "학생"} (${c.request_type || "요청"})`,
          subtitle: c.reason || "내용 없음",
          time: itemTime,
          link: "/cs",
          isUrgentOrAssigned: isMyAssigned,
          isRead,
        };
      };

      setCsTodoCount(todoCs.length);
      setCsInProgressCount(inProgCs.length);
      setAssignedCsActiveCount(myAssignedActiveCs.length);
      setCsTodoItems(sortPreview(todoCs.map((c: any) => mapCsItem(c, "todo"))).slice(0, 15));
      setCsInProgressItems(
        sortPreview(inProgCs.map((c: any) => mapCsItem(c, "in_progress"))).slice(0, 15)
      );

      // To-Do가 0건이고 In Progress만 있는 보드는 호버 시 자동으로 In Progress 탭을 기본 선택
      setActivePopoverTab((prev) => ({
        task:
          todoTasks.length === 0 && inProgTasks.length > 0
            ? "in_progress"
            : todoTasks.length > 0 && inProgTasks.length === 0
            ? "todo"
            : prev.task,
        supply:
          todoSupplies.length === 0 && inProgSupplies.length > 0
            ? "in_progress"
            : todoSupplies.length > 0 && inProgSupplies.length === 0
            ? "todo"
            : prev.supply,
        cs:
          todoCs.length === 0 && inProgCs.length > 0
            ? "in_progress"
            : todoCs.length > 0 && inProgCs.length === 0
            ? "todo"
            : prev.cs,
      }));
    } catch (err) {
      console.error("[헤더] 소통/업무 미완료 카운트 로드 오류:", err);
    }
  }, [currentUid, isSuperAdmin]);

  useEffect(() => {
    if (!currentUid) return;

    loadBoardTodoCounts();

    const triggerDebouncedReload = () => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = setTimeout(() => {
        loadBoardTodoCounts();
      }, 300);
    };

    const suffix = `${currentUid}_${Math.random().toString(36).slice(2, 8)}`;
    const commChannel = supabase
      .channel(`hdr_comm_boards_${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "instructor_memo" },
        triggerDebouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supply_request" },
        triggerDebouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parent_request_log" },
        triggerDebouncedReload
      )
      .subscribe();

    return () => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      supabase.removeChannel(commChannel);
    };
  }, [currentUid, loadBoardTodoCounts]);

  const markNotificationsRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.setItem(`noti_cleared_at_${currentUid}`, new Date().toISOString());
    loadBoardTodoCounts();
  };

  const openHoverMenu = (key: "task" | "supply" | "cs") => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setOpenMenuKey(key);
  };

  const scheduleCloseHoverMenu = () => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      setOpenMenuKey(null);
    }, 180);
  };

  const handleOpenProfile = async () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else {
      setIsProfileModalOpen(true);
      setImageSrc(null);
      setPosition({ x: 0, y: 0 });
      setZoom(1);

      setEditName("");
      setEditPhone("");
      setEditEmail("");
      setNewPassword("");
      setConfirmPassword("");

      const { data } = await supabase
        .from("instructor")
        .select("name, phone, email")
        .eq("instructor_id", currentUid)
        .single();

      if (data) {
        setEditName(data.name || "");
        setEditPhone(data.phone || "");
        setEditEmail(data.email || "");
      }
    }
  };

  const formatPhone = (val: string) => {
    const res = val.replace(/[^0-9]/g, "");
    if (res.length < 4) return res;
    if (res.length < 8) return res.substring(0, 3) + "-" + res.substring(3);
    if (res.length < 12)
      return res.substring(0, 3) + "-" + res.substring(3, 7) + "-" + res.substring(7);
    return (
      res.substring(0, 3) +
      "-" +
      res.substring(3, 7) +
      "-" +
      res.substring(7, 11) +
      "-" +
      res.substring(11)
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setImageSrc(event.target.result as string);
        setPosition({ x: 0, y: 0 });
        setZoom(1);
      }
    };
    reader.readAsDataURL(file);
  };

  const startDrag = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setDragStart({ x: clientX - position.x, y: clientY - position.y });
  };
  const onDrag = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    setPosition({ x: clientX - dragStart.x, y: clientY - dragStart.y });
  };
  const endDrag = () => setIsDragging(false);

  const getCroppedImageBlob = async (): Promise<Blob | null> => {
    const img = imageRef.current;
    if (!img) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const CANVAS_SIZE = 400;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    const CONTAINER_SIZE = 200;
    const ratio = CANVAS_SIZE / CONTAINER_SIZE;

    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;

    const renderW = CONTAINER_SIZE;
    const renderH = CONTAINER_SIZE * (naturalH / naturalW);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(position.x * ratio, position.y * ratio);

    const drawW = renderW * ratio;
    const drawH = renderH * ratio;

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isGuest) {
      alert("🔒 체험용(게스트) 계정은 프로필 정보를 수정할 수 없습니다.");
      return;
    }

    if (!editName) return alert("이름은 필수 항목입니다.");

    setIsSavingProfile(true);

    try {
      let newImgUrl = currentProfileImg;

      if (imageSrc) {
        const blob = await getCroppedImageBlob();
        if (!blob) throw new Error("사진 영역을 잡지 못했습니다. 사진을 다시 선택해주세요.");

        const fileName = `profiles/${currentUid}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("system_images")
          .upload(fileName, blob, { contentType: "image/jpeg", upsert: true });

        if (uploadError) throw new Error(`사진 업로드 에러: ${uploadError.message}`);
        newImgUrl = fileName;
      }

      if (newPassword) {
        if (newPassword.length < 6)
          throw new Error("비밀번호는 최소 6자리 이상이어야 합니다.");
        if (newPassword !== confirmPassword)
          throw new Error("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");

        const { error: authError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (authError) throw new Error(`비밀번호 변경 에러: ${authError.message}`);
      }

      const { error: dbError } = await supabase
        .from("instructor")
        .update({
          name: editName,
          phone: editPhone,
          email: editEmail,
          profile_image_url: newImgUrl,
          profile_image: newImgUrl,
        })
        .eq("instructor_id", currentUid);

      if (dbError) throw new Error(`기본 정보 업데이트 에러: ${dbError.message}`);

      alert(
        newPassword
          ? "정보 및 비밀번호가 성공적으로 변경되었습니다!"
          : "정보가 성공적으로 변경되었습니다!"
      );
      setIsProfileModalOpen(false);
      setNewPassword("");
      setConfirmPassword("");

      if (editName !== currentName) {
        localStorage.setItem("logica_instructor_name", editName);
        setCurrentName(editName);
      }

      if (imageSrc) {
        setCurrentProfileImg(newImgUrl);
        setImgError(false);
      }
    } catch (error: any) {
      alert(`수정 실패: ${error.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const getValidImageUrl = (url: string | null | undefined) => {
    if (!url || url === "null" || url === "undefined" || url.trim() === "") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/storage/v1/object/public/"))
      return `https://kfwlmbwornivkrvoeqdh.supabase.co${url}`;
    const cleanUrl = url.replace(/^system_images\//, "");
    return `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${cleanUrl}`;
  };

  const finalProfileImgUrl = getValidImageUrl(currentProfileImg);

  const taskTotalActive = taskTodoCount + taskInProgressCount;
  const supplyTotalActive = supplyTodoCount + supplyInProgressCount;
  const csTotalActive = csTodoCount + csInProgressCount;

  const renderBoardDropdown = (
    boardKey: "task" | "supply" | "cs",
    title: string,
    subtitle: string,
    targetPath: string,
    todoItems: BoardPreviewItem[],
    inProgressItems: BoardPreviewItem[],
    todoCount: number,
    inProgressCount: number,
    emptyText: string,
    showReadBtn?: boolean
  ) => {
    const selectedTab = activePopoverTab[boardKey] || "todo";
    const visibleItems = selectedTab === "todo" ? todoItems : inProgressItems;
    const allItems = [...todoItems, ...inProgressItems];

    return (
      <div
        onMouseEnter={() => {
          if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
          }
        }}
        onMouseLeave={scheduleCloseHoverMenu}
        className="absolute top-13 right-0 w-84 bg-white rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.14)] border border-slate-200 z-[70] flex flex-col overflow-hidden allow-guest-interaction"
      >
        <div className="bg-slate-50 px-4 pt-3 pb-2.5 border-b border-slate-200 shrink-0">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-slate-800 text-xs md:text-sm">{title}</h3>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpenMenuKey(null);
                router.push(targetPath);
              }}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors shrink-0"
            >
              보드로 이동 →
            </button>
          </div>

          {/* To-Do / In Progress 분리 탭 */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 bg-slate-200/70 p-1 rounded-xl">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePopoverTab((prev) => ({ ...prev, [boardKey]: "todo" }));
              }}
              className={`py-1 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                selectedTab === "todo"
                  ? "bg-white text-slate-800 shadow-xs"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span>To-Do</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  selectedTab === "todo"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-slate-300/70 text-slate-600"
                }`}
              >
                {todoCount}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePopoverTab((prev) => ({ ...prev, [boardKey]: "in_progress" }));
              }}
              className={`py-1 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                selectedTab === "in_progress"
                  ? "bg-white text-slate-800 shadow-xs"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span>In Progress</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  selectedTab === "in_progress"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-300/70 text-slate-600"
                }`}
              >
                {inProgressCount}
              </span>
            </button>
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto custom-scroll p-2 flex flex-col gap-1.5 bg-white">
          {visibleItems.length === 0 ? (
            <div className="text-center py-8 text-xs font-bold text-slate-400">
              {selectedTab === "todo"
                ? `To-Do(대기) 항목이 없습니다.${
                    inProgressCount > 0 ? ` (In Progress ${inProgressCount}건)` : ""
                  }`
                : emptyText}
            </div>
          ) : (
            visibleItems.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  setOpenMenuKey(null);
                  router.push(item.link);
                }}
                className={`p-2.5 border rounded-xl cursor-pointer hover:shadow-md transition-all ${
                  item.isUrgentOrAssigned
                    ? "bg-rose-50/60 border-rose-200 text-slate-700"
                    : "bg-slate-50 border-slate-200 text-slate-600"
                }`}
              >
                <div className="flex justify-between items-center gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${item.badgeColor}`}
                    >
                      {item.badge}
                    </span>
                    <span className="text-xs font-bold text-slate-800 truncate">{item.title}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">
                    {item.time.toLocaleDateString("ko-KR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="text-xs font-medium text-slate-600 line-clamp-2 leading-snug break-keep">
                  {item.subtitle}
                </div>
                {item.isUrgentOrAssigned && item.isRead && (
                  <div className="mt-1 text-[10px] font-bold text-rose-500">
                    📌 읽음 확인됨 · 미완료 상태 유지 중
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {showReadBtn && allItems.some((i) => i.isUrgentOrAssigned && !i.isRead) && (
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
            <span className="text-[10px] font-semibold text-slate-400">
              * 읽음 처리 후에도 완료 전까지 배지 숫자가 유지됩니다.
            </span>
            <button
              type="button"
              onClick={markNotificationsRead}
              className="text-[11px] font-bold text-slate-500 hover:text-rose-600 transition-colors shrink-0 ml-2"
            >
              읽음 확인
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={`absolute top-5 right-8 z-[60] flex items-center bg-white/90 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-slate-200 rounded-full transition-all duration-500 ease-out allow-guest-interaction ${
          isHeaderExpanded ? "pr-6 pl-2 py-2" : "px-2 py-2"
        }`}
      >
        <button
          onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <svg
            className={`w-5 h-5 transition-transform duration-500 ${
              isHeaderExpanded ? "" : "rotate-180"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>

        {/* 1. 퀵 메모(포스트잇) 아이콘 */}
        <div
          className={`shrink-0 empty:hidden transition-all duration-500 ${
            isHeaderExpanded ? "ml-1.5" : "ml-1"
          }`}
        >
          <QuickMemo instId={instId} />
        </div>

        {/* 2. 업무 공유 (/task) 아이콘 — 미완료 합산 배지 (To-Do + In Progress) */}
        <div
          className="relative shrink-0 ml-1.5"
          onMouseEnter={() => openHoverMenu("task")}
          onMouseLeave={scheduleCloseHoverMenu}
        >
          <button
            type="button"
            onClick={() => router.push("/task")}
            title={`업무 공유 미완료 ${taskTotalActive}건 (To-Do ${taskTodoCount} · In Progress ${taskInProgressCount})`}
            aria-label="업무 공유 보드로 이동"
            className={`relative w-10 h-10 rounded-full border flex items-center justify-center transition-colors focus:outline-none ${
              pathname === "/task"
                ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                : urgentTaskActiveCount > 0
                ? "bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
                : "bg-indigo-50/70 border-indigo-200 text-indigo-600 hover:bg-indigo-100"
            }`}
          >
            <svg
              className="w-5 h-5 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            {taskTotalActive > 0 && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 text-white text-xs font-bold rounded-full border-2 border-white flex items-center justify-center leading-none pointer-events-none ${
                  urgentTaskActiveCount > 0 ? "bg-rose-500 animate-pulse" : "bg-indigo-600"
                }`}
              >
                {taskTotalActive > 99 ? "99+" : taskTotalActive}
              </span>
            )}
          </button>

          {openMenuKey === "task" &&
            renderBoardDropdown(
              "task",
              `📋 업무 공유 미완료 (${taskTotalActive}건)`,
              urgentTaskActiveCount > 0
                ? `🚨 미해결 긴급공지 ${urgentTaskActiveCount}건 포함`
                : `To-Do ${taskTodoCount}건 · In Progress ${taskInProgressCount}건`,
              "/task",
              taskTodoItems,
              taskInProgressItems,
              taskTodoCount,
              taskInProgressCount,
              "진행 중인 업무 공유 항목이 없습니다.",
              true
            )}
        </div>

        {/* 3. 비품 신청 (/supply) 아이콘 — 미완료 합산 배지 (To-Do + In Progress) */}
        <div
          className="relative shrink-0 ml-1.5"
          onMouseEnter={() => openHoverMenu("supply")}
          onMouseLeave={scheduleCloseHoverMenu}
        >
          <button
            type="button"
            onClick={() => router.push("/supply")}
            title={`비품 신청 미완료 ${supplyTotalActive}건 (To-Do ${supplyTodoCount} · In Progress ${supplyInProgressCount})`}
            aria-label="비품 신청 보드로 이동"
            className={`relative w-10 h-10 rounded-full border flex items-center justify-center transition-colors focus:outline-none ${
              pathname === "/supply"
                ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                : "bg-emerald-50/70 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
            }`}
          >
            <svg
              className="w-5 h-5 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            {supplyTotalActive > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-emerald-600 text-white text-xs font-bold rounded-full border-2 border-white flex items-center justify-center leading-none pointer-events-none">
                {supplyTotalActive > 99 ? "99+" : supplyTotalActive}
              </span>
            )}
          </button>

          {openMenuKey === "supply" &&
            renderBoardDropdown(
              "supply",
              `📦 비품 신청 미완료 (${supplyTotalActive}건)`,
              `To-Do ${supplyTodoCount}건 · In Progress ${supplyInProgressCount}건`,
              "/supply",
              supplyTodoItems,
              supplyInProgressItems,
              supplyTodoCount,
              supplyInProgressCount,
              "진행 중인 비품 신청이 없습니다.",
              false
            )}
        </div>

        {/* 4. 학부모 요청/CS (/cs) 아이콘 — 미완료 합산 배지 (To-Do + In Progress) */}
        <div
          className="relative shrink-0 ml-1.5"
          onMouseEnter={() => openHoverMenu("cs")}
          onMouseLeave={scheduleCloseHoverMenu}
        >
          <button
            type="button"
            onClick={() => router.push("/cs")}
            title={`학부모 요청/CS 미완료 ${csTotalActive}건 (To-Do ${csTodoCount} · In Progress ${csInProgressCount})`}
            aria-label="학부모 요청/CS 보드로 이동"
            className={`relative w-10 h-10 rounded-full border flex items-center justify-center transition-colors focus:outline-none ${
              pathname === "/cs"
                ? "bg-rose-100 border-rose-300 text-rose-700"
                : "bg-rose-50/70 border-rose-200 text-rose-600 hover:bg-rose-100"
            }`}
          >
            <svg
              className="w-5 h-5 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            {csTotalActive > 0 && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 text-white text-xs font-bold rounded-full border-2 border-white flex items-center justify-center leading-none pointer-events-none ${
                  assignedCsActiveCount > 0 ? "bg-rose-600 animate-pulse" : "bg-rose-500"
                }`}
              >
                {csTotalActive > 99 ? "99+" : csTotalActive}
              </span>
            )}
          </button>

          {openMenuKey === "cs" &&
            renderBoardDropdown(
              "cs",
              `🎧 학부모 요청/CS 미완료 (${csTotalActive}건)`,
              assignedCsActiveCount > 0
                ? `🎯 내게 배정된 미해결 CS ${assignedCsActiveCount}건 포함`
                : `To-Do ${csTodoCount}건 · In Progress ${csInProgressCount}건`,
              "/cs",
              csTodoItems,
              csInProgressItems,
              csTodoCount,
              csInProgressCount,
              "진행 중인 학부모 요청/CS가 없습니다.",
              true
            )}
        </div>

        <div
          className={`flex items-center overflow-hidden transition-all duration-500 ease-in-out ${
            isHeaderExpanded
              ? "max-w-[800px] opacity-100 ml-4 pl-4 border-l border-slate-200"
              : "max-w-0 opacity-0 ml-0 pl-0 border-transparent"
          }`}
        >
          <DigitalClock />

          <div className="w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm shrink-0 mr-3">
            {finalProfileImgUrl && !imgError ? (
              <img
                src={finalProfileImgUrl}
                className="w-full h-full object-cover"
                alt="profile"
                onError={() => setImgError(true)}
              />
            ) : (
              <span className="text-lg">👨‍🏫</span>
            )}
          </div>

          <div className="flex flex-col text-left shrink-0">
            <p className="font-bold text-slate-800 leading-tight truncate">
              {currentName} 선생님
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-xs font-bold text-blue-500 cursor-pointer hover:text-blue-700 transition-colors allow-guest-interaction"
                onClick={handleOpenProfile}
              >
                정보수정
              </span>
              <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
              <span
                className="text-xs font-bold text-slate-400 cursor-pointer hover:text-rose-500 transition-colors allow-guest-interaction"
                onClick={onLogout}
              >
                로그아웃
              </span>
            </div>
          </div>
        </div>
      </div>

      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-brand shrink-0">
              <h2 className="text-lg font-bold text-white">⚙️ 내 정보 수정</h2>
              <button
                onClick={() => {
                  setIsProfileModalOpen(false);
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="text-blue-200 hover:text-white text-2xl leading-none transition-colors allow-guest-interaction px-2"
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={handleSaveProfile}
              autoComplete="off"
              className="p-6 flex-1 overflow-y-auto custom-scroll space-y-6 allow-guest-interaction"
            >
              <div className="flex flex-col items-center border-b border-slate-100 pb-6">
                <h3 className="text-sm font-bold text-slate-800 mb-4 w-full text-left">
                  프로필 사진
                </h3>

                {!imageSrc ? (
                  <div className="flex flex-col items-center">
                    <div className="w-[160px] h-[160px] rounded-full border border-slate-200 shadow-sm overflow-hidden mb-4 bg-slate-100 flex items-center justify-center">
                      {finalProfileImgUrl && !imgError ? (
                        <img
                          src={finalProfileImgUrl}
                          className="w-full h-full object-cover"
                          alt="current profile"
                          onError={() => setImgError(true)}
                        />
                      ) : (
                        <span className="text-4xl">👨‍🏫</span>
                      )}
                    </div>

                    <label
                      className={`relative overflow-hidden bg-slate-100 text-slate-700 text-xs font-bold py-2.5 px-5 rounded-xl border border-slate-300 transition-colors shadow-sm flex items-center gap-2 ${
                        isGuest
                          ? "cursor-not-allowed opacity-60"
                          : "hover:bg-slate-200 cursor-pointer"
                      }`}
                    >
                      <span className="text-base z-10">📸</span>{" "}
                      <span className="z-10 relative">새 사진 업로드 및 자르기</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isGuest}
                        className={`absolute inset-0 w-full h-full opacity-0 z-20 ${
                          isGuest ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                        onChange={handleFileChange}
                        onClick={(e) => {
                          (e.target as HTMLInputElement).value = "";
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner">
                    <p className="text-xs font-bold text-blue-600 mb-3 bg-blue-50 px-3 py-1 rounded-full">
                      👆 마우스나 손가락으로 사진을 끌어 맞추세요
                    </p>

                    <div
                      className="relative w-[200px] h-[200px] rounded-full overflow-hidden bg-white border-4 border-brand mx-auto cursor-move shadow-md"
                      style={{ touchAction: "none" }}
                      onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
                      onMouseMove={(e) => onDrag(e.clientX, e.clientY)}
                      onMouseUp={endDrag}
                      onMouseLeave={endDrag}
                      onTouchStart={(e) =>
                        startDrag(e.touches[0].clientX, e.touches[0].clientY)
                      }
                      onTouchMove={(e) =>
                        onDrag(e.touches[0].clientX, e.touches[0].clientY)
                      }
                      onTouchEnd={endDrag}
                    >
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30 z-10">
                        <div className="w-full h-[1px] bg-white"></div>
                        <div className="absolute h-full w-[1px] bg-white"></div>
                      </div>

                      <img
                        ref={imageRef}
                        src={imageSrc}
                        alt="crop"
                        className="absolute pointer-events-none max-w-none"
                        style={{
                          transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                          top: "50%",
                          left: "50%",
                          width: "100%",
                        }}
                      />
                    </div>

                    <div className="w-full max-w-[240px] mt-6 flex items-center gap-3 bg-white px-3 py-2.5 rounded-lg border border-slate-200 shadow-sm">
                      <span className="text-xs font-bold text-slate-500 shrink-0">축소</span>
                      <input
                        type="range"
                        min="0.5"
                        max="3"
                        step="0.05"
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="flex-1 accent-brand"
                      />
                      <span className="text-xs font-bold text-slate-500 shrink-0">확대</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setImageSrc(null);
                        setPosition({ x: 0, y: 0 });
                        setZoom(1);
                      }}
                      className="mt-4 text-xs font-bold text-slate-500 hover:text-slate-700 underline underline-offset-2 transition-colors allow-guest-interaction"
                    >
                      취소하고 이전 사진 유지
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4 pb-5 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800">기본 정보</h3>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">이름</label>
                  <input
                    type="text"
                    required
                    disabled={isGuest}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoComplete="none"
                    data-lpignore="true"
                    className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                      isGuest
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-white text-slate-700"
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
                  <input
                    type="text"
                    disabled={isGuest}
                    value={editPhone}
                    onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                    maxLength={13}
                    autoComplete="none"
                    data-lpignore="true"
                    className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-medium focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                      isGuest
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-white text-slate-700"
                    }`}
                    placeholder="010-0000-0000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">이메일</label>
                  <input
                    type="email"
                    disabled={isGuest}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    autoComplete="none"
                    data-lpignore="true"
                    className={`w-full px-3 py-2 rounded-lg border border-slate-300 font-medium focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                      isGuest
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-white text-slate-700"
                    }`}
                    placeholder="email@example.com"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-800">
                  비밀번호 변경{" "}
                  <span className="text-xs font-normal text-slate-400 ml-1">(선택 사항)</span>
                </h3>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    새 비밀번호
                  </label>
                  <input
                    type="password"
                    disabled={isGuest}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    data-lpignore="true"
                    className={`w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                      isGuest ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-white"
                    }`}
                    placeholder="변경할 경우에만 입력 (최소 6자리)"
                  />
                </div>
                {newPassword && !isGuest && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">
                      새 비밀번호 확인
                    </label>
                    <input
                      type="password"
                      required={!!newPassword}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      data-lpignore="true"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      placeholder="새 비밀번호를 한 번 더 입력하세요"
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileModalOpen(false);
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors allow-guest-interaction"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile || isGuest}
                  className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-md transition-colors ${
                    isGuest
                      ? "bg-slate-400 cursor-not-allowed"
                      : "bg-brand hover:bg-blue-800 disabled:opacity-50"
                  }`}
                >
                  {isGuest
                    ? "🔒 수정 불가 (체험용)"
                    : isSavingProfile
                    ? "저장 중..."
                    : "변경사항 저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}