// src/app/hq/members/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import CertificatePrintModal from "@/components/hq/members/CertificatePrintModal";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import MemberFormModal from "@/components/hq/members/MemberFormModal";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import { getRankMeta, HQ_RANK_LIST } from "@/lib/hq/constants";
import type {
  HqHrLifecycleState,
  HqInviteCandidateItem,
  HqMember,
  HqPersonnelAppointmentItem,
  HqRankCode,
  HqWorkStatus,
} from "@/lib/hq/types";

const DEFAULT_LIFECYCLE_STATE: HqHrLifecycleState = {
  onboarding_templates: [
    "근로 · 연봉 전자계약서 서명",
    "급여 계좌 및 주민등록등본 제출",
    "사내 워크스페이스 · 캘린더 연결",
    "본부 보안 · 출판 업무 가이드 확인",
  ],
  offboarding_templates: [
    "담당 원고 · 업무 인수인계 및 자산 반납",
    "퇴직 정산 및 사내 계정 회수 확인",
  ],
  completed_checks: {},
  appointments: [],
  invitations: [],
};

const APPOINTMENT_LABELS = [
  "부서 이동 (전보)",
  "승진",
  "직책 변경",
  "직무 변경",
  "수습 종료",
  "휴직",
  "복직",
  "퇴직",
];

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

function avatarColor(name: string): string {
  if (name === "천종현") return "#8da2fb";
  if (name === "김근식") return "#2dd4bf";
  if (name === "이웅행") return "#fbbf24";
  const palette = [
    "#4ade80",
    "#fb923c",
    "#38bdf8",
    "#f87171",
    "#a78bfa",
    "#2dd4bf",
  ];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return palette[sum % palette.length];
}

function formatDotDate(iso?: string | null): string {
  if (!iso) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}. ${Number(m[2])}. ${Number(m[3])}`;
}

function formatKoreanDateWithDow(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${
    days[d.getDay()]
  })`;
}

function formatKoreanDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const hr24 = d.getHours();
  const ampm = hr24 < 12 ? "오전" : "오후";
  const hr12 = hr24 % 12 === 0 ? 12 : hr24 % 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${
    days[d.getDay()]
  }) ${ampm} ${hr12}:${min}`;
}

function calcTenureText(hireDate?: string | null, asOfIso?: string): string {
  if (!hireDate) return "-";
  const start = new Date(`${hireDate.slice(0, 10)}T00:00:00`);
  const end = asOfIso
    ? new Date(`${asOfIso.slice(0, 10)}T00:00:00`)
    : new Date();
  if (Number.isNaN(start.getTime()) || end < start) return "1개월 미만";
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months = Math.max(0, months - 1);
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  if (yrs > 0 && rem > 0) return `${yrs}년 ${rem}개월`;
  if (yrs > 0) return `${yrs}년`;
  return `${Math.max(1, rem)}개월`;
}

export default function HqMembersPage() {
  const router = useRouter();
  const {
    instId,
    me,
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshMembers,
    refreshCompanySettings,
  } = useHqShell();

  const canManage = isHrManager || isHqAdmin;
  const companyName = companySettings?.company_name || "(주)천종현수학연구소";
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // 상단 메인 모드 탭: 구성원(디렉토리) | 구성원 관리 | 인사 정보 관리
  // (조직도는 좌측 사이드바 '/hq/org-chart' 메뉴로 완전히 분리!)
  const [topTab, setTopTab] = useState<"DIRECTORY" | "MANAGE" | "APPOINTMENT">(
    "DIRECTORY"
  );

  // 1) 구성원 디렉토리 탭 상태 (스크린샷 203551)
  const [dirSearchOpen, setDirSearchOpen] = useState(false);
  const [dirKeyword, setDirKeyword] = useState("");
  const [dirDeptFilter, setDirDeptFilter] = useState("ALL");
  const [dirSort, setDirSort] = useState<"NAME" | "HIRE" | "DEPT">("NAME");
  const [dirFilterPopover, setDirFilterPopover] = useState(false);

  // 2) 구성원 관리 탭 상태 (스크린샷 203626 ~ 203655)
  const [manageSubTab, setManageSubTab] = useState<
    "ALL" | "ONBOARDING" | "OFFBOARDING" | "INVITE"
  >("ALL");
  const [manageKeyword, setManageKeyword] = useState("");
  const [manageSearchOpen, setManageSearchOpen] = useState(false);
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [selectedStatuses, setSelectedStatuses] = useState<HqWorkStatus[]>([
    "재직",
    "휴직",
  ]);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [manageDeptFilter, setManageDeptFilter] = useState("ALL");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  // 초대 현황 필터
  const [inviteStatusFilter, setInviteStatusFilter] = useState<
    "ALL" | "초대 전" | "가입 대기 중" | "정보 입력 중"
  >("ALL");
  const [inviteKeyword, setInviteKeyword] = useState("");
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState({
    name: "",
    email: "",
    department: "집필팀",
    job_title: "사원",
    hire_date: todayIso,
    status: "가입 대기 중" as HqInviteCandidateItem["status"],
  });

  // 체크리스트 모달 상태 (온보딩/오프보딩 개별 진행 & 템플릿 편집)
  const [checklistTarget, setChecklistTarget] = useState<{
    mode: "ONBOARD" | "OFFBOARD";
    member: HqMember;
  } | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [onboardTplDraft, setOnboardTplDraft] = useState<string[]>([]);
  const [offboardTplDraft, setOffboardTplDraft] = useState<string[]>([]);
  const [newTplText, setNewTplText] = useState("");

  // 3) 인사 정보 관리 탭 상태 (스크린샷 203940, 203955)
  const [hrSubTab, setHrSubTab] = useState<"HISTORY" | "BULK">("HISTORY");
  const [appointSortDesc, setAppointSortDesc] = useState(true);
  const [appointFilterLabel, setAppointFilterLabel] = useState("ALL");

  // 인사 발령하기 2단계 모달 (Step 1: 발령 정보 설정 203955 -> Step 2: 상세 변경)
  const [appointModalStep, setAppointModalStep] = useState<0 | 1 | 2>(0);
  const [appointDraft, setAppointDraft] = useState({
    effective_date: todayIso,
    target_member_id: "",
    appointment_label: "",
    memo: "",
    next_department: "",
    next_rank_code: "STAFF" as HqRankCode,
    next_job_title: "",
    next_is_dept_head: false,
    next_work_status: "재직" as HqWorkStatus,
  });
  const [savingAppoint, setSavingAppoint] = useState(false);

  // 정보 일괄 변경 상태
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkTargetDept, setBulkTargetDept] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // 기존 모달들 (등록/편집, 프로필 상세, 증명서 출력)
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingMember, setEditingMember] = useState<HqMember | null>(null);
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [certMember, setCertMember] = useState<HqMember | null>(null);

  const lifecycle: HqHrLifecycleState = useMemo(() => {
    const raw = companySettings?.extra_settings?.hr_lifecycle_state;
    return {
      onboarding_templates:
        Array.isArray(raw?.onboarding_templates) &&
        raw!.onboarding_templates.length > 0
          ? raw!.onboarding_templates
          : DEFAULT_LIFECYCLE_STATE.onboarding_templates,
      offboarding_templates:
        Array.isArray(raw?.offboarding_templates) &&
        raw!.offboarding_templates.length > 0
          ? raw!.offboarding_templates
          : DEFAULT_LIFECYCLE_STATE.offboarding_templates,
      completed_checks: raw?.completed_checks || {},
      appointments: Array.isArray(raw?.appointments) ? raw!.appointments : [],
      invitations: Array.isArray(raw?.invitations) ? raw!.invitations : [],
    };
  }, [companySettings?.extra_settings?.hr_lifecycle_state]);

  const saveLifecyclePatch = async (partial: Partial<HqHrLifecycleState>) => {
    const nextState: HqHrLifecycleState = {
      ...lifecycle,
      ...partial,
    };
    await hqFetch("/api/hq/settings", {
      method: "PATCH",
      body: {
        extra_settings: {
          ...companySettings.extra_settings,
          hr_lifecycle_state: nextState,
        },
      },
    });
    await refreshCompanySettings();
  };

  const existingDepartments = useMemo(() => {
    const set = new Set<string>();
    (companySettings?.extra_settings?.org_chart_nodes || [])
      .filter((n) => !n.is_hidden && n.parent_id !== null)
      .forEach((n) => set.add(n.name));
    members.forEach((m) => {
      if (m.department && m.department !== "미지정") set.add(m.department);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [members, companySettings?.extra_settings?.org_chart_nodes]);

  const activeProfileMember = useMemo(
    () => members.find((m) => m.instructor_id === profileTargetId) || null,
    [members, profileTargetId]
  );

  // 1) 디렉토리 목록 필터·정렬
  const directoryList = useMemo(() => {
    const kw = dirKeyword.trim().toLowerCase();
    const list = members.filter((m) => {
      if (m.work_status === "퇴직") return false;
      if (dirDeptFilter !== "ALL" && m.department !== dirDeptFilter) {
        return false;
      }
      if (kw) {
        const hay = `${m.name} ${m.department} ${m.job_title} ${
          m.job_description || ""
        } ${m.phone || ""} ${m.email || ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (dirSort === "HIRE") {
        return String(a.hire_date || "").localeCompare(String(b.hire_date || ""));
      }
      if (dirSort === "DEPT") {
        return (
          String(a.department || "").localeCompare(
            String(b.department || ""),
            "ko"
          ) || a.name.localeCompare(b.name, "ko")
        );
      }
      return a.name.localeCompare(b.name, "ko");
    });
  }, [members, dirDeptFilter, dirKeyword, dirSort]);

  // 2) 구성원 관리 > 전체 테이블 목록
  const managedMembers = useMemo(() => {
    const kw = manageKeyword.trim().toLowerCase();
    return members
      .filter((m) => {
        if (m.hire_date && m.hire_date > asOfDate) return false;
        if (
          selectedStatuses.length > 0 &&
          !selectedStatuses.includes(m.work_status)
        ) {
          return false;
        }
        if (manageDeptFilter !== "ALL" && m.department !== manageDeptFilter) {
          return false;
        }
        if (kw) {
          const hay = `${m.name} ${m.employee_no} ${m.department} ${m.job_title} ${m.email} ${m.phone}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [members, asOfDate, selectedStatuses, manageDeptFilter, manageKeyword]);

  // 온보딩 중 vs 온보딩 완료 분류 (최근 120일 이내 입사 & 미완료 체크항목 존재 시 온보딩 중)
  const onboardingSplit = useMemo(() => {
    const totalTasks = lifecycle.onboarding_templates.length;
    const active = members
      .filter((m) => m.work_status !== "퇴직")
      .sort((a, b) =>
        String(b.hire_date || "").localeCompare(String(a.hire_date || ""))
      );

    const inProgress: { member: HqMember; doneCount: number }[] = [];
    const completed: HqMember[] = [];

    active.forEach((m) => {
      const doneArr =
        lifecycle.completed_checks[`ONBOARD:${m.name}`] || [];
      const hireMs = m.hire_date
        ? new Date(`${m.hire_date}T00:00:00`).getTime()
        : 0;
      const isRecentHire =
        hireMs > 0 && Date.now() - hireMs <= 120 * 24 * 3600 * 1000;

      if (isRecentHire && doneArr.length < totalTasks) {
        inProgress.push({ member: m, doneCount: doneArr.length });
      } else {
        completed.push(m);
      }
    });

    return { inProgress, completed, totalTasks };
  }, [members, lifecycle]);

  // 오프보딩 중 vs 오프보딩 완료 분류
  const offboardingSplit = useMemo(() => {
    const totalTasks = lifecycle.offboarding_templates.length;
    const resigned = members
      .filter((m) => m.work_status === "퇴직")
      .sort((a, b) =>
        String(b.resign_date || "").localeCompare(String(a.resign_date || ""))
      );

    const inProgress: { member: HqMember; doneCount: number }[] = [];
    const completed: HqMember[] = [];

    resigned.forEach((m) => {
      const doneArr =
        lifecycle.completed_checks[`OFFBOARD:${m.name}`] || [];
      if (doneArr.length < totalTasks) {
        inProgress.push({ member: m, doneCount: doneArr.length });
      } else {
        completed.push(m);
      }
    });

    return { inProgress, completed, totalTasks };
  }, [members, lifecycle]);

  // 3) 인사 발령 통합 타임라인 (저장된 발령 기록 + 구성원 입사 생성 이력 자동 결합)
  const mergedAppointments: HqPersonnelAppointmentItem[] = useMemo(() => {
    const list: HqPersonnelAppointmentItem[] = [...lifecycle.appointments];

    // 구성원 입사 '정보 생성' 및 change_logs 이력 결합
    members.forEach((m) => {
      if (m.hire_date) {
        const autoId = `seed-create-${m.instructor_id}`;
        if (!list.some((x) => x.id === autoId)) {
          list.push({
            id: autoId,
            event_type: "정보 생성",
            status: "완료",
            actor_name: "김근식",
            acted_at: `${m.hire_date}T09:30:00+09:00`,
            effective_date: m.hire_date,
            target_member_id: m.instructor_id,
            target_member_name: m.name,
            appointment_label: "신규 입사",
            summary: `${m.department} · ${m.job_title} 입사 정보 생성`,
          });
        }
      }
    });

    const filtered =
      appointFilterLabel === "ALL"
        ? list
        : list.filter(
            (x) =>
              x.event_type === appointFilterLabel ||
              x.appointment_label === appointFilterLabel
          );

    return filtered.sort((a, b) => {
      const diff =
        new Date(b.acted_at).getTime() - new Date(a.acted_at).getTime();
      return appointSortDesc ? diff : -diff;
    });
  }, [lifecycle.appointments, members, appointFilterLabel, appointSortDesc]);

  // 인사 발령 모달 열기
  const openAppointmentModal = () => {
    setAppointDraft({
      effective_date: todayIso,
      target_member_id: "",
      appointment_label: "",
      memo: "",
      next_department: "",
      next_rank_code: "STAFF",
      next_job_title: "",
      next_is_dept_head: false,
      next_work_status: "재직",
    });
    setAppointModalStep(1);
  };

  const handleProceedAppointStep2 = () => {
    const found = members.find(
      (m) => m.instructor_id === appointDraft.target_member_id
    );
    if (!found) {
      alert("발령 대상을 선택해주세요.");
      return;
    }
    setAppointDraft({
      ...appointDraft,
      next_department: found.department || "",
      next_rank_code: found.rank_code,
      next_job_title: found.job_title || "",
      next_is_dept_head: Boolean(found.is_dept_head),
      next_work_status:
        appointDraft.appointment_label === "휴직"
          ? "휴직"
          : appointDraft.appointment_label === "퇴직"
            ? "퇴직"
            : appointDraft.appointment_label === "복직"
              ? "재직"
              : found.work_status,
    });
    setAppointModalStep(2);
  };

  const handleExecuteAppointment = async () => {
    const found = members.find(
      (m) => m.instructor_id === appointDraft.target_member_id
    );
    if (!found) return;

    setSavingAppoint(true);
    try {
      const summaryParts: string[] = [];
      if (appointDraft.next_department !== found.department) {
        summaryParts.push(
          `부서(${found.department} → ${appointDraft.next_department})`
        );
      }
      if (appointDraft.next_job_title !== found.job_title) {
        summaryParts.push(
          `직위/직책(${found.job_title} → ${appointDraft.next_job_title})`
        );
      }
      if (appointDraft.next_work_status !== found.work_status) {
        summaryParts.push(
          `재직상태(${found.work_status} → ${appointDraft.next_work_status})`
        );
      }

      const summary =
        summaryParts.join(", ") ||
        appointDraft.appointment_label ||
        "인사 발령 적용";

      await hqFetch("/api/hq/members", {
        method: "PATCH",
        body: {
          instructor_id: found.instructor_id,
          department: appointDraft.next_department,
          rank_code: appointDraft.next_rank_code,
          job_title: appointDraft.next_job_title,
          is_dept_head: appointDraft.next_is_dept_head,
          work_status: appointDraft.next_work_status,
          resign_date:
            appointDraft.next_work_status === "퇴직"
              ? appointDraft.effective_date
              : null,
          change_summary: `[인사발령${
            appointDraft.appointment_label
              ? ` · ${appointDraft.appointment_label}`
              : ""
          }] ${summary}`,
        },
      });

      const record: HqPersonnelAppointmentItem = {
        id: `apt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        event_type: "인사 정보 변경",
        status: "완료",
        actor_name: me?.name || "인사관리자",
        acted_at: new Date().toISOString(),
        effective_date: appointDraft.effective_date,
        target_member_id: found.instructor_id,
        target_member_name: found.name,
        appointment_label: appointDraft.appointment_label || "인사 변경",
        memo: appointDraft.memo,
        summary,
      };

      await saveLifecyclePatch({
        appointments: [record, ...lifecycle.appointments],
      });
      await refreshMembers();
      setAppointModalStep(0);
    } catch (err: any) {
      alert(err?.message || "인사 발령 적용 실패");
    } finally {
      setSavingAppoint(false);
    }
  };

  const handleBulkDepartmentUpdate = async () => {
    if (bulkSelectedIds.length === 0 || !bulkTargetDept.trim()) {
      alert("변경할 구성원과 이동할 부서를 선택해주세요.");
      return;
    }
    setBulkSaving(true);
    try {
      for (const id of bulkSelectedIds) {
        await hqFetch("/api/hq/members", {
          method: "PATCH",
          body: {
            instructor_id: id,
            department: bulkTargetDept.trim(),
            change_summary: `부서 일괄 변경 (${bulkTargetDept.trim()})`,
          },
        });
      }
      await refreshMembers();
      setBulkSelectedIds([]);
      alert(`${bulkSelectedIds.length}명의 소속 부서가 변경되었습니다.`);
    } catch (err: any) {
      alert(err?.message || "일괄 변경 중 오류 발생");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleExportMembersCsv = () => {
    const headers = [
      "이름",
      "재직상태",
      "사번",
      "입사일",
      "근속기간",
      "이메일",
      "휴대전화번호",
      "소속부서",
      "직책/직위",
    ];
    const rows = managedMembers.map((m) => [
      m.name,
      m.work_status,
      m.employee_no,
      m.hire_date || "",
      calcTenureText(m.hire_date, asOfDate),
      m.email,
      m.phone,
      m.department,
      m.job_title,
    ]);
    const csv =
      "\uFEFF" +
      [headers, ...rows]
        .map((r) =>
          r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
        )
        .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `HQ_구성원명부_${todayIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderMemberAvatar = (m: HqMember) => {
    const photoUrl = resolveStoragePublicUrl(m.profile_image_url);
    if (photoUrl) {
      return (
        <img
          src={photoUrl}
          alt={m.name}
          className="w-8 h-8 rounded-xl object-cover shrink-0 border border-slate-200"
        />
      );
    }
    return (
      <span
        style={{ backgroundColor: avatarColor(m.name) }}
        className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center shrink-0"
      >
        {shortAvatarText(m.name)}
      </span>
    );
  };

  const formatRightOrgRolePill = (m: HqMember): string => {
    const dept = m.rank_code === "CEO" ? "대표" : m.department || "본부";
    const title = m.job_title || getRankMeta(m.rank_code).defaultTitle;
    if (!dept || dept === "미지정") return title;
    return `${dept} · ${title}`;
  };

  return (
    <>
      <div
        onClick={() => {
          if (dirFilterPopover) setDirFilterPopover(false);
          if (statusFilterOpen) setStatusFilterOpen(false);
          if (addDropdownOpen) setAddDropdownOpen(false);
        }}
        className="flex-1 flex flex-col min-h-0 bg-white"
      >
        {/* =============================================================== */}
        {/* 상단 타이틀 탭 바 (구성원 | 구성원 관리 | 인사 정보 관리)        */}
        {/* =============================================================== */}
        <div className="px-8 pt-6 pb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setTopTab("DIRECTORY")}
              className={`text-[22px] font-extrabold tracking-tight transition-colors ${
                topTab === "DIRECTORY"
                  ? "text-slate-900"
                  : "text-slate-300 hover:text-slate-500"
              }`}
            >
              구성원
            </button>

            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setTopTab("MANAGE")}
                  className={`text-[22px] font-extrabold tracking-tight transition-colors ${
                    topTab === "MANAGE"
                      ? "text-slate-900"
                      : "text-slate-300 hover:text-slate-500"
                  }`}
                >
                  구성원 관리
                </button>
                <button
                  type="button"
                  onClick={() => setTopTab("APPOINTMENT")}
                  className={`text-[22px] font-extrabold tracking-tight transition-colors ${
                    topTab === "APPOINTMENT"
                      ? "text-slate-900"
                      : "text-slate-300 hover:text-slate-500"
                  }`}
                >
                  인사 정보 관리
                </button>
              </>
            )}
          </div>

          {/* 우상단 메인 액션 버튼 */}
          <div
            className="flex items-center gap-2 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {topTab === "MANAGE" &&
              (manageSubTab === "ONBOARDING" ||
                manageSubTab === "OFFBOARDING") &&
              canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setOnboardTplDraft([...lifecycle.onboarding_templates]);
                    setOffboardTplDraft([...lifecycle.offboarding_templates]);
                    setNewTplText("");
                    setTemplateModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
                >
                  체크리스트 템플릿
                </button>
              )}

            {topTab === "MANAGE" && canManage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddDropdownOpen((p) => !p)}
                  className="px-4 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-xs flex items-center gap-2"
                >
                  <span>+ 구성원 추가하기</span>
                  <span className="text-[10px]">▾</span>
                </button>

                {addDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-[190px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setAddDropdownOpen(false);
                        setFormMode("create");
                        setEditingMember(null);
                        setFormOpen(true);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-bold text-slate-800"
                    >
                      👤 구성원 직접 등록
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddDropdownOpen(false);
                        setInviteModalOpen(true);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-bold text-slate-700"
                    >
                      ✉️ 입사 예정자 초대 등록
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddDropdownOpen(false);
                        handleExportMembersCsv();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-600"
                    >
                      ⬇️ 구성원 명부 CSV 다운로드
                    </button>
                  </div>
                )}
              </div>
            )}

            {topTab === "APPOINTMENT" && canManage && (
              <button
                type="button"
                onClick={openAppointmentModal}
                className="px-4 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-xs flex items-center gap-1.5"
              >
                <span>✏️</span>
                <span>인사 발령하기</span>
              </button>
            )}
          </div>
        </div>

        {/* =============================================================== */}
        {/* VIEW 1: 구성원 디렉토리 (스크린샷 203551 동일)                  */}
        {/* =============================================================== */}
        {topTab === "DIRECTORY" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-8 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-5 overflow-x-auto no-scrollbar text-xs">
                <button
                  type="button"
                  onClick={() => setDirDeptFilter("ALL")}
                  className={`py-3 border-b-2 whitespace-nowrap transition-colors ${
                    dirDeptFilter === "ALL"
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  전체
                </button>
                {existingDepartments.map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setDirDeptFilter(dept)}
                    className={`py-3 border-b-2 whitespace-nowrap transition-colors ${
                      dirDeptFilter === dept
                        ? "border-slate-900 text-slate-900 font-extrabold"
                        : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>

              <div
                className="flex items-center gap-3 text-xs text-slate-500 shrink-0 py-2"
                onClick={(e) => e.stopPropagation()}
              >
                {dirSearchOpen && (
                  <input
                    autoFocus
                    value={dirKeyword}
                    onChange={(e) => setDirKeyword(e.target.value)}
                    placeholder="이름 · 부서 · 직무 검색"
                    className="px-3 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-[#00c458]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDirSearchOpen((p) => !p);
                    if (dirSearchOpen) setDirKeyword("");
                  }}
                  className="hover:text-slate-800"
                  title="검색"
                >
                  🔍
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/hq/org-chart")}
                  className="hover:text-slate-800 font-bold"
                  title="조직도 페이지로 이동"
                >
                  品
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDirSort((prev) =>
                      prev === "NAME"
                        ? "DEPT"
                        : prev === "DEPT"
                          ? "HIRE"
                          : "NAME"
                    )
                  }
                  className="hover:text-slate-800 font-semibold flex items-center gap-1"
                >
                  <span>⇅</span>
                  <span>
                    {dirSort === "NAME"
                      ? "정렬"
                      : dirSort === "DEPT"
                        ? "부서순"
                        : "입사일순"}
                  </span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDirFilterPopover((p) => !p)}
                    className="hover:text-slate-800 font-semibold flex items-center gap-1"
                  >
                    <span>≡</span>
                    <span>필터</span>
                  </button>
                  {dirFilterPopover && (
                    <div className="absolute right-0 top-full mt-1.5 w-[160px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setDirDeptFilter("ALL");
                          setDirFilterPopover(false);
                        }}
                        className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 font-bold text-slate-700"
                      >
                        전체 부서 보기
                      </button>
                      {existingDepartments.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setDirDeptFilter(d);
                            setDirFilterPopover(false);
                          }}
                          className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 text-slate-600"
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 디렉토리 리스트 본문 */}
            <div className="flex-1 overflow-y-auto custom-scroll px-8 divide-y divide-slate-100">
              {directoryList.map((m) => (
                <div
                  key={m.instructor_id}
                  onClick={() => setProfileTargetId(m.instructor_id)}
                  className="py-4 hover:bg-slate-50/70 flex items-center justify-between gap-4 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {renderMemberAvatar(m)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-bold text-slate-900">
                          {m.name}
                        </span>
                        {m.rank_code === "CEO" && (
                          <span className="text-amber-500 text-xs">✪</span>
                        )}
                      </div>
                      {m.job_description && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {m.job_description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(m.instructor_id === instId || canManage) && (
                      <button
                        type="button"
                        onClick={() => setCertMember(m)}
                        className="opacity-0 group-hover:opacity-100 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-600 transition-opacity"
                      >
                        📄 증명서
                      </button>
                    )}
                    <span
                      onClick={() => setProfileTargetId(m.instructor_id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200/90 bg-white text-xs text-slate-500 font-medium"
                    >
                      {formatRightOrgRolePill(m)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =============================================================== */}
        {/* VIEW 2: 구성원 관리 (전체 | 입사 | 퇴사 | 초대 현황)            */}
        {/* =============================================================== */}
        {topTab === "MANAGE" && canManage && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 서브 탭 바 */}
            <div className="px-8 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs">
                {(
                  [
                    { key: "ALL", label: "전체" },
                    { key: "ONBOARDING", label: "입사" },
                    { key: "OFFBOARDING", label: "퇴사" },
                    { key: "INVITE", label: "초대 현황" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setManageSubTab(t.key)}
                    className={`py-3 border-b-2 transition-colors ${
                      manageSubTab === t.key
                        ? "border-slate-900 text-slate-900 font-extrabold"
                        : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500 py-2">
                {manageSearchOpen && (
                  <input
                    autoFocus
                    value={manageKeyword}
                    onChange={(e) => setManageKeyword(e.target.value)}
                    placeholder="이름 · 사번 · 이메일 검색"
                    className="px-3 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setManageSearchOpen((p) => !p);
                    if (manageSearchOpen) setManageKeyword("");
                  }}
                >
                  🔍
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/hq/org-chart")}
                  title="조직도 관리로 이동"
                >
                  品
                </button>
              </div>
            </div>

            {/* 2-A: 전체 스프레드시트 테이블 (스크린샷 203626 동일) */}
            {manageSubTab === "ALL" && (
              <div className="flex-1 flex flex-col min-h-0">
                <div
                  className="px-8 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-600 flex items-center gap-1.5">
                      <span>📅 기준일</span>
                      <input
                        type="date"
                        value={asOfDate}
                        onChange={(e) =>
                          setAsOfDate(e.target.value || todayIso)
                        }
                        className="font-bold text-slate-900 focus:outline-none"
                      />
                    </label>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setStatusFilterOpen((p) => !p)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-600 flex items-center gap-1"
                      >
                        <span>🪪 재직 상태</span>
                        <b className="text-slate-900">
                          {selectedStatuses.join("·")}
                        </b>
                      </button>

                      {statusFilterOpen && (
                        <div className="absolute left-0 top-full mt-1 w-[140px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                          {(["재직", "휴직", "퇴직"] as HqWorkStatus[]).map(
                            (st) => (
                              <label
                                key={st}
                                className="px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedStatuses.includes(st)}
                                  onChange={() =>
                                    setSelectedStatuses((prev) =>
                                      prev.includes(st)
                                        ? prev.filter((x) => x !== st)
                                        : [...prev, st]
                                    )
                                  }
                                  className="rounded border-slate-300"
                                />
                                <span className="font-semibold text-slate-700">
                                  {st}
                                </span>
                              </label>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    <select
                      value={manageDeptFilter}
                      onChange={(e) => setManageDeptFilter(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 focus:outline-none"
                    >
                      <option value="ALL">+ 부서 필터 (전체)</option>
                      {existingDepartments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-bold text-slate-600">
                      {managedMembers.length}명
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAsOfDate(todayIso);
                        setSelectedStatuses(["재직", "휴직"]);
                        setManageDeptFilter("ALL");
                        setManageKeyword("");
                      }}
                      className="px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                    >
                      초기화
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMembersCsv}
                      className="px-2.5 py-1 rounded-md bg-emerald-50 text-[#00a84b] font-extrabold"
                    >
                      엑셀(CSV) 저장
                    </button>
                  </div>
                </div>

                {/* 스프레드시트 테이블 */}
                <div className="flex-1 overflow-auto custom-scroll">
                  <table className="w-full min-w-[1150px] text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-[#f9fafb] border-b border-slate-200 text-[11px] font-semibold text-slate-500 z-10">
                      <tr>
                        <th className="py-2.5 pl-8 pr-3 w-10">
                          <input
                            type="checkbox"
                            checked={
                              managedMembers.length > 0 &&
                              selectedRowIds.length === managedMembers.length
                            }
                            onChange={(e) =>
                              setSelectedRowIds(
                                e.target.checked
                                  ? managedMembers.map((x) => x.instructor_id)
                                  : []
                              )
                            }
                            className="rounded border-slate-300"
                          />
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[190px]">
                          이름
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[90px]">
                          재직 상태
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[100px]">
                          사번
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[105px]">
                          입사일
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[95px]">
                          근속 기간
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[180px]">
                          이메일
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[160px]">
                          개인 이메일
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[135px]">
                          휴대전화번호
                        </th>
                        <th className="py-2.5 px-3 border-r border-slate-100 w-[230px]">
                          조직 정보
                        </th>
                        <th className="py-2.5 pl-3 pr-8">주조직 · 직책 · 관리</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {managedMembers.map((m) => {
                        const checked = selectedRowIds.includes(
                          m.instructor_id
                        );
                        const orgPath =
                          m.rank_code === "CEO"
                            ? `${companyName} › 대표`
                            : m.department && m.department !== "미지정"
                              ? `${companyName} › 대표 › ${m.department}`
                              : "";

                        return (
                          <tr
                            key={m.instructor_id}
                            onClick={() => setProfileTargetId(m.instructor_id)}
                            className="hover:bg-slate-50/80 cursor-pointer"
                          >
                            <td
                              className="py-3 pl-8 pr-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedRowIds(
                                    checked
                                      ? selectedRowIds.filter(
                                          (x) => x !== m.instructor_id
                                        )
                                      : [...selectedRowIds, m.instructor_id]
                                  )
                                }
                                className="rounded border-slate-300"
                              />
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100">
                              <div className="flex items-center gap-2.5">
                                {renderMemberAvatar(m)}
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-900 flex items-center gap-1">
                                    <span>{m.name}</span>
                                    {m.rank_code === "CEO" && (
                                      <span className="text-amber-500 text-[11px]">
                                        ✪
                                      </span>
                                    )}
                                  </div>
                                  {m.job_description && (
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {m.job_description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                  m.work_status === "재직"
                                    ? "bg-emerald-50 text-[#00a84b]"
                                    : m.work_status === "휴직"
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {m.work_status}
                              </span>
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 font-mono text-slate-600">
                              {m.employee_no || ""}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-700">
                              {formatDotDate(m.hire_date)}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-600">
                              {calcTenureText(m.hire_date, asOfDate)}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-600 truncate max-w-[180px]">
                              {m.email}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-500 truncate max-w-[160px]">
                              {m.profile_extra?.personal_email || ""}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-700">
                              {m.phone}
                            </td>

                            <td className="py-3 px-3 border-r border-slate-100 text-slate-600 truncate max-w-[230px]">
                              {orgPath}
                            </td>

                            <td
                              className="py-3 pl-3 pr-8 flex items-center justify-between gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-slate-700">
                                {formatRightOrgRolePill(m)}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormMode("edit");
                                  setEditingMember(m);
                                  setFormOpen(true);
                                }}
                                className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                              >
                                수정
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2-B: 입사 온보딩 탭 (스크린샷 203637 동일) */}
            {manageSubTab === "ONBOARDING" && (
              <div className="flex-1 overflow-y-auto custom-scroll px-8 py-4 space-y-6 text-xs">
                <div>
                  <div className="py-2 border-b border-slate-100 grid grid-cols-12 text-[11px] font-bold text-slate-400">
                    <div className="col-span-7">
                      온보딩 중 ({onboardingSplit.inProgress.length})
                    </div>
                    <div className="col-span-3">입사일</div>
                    <div className="col-span-2">진행 상태</div>
                  </div>
                  {onboardingSplit.inProgress.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      현재 온보딩 진행 중인 신규 입사자가 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {onboardingSplit.inProgress.map(
                        ({ member: m, doneCount }) => (
                          <div
                            key={m.instructor_id}
                            onClick={() =>
                              setChecklistTarget({
                                mode: "ONBOARD",
                                member: m,
                              })
                            }
                            className="py-3.5 grid grid-cols-12 items-center hover:bg-slate-50 cursor-pointer"
                          >
                            <div className="col-span-7 flex items-center gap-3">
                              {renderMemberAvatar(m)}
                              <div>
                                <div className="font-bold text-slate-900">
                                  {m.name}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {m.department}
                                </div>
                              </div>
                            </div>
                            <div className="col-span-3 text-slate-500">
                              {formatKoreanDateWithDow(m.hire_date)}
                            </div>
                            <div className="col-span-2">
                              <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                                진행중 ({doneCount}/{onboardingSplit.totalTasks})
                              </span>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="py-2 border-b border-slate-100 grid grid-cols-12 text-[11px] font-bold text-slate-400">
                    <div className="col-span-7">
                      온보딩 완료 ({onboardingSplit.completed.length})
                    </div>
                    <div className="col-span-3">입사일</div>
                    <div className="col-span-2">진행 상태</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {onboardingSplit.completed.map((m) => (
                      <div
                        key={m.instructor_id}
                        onClick={() =>
                          setChecklistTarget({ mode: "ONBOARD", member: m })
                        }
                        className="py-3.5 grid grid-cols-12 items-center hover:bg-slate-50 cursor-pointer"
                      >
                        <div className="col-span-7 flex items-center gap-3">
                          {renderMemberAvatar(m)}
                          <div>
                            <div className="font-bold text-slate-900">
                              {m.name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {m.department}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-3 text-slate-500">
                          {formatKoreanDateWithDow(m.hire_date)}
                        </div>
                        <div className="col-span-2">
                          <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 text-[11px] font-semibold">
                            완료
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2-C: 퇴사 오프보딩 탭 (스크린샷 203648 동일) */}
            {manageSubTab === "OFFBOARDING" && (
              <div className="flex-1 overflow-y-auto custom-scroll px-8 py-4 space-y-6 text-xs">
                <div>
                  <div className="py-2 border-b border-slate-100 grid grid-cols-12 text-[11px] font-bold text-slate-400">
                    <div className="col-span-7">
                      오프보딩 중 ({offboardingSplit.inProgress.length})
                    </div>
                    <div className="col-span-3">퇴직일</div>
                    <div className="col-span-2">진행 상태</div>
                  </div>
                  {offboardingSplit.inProgress.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      현재 오프보딩 진행 중인 퇴직 예정자가 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {offboardingSplit.inProgress.map(
                        ({ member: m, doneCount }) => (
                          <div
                            key={m.instructor_id}
                            onClick={() =>
                              setChecklistTarget({
                                mode: "OFFBOARD",
                                member: m,
                              })
                            }
                            className="py-3.5 grid grid-cols-12 items-center hover:bg-slate-50 cursor-pointer"
                          >
                            <div className="col-span-7 flex items-center gap-3">
                              {renderMemberAvatar(m)}
                              <div>
                                <div className="font-bold text-slate-900">
                                  {m.name}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {m.department}
                                </div>
                              </div>
                            </div>
                            <div className="col-span-3 text-slate-500">
                              {formatKoreanDateWithDow(m.resign_date)}
                            </div>
                            <div className="col-span-2">
                              <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                                진행중 ({doneCount}/{offboardingSplit.totalTasks})
                              </span>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="py-2 border-b border-slate-100 grid grid-cols-12 text-[11px] font-bold text-slate-400">
                    <div className="col-span-7">
                      오프보딩 완료 ({offboardingSplit.completed.length})
                    </div>
                    <div className="col-span-3">퇴직일</div>
                    <div className="col-span-2">진행 상태</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {offboardingSplit.completed.map((m) => (
                      <div
                        key={m.instructor_id}
                        onClick={() =>
                          setChecklistTarget({ mode: "OFFBOARD", member: m })
                        }
                        className="py-3.5 grid grid-cols-12 items-center hover:bg-slate-50 cursor-pointer"
                      >
                        <div className="col-span-7 flex items-center gap-3">
                          {renderMemberAvatar(m)}
                          <div>
                            <div className="font-bold text-slate-900">
                              {m.name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {m.department}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-3 text-slate-500">
                          {formatKoreanDateWithDow(m.resign_date)}
                        </div>
                        <div className="col-span-2">
                          <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 text-[11px] font-semibold">
                            완료
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2-D: 초대 현황 탭 (스크린샷 203655 동일) */}
            {manageSubTab === "INVITE" && (
              <div className="flex-1 overflow-y-auto custom-scroll px-8 py-6 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        "ALL",
                        "초대 전",
                        "가입 대기 중",
                        "정보 입력 중",
                      ] as const
                    ).map((st) => {
                      const active = inviteStatusFilter === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setInviteStatusFilter(st)}
                          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                            active
                              ? "bg-[#00c458] text-white"
                              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {st === "ALL" ? "전체" : st}
                        </button>
                      );
                    })}
                  </div>

                  <div className="px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-2 w-[220px]">
                    <input
                      value={inviteKeyword}
                      onChange={(e) => setInviteKeyword(e.target.value)}
                      placeholder="이름, 조직, 직무 검색"
                      className="w-full focus:outline-none text-xs"
                    />
                    <span className="text-slate-400">🔍</span>
                  </div>
                </div>

                {(() => {
                  const list = lifecycle.invitations.filter((inv) => {
                    if (
                      inviteStatusFilter !== "ALL" &&
                      inv.status !== inviteStatusFilter
                    ) {
                      return false;
                    }
                    if (
                      inviteKeyword.trim() &&
                      !`${inv.name} ${inv.department} ${inv.job_title}`.includes(
                        inviteKeyword.trim()
                      )
                    ) {
                      return false;
                    }
                    return true;
                  });

                  return (
                    <div className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100 text-xs font-extrabold text-[#00a84b]">
                        {list.length}명
                      </div>

                      {list.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center text-center space-y-2.5">
                          <span className="w-6 h-6 rounded-full border border-slate-300 text-slate-400 flex items-center justify-center font-bold">
                            i
                          </span>
                          <div className="text-xs font-bold text-slate-600">
                            구성원이 없어요.
                          </div>
                          <p className="text-[11px] text-slate-400">
                            회사의 구성원을 추가해보세요.
                          </p>
                          <button
                            type="button"
                            onClick={() => setInviteModalOpen(true)}
                            className="mt-1 px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1"
                          >
                            <span className="text-[#00c458] font-extrabold">
                              +
                            </span>
                            <span>구성원 추가하기</span>
                          </button>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {list.map((inv) => (
                            <div
                              key={inv.id}
                              className="px-5 py-3.5 flex items-center justify-between"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  style={{
                                    backgroundColor: avatarColor(inv.name),
                                  }}
                                  className="w-8 h-8 rounded-xl text-white text-[10px] font-extrabold flex items-center justify-center"
                                >
                                  {shortAvatarText(inv.name)}
                                </span>
                                <div>
                                  <div className="font-bold text-slate-900">
                                    {inv.name}{" "}
                                    <span className="text-slate-400 font-normal">
                                      ({inv.email})
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {inv.department} · {inv.job_title} · 입사예정{" "}
                                    {inv.hire_date}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-[#00a84b] text-[11px] font-bold">
                                  {inv.status}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    saveLifecyclePatch({
                                      invitations: lifecycle.invitations.filter(
                                        (x) => x.id !== inv.id
                                      ),
                                    })
                                  }
                                  className="text-slate-400 hover:text-rose-500 font-bold"
                                >
                                  취소
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* =============================================================== */}
        {/* VIEW 3: 인사 정보 관리 (인사 발령 | 정보 일괄 변경 — 203940)     */}
        {/* =============================================================== */}
        {topTab === "APPOINTMENT" && canManage && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-8 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs">
                <button
                  type="button"
                  onClick={() => setHrSubTab("HISTORY")}
                  className={`py-3 border-b-2 transition-colors ${
                    hrSubTab === "HISTORY"
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  인사 발령
                </button>
                <button
                  type="button"
                  onClick={() => setHrSubTab("BULK")}
                  className={`py-3 border-b-2 transition-colors ${
                    hrSubTab === "BULK"
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  정보 일괄 변경
                </button>
              </div>

              {hrSubTab === "HISTORY" && (
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => setAppointSortDesc((p) => !p)}
                    className="hover:text-slate-800"
                    title="정렬 순서 전환"
                  >
                    ⇅
                  </button>
                  <select
                    value={appointFilterLabel}
                    onChange={(e) => setAppointFilterLabel(e.target.value)}
                    className="text-xs font-semibold text-slate-600 focus:outline-none"
                  >
                    <option value="ALL">≡ 필터 (전체)</option>
                    <option value="인사 정보 변경">인사 정보 변경</option>
                    <option value="정보 생성">정보 생성</option>
                  </select>
                </div>
              )}
            </div>

            {hrSubTab === "HISTORY" ? (
              <div className="flex-1 overflow-y-auto custom-scroll px-8 py-4 text-xs">
                <div className="text-[11px] font-bold text-slate-400 pb-2 border-b border-slate-100">
                  변경 내역
                </div>

                <div className="divide-y divide-slate-100">
                  {mergedAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="py-4 flex items-center justify-between gap-4 hover:bg-slate-50/70"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-bold text-slate-900">
                            {apt.event_type}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                              apt.status === "취소"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-emerald-50 text-[#00a84b]"
                            }`}
                          >
                            {apt.status}
                          </span>
                          {apt.appointment_label && (
                            <span className="text-[11px] text-slate-500 font-semibold">
                              · {apt.appointment_label}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {apt.actor_name} · {formatKoreanDateTime(apt.acted_at)}
                          {apt.summary ? ` — ${apt.summary}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {apt.id.startsWith("apt_") && apt.status !== "취소" && (
                          <button
                            type="button"
                            onClick={() =>
                              saveLifecyclePatch({
                                appointments: lifecycle.appointments.map((x) =>
                                  x.id === apt.id ? { ...x, status: "취소" } : x
                                ),
                              })
                            }
                            className="text-[11px] text-slate-400 hover:text-rose-500 font-semibold"
                          >
                            발령 취소
                          </button>
                        )}
                        <span className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-600">
                          📅 {formatKoreanDateWithDow(apt.effective_date).replace(/\s*\(.\)$/, "")}
                        </span>
                        <span
                          title={apt.target_member_name}
                          style={{
                            backgroundColor: avatarColor(apt.target_member_name),
                          }}
                          className="w-7 h-7 rounded-xl text-white text-[10px] font-extrabold flex items-center justify-center"
                        >
                          {shortAvatarText(apt.target_member_name)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* 정보 일괄 변경 뷰 */
              <div className="flex-1 overflow-y-auto custom-scroll px-8 py-6 space-y-4 text-xs">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-slate-800">
                      선택한 구성원 ({bulkSelectedIds.length}명) 소속 부서 일괄 변경
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      조직 개편 시 여러 구성원의 부서를 한 번에 발령·이동할 수 있어요.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={bulkTargetDept}
                      onChange={(e) => setBulkTargetDept(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
                    >
                      <option value="">이동할 부서 선택</option>
                      {existingDepartments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={bulkSaving}
                      onClick={handleBulkDepartmentUpdate}
                      className="px-4 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                    >
                      {bulkSaving ? "처리 중..." : "일괄 적용"}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {members
                    .filter((m) => m.work_status !== "퇴직")
                    .map((m) => {
                      const checked = bulkSelectedIds.includes(m.instructor_id);
                      return (
                        <label
                          key={m.instructor_id}
                          className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                        >
                          <span className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setBulkSelectedIds(
                                  checked
                                    ? bulkSelectedIds.filter(
                                        (x) => x !== m.instructor_id
                                      )
                                    : [...bulkSelectedIds, m.instructor_id]
                                )
                              }
                              className="rounded border-slate-300"
                            />
                            {renderMemberAvatar(m)}
                            <span className="font-bold text-slate-900">
                              {m.name}
                            </span>
                          </span>
                          <span className="text-slate-500">
                            {m.department} · {m.job_title}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* 모달 A: 인사 발령하기 2단계 모달 (스크린샷 203955 동일)           */}
      {/* ================================================================= */}
      {appointModalStep > 0 && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAppointModalStep(0)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {appointModalStep === 1 ? (
              <>
                <div className="-mt-3">
                  <h3 className="text-xl font-extrabold text-slate-900">
                    발령 정보 설정
                  </h3>
                  <p className="text-slate-400 mt-1">
                    인사 발령에 필요한 정보를 먼저 설정해 주세요.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      발령일<span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={appointDraft.effective_date}
                      onChange={(e) =>
                        setAppointDraft({
                          ...appointDraft,
                          effective_date: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      발령 대상<span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={appointDraft.target_member_id}
                      onChange={(e) =>
                        setAppointDraft({
                          ...appointDraft,
                          target_member_id: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                    >
                      <option value="">발령 대상 선택</option>
                      {members.map((m) => (
                        <option key={m.instructor_id} value={m.instructor_id}>
                          {m.name} ({m.department} · {m.job_title})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      발령 라벨 <span className="text-slate-400">ⓘ</span>
                    </label>
                    <select
                      value={appointDraft.appointment_label}
                      onChange={(e) =>
                        setAppointDraft({
                          ...appointDraft,
                          appointment_label: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                    >
                      <option value="">발령 라벨 선택</option>
                      {APPOINTMENT_LABELS.map((lb) => (
                        <option key={lb} value={lb}>
                          {lb}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-slate-700">
                        메모
                      </label>
                      <span className="text-[10px] text-slate-400">
                        🔒 인사 정보 권한자만 볼 수 있어요.
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={appointDraft.memo}
                      onChange={(e) =>
                        setAppointDraft({
                          ...appointDraft,
                          memo: e.target.value,
                        })
                      }
                      placeholder="메모를 입력하세요."
                      className="w-full p-3.5 rounded-xl border border-slate-200 focus:outline-none resize-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleProceedAppointStep2}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-sm"
                >
                  정보 변경하러 가기
                </button>
              </>
            ) : (
              <>
                <div className="-mt-3">
                  <h3 className="text-xl font-extrabold text-slate-900">
                    발령 상세 정보 변경
                  </h3>
                  <p className="text-slate-400 mt-1">
                    선택한 대상자의 조직·직급·재직 상태를 변경하고 발령을 완료합니다.
                  </p>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      발령 소속 부서(조직)
                    </label>
                    <input
                      list="hq-appoint-depts"
                      value={appointDraft.next_department}
                      onChange={(e) =>
                        setAppointDraft({
                          ...appointDraft,
                          next_department: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
                    />
                    <datalist id="hq-appoint-depts">
                      {existingDepartments.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        직급 단계
                      </label>
                      <select
                        value={appointDraft.next_rank_code}
                        onChange={(e) =>
                          setAppointDraft({
                            ...appointDraft,
                            next_rank_code: e.target.value as HqRankCode,
                          })
                        }
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold"
                      >
                        {HQ_RANK_LIST.map((rk) => (
                          <option key={rk.code} value={rk.code}>
                            Lv.{rk.level} {rk.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        직위 / 직책명
                      </label>
                      <input
                        value={appointDraft.next_job_title}
                        onChange={(e) =>
                          setAppointDraft({
                            ...appointDraft,
                            next_job_title: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 items-center">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        재직 상태
                      </label>
                      <select
                        value={appointDraft.next_work_status}
                        onChange={(e) =>
                          setAppointDraft({
                            ...appointDraft,
                            next_work_status: e.target.value as HqWorkStatus,
                          })
                        }
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold"
                      >
                        <option value="재직">재직</option>
                        <option value="휴직">휴직</option>
                        <option value="퇴직">퇴직</option>
                      </select>
                    </div>

                    <label className="mt-4 flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={appointDraft.next_is_dept_head}
                        onChange={(e) =>
                          setAppointDraft({
                            ...appointDraft,
                            next_is_dept_head: e.target.checked,
                          })
                        }
                        className="rounded border-slate-300"
                      />
                      <span>조직장(부서장) 지정</span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAppointModalStep(1)}
                    className="py-3 rounded-xl border border-slate-200 font-bold text-slate-600"
                  >
                    ← 이전 단계
                  </button>
                  <button
                    type="button"
                    disabled={savingAppoint}
                    onClick={handleExecuteAppointment}
                    className="py-3 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold"
                  >
                    {savingAppoint ? "적용 중..." : "인사 발령 완료"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 B: 온보딩 · 오프보딩 체크리스트 진행 모달                    */}
      {/* ================================================================= */}
      {checklistTarget && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {checklistTarget.member.name} 님{" "}
                  {checklistTarget.mode === "ONBOARD" ? "온보딩" : "오프보딩"}{" "}
                  체크리스트
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  완료된 항목을 체크하면 진행 상태가 즉시 업데이트됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChecklistTarget(null)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {(checklistTarget.mode === "ONBOARD"
                ? lifecycle.onboarding_templates
                : lifecycle.offboarding_templates
              ).map((task) => {
                const mapKey = `${checklistTarget.mode}:${checklistTarget.member.name}`;
                const curArr = lifecycle.completed_checks[mapKey] || [];
                const done = curArr.includes(task);
                return (
                  <label
                    key={task}
                    className={`p-3.5 rounded-xl border flex items-center gap-3 cursor-pointer ${
                      done
                        ? "border-emerald-200 bg-emerald-50/40"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => {
                        const nextArr = done
                          ? curArr.filter((x) => x !== task)
                          : [...curArr, task];
                        saveLifecyclePatch({
                          completed_checks: {
                            ...lifecycle.completed_checks,
                            [mapKey]: nextArr,
                          },
                        });
                      }}
                      className="w-4 h-4 rounded border-slate-300 accent-[#00c458]"
                    />
                    <span
                      className={`font-semibold ${
                        done ? "line-through text-slate-400" : "text-slate-800"
                      }`}
                    >
                      {task}
                    </span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setChecklistTarget(null)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-extrabold"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 C: 체크리스트 템플릿 관리 모달                               */}
      {/* ================================================================= */}
      {templateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {manageSubTab === "OFFBOARDING" ? "오프보딩" : "온보딩"} 체크리스트 템플릿
              </h3>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={newTplText}
                onChange={(e) => setNewTplText(e.target.value)}
                placeholder="새 체크리스트 항목 입력"
                className="flex-1 px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none font-semibold"
              />
              <button
                type="button"
                onClick={() => {
                  const t = newTplText.trim();
                  if (!t) return;
                  if (manageSubTab === "OFFBOARDING") {
                    setOffboardTplDraft([...offboardTplDraft, t]);
                  } else {
                    setOnboardTplDraft([...onboardTplDraft, t]);
                  }
                  setNewTplText("");
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold"
              >
                추가
              </button>
            </div>

            <div className="space-y-1.5 max-h-[240px] overflow-y-auto custom-scroll">
              {(manageSubTab === "OFFBOARDING"
                ? offboardTplDraft
                : onboardTplDraft
              ).map((item, idx) => (
                <div
                  key={`${item}-${idx}`}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between"
                >
                  <span className="font-semibold text-slate-800">{item}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (manageSubTab === "OFFBOARDING") {
                        setOffboardTplDraft(
                          offboardTplDraft.filter((_, i) => i !== idx)
                        );
                      } else {
                        setOnboardTplDraft(
                          onboardTplDraft.filter((_, i) => i !== idx)
                        );
                      }
                    }}
                    className="text-slate-400 hover:text-rose-500 font-bold"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  await saveLifecyclePatch({
                    onboarding_templates: onboardTplDraft,
                    offboarding_templates: offboardTplDraft,
                  });
                  setTemplateModalOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-[#00c458] text-white font-extrabold"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 D: 입사 예정자 초대 대기 등록 모달                           */}
      {/* ================================================================= */}
      {inviteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[420px] rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                ✉️ 입사 예정 구성원 초대 등록
              </h3>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <input
                value={inviteDraft.name}
                onChange={(e) =>
                  setInviteDraft({ ...inviteDraft, name: e.target.value })
                }
                placeholder="성명 (예: 홍길동)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
              />
              <input
                value={inviteDraft.email}
                onChange={(e) =>
                  setInviteDraft({ ...inviteDraft, email: e.target.value })
                }
                placeholder="초대 이메일 주소"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={inviteDraft.department}
                  onChange={(e) =>
                    setInviteDraft({
                      ...inviteDraft,
                      department: e.target.value,
                    })
                  }
                  placeholder="배정 부서"
                  className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
                <input
                  value={inviteDraft.job_title}
                  onChange={(e) =>
                    setInviteDraft({
                      ...inviteDraft,
                      job_title: e.target.value,
                    })
                  }
                  placeholder="직위/직책"
                  className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="date"
                  value={inviteDraft.hire_date}
                  onChange={(e) =>
                    setInviteDraft({
                      ...inviteDraft,
                      hire_date: e.target.value,
                    })
                  }
                  className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] focus:outline-none"
                />
                <select
                  value={inviteDraft.status}
                  onChange={(e) =>
                    setInviteDraft({
                      ...inviteDraft,
                      status: e.target.value as HqInviteCandidateItem["status"],
                    })
                  }
                  className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
                >
                  <option value="초대 전">초대 전</option>
                  <option value="가입 대기 중">가입 대기 중</option>
                  <option value="정보 입력 중">정보 입력 중</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!inviteDraft.name.trim()) {
                    alert("이름을 입력해주세요.");
                    return;
                  }
                  const item: HqInviteCandidateItem = {
                    id: `inv_${Date.now()}`,
                    name: inviteDraft.name.trim(),
                    email: inviteDraft.email.trim() || "-",
                    department: inviteDraft.department.trim() || "본부",
                    job_title: inviteDraft.job_title.trim() || "사원",
                    hire_date: inviteDraft.hire_date || todayIso,
                    status: inviteDraft.status,
                    created_at: new Date().toISOString(),
                  };
                  await saveLifecyclePatch({
                    invitations: [item, ...lifecycle.invitations],
                  });
                  setInviteModalOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-[#00c458] text-white font-extrabold"
              >
                초대 목록에 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 기존 구성원 추가/수정 모달 */}
      <MemberFormModal
        isOpen={formOpen}
        mode={formMode}
        member={editingMember}
        isHrManager={isHrManager}
        existingDepartments={existingDepartments}
        onClose={() => setFormOpen(false)}
        onSaved={refreshMembers}
      />

      {/* 상세 인사 프로필 모달 */}
      <HqMemberProfileModal
        isOpen={Boolean(activeProfileMember)}
        member={activeProfileMember}
        meId={instId}
        isHrManager={isHrManager}
        existingDepartments={existingDepartments}
        onClose={() => setProfileTargetId(null)}
        onSaved={refreshMembers}
      />

      {/* 재직·경력증명서 인쇄 모달 */}
      <CertificatePrintModal
        isOpen={Boolean(certMember)}
        member={certMember}
        onClose={() => setCertMember(null)}
      />
    </>
  );
}
