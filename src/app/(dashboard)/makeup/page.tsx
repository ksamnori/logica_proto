// src/app/(dashboard)/makeup/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  addToQueue,
  sendQueuedMessages,
  clearQueue,
  deleteQueueItem,
} from "@/app/actions/alimtalk";
import MakeupModal from "@/components/makeup/MakeupModal";

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const formatParentDisplayName = (
  rawName?: string,
  rawRel?: string,
  studentName?: string
): string => {
  const rawRelTrim = String(rawRel || "").replace(/\(\s*\)/g, "").trim();
  const validRel =
    rawRelTrim && rawRelTrim !== "-" && rawRelTrim !== "미입력" && rawRelTrim !== "학부모"
      ? rawRelTrim
      : "";
  const raw = String(rawName || "").trim();
  const cleanStu = String(studentName || "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s*학부모님?\s*/g, " ")
    .trim();

  const parenMatch = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (parenMatch) {
    const innerTrim = parenMatch[2].trim();
    const validInner =
      innerTrim && innerTrim !== "-" && innerTrim !== "미입력" && innerTrim !== "학부모"
        ? innerTrim
        : validRel;
    const cleanedPrefix = parenMatch[1]
      .replace(/\(\s*\)/g, "")
      .replace(/\s*학부모님?\s*/g, " ")
      .trim();
    const base = cleanedPrefix && cleanedPrefix !== "미입력" ? cleanedPrefix : (cleanStu || "원생");
    return validInner ? `${base}(${validInner})` : base;
  }

  const cleaned = raw
    .replace(/\(\s*\)/g, "")
    .replace(/\s*학부모님?\s*/g, " ")
    .trim();
  const baseName = cleaned && cleaned !== "미입력" ? cleaned : cleanStu || "원생";
  return validRel ? `${baseName}(${validRel})` : baseName;
};

const buildMakeupSmsBody = (
  parentName: string,
  studentName: string,
  schStr: string,
  roomStr: string,
  detailStr: string
) => {
  return `[로지카대치본원학원] 보강 안내\n\n${parentName} 학부모님,\n${studentName}학생의 보강 일정을 안내해 드립니다.\n\n■ 보강 일시 : ${schStr}\n■ 강의실 : ${roomStr}\n■ 상세 내용 : ${detailStr}`;
};

const getBadgeColor = (title: string) => {
  if (!title) return "bg-slate-100 text-slate-600 border-slate-200";
  if (title.includes("출석") || title.includes("등원") || title.includes("원내체류"))
    return "bg-blue-50 text-blue-700 border-blue-200";
  if (title.includes("하원") || title.includes("조퇴"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (title.includes("지각")) return "bg-amber-50 text-amber-600 border-amber-100";
  if (title.includes("결석")) return "bg-rose-50 text-rose-500 border-rose-100";
  if (title.includes("일정")) return "bg-indigo-50 text-indigo-600 border-indigo-100";
  if (title.includes("보강")) return "bg-purple-50 text-purple-600 border-purple-200";
  if (title.includes("과제")) return "bg-cyan-50 text-cyan-600 border-cyan-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
};

export default function MakeupPage() {
  const router = useRouter();

  // 메뉴 및 세부 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [canEditMakeup, setCanEditMakeup] = useState(false);
  const [canDeleteMakeup, setCanDeleteMakeup] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [tenantId, setTenantId] = useState<string>("");

  // 기본 데이터 상태
  const [makeups, setMakeups] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalClassId, setModalClassId] = useState<string | null>(null);
  const deepLinkHandledRef = useRef(false);

  // 필터 상태
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterInstructor, setFilterInstructor] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMakeup, setSelectedMakeup] = useState<any | null>(null);

  // 우측 발송 대기열 & 최근 발송 목록 상태
  const [queuedMessages, setQueuedMessages] = useState<any[]>([]);
  const [liveFeeds, setLiveFeeds] = useState<any[]>([]);
  const [isSendingAlimtalk, setIsSendingAlimtalk] = useState(false);
  const [queueingMakeupId, setQueueingMakeupId] = useState<string | null>(null);
  const [previewQueueIdx, setPreviewQueueIdx] = useState<number | null>(null);
  const [selectedLogItem, setSelectedLogItem] = useState<any | null>(null);

  const getValidTenantId = useCallback(
    (rawTenantId?: string | null) => {
      const t = rawTenantId || tenantId || localStorage.getItem("logica_tenant_id") || "";
      return t === "hq" ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73" : t;
    },
    [tenantId]
  );

  // 컴포넌트 마운트 시 권한 검사 및 세부 권한 연동
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      setTenantId(tId);

      const isGodMode =
        role === "SUPER_ADMIN" ||
        role === "ADMIN" ||
        pos.includes("최고관리자") ||
        pos.includes("대장") ||
        pos.includes("원장");

      if (isGodMode) {
        setIsAuthorized(true);
        setCanEditMakeup(true);
        setCanDeleteMakeup(true);
        setIsSuperAdmin(true);
        return;
      }

      if (!tId || !role) {
        alert("권한 정보가 없습니다.");
        router.replace("/home");
        return;
      }

      const { data } = await supabase
        .from("tenant_role_permissions")
        .select("allowed_menus")
        .eq("tenant_id", tId)
        .eq("role_name", role)
        .maybeSingle();

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/makeup"))) {
        alert("⛔ 보강 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        setCanEditMakeup(data.allowed_menus.includes("action_edit_makeup"));
        setCanDeleteMakeup(data.allowed_menus.includes("action_delete_makeup"));
      }
    };

    checkAccess();
  }, [router]);

  const fetchQueue = useCallback(async () => {
    const validTenantId = getValidTenantId();
    if (!validTenantId) return;

    const { data } = await supabase
      .from("alimtalk_queue")
      .select("*")
      .eq("tenant_id", validTenantId)
      .eq("status", "대기")
      .order("created_at", { ascending: false });

    const raw = data || [];
    const uniqueMap = new Map();
    raw.forEach((item: any) => {
      const key =
        item.template_id === "KA01TP260921034958500GAtQOl600yJ"
          ? `${item.student_id}_${item.parent_phone}_ATT`
          : item.queue_id;
      if (!uniqueMap.has(key)) {
        const cleanedParent = formatParentDisplayName(
          item.parent_name,
          "학부모",
          item.student_name
        );
        const cleanedDesc =
          typeof item.preview_desc === "string"
            ? item.preview_desc.replace(/\s*학부모\s*(\([^)]+\))/g, "$1")
            : item.preview_desc;
        uniqueMap.set(key, {
          ...item,
          parent_name: cleanedParent,
          preview_desc: cleanedDesc,
        });
      }
    });
    setQueuedMessages(Array.from(uniqueMap.values()));
  }, [getValidTenantId]);

  const fetchLiveFeeds = useCallback(async () => {
    const rawTenantId = tenantId || localStorage.getItem("logica_tenant_id") || "";
    const validTenantId = getValidTenantId(rawTenantId);
    let query = supabase
      .from("notification_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40);
    if (validTenantId) {
      query = query.eq("tenant_id", validTenantId);
    }
    const { data } = await query;
    setLiveFeeds(data || []);
  }, [tenantId, getValidTenantId]);

  useEffect(() => {
    if (!isAuthorized) return;
    fetchInitialData();
    fetchQueue();
    fetchLiveFeeds();

    const queueChannel = supabase
      .channel("makeup_queue_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alimtalk_queue" },
        () => {
          fetchQueue();
        }
      )
      .subscribe();

    const logChannel = supabase
      .channel("makeup_noti_log_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification_log" },
        () => {
          fetchLiveFeeds();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(queueChannel);
      supabase.removeChannel(logChannel);
    };
  }, [isAuthorized, fetchQueue, fetchLiveFeeds]);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const validTenantId = getValidTenantId();
      if (!validTenantId) {
        setIsLoading(false);
        return;
      }

      let makeupQuery = supabase
        .from("individual_makeup")
        .select(`
          *, 
          instructor(name),
          student(
            student_id,
            name, 
            grade, 
            enrollment(
              status,
              end_date,
              class(*)
            )
          )
        `)
        .order("schedule_date", { ascending: false })
        .limit(1000);

      let instQuery = supabase
        .from("instructor")
        .select("instructor_id, name")
        .eq("status", "재직");

      let stuQuery = supabase
        .from("student")
        .select(`
          student_id, 
          name, 
          grade, 
          tenant_id,
          parent(name, phone, relationship, name_2, phone_2, relationship_2),
          enrollment(
            status,
            end_date,
            class(*)
          )
        `)
        .eq("status", "재원")
        .order("name")
        .limit(1000);

      if (validTenantId) {
        makeupQuery = makeupQuery.eq("tenant_id", validTenantId);
        instQuery = instQuery.eq("tenant_id", validTenantId);
        stuQuery = stuQuery.eq("tenant_id", validTenantId);
      }

      const [instRes, stuRes, makeupRes] = await Promise.all([
        instQuery,
        stuQuery,
        makeupQuery,
      ]);

      if (instRes.data) setInstructors(instRes.data);

      if (stuRes.data) {
        const mappedStudents = stuRes.data.map((s: any) => {
          const enrolls = Array.isArray(s.enrollment) ? s.enrollment : [];
          const active = enrolls.find((e: any) => !isEndedEnrollment(e));
          const cName =
            active?.class?.class_name || active?.class?.name || "반 미배정";
          return { ...s, class_name: cName };
        });
        setStudents(mappedStudents);
      }

      if (makeupRes.data) setMakeups(makeupRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      handleDeepLinkOnce();
    }
  };

  const handleDeepLinkOnce = () => {
    if (deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    window.history.replaceState(null, "", "/makeup");
    if (!canEditMakeup) {
      alert("⛔ 보강 일정을 등록할 권한이 없습니다.");
      return;
    }
    setModalClassId(params.get("classId"));
    setSelectedMakeup(null);
    setIsModalOpen(true);
  };

  const filteredMakeups = useMemo(() => {
    const searchLow = filterSearch.trim().toLowerCase();
    return makeups.filter((m) => {
      const matchStatus = filterStatus === "all" || m.status === filterStatus;
      const matchInst =
        filterInstructor === "all" ||
        m.instructor_id?.toString() === filterInstructor;
      const matchSearch =
        searchLow === "" ||
        m.student?.name?.toLowerCase().includes(searchLow);
      return matchStatus && matchInst && matchSearch;
    });
  }, [makeups, filterStatus, filterInstructor, filterSearch]);

  const resetFilters = () => {
    setFilterStatus("all");
    setFilterInstructor("all");
    setFilterSearch("");
  };

  const openModal = (makeup: any | null = null) => {
    setModalClassId(null);
    setSelectedMakeup(makeup);
    setIsModalOpen(true);
  };

  const completeMakeup = async (id: string) => {
    if (!canEditMakeup) return alert("⛔ 보강 일정을 수정할 권한이 없습니다.");
    if (!confirm("이 보강 일정을 '완료' 상태로 변경하시겠습니까?")) return;
    try {
      const { error } = await supabase
        .from("individual_makeup")
        .update({ status: "완료" })
        .eq("makeup_id", id);
      if (error) throw error;
      fetchInitialData();
    } catch (e: any) {
      alert("완료 처리 실패: " + e.message);
    }
  };

  const deleteMakeup = async (id: string) => {
    if (!canDeleteMakeup) return alert("⛔ 보강 일정을 삭제할 권한이 없습니다.");
    if (!confirm("이 보강 일정을 정말 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase
        .from("individual_makeup")
        .delete()
        .eq("makeup_id", id);
      if (error) throw error;
      alert("삭제되었습니다.");
      fetchInitialData();
    } catch (e: any) {
      alert("삭제 실패: " + e.message);
    }
  };

  // 🌟 리스트의 [알림] 버튼 클릭 시 해당 보강 일정 내용을 자동 완성하여 문자 발송 대기열로 즉시 전송
  const handleQueueNotificationFromRow = async (m: any) => {
    const studentId = m.student_id || m.student?.student_id;
    const studentName = m.student?.name || "원생";
    if (!studentId) {
      return alert("대상 학생 정보가 없습니다.");
    }

    const validTenantId = getValidTenantId(m.tenant_id);
    if (!validTenantId) {
      return alert("소속 지점 정보가 없습니다.");
    }

    setQueueingMakeupId(String(m.makeup_id));
    try {
      // 1) 보강 일시 문자열 생성 (예: "11월 6일(금) 16:00~17:00")
      const days = ["일", "월", "화", "수", "목", "금", "토"];
      const d = new Date(m.schedule_date);
      const mm = d.getMonth() + 1;
      const dd = d.getDate();
      const dayLabel = !isNaN(d.getTime()) ? `(${days[d.getDay()]})` : "";
      const sHour = String(d.getHours()).padStart(2, "0");
      const sMin = String(d.getMinutes()).padStart(2, "0");

      let cleanNote = String(m.instructor_note || "");
      let endTimeStr = "";
      const endMatch = cleanNote.match(/\[종료예정 (\d{2}):(\d{2})\]/);
      if (endMatch) {
        endTimeStr = `${endMatch[1]}:${endMatch[2]}`;
        cleanNote = cleanNote.replace(/\[종료예정 \d{2}:\d{2}\]\s*/, "").trim();
      }
      const timeRange = endTimeStr ? `${sHour}:${sMin}~${endTimeStr}` : `${sHour}:${sMin}`;
      const finalSchedule = `${mm}월 ${dd}일${dayLabel} ${timeRange}`;
      const finalClassroom = String(m.classroom || "-").trim();

      // 2) 상세 내용 문자열 생성
      const detailParts: string[] = [];
      const instName =
        m.instructor?.name ||
        instructors.find((i: any) => String(i.instructor_id) === String(m.instructor_id))?.name;
      if (instName) {
        detailParts.push(`담당강사: ${instName} 선생님`);
      }
      if (m.target_category_id && String(m.target_category_id).trim()) {
        detailParts.push(`보강내용: ${String(m.target_category_id).trim()}`);
      }
      if (cleanNote) {
        detailParts.push(`안내사항: ${cleanNote}`);
      }
      const finalDetails =
        detailParts.length > 0 ? detailParts.join(" / ") : "개별 보강 수업이 진행됩니다.";

      // 3) 학부모 연락처 조회 (메모리 내 students 우선 확인 후 없으면 DB 조회)
      const stuInState = students.find((s: any) => String(s.student_id) === String(studentId));
      let pInfo: any = unwrap(stuInState?.parent);
      if (!pInfo) {
        const { data: stuWithParent } = await supabase
          .from("student")
          .select("name, parent(name, phone, relationship, name_2, phone_2, relationship_2)")
          .eq("student_id", studentId)
          .maybeSingle();
        pInfo = unwrap(stuWithParent?.parent);
      }

      const targets: { phone: string; finalName: string }[] = [];
      if (pInfo) {
        const pushTarget = (phone?: string, name?: string, rel?: string) => {
          if (!phone || String(phone).includes("unassigned") || !String(phone).trim()) return;
          const relClean = String(rel || "").replace(/\(\s*\)/g, "").trim();
          const validRel = relClean && relClean !== "-" && relClean !== "미입력" && relClean !== "학부모" ? relClean : "";
          const cleanedName = String(name || "")
            .replace(/\(\s*\)/g, "")
            .replace(/\s*학부모님?\s*/g, " ")
            .trim();
          const baseName =
            cleanedName && cleanedName !== "미입력" ? cleanedName : studentName;
          const finalName = validRel ? `${baseName}(${validRel})` : baseName;
          targets.push({ phone: String(phone).trim(), finalName });
        };
        pushTarget(pInfo.phone, pInfo.name, pInfo.relationship);
        pushTarget(pInfo.phone_2, pInfo.name_2, pInfo.relationship_2);
      }

      if (targets.length === 0) {
        alert(`${studentName} 학생에게 등록된 학부모 연락처가 없어 대기열에 담을 수 없습니다.`);
        return;
      }

      const currentTimeStr = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const newMessages = targets.map((t) => {
        const fullSmsText = buildMakeupSmsBody(
          t.finalName,
          studentName,
          finalSchedule,
          finalClassroom,
          finalDetails
        );
        return {
          tenant_id: validTenantId,
          student_id: studentId,
          student_name: studentName,
          parent_name: t.finalName,
          parent_phone: t.phone,
          template_id: "GENERAL_SMS",
          details: fullSmsText,
          preview_title: `[보강] ${studentName}`,
          preview_desc: `${finalSchedule} (${finalClassroom})`,
          time_string: currentTimeStr,
          status: "대기",
        };
      });

      const res = await addToQueue(newMessages);
      if (!res.success) {
        alert(`발송 대기열 등록 실패: ${res.message}`);
        return;
      }

      await fetchQueue();
    } catch (e: any) {
      alert("대기열 등록 중 오류: " + (e?.message || String(e)));
    } finally {
      setQueueingMakeupId(null);
    }
  };

  // 발송 대기열 전체 발송 핸들러
  const handleSendQueuedMessages = async () => {
    if (queuedMessages.length === 0) return;
    if (!confirm(`대기 중인 ${queuedMessages.length}건의 메시지를 발송하시겠습니까?`)) return;

    setIsSendingAlimtalk(true);
    try {
      const validTenantId = getValidTenantId();
      const res = await sendQueuedMessages(validTenantId);
      await Promise.all([fetchQueue(), fetchLiveFeeds()]);

      if (!res.success) {
        alert(`발송 중 오류가 발생했습니다.\n${res.message || ""}`);
        return;
      }
      alert(`메시지 전송 완료!\n(성공: ${res.sent}건, 실패: ${res.failed}건)`);
    } finally {
      setIsSendingAlimtalk(false);
    }
  };

  const deleteNotificationLog = async (logId: string) => {
    if (!confirm("이 발송 기록을 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase
        .from("notification_log")
        .delete()
        .eq("noti_log_id", logId);
      if (error) {
        alert("삭제에 실패했습니다.");
        return;
      }
      fetchLiveFeeds();
    } catch (e) {
      alert("삭제 실패");
    }
  };

  const clearNotificationLogs = async () => {
    if (!confirm("최근 발송 내역을 모두 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다.)")) return;
    try {
      const validTenantId = getValidTenantId();
      const { error } = await supabase
        .from("notification_log")
        .delete()
        .eq("tenant_id", validTenantId);
      if (error) {
        alert("전체 삭제에 실패했습니다.");
        return;
      }
      fetchLiveFeeds();
    } catch (e) {
      alert("전체 삭제 실패");
    }
  };

  const handleStudentClick = (studentId: string) => {
    if (!studentId) return;
    router.push(`/student/${studentId}?tab=makeup`);
  };

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }

  if (isAuthorized === false) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-6 gap-4 overflow-hidden relative">
      {/* 상단 타이틀 & 필터 바 */}
      <div className="flex flex-wrap justify-between items-end gap-3 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">1:1 개별 보강 관리</h2>
          <p className="text-xs sm:text-sm font-bold text-slate-400 mt-0.5">
            학생들의 1:1 개별 보강 일정을 등록·관리하고, 우측에서 보강 안내 문자를 바로 발송합니다.
          </p>
        </div>
      </div>

      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2.5 shrink-0 flex-wrap">
        <span className="font-bold text-slate-600 text-sm mr-1">🔍 보강 필터</span>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand"
        >
          <option value="all">모든 상태</option>
          <option value="예정">예정</option>
          <option value="진행중">진행중</option>
          <option value="완료">완료</option>
          <option value="취소">취소</option>
        </select>

        <select
          value={filterInstructor}
          onChange={(e) => setFilterInstructor(e.target.value)}
          className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand"
        >
          <option value="all">모든 담당 강사</option>
          {instructors.map((inst) => (
            <option key={inst.instructor_id} value={inst.instructor_id}>
              {inst.name} 선생님
            </option>
          ))}
        </select>

        <input
          type="text"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          placeholder="학생 이름 검색"
          className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand w-36 sm:w-44"
        />

        <button
          onClick={resetFilters}
          className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1"
        >
          🔄 전체보기
        </button>

        {canEditMakeup && (
          <button
            onClick={() => openModal()}
            className="ml-auto bg-brand text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors"
          >
            새 보강 일정 등록
          </button>
        )}
      </div>

      {/* 본문 2단 레이아웃: 좌측 보강 일정 테이블 + 우측 (상단 발송 대기열 / 하단 최근 발송 목록) */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_380px] 2xl:grid-cols-[1fr_420px] gap-4 min-h-0 overflow-hidden">
        {/* 좌측: 보강 일정 목록 테이블 */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden min-h-0 min-w-0">
          <div className="overflow-auto flex-1 custom-scroll">
            <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">예정일</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">시간</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">강의실</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">대상 학생 🔍</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">담당 강사</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">보강 내용(단원)</th>
                  <th className="py-3 px-3 font-bold text-slate-500 text-center">상태</th>
                  {(canEditMakeup || canDeleteMakeup) && (
                    <th className="py-3 px-3 font-bold text-slate-500 text-center">관리</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-slate-400 font-bold">
                      보강 일정을 불러오는 중입니다...
                    </td>
                  </tr>
                ) : filteredMakeups.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-slate-400 font-bold">
                      조건에 맞는 보강 일정이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredMakeups.map((m: any) => {
                    const d = new Date(m.schedule_date);
                    const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(
                      2,
                      "0"
                    )}.${String(d.getDate()).padStart(2, "0")}`;
                    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(
                      d.getMinutes()
                    ).padStart(2, "0")}`;

                    const roomStr = m.classroom || "-";
                    const instName = m.instructor ? `${m.instructor.name} 선생님` : "미지정";

                    let statusClass = "bg-slate-100 text-slate-600";
                    if (m.status === "예정") statusClass = "bg-blue-100 text-blue-700";
                    else if (m.status === "진행중") statusClass = "bg-amber-100 text-amber-700";
                    else if (m.status === "완료") statusClass = "bg-emerald-100 text-emerald-700";
                    else if (m.status === "취소") statusClass = "bg-rose-100 text-rose-700";

                    const enrolls = Array.isArray(m.student?.enrollment)
                      ? m.student.enrollment
                      : [];
                    const active = enrolls.find((e: any) => !isEndedEnrollment(e));
                    const className =
                      active?.class?.class_name || active?.class?.name || "반 미배정";

                    const isQueueingThis = queueingMakeupId === String(m.makeup_id);

                    return (
                      <tr
                        key={m.makeup_id}
                        className="hover:bg-blue-50/50 transition-colors border-b border-slate-100"
                      >
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600">
                          {dateStr}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-brand bg-blue-50/30">
                          {timeStr}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-700">
                          {roomStr}
                        </td>
                        <td
                          onClick={() => handleStudentClick(m.student?.student_id)}
                          className="py-2.5 px-3 text-center font-bold text-blue-600 cursor-pointer hover:underline"
                        >
                          {m.student?.name || "알수없음"}{" "}
                          <span className="text-xs text-slate-400 font-medium">
                            ({className})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-700">
                          {instName}
                        </td>
                        <td
                          className="py-2.5 px-3 text-center font-bold text-slate-600 truncate max-w-[170px]"
                          title={m.target_category_id}
                        >
                          {m.target_category_id || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`${statusClass} px-2 py-0.5 rounded text-xs font-bold`}>
                            {m.status || "예정"}
                          </span>
                        </td>

                        {(canEditMakeup || canDeleteMakeup) && (
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {canEditMakeup && (
                                <button
                                  type="button"
                                  disabled={isQueueingThis}
                                  onClick={() => handleQueueNotificationFromRow(m)}
                                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white font-bold text-xs border border-indigo-200 hover:border-indigo-600 rounded shadow-sm transition-colors disabled:opacity-50"
                                  title="이 보강 일정을 자동 완성하여 우측 문자 발송 대기열에 담습니다."
                                >
                                  {isQueueingThis ? "담는중.." : "알림"}
                                </button>
                              )}
                              {canEditMakeup && m.status !== "완료" && (
                                <button
                                  type="button"
                                  onClick={() => completeMakeup(m.makeup_id)}
                                  className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white font-bold text-xs border border-emerald-200 hover:border-emerald-500 rounded shadow-sm transition-colors"
                                >
                                  완료
                                </button>
                              )}
                              {canEditMakeup && (
                                <button
                                  type="button"
                                  onClick={() => openModal(m)}
                                  className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-xs rounded shadow-sm transition-colors"
                                >
                                  수정
                                </button>
                              )}
                              {canDeleteMakeup && (
                                <button
                                  type="button"
                                  onClick={() => deleteMakeup(m.makeup_id)}
                                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-500 text-rose-400 hover:text-white font-bold text-xs border border-rose-200 hover:border-rose-400 rounded shadow-sm transition-colors"
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 우측: 상단 발송 대기열 + 하단 최근 발송 목록 */}
        <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* 우측 상단: 발송 대기열 */}
          <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span>💬 발송 대기열</span>
                {queuedMessages.length > 0 && (
                  <span className="text-xs font-bold text-[#3a2929] bg-[#fef01b] px-2 py-0.5 rounded-full shadow-sm">
                    {queuedMessages.length}건 대기중
                  </span>
                )}
              </h3>
              {queuedMessages.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewQueueIdx(0)}
                    className="text-[11px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-lg font-bold transition-colors shadow-sm"
                  >
                    🔍 미리보기
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const validTenantId = getValidTenantId();
                      const res = await clearQueue(validTenantId);
                      if (!res.success) alert(`삭제 실패: ${res.message}`);
                      fetchQueue();
                    }}
                    className="text-[11px] text-slate-400 hover:text-rose-500 font-bold transition-colors"
                  >
                    전체 비우기
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-2.5 bg-slate-50/50">
              {queuedMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-80 py-6">
                  <span className="text-3xl mb-2 drop-shadow-sm">📬</span>
                  <p className="font-bold text-xs">대기 중인 메시지가 없습니다.</p>
                  <p className="text-[11px] mt-1 px-4 text-center leading-relaxed">
                    좌측 목록의 [알림] 버튼이나 보강 등록 창에서 담으면 이곳에 표시됩니다.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {queuedMessages.map((msg: any, idx: number) => (
                    <div
                      key={msg.queue_id || idx}
                      onClick={() => setPreviewQueueIdx(idx)}
                      className="bg-white px-2.5 py-2 rounded-lg border border-slate-200 shadow-sm flex flex-col group hover:border-indigo-400 hover:bg-indigo-50/20 cursor-pointer transition-colors relative gap-1"
                      title="클릭하여 발송될 문자 전문 미리보기"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0 pr-5">
                          <span
                            className={`text-[11px] font-bold px-1.5 py-0.5 rounded shadow-sm border truncate max-w-[72px] shrink-0 ${getBadgeColor(
                              msg.preview_title
                            )}`}
                          >
                            {msg.preview_title}
                          </span>
                          <span className="text-xs font-bold text-slate-700 shrink-0">
                            {msg.student_name}
                          </span>
                          <span className="text-xs text-indigo-500 font-bold truncate">
                            {msg.parent_name}
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium shrink-0">
                            {msg.parent_phone}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-400 pr-5 shrink-0">
                          {msg.time_string || ""}
                        </span>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const res = await deleteQueueItem(msg.queue_id);
                            if (!res.success) alert(`삭제 실패: ${res.message}`);
                            fetchQueue();
                          }}
                          className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-rose-100 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 font-bold shrink-0 absolute right-1.5 top-1.5"
                          title="대기열에서 제외"
                        >
                          ×
                        </button>
                      </div>

                      {(msg.preview_desc || msg.details) && (
                        <div
                          className="bg-slate-50 px-2 py-1 rounded text-[11px] text-slate-600 border border-slate-100 line-clamp-1 leading-snug"
                          title={msg.details || msg.preview_desc}
                        >
                          {msg.preview_desc || msg.details}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 bg-white border-t border-slate-200 shrink-0">
              <button
                type="button"
                onClick={handleSendQueuedMessages}
                disabled={queuedMessages.length === 0 || isSendingAlimtalk}
                className="w-full py-2 bg-[#fef01b] hover:bg-[#eade16] disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-400 text-[#3a2929] text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                {isSendingAlimtalk ? (
                  <>
                    발송 중... <span className="animate-spin">⏳</span>
                  </>
                ) : (
                  <>🚀 {queuedMessages.length}건 전체 발송</>
                )}
              </button>
            </div>
          </div>

          {/* 우측 하단: 최근 발송 목록 */}
          <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span>🔔 최근 발송 목록</span>
                <span className="relative flex h-2 w-2 ml-0.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </h3>
              {isSuperAdmin && liveFeeds.length > 0 && (
                <button
                  type="button"
                  onClick={clearNotificationLogs}
                  className="text-[11px] text-slate-400 hover:text-rose-500 font-bold transition-colors"
                >
                  전체 비우기
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll bg-white relative">
              {liveFeeds.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 font-bold text-xs py-8">
                  최근 발송 내역이 없습니다.
                </div>
              ) : (
                <div className="flex flex-col">
                  {liveFeeds.map((feed: any, idx: number) => {
                    const dateObj = new Date(feed.created_at);
                    const days = ["일", "월", "화", "수", "목", "금", "토"];
                    const currentDateStr = `${dateObj.getFullYear()}-${String(
                      dateObj.getMonth() + 1
                    ).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
                    const displayDateStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 (${
                      days[dateObj.getDay()]
                    })`;
                    const timeStr = dateObj.toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });

                    let showSeparator = false;
                    if (idx === 0) {
                      showSeparator = true;
                    } else {
                      const prevDateObj = new Date(liveFeeds[idx - 1].created_at);
                      const prevDateStr = `${prevDateObj.getFullYear()}-${String(
                        prevDateObj.getMonth() + 1
                      ).padStart(2, "0")}-${String(prevDateObj.getDate()).padStart(2, "0")}`;
                      if (currentDateStr !== prevDateStr) {
                        showSeparator = true;
                      }
                    }

                    const fullMsg = feed.message_content || feed.content || "";
                    const match = fullMsg.match(/^\[(.*?)\]/);
                    const categoryName = match ? match[1] : "알림";
                    const descText = match ? fullMsg.replace(/^\[.*?\]\s*/, "") : fullMsg;
                    const badgeColorClass = getBadgeColor(fullMsg);
                    const isSuccess = feed.status === "성공";

                    return (
                      <React.Fragment key={feed.noti_log_id || idx}>
                        {showSeparator && (
                          <div className="bg-slate-100/70 px-3 py-1 border-y border-slate-200 flex items-center gap-1.5 sticky top-0 z-10 backdrop-blur-sm">
                            <span className="text-[11px] font-bold text-slate-500">
                              📅 {displayDateStr}
                            </span>
                          </div>
                        )}
                        <div
                          onClick={() => setSelectedLogItem(feed)}
                          className="px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors flex flex-col gap-0.5 text-xs w-full group relative cursor-pointer"
                          title="클릭하여 발송 내용 상세 보기"
                        >
                          <div className="flex items-center justify-between gap-1.5 pr-4">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`text-xs font-bold shrink-0 ${
                                  isSuccess ? "text-emerald-500" : "text-rose-500"
                                }`}
                              >
                                {isSuccess ? "✓" : "✗"}
                              </span>
                              <span
                                className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${badgeColorClass} shrink-0`}
                              >
                                {categoryName}
                              </span>
                              <span className="font-bold text-slate-700 truncate">
                                {feed.target_name || feed.student_name || "학부모"}
                              </span>
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 shrink-0 whitespace-nowrap">
                              {timeStr}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate pl-4 pr-4">
                            {descText.replace(/\n+/g, " ")}
                          </div>

                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotificationLog(feed.noti_log_id);
                              }}
                              className="absolute right-2 top-2 bg-white text-slate-300 hover:bg-rose-100 hover:text-rose-500 font-bold rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm border border-slate-200 hover:border-rose-300"
                              title="기록 삭제"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 발송 대기열 메시지 상세 미리보기 모달 */}
      {previewQueueIdx !== null &&
        queuedMessages[previewQueueIdx] &&
        (() => {
          const msg = queuedMessages[previewQueueIdx];
          const isGeneralSms = msg.template_id === "GENERAL_SMS";
          const displayParentName = formatParentDisplayName(
            msg.parent_name,
            "학부모",
            msg.student_name
          );
          const rawDetails = String(msg.details || "")
            .trim()
            .replace(/\(\s*\)/g, "").replace(/\s*학부모\s*(\([^)]+\))\s*학부모님/g, "$1 학부모님");
          const isPreformattedSms =
            rawDetails.startsWith("[로지카대치본원학원] 보강 안내") ||
            rawDetails.includes("학부모님,");
          const cleanedDetails = rawDetails.replace(/^\[로지카대치본원학원\]\s*/, "");

          const fullSmsText = isPreformattedSms
            ? `${rawDetails}\n\n━━━━━━━━━━━━━━\n📱 [자녀 학습 현황 / 학부모 포탈]\n👉 https://www.logicaclass.com/p\n━━━━━━━━━━━━━━\n\n문의: 02-555-8875`
            : `[로지카대치본원학원]\n\n${displayParentName} 학부모님,\n\n${cleanedDetails}\n\n━━━━━━━━━━━━━━\n📱 [자녀 학습 현황 / 학부모 포탈]\n👉 https://www.logicaclass.com/p\n━━━━━━━━━━━━━━\n\n문의: 02-555-8875`;

          return (
            <div
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
              onClick={() => setPreviewQueueIdx(null)}
            >
              <div
                className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-slate-800 px-5 py-4 text-white flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🔍</span>
                    <div>
                      <h3 className="font-bold text-sm">
                        발송 대기열 메시지 미리보기 ({previewQueueIdx + 1} /{" "}
                        {queuedMessages.length})
                      </h3>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        {isGeneralSms
                          ? "일반 문자(SMS/LMS) 발송 예정"
                          : "카카오 알림톡 템플릿 발송 예정"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPreviewQueueIdx(null)}
                    className="text-slate-300 hover:text-white text-2xl font-bold leading-none"
                  >
                    &times;
                  </button>
                </div>

                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-bold px-2 py-0.5 rounded border ${getBadgeColor(
                        msg.preview_title
                      )}`}
                    >
                      {msg.preview_title}
                    </span>
                    <span className="font-bold text-slate-800">{msg.student_name}</span>
                    <span className="font-bold text-indigo-600">{displayParentName}</span>
                  </div>
                  <span className="font-bold text-slate-500">{msg.parent_phone}</span>
                </div>

                <div className="p-5 bg-[#b2c7d9] max-h-[60vh] overflow-y-auto custom-scroll">
                  <div className="bg-white rounded-2xl p-4 shadow-md border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-medium">
                    <div className="text-[11px] font-bold text-slate-400 border-b border-slate-100 pb-1.5 mb-2 flex justify-between">
                      <span>✉️ 문자 메시지 (LMS)</span>
                      <span>발신: 02-555-8875</span>
                    </div>
                    {isGeneralSms ? fullSmsText : msg.details || msg.preview_desc || "-"}
                  </div>
                </div>

                <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={previewQueueIdx <= 0}
                      onClick={() =>
                        setPreviewQueueIdx((prev) =>
                          prev !== null && prev > 0 ? prev - 1 : prev
                        )
                      }
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      ◀ 이전
                    </button>
                    <button
                      type="button"
                      disabled={previewQueueIdx >= queuedMessages.length - 1}
                      onClick={() =>
                        setPreviewQueueIdx((prev) =>
                          prev !== null && prev < queuedMessages.length - 1
                            ? prev + 1
                            : prev
                        )
                      }
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      다음 ▶
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await deleteQueueItem(msg.queue_id);
                        if (!res.success) {
                          alert(`삭제 실패: ${res.message}`);
                          return;
                        }
                        await fetchQueue();
                        if (queuedMessages.length <= 1) {
                          setPreviewQueueIdx(null);
                        } else if (previewQueueIdx >= queuedMessages.length - 1) {
                          setPreviewQueueIdx(Math.max(0, queuedMessages.length - 2));
                        }
                      }}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold rounded-lg transition-colors"
                    >
                      이 항목 삭제
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewQueueIdx(null)}
                      className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* 최근 발송 목록 상세 보기 모달 */}
      {selectedLogItem && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
          onClick={() => setSelectedLogItem(null)}
        >
          <div
            className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-800 px-5 py-4 text-white flex justify-between items-center shrink-0">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span>🔔</span>
                <span>발송 완료 메시지 상세</span>
              </h3>
              <button
                onClick={() => setSelectedLogItem(null)}
                className="text-slate-300 hover:text-white text-2xl font-bold leading-none"
              >
                &times;
              </button>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800">
                {selectedLogItem.target_name || "학부모"}
              </span>
              <span className="font-bold text-slate-500">
                {selectedLogItem.target_phone || ""}
              </span>
            </div>
            <div className="p-5 bg-slate-100 max-h-[60vh] overflow-y-auto custom-scroll">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-medium">
                {selectedLogItem.message_content || selectedLogItem.content || "-"}
              </div>
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLogItem(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <MakeupModal
        isOpen={isModalOpen}
        makeupData={selectedMakeup}
        students={students}
        initialClassId={modalClassId}
        instructors={instructors}
        onClose={() => {
          setIsModalOpen(false);
          setModalClassId(null);
        }}
        onSuccess={() => {
          fetchInitialData();
          fetchQueue();
        }}
      />
    </div>
  );
}