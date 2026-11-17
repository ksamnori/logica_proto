// src/components/hq/members/HqMemberProfileModal.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useOptionalHqShell } from "@/components/hq/HqShellContext";
import { useHqHref } from "@/lib/hq/hqRoutes";
import {
  HQ_DEFAULT_DEPARTMENTS,
  HQ_EMPLOYMENT_TYPES,
  HQ_RANK_LIST,
  getRankMeta,
} from "@/lib/hq/constants";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import { DEFAULT_DOC_FOLDERS } from "@/lib/hq/defaultApprovalPolicies";
import {
  calcWeeklyWorkHours,
  DEFAULT_WORK_RULES,
  formatHmToKoreanAmPm,
  patternShortBadge,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqAwardItem,
  HqCareerItem,
  HqDisciplineItem,
  HqEducationItem,
  HqFamilyItem,
  HqGrowthItem,
  HqLeaveHistoryItem,
  HqMember,
  HqRankCode,
  HqTrainingItem,
  HqWorkStatus,
} from "@/lib/hq/types";
import { getRegisteredOrgNames } from "@/lib/hq/orgTreeHelper";
import CertificatePrintModal from "./CertificatePrintModal";
import HqMemberHrChangeModal from "./HqMemberHrChangeModal";

interface Props {
  isOpen: boolean;
  member: HqMember | null;
  meId: string;
  isHrManager: boolean;
  existingDepartments?: string[];
  initialSubModal?: "basic" | "hr" | null;
  onClose: () => void;
  onSaved: () => void;
}

type ProfileTab =
  | "info"
  | "growth"
  | "education"
  | "payroll"
  | "documents"
  | "contracts";

type ActiveEditModal =
  | null
  | "hr"
  | "basic"
  | "labor"
  | "wage"
  | "work"
  | "leave_policy"
  | "special"
  | "add_career"
  | "add_edu"
  | "add_family"
  | "add_leave_hist"
  | "add_award"
  | "add_discipline"
  | "messenger"
  | "password"
  | "changelog";

function formatKoreanDate(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

function formatKoreanYm(ym?: string | null): string {
  if (!ym) return "현재";
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return `${Number(m[1])}년 ${Number(m[2])}월`;
}

function calcTenureBadge(hireDate?: string | null, resignDate?: string | null): string {
  if (!hireDate) return "";
  const start = new Date(hireDate);
  const end = resignDate ? new Date(resignDate) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return "";
  }
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthLastDay = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += prevMonthLastDay;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (years === 0 && days >= 0) parts.push(`${days + 1}일`);
  return `${parts.join(" ") || "1일"} ${resignDate ? "근무" : "재직"}`;
}

function calcYmDuration(startYm?: string, endYm?: string): string {
  if (!startYm) return "";
  const sm = /^(\d{4})-(\d{2})/.exec(startYm);
  if (!sm) return "";
  const now = new Date();
  const em = endYm ? /^(\d{4})-(\d{2})/.exec(endYm) : null;
  const sy = Number(sm[1]);
  const sMonth = Number(sm[2]);
  const ey = em ? Number(em[1]) : now.getFullYear();
  const eMonth = em ? Number(em[2]) : now.getMonth() + 1;

  const totalMonths = (ey - sy) * 12 + (eMonth - sMonth) + 1;
  if (totalMonths <= 0) return "";
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y > 0 && m > 0) return `${y}년 ${m}개월`;
  if (y > 0) return `${y}년`;
  return `${m}개월`;
}

function formatBirthdayShort(birthDate?: string | null, rrnFront?: string): string {
  if (birthDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
    if (m) return `${Number(m[2])}월 ${Number(m[3])}일`;
  }
  if (rrnFront && /^\d{6}$/.test(rrnFront)) {
    const mm = Number(rrnFront.slice(2, 4));
    const dd = Number(rrnFront.slice(4, 6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${mm}월 ${dd}일`;
    }
  }
  return "";
}

function formatIntlPhone(phone?: string): string {
  if (!phone) return "";
  if (phone.startsWith("010")) {
    return `+82-${phone.slice(1)}`;
  }
  return phone;
}

function makeUid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const SECTION_ANCHORS = [
  { id: "sec-hr", label: "인사" },
  { id: "sec-basic", label: "기본" },
  { id: "sec-labor", label: "근로 계약" },
  { id: "sec-wage", label: "임금 계약" },
  { id: "sec-work", label: "근무" },
  { id: "sec-leave", label: "휴가" },
  { id: "sec-holiday", label: "쉬는 날" },
  { id: "sec-leave-hist", label: "휴직 이력" },
  { id: "sec-award", label: "수상" },
  { id: "sec-discipline", label: "징계" },
  { id: "sec-career", label: "경력" },
  { id: "sec-edu", label: "학력" },
  { id: "sec-special", label: "특이사항" },
  { id: "sec-family", label: "가족" },
] as const;

export default function HqMemberProfileModal({
  isOpen,
  member,
  meId,
  isHrManager,
  existingDepartments = [],
  initialSubModal = null,
  onClose,
  onSaved,
}: Props) {
  const shell = useOptionalHqShell();
  const hqHref = useHqHref();
  const [activeTab, setActiveTab] = useState<ProfileTab>("info");
  const [isMaximized, setIsMaximized] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [editModal, setEditModal] = useState<ActiveEditModal>(null);
  const [certOpen, setCertOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // 우측 사이드바 한줄 소개 인라인 편집
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");

  // 1) 인사 정보 폼 (HR 전용)
  const [hrForm, setHrForm] = useState({
    department: "",
    customDept: "",
    rank_code: "STAFF" as HqRankCode,
    job_title: "",
    employee_no: "",
    job_description: "",
    is_dept_head: false,
    work_status: "재직" as HqWorkStatus,
    resign_date: "",
  });

  // 2) 기본 정보 폼
  const [basicForm, setBasicForm] = useState({
    name: "",
    nickname: "",
    email: "",
    personal_email: "",
    employee_no: "",
    hire_date: "",
    group_hire_date: "",
    hire_type: "",
    rrn_front: "",
    rrn_gender_digit: "",
    gender: "" as "" | "남" | "여",
    birth_date: "",
    nationality: "대한민국(KOR)",
    phone: "",
    extension_no: "",
    emergency_contact: "",
    postal_code: "",
    address: "",
    bank_name: "",
    bank_account: "",
    account_holder: "",
  });

  // 3) 근로계약 폼
  const [laborForm, setLaborForm] = useState({
    employment_type: "정규직",
    contract_type: "무기계약 (정규직)",
    start_date: "",
    end_date: "",
    probation_end_date: "",
    work_place: "천종현수학연구소 본사",
    note: "",
  });

  // 4) 임금계약 폼
  const [wageForm, setWageForm] = useState({
    wage_type: "연봉제",
    annual_salary: "",
    monthly_base: "",
    meal_allowance: "200000",
    pay_day: "매월 25일",
    effective_date: "",
    note: "",
  });

  // 5) 근무 / 휴가정책 / 특이사항 폼
  const [workForm, setWorkForm] = useState({
    work_schedule_type: "기본 9시",
    work_schedule_mode: "고정",
    weekly_work_hours: "40",
  });

  const [leavePolicyForm, setLeavePolicyForm] = useState({
    leave_policy_name: "기본 연차 정책",
    annual_leave_total: "15",
    annual_leave_used: "0",
  });

  const [specialForm, setSpecialForm] = useState({
    special_notes: "",
    hr_memo: "",
  });

  // 동적 리스트 추가용 폼들
  const [careerDraft, setCareerDraft] = useState({
    company_name: "",
    start_ym: "",
    end_ym: "",
    contract_type: "정규직",
    department: "",
    job_title: "",
  });

  const [eduDraft, setEduDraft] = useState({
    school_name: "",
    degree_type: "대학교(일반대학)",
    graduation_status: "졸업",
    major: "",
    start_ym: "",
    end_ym: "",
  });

  const [familyDraft, setFamilyDraft] = useState({
    relation: "배우자",
    name: "",
    birth_date: "",
    basic_deduction: true,
    health_dependent: false,
  });

  const [leaveHistDraft, setLeaveHistDraft] = useState({
    leave_kind: "육아휴직",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const [awardDraft, setAwardDraft] = useState({
    title: "",
    awarded_date: "",
    issuer: "천종현수학연구소",
    note: "",
  });

  const [disciplineDraft, setDisciplineDraft] = useState({
    kind: "주의",
    action_date: "",
    reason: "",
  });

  // 성장 / 교육 탭 추가 폼
  const [growthDraft, setGrowthDraft] = useState({
    period: `${new Date().getFullYear()} 상반기`,
    title: "",
    progress: "50",
    status: "진행중",
    note: "",
  });

  const [trainingDraft, setTrainingDraft] = useState({
    title: "",
    completed_date: new Date().toISOString().slice(0, 10),
    hours: "2",
    institution: "사내교육",
    status: "이수완료",
  });

  // 메신저 부재중 자동응답 & 비밀번호 폼
  const [msgForm, setMsgForm] = useState({
    auto_reply_active: false,
    chat_allow_start: "09:00",
    chat_allow_end: "18:00",
    auto_reply_message: "",
  });

  const [pwForm, setPwForm] = useState({
    password: "",
    confirm: "",
  });

  const leftScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !member) return;
    setActiveTab("info");
    setStatusMenuOpen(false);
    setEditingBio(false);
    setBioDraft(member.profile_extra?.bio || "");
    if (initialSubModal === "basic") {
      const mEx = member.profile_extra || {};
      setBasicForm({
        name: member.name,
        nickname: mEx.nickname || "",
        email: member.email || "",
        personal_email: mEx.personal_email || "",
        employee_no: member.employee_no || "",
        hire_date: member.hire_date || "",
        group_hire_date: mEx.group_hire_date || member.hire_date || "",
        hire_type: mEx.hire_type || "",
        rrn_front: mEx.rrn_front || "",
        rrn_gender_digit: mEx.rrn_gender_digit || "",
        gender: (mEx.gender as "" | "남" | "여") || "",
        birth_date: member.birth_date || "",
        nationality: mEx.nationality || "대한민국(KOR)",
        phone: member.phone || "",
        extension_no: member.extension_no || "",
        emergency_contact: member.emergency_contact || "",
        postal_code: mEx.postal_code || "",
        address: member.address || "",
        bank_name: member.bank_name || "",
        bank_account: member.bank_account || "",
        account_holder: member.account_holder || member.name,
      });
      setEditModal("basic");
    } else if (initialSubModal === "hr") {
      setEditModal("hr");
    } else {
      setEditModal(null);
    }
  }, [isOpen, member?.instructor_id, initialSubModal]);

  const companyExtra = shell?.companySettings?.extra_settings;
  const empNoLocked = Boolean(companyExtra?.emp_no_locked);

  const deptOptions = useMemo(
    () => getRegisteredOrgNames(companyExtra?.org_chart_nodes),
    [companyExtra?.org_chart_nodes]
  );

  const titleSuggestions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(companyExtra?.hr_positions || []),
          ...(companyExtra?.hr_titles || []),
        ])
      ),
    [companyExtra?.hr_positions, companyExtra?.hr_titles]
  );

  const jobSuggestions = useMemo(
    () => companyExtra?.hr_jobs || [],
    [companyExtra?.hr_jobs]
  );

  if (!isOpen || !member) return null;

  const isSelf = member.instructor_id === meId;
  const canEditSelfOrHr = isSelf || isHrManager;
  const canSeePrivate = member.can_view_private || isSelf || isHrManager;
  const ex = member.profile_extra || {};

  const avatarUrl = resolveStoragePublicUrl(member.profile_image_url);
  const avatarShortName =
    member.name.length >= 2 ? member.name.slice(-2) : member.name || "HQ";
  const tenureText = calcTenureBadge(member.hire_date, member.resign_date);
  const birthdayShort = formatBirthdayShort(member.birth_date, ex.rrn_front);
  const weeklyHours = Number(ex.weekly_work_hours ?? 40);

  const families = ex.families || [];
  const basicDeductionCount =
    1 + families.filter((f) => f.basic_deduction).length;
  const healthDependentCount = families.filter((f) => f.health_dependent).length;

  const scrollToSection = (secId: string) => {
    if (activeTab !== "info") {
      setActiveTab("info");
      setTimeout(() => {
        const el = document.getElementById(secId);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
      return;
    }
    const el = document.getElementById(secId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const patchMember = async (
    payload: Record<string, unknown>,
    summary: string
  ) => {
    setSaving(true);
    try {
      await hqFetch("/api/hq/members", {
        method: "PATCH",
        body: {
          instructor_id: member.instructor_id,
          change_summary: summary,
          ...payload,
        },
      });
      onSaved();
      setEditModal(null);
    } catch (err: any) {
      alert(err?.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const uploadedPath = await uploadHqReceiptFile(file, "hq_avatars");
      await patchMember(
        { profile_image_url: uploadedPath },
        "프로필 사진 변경"
      );
    } catch (err: any) {
      alert(err?.message || "프로필 사진 업로드 실패");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openHrEdit = () => {
    const inList = deptOptions.includes(member.department);
    setHrForm({
      department: inList ? member.department : "__CUSTOM__",
      customDept: inList ? "" : member.department,
      rank_code: member.rank_code,
      job_title: member.job_title,
      employee_no: member.employee_no,
      job_description: member.job_description || "",
      is_dept_head: member.is_dept_head,
      work_status: member.work_status,
      resign_date: member.resign_date || "",
    });
    setEditModal("hr");
  };

  const openBasicEdit = () => {
    setBasicForm({
      name: member.name,
      nickname: ex.nickname || "",
      email: member.email || "",
      personal_email: ex.personal_email || "",
      employee_no: member.employee_no || "",
      hire_date: member.hire_date || "",
      group_hire_date: ex.group_hire_date || member.hire_date || "",
      hire_type: ex.hire_type || "",
      rrn_front: ex.rrn_front || "",
      rrn_gender_digit: ex.rrn_gender_digit || "",
      gender: (ex.gender as "" | "남" | "여") || "",
      birth_date: member.birth_date || "",
      nationality: ex.nationality || "대한민국(KOR)",
      phone: member.phone || "",
      extension_no: member.extension_no || "",
      emergency_contact: member.emergency_contact || "",
      postal_code: ex.postal_code || "",
      address: member.address || "",
      bank_name: member.bank_name || "",
      bank_account: member.bank_account || "",
      account_holder: member.account_holder || member.name,
    });
    setEditModal("basic");
  };

  const openLaborEdit = () => {
    const lc = ex.labor_contract || {};
    setLaborForm({
      employment_type: member.employment_type || "정규직",
      contract_type:
        lc.contract_type ||
        (member.employment_type === "정규직" ? "무기계약(정규직)" : "기간제"),
      start_date: lc.start_date || member.hire_date || "",
      end_date: lc.end_date || "",
      probation_end_date: lc.probation_end_date || "",
      work_place: lc.work_place || "천종현수학연구소 본부",
      note: lc.note || "",
    });
    setEditModal("labor");
  };

  const openWageEdit = () => {
    const wc = ex.wage_contract || {};
    setWageForm({
      wage_type: wc.wage_type || "연봉제",
      annual_salary: wc.annual_salary ? String(wc.annual_salary) : "",
      monthly_base: wc.monthly_base ? String(wc.monthly_base) : "",
      meal_allowance:
        wc.meal_allowance !== undefined ? String(wc.meal_allowance) : "200000",
      pay_day: wc.pay_day || "매월 25일",
      effective_date: wc.effective_date || member.hire_date || "",
      note: wc.note || "",
    });
    setEditModal("wage");
  };

  const openWorkEdit = () => {
    setWorkForm({
      work_schedule_type: ex.work_schedule_type || "기본 9시",
      work_schedule_mode: ex.work_schedule_mode || "고정",
      weekly_work_hours: String(ex.weekly_work_hours ?? 40),
    });
    setEditModal("work");
  };

  const openLeavePolicyEdit = () => {
    setLeavePolicyForm({
      leave_policy_name: ex.leave_policy_name || "기본 연차 정책",
      annual_leave_total: String(member.annual_leave_total ?? 15),
      annual_leave_used: String(member.annual_leave_used ?? 0),
    });
    setEditModal("leave_policy");
  };

  const openSpecialEdit = () => {
    setSpecialForm({
      special_notes: ex.special_notes || "",
      hr_memo: member.hr_memo || "",
    });
    setEditModal("special");
  };

  const openMessengerEdit = () => {
    setStatusMenuOpen(false);
    setMsgForm({
      auto_reply_active: Boolean(member.auto_reply_active),
      chat_allow_start: member.chat_allow_start || "09:00",
      chat_allow_end: member.chat_allow_end || "18:00",
      auto_reply_message:
        member.auto_reply_message ||
        "현재 업무 외 시간이거나 부재중입니다. 확인 후 답변드리겠습니다.",
    });
    setEditModal("messenger");
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.password.length < 6) {
      alert("새 비밀번호는 최소 6자리 이상이어야 합니다.");
      return;
    }
    if (pwForm.password !== pwForm.confirm) {
      alert("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: pwForm.password,
      });
      if (error) throw error;
      alert("✅ 비밀번호가 안전하게 변경되었습니다.");
      setPwForm({ password: "", confirm: "" });
      setEditModal(null);
    } catch (err: any) {
      alert(err?.message || "비밀번호 변경 실패");
    } finally {
      setSaving(false);
    }
  };

  const removeArrayItem = async (
    key:
      | "careers"
      | "educations"
      | "families"
      | "leave_histories"
      | "awards"
      | "disciplines"
      | "growth_goals"
      | "trainings",
    id: string,
    label: string
  ) => {
    if (!confirm(`이 ${label} 항목을 삭제하시겠습니까?`)) return;
    const currentList = (ex[key] as any[]) || [];
    await patchMember(
      {
        profile_extra: {
          [key]: currentList.filter((item) => item.id !== id),
        },
      },
      `${label} 항목 삭제`
    );
  };

  const formatPhoneInput = (val: string) => {
    const d = val.replace(/[^0-9]/g, "").slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  };

  const rankMeta = getRankMeta(member.rank_code);

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-50 flex items-center justify-center p-3 sm:p-5">
        <div
          className={`bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden transition-all ${
            isMaximized
              ? "w-[97vw] h-[95vh]"
              : "w-full max-w-[1020px] h-[88vh] max-h-[860px]"
          }`}
        >
          {/* 1. 상단 Flex 스타일 그라데이션 커버 배너 */}
          <div className="relative h-28 sm:h-36 bg-gradient-to-br from-[#6d28d9] via-[#3730a3] to-[#0f172a] shrink-0 overflow-hidden">
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, rgba(167,139,250,0.65), transparent 55%), radial-gradient(circle at 80% 75%, rgba(56,189,248,0.35), transparent 50%)",
              }}
            />
            <div className="absolute top-3.5 right-4 flex items-center gap-1.5 z-10">
              <button
                type="button"
                onClick={() => setIsMaximized((p) => !p)}
                className="w-8 h-8 rounded-lg bg-black/25 hover:bg-black/45 text-white flex items-center justify-center transition-colors"
                title={isMaximized ? "기본 크기로 축소" : "넓게 보기"}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-black/25 hover:bg-black/45 text-white flex items-center justify-center text-xl leading-none transition-colors"
                title="닫기"
              >
                &times;
              </button>
            </div>
          </div>

          {/* 2. 프로필 아바타 + 이름/직무 + 상태 관리 바 */}
          <div className="px-6 sm:px-8 pt-3 pb-0 bg-white shrink-0 border-b border-slate-200">
            <div className="flex flex-wrap items-end justify-between gap-4 -mt-11 sm:-mt-12 mb-4">
              <div className="flex items-end gap-4">
                {/* Flex 스타일 라운드 스퀘어 아바타 */}
                <div className="relative group w-20 h-20 sm:w-22 sm:h-22 rounded-[22px] bg-[#f4c430] border-4 border-white shadow-md flex items-center justify-center text-white font-extrabold text-2xl overflow-hidden shrink-0 select-none">
                  <span>{avatarShortName}</span>
                  {avatarUrl && (
                    <img
                      src={avatarUrl}
                      alt={member.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {canEditSelfOrHr && (
                    <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-[11px] font-bold text-white cursor-pointer">
                      <span>{uploadingPhoto ? "업로드중" : "📷 사진변경"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                <div className="pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                      {member.name}
                    </h2>
                    {ex.nickname && (
                      <span className="text-sm font-semibold text-slate-400">
                        ({ex.nickname})
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${rankMeta.badgeClass}`}
                    >
                      {member.job_title}
                    </span>
                    {member.is_dept_head && (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold">
                        부서장
                      </span>
                    )}
                    {member.work_status !== "재직" && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold">
                        {member.work_status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-[13px] text-slate-500 font-medium mt-0.5">
                    {member.job_description || member.job_title || "직무 미지정"} ·{" "}
                    {member.department || "조직 없음"}
                  </p>
                </div>
              </div>

              {/* 우측 상태 관리 드롭다운 */}
              {canEditSelfOrHr && (
                <div className="relative pb-1">
                  <button
                    type="button"
                    onClick={() => setStatusMenuOpen((p) => !p)}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs flex items-center gap-1.5"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        member.work_status === "재직"
                          ? "bg-emerald-500"
                          : member.work_status === "휴직"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                      }`}
                    />
                    <span>상태 관리</span>
                    <span className="text-slate-400">▾</span>
                  </button>

                  {statusMenuOpen && (
                    <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                      {isHrManager && (
                        <>
                          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">
                            재직 상태 변경 (HR)
                          </div>
                          {(["재직", "휴직", "퇴직"] as HqWorkStatus[]).map(
                            (st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => {
                                  setStatusMenuOpen(false);
                                  patchMember(
                                    { work_status: st },
                                    `재직 상태 변경 (${st})`
                                  );
                                }}
                                className={`w-full px-3.5 py-2 text-left font-semibold hover:bg-slate-50 flex items-center justify-between ${
                                  member.work_status === st
                                    ? "text-brand font-bold"
                                    : "text-slate-700"
                                }`}
                              >
                                <span>{st}</span>
                                {member.work_status === st && <span>✓</span>}
                              </button>
                            )
                          )}
                          <div className="my-1 border-t border-slate-100" />
                        </>
                      )}

                      <button
                        type="button"
                        onClick={openMessengerEdit}
                        className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <span>💬</span>
                        <span>메신저 근무시간 · 자동응답</span>
                      </button>

                      {isSelf && (
                        <button
                          type="button"
                          onClick={() => {
                            setStatusMenuOpen(false);
                            setEditModal("password");
                          }}
                          className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <span>🔑</span>
                          <span>로그인 비밀번호 변경</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 탭 바 + 정보 변경 내역 버튼 */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center gap-5 text-[13px] font-bold shrink-0">
                {(
                  [
                    { key: "info", label: "정보" },
                    { key: "growth", label: "성장" },
                    { key: "education", label: "교육" },
                    { key: "payroll", label: "급여" },
                    { key: "documents", label: "문서 · 증명서" },
                    { key: "contracts", label: "계약서" },
                  ] as { key: ProfileTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveTab(t.key)}
                    className={`pb-3 border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === t.key
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {canSeePrivate && (
                <button
                  type="button"
                  onClick={() => setEditModal("changelog")}
                  className="mb-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 text-[12px] font-semibold text-slate-600 hover:text-blue-600 flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <span>🕒</span>
                  <span>정보 변경 내역</span>
                </button>
              )}
            </div>
          </div>

          {/* 3. 탭별 본문 영역 */}
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-white">
            {/* 좌측 메인 스크롤 컬럼 */}
            <div
              ref={leftScrollRef}
              className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-9 custom-scroll text-[13px]"
            >
              {activeTab === "info" && (
                <>
                  {/* (1) 인사 정보 (Flex 3행 구조: 조직·직책 / 직무·직군 / 직위·직급) */}
                  <section id="sec-hr" className="scroll-mt-4">
                    <div className="flex items-center justify-between pb-2.5">
                      <h4 className="text-[14px] font-extrabold text-slate-900">
                        인사 정보
                      </h4>
                      <div className="flex items-center gap-3 text-xs">
                        {(ex.hr_effective_date || member.hire_date) && (
                          <span className="text-slate-400 font-medium">
                            🕒{" "}
                            {String(ex.hr_effective_date || member.hire_date)
                              .replace(/-/g, ". ")}{" "}
                            ~ 현재
                          </span>
                        )}
                        {isHrManager && (
                          <button
                            type="button"
                            onClick={() => setEditModal("hr")}
                            className="text-slate-500 hover:text-slate-900 font-bold"
                          >
                            ✏️ 변경
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      <InfoRow icon="品" label="조직 · 직책">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-400 text-xs">주조직</span>
                          <span className="font-semibold text-slate-800">
                            {member.department || "미지정"}
                          </span>
                          {member.job_title && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="font-semibold text-slate-800">
                                {member.job_title}
                              </span>
                            </>
                          )}
                          {member.is_dept_head && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[10px] font-extrabold">
                              조직장
                            </span>
                          )}
                          {(ex.org_assignments || [])
                            .filter((a) => !a.is_primary)
                            .map((sub) => (
                              <span
                                key={sub.id}
                                className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold"
                              >
                                겸직: {sub.org_name}
                                {sub.title ? ` · ${sub.title}` : ""}
                              </span>
                            ))}
                        </div>
                      </InfoRow>

                      <InfoRow icon="✏️" label="직무 · 직군">
                        <span className="text-slate-400 mr-1.5">직무</span>
                        {ex.hr_jobs_selected &&
                        ex.hr_jobs_selected.length > 0 ? (
                          <span className="font-semibold text-slate-800 mr-4">
                            {ex.hr_jobs_selected.join(", ")}
                          </span>
                        ) : member.job_description ? (
                          <span className="font-semibold text-slate-800 mr-4">
                            {member.job_description}
                          </span>
                        ) : (
                          <span className="text-slate-300 mr-4">없음</span>
                        )}

                        <span className="text-slate-400 mr-1.5">직군</span>
                        {ex.hr_job_group ? (
                          <span className="font-semibold text-slate-800">
                            {ex.hr_job_group}
                          </span>
                        ) : (
                          <span className="text-slate-300">없음</span>
                        )}
                      </InfoRow>

                      <InfoRow icon="🎖️" label="직위 · 직급">
                        <span className="text-slate-400 mr-1.5">직위</span>
                        {ex.hr_position || member.job_title ? (
                          <span className="font-semibold text-slate-800 mr-4">
                            {ex.hr_position || member.job_title}
                          </span>
                        ) : (
                          <span className="text-slate-300 mr-4">없음</span>
                        )}

                        <span className="text-slate-400 mr-1.5">직급</span>
                        {ex.hr_grade ? (
                          <span className="font-semibold text-slate-800">
                            {ex.hr_grade}
                          </span>
                        ) : (
                          <span className="text-slate-300">없음</span>
                        )}
                      </InfoRow>
                    </div>
                  </section>

                  {/* (2) 기본 정보 */}
                  <section id="sec-basic" className="scroll-mt-4">
                    <SectionHeader
                      title="기본 정보"
                      actionLabel={canEditSelfOrHr ? "✏️ 변경" : undefined}
                      onAction={canEditSelfOrHr ? openBasicEdit : undefined}
                    />
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      <InfoRow icon="Aa" label="이름">
                        <span className="text-slate-400 mr-1.5">본명</span>
                        <span className="font-semibold text-slate-800 mr-4">
                          {member.name}
                        </span>
                        <span className="text-slate-400 mr-1.5">닉네임</span>
                        {ex.nickname ? (
                          <span className="text-slate-800">{ex.nickname}</span>
                        ) : (
                          <PlaceholderBtn
                            text="입력하기"
                            canClick={canEditSelfOrHr}
                            onClick={openBasicEdit}
                          />
                        )}
                      </InfoRow>

                      <InfoRow icon="@" label="이메일">
                        <span className="text-slate-400 mr-1.5">이메일</span>
                        <span className="text-slate-800 mr-4">
                          {member.email || "-"}
                        </span>
                        {canSeePrivate && (
                          <>
                            <span className="text-slate-400 mr-1.5">
                              개인 이메일
                            </span>
                            {ex.personal_email ? (
                              <span className="text-slate-800 mr-4">
                                {ex.personal_email}
                              </span>
                            ) : (
                              <span className="mr-4">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={canEditSelfOrHr}
                                  onClick={openBasicEdit}
                                />
                              </span>
                            )}
                          </>
                        )}
                        <span className="text-slate-400 mr-1.5">사번</span>
                        <span className="text-slate-800 font-mono text-xs">
                          {member.employee_no}
                        </span>
                      </InfoRow>

                      <InfoRow icon="🪪" label="입사 정보">
                        <span className="text-slate-400 mr-1.5">입사일</span>
                        <span className="font-semibold text-slate-800 mr-2">
                          {formatKoreanDate(member.hire_date) || "미등록"}
                        </span>
                        {tenureText && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-bold mr-4">
                            {tenureText}
                          </span>
                        )}
                        {canSeePrivate && (
                          <>
                            <span className="text-slate-400 mr-1.5">
                              그룹 입사일
                            </span>
                            <span className="text-slate-800 mr-4">
                              {formatKoreanDate(
                                ex.group_hire_date || member.hire_date
                              ) || "-"}
                            </span>
                            <span className="text-slate-400 mr-1.5">
                              입사 유형
                            </span>
                            <span className="text-slate-600">
                              {ex.hire_type || "없음"}
                            </span>
                          </>
                        )}
                      </InfoRow>

                      {canSeePrivate && (
                        <>
                          <InfoRow icon="🎂" label="주민등록번호 · 생일">
                            <span className="text-slate-400 mr-1.5">
                              주민등록번호
                            </span>
                            {ex.rrn_front && ex.rrn_gender_digit ? (
                              <span className="font-mono text-slate-800 mr-4">
                                {ex.rrn_front}-{ex.rrn_gender_digit}******
                              </span>
                            ) : (
                              <span className="mr-4">
                                <PlaceholderBtn
                                  text={
                                    ex.rrn_front
                                      ? `${ex.rrn_front}- (뒷 첫자리 입력하기)`
                                      : "입력하기"
                                  }
                                  canClick={canEditSelfOrHr}
                                  onClick={openBasicEdit}
                                />
                              </span>
                            )}
                            <span className="text-slate-400 mr-1.5">생일</span>
                            <span className="text-slate-800">
                              {birthdayShort || "미입력"}
                            </span>
                          </InfoRow>

                          <InfoRow icon="🌐" label="국적">
                            <span className="text-slate-800">
                              {ex.nationality || "대한민국(KOR)"}
                            </span>
                          </InfoRow>
                        </>
                      )}

                      <InfoRow icon="📞" label="휴대전화번호">
                        <span className="font-medium text-slate-800 mr-4">
                          {formatIntlPhone(member.phone) || "-"}
                        </span>
                        {member.extension_no && (
                          <span className="text-slate-500 text-xs mr-4">
                            내선 {member.extension_no}
                          </span>
                        )}
                        {canSeePrivate && member.emergency_contact && (
                          <span className="text-slate-400 text-xs">
                            비상연락망: {member.emergency_contact}
                          </span>
                        )}
                      </InfoRow>

                      {canSeePrivate && (
                        <>
                          <InfoRow icon="📍" label="주소">
                            {member.address ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-slate-800">
                                  {member.address}
                                </span>
                                {ex.postal_code && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-mono">
                                    우 {ex.postal_code}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <PlaceholderBtn
                                text="주소 입력하기"
                                canClick={canEditSelfOrHr}
                                onClick={openBasicEdit}
                              />
                            )}
                          </InfoRow>

                          <InfoRow icon="🏦" label="급여계좌">
                            {member.bank_name && member.bank_account ? (
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">
                                  {member.bank_name} {member.bank_account}
                                </span>
                                {member.account_holder && (
                                  <span className="text-xs text-slate-500">
                                    ({member.account_holder})
                                  </span>
                                )}
                                <span
                                  className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold"
                                  title="계좌 등록 완료"
                                >
                                  ✓
                                </span>
                              </div>
                            ) : (
                              <PlaceholderBtn
                                text="계좌 등록하기"
                                canClick={canEditSelfOrHr}
                                onClick={openBasicEdit}
                              />
                            )}
                          </InfoRow>
                        </>
                      )}
                    </div>
                  </section>

                  {/* 이하 민감 인사 섹션 (본인 또는 HR 관리자 열람) */}
                  {canSeePrivate ? (
                    <>
                      {/* (3) 근로 계약 정보 */}
                      <section id="sec-labor" className="scroll-mt-4">
                        <SectionHeader
                          title="근로 계약 정보"
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openLaborEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <InfoRow icon="✍️" label="근로 계약 정보">
                            {ex.labor_contract?.contract_type ||
                            member.employment_type ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-800">
                                  {ex.labor_contract?.contract_type ||
                                    member.employment_type}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                  {member.employment_type}
                                </span>
                                {(ex.labor_contract?.start_date ||
                                  member.hire_date) && (
                                  <span className="text-xs text-slate-500">
                                    계약기간:{" "}
                                    {ex.labor_contract?.start_date ||
                                      member.hire_date}{" "}
                                    ~{" "}
                                    {ex.labor_contract?.end_date ||
                                      "기간의 정함 없음"}
                                  </span>
                                )}
                                {ex.labor_contract?.probation_end_date && (
                                  <span className="text-xs text-amber-700">
                                    (수습종료:{" "}
                                    {ex.labor_contract.probation_end_date})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <EmptyText />
                            )}
                          </InfoRow>
                        </div>
                      </section>

                      {/* (4) 임금 계약 정보 */}
                      <section id="sec-wage" className="scroll-mt-4">
                        <SectionHeader
                          title="임금 계약 정보"
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openWageEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <InfoRow icon="₩" label="임금 계약 정보">
                            {ex.wage_contract?.annual_salary ||
                            ex.wage_contract?.monthly_base ? (
                              <div className="flex flex-wrap items-center gap-2.5">
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-bold">
                                  {ex.wage_contract.wage_type || "연봉제"}
                                </span>
                                {ex.wage_contract.annual_salary ? (
                                  <span className="font-bold text-slate-800">
                                    계약 연봉{" "}
                                    {Number(
                                      ex.wage_contract.annual_salary
                                    ).toLocaleString()}
                                    원
                                  </span>
                                ) : null}
                                {ex.wage_contract.monthly_base ? (
                                  <span className="text-slate-600">
                                    (월 기본급{" "}
                                    {Number(
                                      ex.wage_contract.monthly_base
                                    ).toLocaleString()}
                                    원)
                                  </span>
                                ) : null}
                                <span className="text-xs text-slate-400">
                                  지급일:{" "}
                                  {ex.wage_contract.pay_day || "매월 25일"}
                                </span>
                              </div>
                            ) : (
                              <EmptyText />
                            )}
                          </InfoRow>
                        </div>
                      </section>

                      {/* (5) 근무 정보 */}
                      <section id="sec-work" className="scroll-mt-4">
                        <SectionHeader
                          title="근무 정보"
                          rightSubText={
                            member.hire_date
                              ? `🕒 ${member.hire_date.replace(/-/g, ". ")} - 현재`
                              : undefined
                          }
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openWorkEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <InfoRow icon="🧳" label="근무 유형">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-800">
                                {ex.work_schedule_type || "기본 9시"}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-bold">
                                {ex.work_schedule_mode || "고정"}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                주 {weeklyHours}시간
                              </span>
                            </div>
                          </InfoRow>
                        </div>
                      </section>

                      {/* (6) 휴가 정보 */}
                      <section id="sec-leave" className="scroll-mt-4">
                        <SectionHeader
                          title="휴가 정보"
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openLeavePolicyEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <InfoRow icon="🏖️" label="연차 정책">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-800 mr-1">
                                {ex.leave_policy_name || "기본 연차 정책"}
                              </span>
                              {(
                                ex.leave_policy_tags || [
                                  "회계일 기준 부여",
                                  "시간 단위 사용",
                                  "연차 촉진 사용",
                                ]
                              ).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold"
                                >
                                  {tag}
                                </span>
                              ))}
                              <span className="ml-2 text-xs font-bold text-emerald-700">
                                · 잔여 {member.annual_leave_remain}일 (부여{" "}
                                {member.annual_leave_total}일 / 사용{" "}
                                {member.annual_leave_used}일)
                              </span>
                            </div>
                          </InfoRow>
                        </div>
                      </section>

                      {/* (7) 쉬는 날 정보 */}
                      <section id="sec-holiday" className="scroll-mt-4">
                        <SectionHeader
                          title="쉬는 날 정보"
                          actionLabel="쉬는 날 보기 ›"
                          onAction={() => {
                            onClose();
                            shell?.openSettingsModal("holidays");
                          }}
                        />
                        <div className="border-t border-slate-100">
                          <InfoRow icon="📅" label="쉬는 날">
                            {(() => {
                              const curYear = String(new Date().getFullYear());
                              const yrList =
                                shell?.companySettings?.holidays_by_year?.[
                                  curYear
                                ] ||
                                shell?.companySettings?.holidays_by_year?.[
                                  "2026"
                                ];
                              const totalDays = yrList
                                ? yrList.reduce(
                                    (s, h) => s + Number(h.days_count ?? 1),
                                    0
                                  )
                                : 14;
                              const names = yrList
                                ? yrList.map((h) => h.name).join(", ")
                                : ex.holiday_summary ||
                                  "1월 1일, 설날, 3·1절, 부처님 오신 날, 노동절, 어린이날, 현충일, 제헌절, 광복절, 추석, 개천절, 한글날, 성탄절...";
                              return (
                                <>
                                  <span className="font-semibold text-slate-800 mr-2 shrink-0">
                                    기본 ({totalDays}일)
                                  </span>
                                  <span className="text-slate-400 text-xs truncate max-w-md">
                                    {names}
                                  </span>
                                </>
                              );
                            })()}
                          </InfoRow>
                        </div>
                      </section>

                      {/* (8) 휴직 이력 */}
                      <section id="sec-leave-hist" className="scroll-mt-4">
                        <SectionHeader
                          title="휴직 이력"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={
                            isHrManager
                              ? () => setEditModal("add_leave_hist")
                              : undefined
                          }
                        />
                        <div className="border-t border-slate-100">
                          {(ex.leave_histories || []).length === 0 ? (
                            <InfoRow icon="🌿" label="휴직 이력">
                              <EmptyText />
                            </InfoRow>
                          ) : (
                            (ex.leave_histories || []).map((lh) => (
                              <InfoRow
                                key={lh.id}
                                icon="🌿"
                                label={lh.leave_kind}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <div>
                                    <span className="font-medium text-slate-800">
                                      {lh.start_date} ~ {lh.end_date || "진행중"}
                                    </span>
                                    {lh.reason && (
                                      <span className="ml-3 text-slate-500">
                                        사유: {lh.reason}
                                      </span>
                                    )}
                                  </div>
                                  {isHrManager && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeArrayItem(
                                          "leave_histories",
                                          lh.id,
                                          "휴직 이력"
                                        )
                                      }
                                      className="text-xs text-slate-300 hover:text-rose-500"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </InfoRow>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (9) 수상 */}
                      <section id="sec-award" className="scroll-mt-4">
                        <SectionHeader
                          title="수상"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setEditModal("add_award")
                              : undefined
                          }
                        />
                        <div className="border-t border-slate-100">
                          {(ex.awards || []).length === 0 ? (
                            <InfoRow icon="🏅" label="수상">
                              <EmptyText />
                            </InfoRow>
                          ) : (
                            (ex.awards || []).map((aw) => (
                              <InfoRow key={aw.id} icon="🏅" label={aw.title}>
                                <div className="flex items-center justify-between w-full">
                                  <div>
                                    <span className="text-slate-700">
                                      {formatKoreanDate(aw.awarded_date)}
                                    </span>
                                    {aw.issuer && (
                                      <span className="ml-3 text-slate-500">
                                        수여: {aw.issuer}
                                      </span>
                                    )}
                                  </div>
                                  {canEditSelfOrHr && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeArrayItem("awards", aw.id, "수상")
                                      }
                                      className="text-xs text-slate-300 hover:text-rose-500"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </InfoRow>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (10) 징계 */}
                      <section id="sec-discipline" className="scroll-mt-4">
                        <SectionHeader
                          title="징계"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={
                            isHrManager
                              ? () => setEditModal("add_discipline")
                              : undefined
                          }
                        />
                        <div className="border-t border-slate-100">
                          {(ex.disciplines || []).length === 0 ? (
                            <InfoRow icon="⚖️" label="징계">
                              <EmptyText />
                            </InfoRow>
                          ) : (
                            (ex.disciplines || []).map((ds) => (
                              <InfoRow key={ds.id} icon="⚖️" label={ds.kind}>
                                <div className="flex items-center justify-between w-full">
                                  <div>
                                    <span className="text-slate-700">
                                      {formatKoreanDate(ds.action_date)}
                                    </span>
                                    {ds.reason && (
                                      <span className="ml-3 text-slate-500">
                                        {ds.reason}
                                      </span>
                                    )}
                                  </div>
                                  {isHrManager && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeArrayItem(
                                          "disciplines",
                                          ds.id,
                                          "징계"
                                        )
                                      }
                                      className="text-xs text-slate-300 hover:text-rose-500"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </InfoRow>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (11) 경력 정보 */}
                      <section id="sec-career" className="scroll-mt-4">
                        <SectionHeader
                          title="경력 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setEditModal("add_career")
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.careers || []).length === 0 ? (
                            <InfoRow icon="🏢" label="경력 사항">
                              <PlaceholderBtn
                                text="이전 직장·경력 추가하기"
                                canClick={canEditSelfOrHr}
                                onClick={() => setEditModal("add_career")}
                              />
                            </InfoRow>
                          ) : (
                            (ex.careers || []).map((c) => {
                              const dur = calcYmDuration(c.start_ym, c.end_ym);
                              return (
                                <InfoRow
                                  key={c.id}
                                  icon="🏢"
                                  label={c.company_name}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-slate-400">기간</span>
                                      <span className="font-semibold text-slate-800">
                                        {formatKoreanYm(c.start_ym)} -{" "}
                                        {formatKoreanYm(c.end_ym)}
                                      </span>
                                      {dur && (
                                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                          {dur}
                                        </span>
                                      )}
                                      <span className="text-slate-400 ml-2">
                                        계약유형
                                      </span>
                                      <span className="font-medium text-slate-800">
                                        {c.contract_type}
                                      </span>
                                      {(c.department || c.job_title) && (
                                        <span className="text-xs text-slate-500">
                                          · {[c.department, c.job_title]
                                            .filter(Boolean)
                                            .join(" / ")}
                                        </span>
                                      )}
                                    </div>
                                    {canEditSelfOrHr && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeArrayItem(
                                            "careers",
                                            c.id,
                                            "경력"
                                          )
                                        }
                                        className="text-xs text-slate-300 hover:text-rose-500"
                                      >
                                        삭제
                                      </button>
                                    )}
                                  </div>
                                </InfoRow>
                              );
                            })
                          )}
                        </div>
                      </section>

                      {/* (12) 학력 정보 */}
                      <section id="sec-edu" className="scroll-mt-4">
                        <SectionHeader
                          title="학력 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setEditModal("add_edu")
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.educations || []).length === 0 ? (
                            <InfoRow icon="🎓" label="학력 사항">
                              <PlaceholderBtn
                                text="학력 추가하기"
                                canClick={canEditSelfOrHr}
                                onClick={() => setEditModal("add_edu")}
                              />
                            </InfoRow>
                          ) : (
                            (ex.educations || []).map((ed) => (
                              <InfoRow
                                key={ed.id}
                                icon="🎓"
                                label={ed.school_name}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-slate-400">기간</span>
                                    <span className="font-semibold text-slate-800 mr-1">
                                      {formatKoreanYm(ed.start_ym)} -{" "}
                                      {formatKoreanYm(ed.end_ym)}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                      {ed.graduation_status}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                      {ed.degree_type}
                                    </span>
                                    {ed.major && (
                                      <span className="text-xs text-slate-500 ml-1">
                                        ({ed.major})
                                      </span>
                                    )}
                                  </div>
                                  {canEditSelfOrHr && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeArrayItem(
                                          "educations",
                                          ed.id,
                                          "학력"
                                        )
                                      }
                                      className="text-xs text-slate-300 hover:text-rose-500"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </InfoRow>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (13) 특이사항 */}
                      <section id="sec-special" className="scroll-mt-4">
                        <SectionHeader
                          title="특이사항"
                          actionLabel={canEditSelfOrHr ? "✏️ 변경" : undefined}
                          onAction={canEditSelfOrHr ? openSpecialEdit : undefined}
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          <InfoRow icon="👁️" label="특이사항">
                            {ex.special_notes ? (
                              <span className="text-slate-800">
                                {ex.special_notes}
                              </span>
                            ) : (
                              <EmptyText />
                            )}
                          </InfoRow>
                          {isHrManager && (
                            <InfoRow icon="🔒" label="인사 비공개 메모">
                              {member.hr_memo ? (
                                <span className="text-amber-800 font-medium">
                                  {member.hr_memo}
                                </span>
                              ) : (
                                <EmptyText text="인사팀 전용 메모 없음" />
                              )}
                            </InfoRow>
                          )}
                        </div>
                      </section>

                      {/* (14) 가족 정보 */}
                      <section id="sec-family" className="scroll-mt-4 pb-6">
                        <SectionHeader
                          title="가족 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setEditModal("add_family")
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          <InfoRow icon="👪" label="가족 구성원">
                            {families.length === 0 ? (
                              <PlaceholderBtn
                                text="입력하기"
                                canClick={canEditSelfOrHr}
                                onClick={() => setEditModal("add_family")}
                              />
                            ) : (
                              <div className="space-y-1.5 w-full">
                                {families.map((fm) => (
                                  <div
                                    key={fm.id}
                                    className="flex flex-wrap items-center justify-between gap-2"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                                        {fm.relation}
                                      </span>
                                      <span className="font-semibold text-slate-800">
                                        {fm.name}
                                      </span>
                                      {fm.birth_date && (
                                        <span className="text-xs text-slate-400">
                                          ({fm.birth_date})
                                        </span>
                                      )}
                                      {fm.basic_deduction && (
                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                                          기본공제
                                        </span>
                                      )}
                                      {fm.health_dependent && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                                          건보피부양자
                                        </span>
                                      )}
                                    </div>
                                    {canEditSelfOrHr && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeArrayItem(
                                            "families",
                                            fm.id,
                                            "가족"
                                          )
                                        }
                                        className="text-xs text-slate-300 hover:text-rose-500"
                                      >
                                        삭제
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </InfoRow>

                          <InfoRow icon="🧮" label="총 공제 대상">
                            <span className="text-slate-400 mr-1.5">
                              기본 공제
                            </span>
                            <span className="font-bold text-slate-800 mr-5">
                              {basicDeductionCount}명
                            </span>
                            <span className="text-slate-400 mr-1.5">
                              건강보험 피부양자
                            </span>
                            <span className="font-bold text-slate-800">
                              {healthDependentCount}명
                            </span>
                          </InfoRow>
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-500">
                      🔒 주민등록번호, 급여계좌, 계약/연봉, 가족 및 상세 이력 정보는 본인 및 인사관리자에게만 공개됩니다.
                    </div>
                  )}
                </>
              )}

              {/* 탭 2: 성장 (OKR · 목표 관리) */}
              {activeTab === "growth" && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        🎯 목표 · 성과 기록 (OKR / KPI)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        반기별 핵심 직무 목표와 달성률을 관리합니다.
                      </p>
                    </div>
                  </div>

                  {canEditSelfOrHr && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          대상 기간
                        </label>
                        <input
                          value={growthDraft.period}
                          onChange={(e) =>
                            setGrowthDraft({ ...growthDraft, period: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        />
                      </div>
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          핵심 목표명
                        </label>
                        <input
                          value={growthDraft.title}
                          onChange={(e) =>
                            setGrowthDraft({ ...growthDraft, title: e.target.value })
                          }
                          placeholder="예: 2026 하반기 초등 사고력 신간 3종 출간"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          달성률(%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={growthDraft.progress}
                          onChange={(e) =>
                            setGrowthDraft({
                              ...growthDraft,
                              progress: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          disabled={saving || !growthDraft.title.trim()}
                          onClick={() => {
                            const nextItem: HqGrowthItem = {
                              id: makeUid(),
                              period: growthDraft.period,
                              title: growthDraft.title.trim(),
                              progress: Math.min(
                                100,
                                Math.max(0, Number(growthDraft.progress || 0))
                              ),
                              status:
                                Number(growthDraft.progress) >= 100
                                  ? "달성"
                                  : "진행중",
                            };
                            patchMember(
                              {
                                profile_extra: {
                                  growth_goals: [
                                    nextItem,
                                    ...(ex.growth_goals || []),
                                  ],
                                },
                              },
                              "성장 목표 등록"
                            );
                            setGrowthDraft({ ...growthDraft, title: "" });
                          }}
                          className="w-full py-2 rounded-lg bg-brand text-white text-xs font-bold disabled:opacity-40"
                        >
                          + 목표 등록
                        </button>
                      </div>
                    </div>
                  )}

                  {(ex.growth_goals || []).length === 0 ? (
                    <div className="py-16 text-center text-slate-400 text-xs font-semibold">
                      등록된 목표 · 성과 이력이 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {(ex.growth_goals || []).map((g) => (
                        <div
                          key={g.id}
                          className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-4"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold">
                                {g.period}
                              </span>
                              <span className="font-bold text-slate-800 truncate">
                                {g.title}
                              </span>
                            </div>
                            <div className="mt-2 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-brand h-full rounded-full"
                                style={{ width: `${g.progress}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-extrabold text-brand text-sm">
                              {g.progress}%
                            </span>
                            {canEditSelfOrHr && (
                              <button
                                type="button"
                                onClick={() =>
                                  removeArrayItem("growth_goals", g.id, "목표")
                                }
                                className="text-xs text-slate-300 hover:text-rose-500"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 탭 3: 교육 */}
              {activeTab === "education" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      📚 사내 · 법정의무교육 이수 내역
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      개인정보보호, 산업안전, 직무 역량 교육 이수 현황을 기록합니다.
                    </p>
                  </div>

                  {canEditSelfOrHr && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          교육 과정명
                        </label>
                        <input
                          value={trainingDraft.title}
                          onChange={(e) =>
                            setTrainingDraft({
                              ...trainingDraft,
                              title: e.target.value,
                            })
                          }
                          placeholder="예: 2026 개인정보보호 법정의무교육"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          이수일
                        </label>
                        <input
                          type="date"
                          value={trainingDraft.completed_date}
                          onChange={(e) =>
                            setTrainingDraft({
                              ...trainingDraft,
                              completed_date: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          시간(h)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={trainingDraft.hours}
                          onChange={(e) =>
                            setTrainingDraft({
                              ...trainingDraft,
                              hours: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          disabled={saving || !trainingDraft.title.trim()}
                          onClick={() => {
                            const nextTr: HqTrainingItem = {
                              id: makeUid(),
                              title: trainingDraft.title.trim(),
                              completed_date: trainingDraft.completed_date,
                              hours: Number(trainingDraft.hours || 1),
                              institution: trainingDraft.institution,
                              status: "이수완료",
                            };
                            patchMember(
                              {
                                profile_extra: {
                                  trainings: [nextTr, ...(ex.trainings || [])],
                                },
                              },
                              "교육 이수 등록"
                            );
                            setTrainingDraft({ ...trainingDraft, title: "" });
                          }}
                          className="w-full py-2 rounded-lg bg-brand text-white text-xs font-bold disabled:opacity-40"
                        >
                          + 이수 추가
                        </button>
                      </div>
                    </div>
                  )}

                  {(ex.trainings || []).length === 0 ? (
                    <div className="py-16 text-center text-slate-400 text-xs font-semibold">
                      등록된 교육 이수 내역이 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border rounded-xl border-slate-200">
                      {(ex.trainings || []).map((tr) => (
                        <div
                          key={tr.id}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="font-bold text-slate-800">
                              {tr.title}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              이수일: {tr.completed_date} · {tr.hours}시간
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                              {tr.status}
                            </span>
                            {canEditSelfOrHr && (
                              <button
                                type="button"
                                onClick={() =>
                                  removeArrayItem("trainings", tr.id, "교육")
                                }
                                className="text-xs text-slate-300 hover:text-rose-500"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 탭 4: 급여 */}
              {activeTab === "payroll" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-slate-900">
                    💰 급여 · 정산 계좌 정보
                  </h3>
                  {!canSeePrivate ? (
                    <div className="p-6 rounded-xl bg-slate-50 text-xs text-slate-500">
                      본인 및 인사관리자만 열람할 수 있습니다.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                        <div className="text-xs font-bold text-slate-400">
                          급여 · 경비정산 수령 계좌
                        </div>
                        <div className="text-base font-extrabold text-slate-900">
                          {member.bank_name
                            ? `${member.bank_name} ${member.bank_account}`
                            : "미등록"}
                        </div>
                        <div className="text-xs text-slate-500">
                          예금주: {member.account_holder || member.name}
                        </div>
                        {canEditSelfOrHr && (
                          <button
                            type="button"
                            onClick={openBasicEdit}
                            className="mt-2 text-xs font-bold text-brand hover:underline"
                          >
                            계좌 정보 변경하기 →
                          </button>
                        )}
                      </div>

                      <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                        <div className="text-xs font-bold text-slate-400">
                          현행 임금 계약 기준
                        </div>
                        <div className="text-base font-extrabold text-slate-900">
                          {ex.wage_contract?.annual_salary
                            ? `연봉 ${Number(
                                ex.wage_contract.annual_salary
                              ).toLocaleString()}원`
                            : ex.wage_contract?.monthly_base
                              ? `월 기본급 ${Number(
                                  ex.wage_contract.monthly_base
                                ).toLocaleString()}원`
                              : "임금 계약 미입력"}
                        </div>
                        <div className="text-xs text-slate-500">
                          급여일: {ex.wage_contract?.pay_day || "매월 25일"} ·
                          공제대상 {basicDeductionCount}명
                        </div>
                      </div>

                      <div className="sm:col-span-2 p-4 rounded-2xl border border-blue-200 bg-blue-50/50 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            📄 월별 급여명세서 열람 · PDF 출력
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            배부 확정된 월별 임금명세서(세무사 급여대장 확정분)를 조회하고 A4 인쇄할 수 있습니다.
                          </div>
                        </div>
                        <Link
                          href={hqHref("/hq/payroll")}
                          onClick={onClose}
                          className="px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold"
                        >
                          급여명세서 보관함 이동 →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 탭 5: 문서 · 증명서 */}
              {activeTab === "documents" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      📄 인사 문서 · 증명서 셀프 발급
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      재직증명서 및 경력증명서를 즉시 전자 발급하고 PDF로 저장하거나 인쇄할 수 있습니다.
                    </p>
                  </div>

                  {canSeePrivate ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl border border-slate-200 hover:border-brand transition-colors flex flex-col justify-between gap-4">
                        <div>
                          <div className="text-2xl mb-2">📜</div>
                          <div className="font-bold text-slate-900 text-sm">
                            국문 재직증명서
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            금융기관·관공서 제출용 공식 재직증명서 즉시 발급
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCertOpen(true)}
                          className="w-full py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold"
                        >
                          발급 미리보기 · 인쇄
                        </button>
                      </div>

                      <div className="p-5 rounded-2xl border border-slate-200 hover:border-brand transition-colors flex flex-col justify-between gap-4">
                        <div>
                          <div className="text-2xl mb-2">🗂️</div>
                          <div className="font-bold text-slate-900 text-sm">
                            경력증명서
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            재직 기간 및 담당 직무 이력이 기재된 경력증명서 발급
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCertOpen(true)}
                          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                        >
                          발급 미리보기 · 인쇄
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl bg-slate-50 text-xs text-slate-500">
                      증명서 발급은 본인 또는 인사관리자만 가능합니다.
                    </div>
                  )}

                  {canSeePrivate && (
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">
                          📁 구성원 제출 문서함
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          설정 &gt; 문서함 설정에서 지정한 인사 수집 서류 목록입니다.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {(companyExtra?.doc_folders &&
                        companyExtra.doc_folders.length > 0
                          ? companyExtra.doc_folders
                          : DEFAULT_DOC_FOLDERS
                        )
                          .slice()
                          .sort((a, b) => a.order - b.order)
                          .map((folder) => {
                            const attached = ex.doc_files?.[folder.id];
                            const fileUrl = attached
                              ? resolveStoragePublicUrl(attached.url)
                              : null;
                            return (
                              <div
                                key={folder.id}
                                className="px-4 py-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div className="flex items-center gap-2.5">
                                  <span className="text-slate-400">📄</span>
                                  <span className="font-bold text-slate-800">
                                    {folder.name}
                                  </span>
                                  {folder.is_required && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                                      필수
                                    </span>
                                  )}
                                  {attached ? (
                                    <span className="text-[11px] text-emerald-600 font-semibold">
                                      ✓ {attached.file_name}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">
                                      미제출
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {fileUrl && (
                                    <a
                                      href={fileUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
                                    >
                                      열람 ↗
                                    </a>
                                  )}
                                  {canEditSelfOrHr && (
                                    <label className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700 cursor-pointer">
                                      <span>
                                        {attached ? "재업로드" : "파일 등록"}
                                      </span>
                                      <input
                                        type="file"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const f = e.target.files?.[0];
                                          if (!f) return;
                                          try {
                                            const path =
                                              await uploadHqReceiptFile(
                                                f,
                                                "hq_member_docs"
                                              );
                                            const nextFiles = {
                                              ...(ex.doc_files || {}),
                                              [folder.id]: {
                                                url: path,
                                                file_name: f.name,
                                                uploaded_at: new Date()
                                                  .toISOString()
                                                  .slice(0, 10),
                                              },
                                            };
                                            await patchMember(
                                              {
                                                profile_extra: {
                                                  doc_files: nextFiles,
                                                },
                                              },
                                              `구성원 문서함 '${folder.name}' 파일 등록`
                                            );
                                          } catch (err: any) {
                                            alert(
                                              err?.message ||
                                                "문서 업로드에 실패했습니다."
                                            );
                                          }
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 탭 6: 계약서 */}
              {activeTab === "contracts" && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        ✍️ 근로 · 임금 계약 현황
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        체결된 근로계약 및 연봉계약 조건을 확인합니다.
                      </p>
                    </div>
                    {isHrManager && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={openLaborEdit}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          근로계약 편집
                        </button>
                        <button
                          type="button"
                          onClick={openWageEdit}
                          className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold"
                        >
                          임금계약 편집
                        </button>
                      </div>
                    )}
                  </div>

                  {!canSeePrivate ? (
                    <div className="p-6 rounded-xl bg-slate-50 text-xs text-slate-500">
                      계약 정보는 본인 및 인사관리자만 열람할 수 있습니다.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-5 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-sm">
                            표준 근로계약서 ({member.employment_type})
                          </span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-bold">
                            적용중
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>
                            계약 구분:{" "}
                            {ex.labor_contract?.contract_type ||
                              member.employment_type}
                          </div>
                          <div>
                            계약 기간:{" "}
                            {ex.labor_contract?.start_date ||
                              member.hire_date ||
                              "-"}{" "}
                            ~ {ex.labor_contract?.end_date || "무기한"}
                          </div>
                          <div>
                            근무 장소:{" "}
                            {ex.labor_contract?.work_place ||
                              "천종현수학연구소 본부"}
                          </div>
                          {ex.labor_contract?.note && (
                            <div className="text-slate-500">
                              비고: {ex.labor_contract.note}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-sm">
                            임금(연봉) 계약서
                          </span>
                          <span className="text-xs text-slate-400">
                            적용일:{" "}
                            {ex.wage_contract?.effective_date ||
                              member.hire_date ||
                              "-"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>
                            임금 형태: {ex.wage_contract?.wage_type || "연봉제"}
                          </div>
                          <div>
                            계약 금액:{" "}
                            {ex.wage_contract?.annual_salary
                              ? `${Number(
                                  ex.wage_contract.annual_salary
                                ).toLocaleString()}원`
                              : "미등록"}
                          </div>
                          <div>
                            식대 비과세:{" "}
                            {ex.wage_contract?.meal_allowance !== undefined
                              ? `${Number(
                                  ex.wage_contract.meal_allowance
                                ).toLocaleString()}원`
                              : "200,000원"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 우측 Flex 스타일 고정 요약 사이드바 */}
            <aside className="w-full lg:w-[290px] border-t lg:border-t-0 lg:border-l border-slate-100 px-6 py-6 bg-slate-50/30 overflow-y-auto shrink-0 space-y-5 text-xs">
              <div>
                <h4 className="text-[13px] font-extrabold text-slate-900 mb-2">
                  프로필
                </h4>
                {editingBio ? (
                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      value={bioDraft}
                      onChange={(e) => setBioDraft(e.target.value)}
                      placeholder="담당 업무나 한줄 소개를 입력해보세요."
                      className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-800 resize-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBio(false);
                          setBioDraft(ex.bio || "");
                        }}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 font-semibold"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          await patchMember(
                            { profile_extra: { bio: bioDraft.trim() } },
                            "한줄 소개 수정"
                          );
                          setEditingBio(false);
                        }}
                        className="px-3 py-1 rounded-lg bg-slate-900 text-white font-bold"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canEditSelfOrHr}
                    onClick={() => setEditingBio(true)}
                    className="text-left w-full text-slate-500 hover:text-slate-800 leading-relaxed disabled:cursor-default"
                  >
                    {ex.bio || "내 소개 작성하기"}
                  </button>
                )}
              </div>

              <div className="space-y-2.5 text-slate-600 pt-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-slate-400 w-4 text-center">📞</span>
                  <span className="truncate">
                    {formatIntlPhone(member.phone) || "미등록"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-slate-400 w-4 text-center">✉️</span>
                  <span className="truncate">{member.email || "미등록"}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-slate-400 w-4 text-center">🏢</span>
                  <span className="truncate">
                    {member.department !== "미지정"
                      ? `${member.department} · ${member.job_title}`
                      : "없음"}
                  </span>
                </div>
                {canSeePrivate && (
                  <>
                    <div className="flex items-center gap-2.5">
                      <span className="text-slate-400 w-4 text-center">📍</span>
                      <span className="truncate">
                        {member.address || "주소 미등록"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-slate-400 w-4 text-center">🎂</span>
                      <span>{birthdayShort || "생일 미등록"}</span>
                    </div>
                  </>
                )}
              </div>

              {canSeePrivate && (
                <>
                  <div className="border-t border-slate-200/80 pt-4 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => scrollToSection("sec-work")}
                      className="w-full flex items-center justify-between text-slate-600 hover:text-slate-900 group"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">🕒</span>
                        <span className="text-slate-500">근무한 시간</span>
                        <span className="font-bold text-slate-900">
                          {weeklyHours}시간
                        </span>
                      </span>
                      <span className="text-slate-300 group-hover:text-slate-600">
                        ↗
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToSection("sec-leave")}
                      className="w-full flex items-center justify-between text-slate-600 hover:text-slate-900 group"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">🏖️</span>
                        <span className="text-slate-500">보유한 연차</span>
                        <span className="font-bold text-slate-900">
                          {member.annual_leave_remain}일
                        </span>
                      </span>
                      <span className="text-slate-300 group-hover:text-slate-600">
                        ↗
                      </span>
                    </button>
                  </div>

                  {/* 다음으로 이동... 퀵 앵커 칩 */}
                  <div className="border-t border-slate-200/80 pt-4">
                    <div className="text-[11px] font-semibold text-slate-400 mb-2.5">
                      다음으로 이동...
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {SECTION_ANCHORS.map((anc) => (
                        <button
                          key={anc.id}
                          type="button"
                          onClick={() => scrollToSection(anc.id)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors"
                        >
                          {anc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </aside>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 서브 편집 모달들 (각 섹션 ✏️ 변경 / + 추가 클릭 시 열림)               */}
      {/* =================================================================== */}

      {/* 1. 인사 정보 변경하기 (플렉스형 작은 모달 — 직무/직군/직위/직급 + 조직·직책 트리 연동) */}
      <HqMemberHrChangeModal
        isOpen={editModal === "hr"}
        member={member}
        onClose={() => setEditModal(null)}
        onSaved={onSaved}
      />

      {/* 2. 기본 정보 편집 (주민등록번호 기반 성별 자동 판별 · 가로 넘침 없는 정돈된 레이아웃) */}
      {editModal === "basic" && (
        <SubDialog
          title="기본 정보 변경"
          maxWidthClass="max-w-[580px]"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            const cleanFront = basicForm.rrn_front
              .replace(/[^0-9]/g, "")
              .slice(0, 6);
            const cleanDigit = basicForm.rrn_gender_digit
              .replace(/[^1-8]/g, "")
              .slice(0, 1);
            const derivedGender: "" | "남" | "여" = ["1", "3", "5", "7"].includes(
              cleanDigit
            )
              ? "남"
              : ["2", "4", "6", "8"].includes(cleanDigit)
                ? "여"
                : "";

            let effBirthDate = basicForm.birth_date || "";
            if (!effBirthDate && cleanFront.length === 6 && cleanDigit) {
              const yy = cleanFront.slice(0, 2);
              const mm = cleanFront.slice(2, 4);
              const dd = cleanFront.slice(4, 6);
              const century = ["1", "2", "5", "6"].includes(cleanDigit)
                ? "19"
                : "20";
              effBirthDate = `${century}${yy}-${mm}-${dd}`;
            }

            const payload: Record<string, unknown> = {
              phone: basicForm.phone,
              email: basicForm.email,
              extension_no: basicForm.extension_no,
              emergency_contact: basicForm.emergency_contact,
              birth_date: effBirthDate || null,
              address: basicForm.address,
              bank_name: basicForm.bank_name,
              bank_account: basicForm.bank_account,
              account_holder: basicForm.account_holder,
              profile_extra: {
                nickname: basicForm.nickname.trim(),
                personal_email: basicForm.personal_email.trim(),
                rrn_front: cleanFront,
                rrn_gender_digit: cleanDigit,
                gender: derivedGender,
                nationality: basicForm.nationality.trim() || "대한민국(KOR)",
                postal_code: basicForm.postal_code.trim(),
                ...(isHrManager
                  ? {
                      group_hire_date: basicForm.group_hire_date,
                      hire_type: basicForm.hire_type,
                    }
                  : {}),
              },
            };
            if (isHrManager) {
              payload.name = basicForm.name;
              if (!(empNoLocked && member.employee_no)) {
                payload.employee_no = basicForm.employee_no;
              }
              payload.hire_date = basicForm.hire_date || null;
            }
            patchMember(payload, "기본 정보 변경");
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="본명">
              <input
                disabled={!isHrManager}
                value={basicForm.name}
                onChange={(e) =>
                  setBasicForm({ ...basicForm, name: e.target.value })
                }
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-bold disabled:bg-slate-100"
              />
            </Field>
            <Field label="닉네임 / 영어이름">
              <input
                value={basicForm.nickname}
                onChange={(e) =>
                  setBasicForm({ ...basicForm, nickname: e.target.value })
                }
                placeholder="선택 입력"
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            <Field label="사내 이메일">
              <input
                type="email"
                value={basicForm.email}
                onChange={(e) =>
                  setBasicForm({ ...basicForm, email: e.target.value })
                }
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="개인 이메일">
              <input
                type="email"
                value={basicForm.personal_email}
                onChange={(e) =>
                  setBasicForm({
                    ...basicForm,
                    personal_email: e.target.value,
                  })
                }
                placeholder="example@naver.com"
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            {isHrManager && (
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="입사일">
                  <input
                    type="date"
                    value={basicForm.hire_date}
                    onChange={(e) =>
                      setBasicForm({ ...basicForm, hire_date: e.target.value })
                    }
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                </Field>
                <Field label="그룹 입사일">
                  <input
                    type="date"
                    value={basicForm.group_hire_date}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        group_hire_date: e.target.value,
                      })
                    }
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                </Field>
                <Field label="입사 유형">
                  <select
                    value={basicForm.hire_type}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        hire_type: e.target.value,
                      })
                    }
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    <option value="">유형없음</option>
                    <option value="신입">신입</option>
                    <option value="경력">경력</option>
                    <option value="전배">전배</option>
                  </select>
                </Field>
              </div>
            )}

            <Field label="주민등록번호 (앞 6자리 · 뒷 첫자리)">
              <div className="flex items-center gap-1.5 min-w-0">
                <input
                  maxLength={6}
                  value={basicForm.rrn_front}
                  onChange={(e) => {
                    const front = e.target.value
                      .replace(/[^0-9]/g, "")
                      .slice(0, 6);
                    setBasicForm((prev) => {
                      let nextBirth = prev.birth_date;
                      if (front.length === 6 && prev.rrn_gender_digit) {
                        const yy = front.slice(0, 2);
                        const mm = front.slice(2, 4);
                        const dd = front.slice(4, 6);
                        const century = ["1", "2", "5", "6"].includes(
                          prev.rrn_gender_digit
                        )
                          ? "19"
                          : "20";
                        nextBirth = `${century}${yy}-${mm}-${dd}`;
                      }
                      return {
                        ...prev,
                        rrn_front: front,
                        birth_date: nextBirth,
                      };
                    });
                  }}
                  placeholder="810201"
                  className="w-28 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-mono text-center font-semibold"
                />
                <span className="text-slate-400 font-mono shrink-0">-</span>
                <input
                  maxLength={1}
                  value={basicForm.rrn_gender_digit}
                  onChange={(e) => {
                    const digit = e.target.value
                      .replace(/[^1-8]/g, "")
                      .slice(0, 1);
                    setBasicForm((prev) => {
                      let nextBirth = prev.birth_date;
                      if (digit && /^\d{6}$/.test(prev.rrn_front)) {
                        const yy = prev.rrn_front.slice(0, 2);
                        const mm = prev.rrn_front.slice(2, 4);
                        const dd = prev.rrn_front.slice(4, 6);
                        const century = ["1", "2", "5", "6"].includes(digit)
                          ? "19"
                          : "20";
                        nextBirth = `${century}${yy}-${mm}-${dd}`;
                      }
                      return {
                        ...prev,
                        rrn_gender_digit: digit,
                        birth_date: nextBirth,
                      };
                    });
                  }}
                  placeholder="1"
                  className="w-10 shrink-0 px-1 py-2.5 rounded-xl border border-slate-300 font-mono text-center font-bold"
                />
                <span className="text-slate-400 font-mono text-xs tracking-wider select-none shrink-0">
                  ••••••
                </span>
              </div>
            </Field>

            <Field label="생년월일">
              <input
                type="date"
                value={basicForm.birth_date}
                onChange={(e) =>
                  setBasicForm({ ...basicForm, birth_date: e.target.value })
                }
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            <Field label="휴대전화번호">
              <input
                value={basicForm.phone}
                maxLength={13}
                placeholder="010-0000-0000"
                onChange={(e) =>
                  setBasicForm({
                    ...basicForm,
                    phone: formatPhoneInput(e.target.value),
                  })
                }
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-bold"
              />
            </Field>

            <Field label="국적">
              <input
                value={basicForm.nationality}
                onChange={(e) =>
                  setBasicForm({ ...basicForm, nationality: e.target.value })
                }
                placeholder="대한민국(KOR)"
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            <Field label="내선번호">
              <input
                value={basicForm.extension_no}
                onChange={(e) =>
                  setBasicForm({
                    ...basicForm,
                    extension_no: e.target.value,
                  })
                }
                placeholder="선택 입력"
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            <Field label="비상연락망">
              <input
                value={basicForm.emergency_contact}
                onChange={(e) =>
                  setBasicForm({
                    ...basicForm,
                    emergency_contact: e.target.value,
                  })
                }
                placeholder="관계 · 연락처"
                className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="주소 · 우편번호">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <input
                    value={basicForm.postal_code}
                    maxLength={6}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        postal_code: e.target.value.replace(/[^0-9]/g, ""),
                      })
                    }
                    placeholder="우편번호"
                    className="sm:col-span-4 w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                  <input
                    value={basicForm.address}
                    onChange={(e) =>
                      setBasicForm({ ...basicForm, address: e.target.value })
                    }
                    placeholder="도로명 주소 및 상세주소"
                    className="sm:col-span-8 w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                </div>
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="급여 · 경비정산 계좌">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    value={basicForm.bank_name}
                    onChange={(e) =>
                      setBasicForm({ ...basicForm, bank_name: e.target.value })
                    }
                    placeholder="은행명 (예: 하나은행)"
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                  <input
                    value={basicForm.bank_account}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        bank_account: e.target.value,
                      })
                    }
                    placeholder="계좌번호"
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                  <input
                    value={basicForm.account_holder}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        account_holder: e.target.value,
                      })
                    }
                    placeholder="예금주"
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                  />
                </div>
              </Field>
            </div>
          </div>
        </SubDialog>
      )}

      {/* 3. 근로계약 편집 */}
      {editModal === "labor" && (
        <SubDialog
          title="근로 계약 정보 설정"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                employment_type: laborForm.employment_type,
                profile_extra: {
                  labor_contract: {
                    contract_type: laborForm.contract_type,
                    start_date: laborForm.start_date,
                    end_date: laborForm.end_date,
                    probation_end_date: laborForm.probation_end_date,
                    work_place: laborForm.work_place,
                    note: laborForm.note,
                  },
                },
              },
              "근로 계약 정보 업데이트"
            )
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="고용 형태">
              <select
                value={laborForm.employment_type}
                onChange={(e) =>
                  setLaborForm({
                    ...laborForm,
                    employment_type: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                {HQ_EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="계약 세부 유형">
              <input
                value={laborForm.contract_type}
                onChange={(e) =>
                  setLaborForm({ ...laborForm, contract_type: e.target.value })
                }
                placeholder="예: 무기계약(정규직), 기간제 1년"
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="계약 시작일">
              <input
                type="date"
                value={laborForm.start_date}
                onChange={(e) =>
                  setLaborForm({ ...laborForm, start_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="계약 종료일 (무기계약은 비움)">
              <input
                type="date"
                value={laborForm.end_date}
                onChange={(e) =>
                  setLaborForm({ ...laborForm, end_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="수습 종료일 (선택)">
              <input
                type="date"
                value={laborForm.probation_end_date}
                onChange={(e) =>
                  setLaborForm({
                    ...laborForm,
                    probation_end_date: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="근무 장소">
              <input
                value={laborForm.work_place}
                onChange={(e) =>
                  setLaborForm({ ...laborForm, work_place: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
        </SubDialog>
      )}

      {/* 4. 임금계약 편집 */}
      {editModal === "wage" && (
        <SubDialog
          title="임금 계약 정보 설정"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                profile_extra: {
                  wage_contract: {
                    wage_type: wageForm.wage_type,
                    annual_salary: Number(
                      wageForm.annual_salary.replace(/[^0-9]/g, "") || 0
                    ),
                    monthly_base: Number(
                      wageForm.monthly_base.replace(/[^0-9]/g, "") || 0
                    ),
                    meal_allowance: Number(
                      wageForm.meal_allowance.replace(/[^0-9]/g, "") || 0
                    ),
                    pay_day: wageForm.pay_day,
                    effective_date: wageForm.effective_date,
                    note: wageForm.note,
                  },
                },
              },
              "임금 계약 정보 업데이트"
            )
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="임금 형태">
              <select
                value={wageForm.wage_type}
                onChange={(e) =>
                  setWageForm({ ...wageForm, wage_type: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="연봉제">연봉제</option>
                <option value="월급제">월급제</option>
                <option value="시급제">시급제</option>
              </select>
            </Field>
            <Field label="적용 시작일">
              <input
                type="date"
                value={wageForm.effective_date}
                onChange={(e) =>
                  setWageForm({ ...wageForm, effective_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="계약 연봉 (원)">
              <input
                value={
                  wageForm.annual_salary
                    ? Number(
                        wageForm.annual_salary.replace(/[^0-9]/g, "")
                      ).toLocaleString()
                    : ""
                }
                onChange={(e) =>
                  setWageForm({
                    ...wageForm,
                    annual_salary: e.target.value.replace(/[^0-9]/g, ""),
                  })
                }
                placeholder="예: 50,000,000"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-right"
              />
            </Field>
            <Field label="월 기본급 (원 · 선택)">
              <input
                value={
                  wageForm.monthly_base
                    ? Number(
                        wageForm.monthly_base.replace(/[^0-9]/g, "")
                      ).toLocaleString()
                    : ""
                }
                onChange={(e) =>
                  setWageForm({
                    ...wageForm,
                    monthly_base: e.target.value.replace(/[^0-9]/g, ""),
                  })
                }
                placeholder="예: 3,966,660"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-right"
              />
            </Field>
            <Field label="급여 지급일">
              <input
                value={wageForm.pay_day}
                onChange={(e) =>
                  setWageForm({ ...wageForm, pay_day: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="식대 비과세 한도 (원)">
              <input
                value={wageForm.meal_allowance}
                onChange={(e) =>
                  setWageForm({
                    ...wageForm,
                    meal_allowance: e.target.value.replace(/[^0-9]/g, ""),
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-right"
              />
            </Field>
          </div>
        </SubDialog>
      )}

      {/* 5. 근무 유형 설정 */}
      {editModal === "work" && (
        <SubDialog
          title="근무 유형 설정"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                profile_extra: {
                  work_schedule_type: workForm.work_schedule_type,
                  work_schedule_mode: workForm.work_schedule_mode,
                  weekly_work_hours: Number(workForm.weekly_work_hours || 40),
                },
              },
              "근무 유형 변경"
            )
          }
        >
          <div className="space-y-3">
            <Field label="근무 스케줄 명칭">
              <select
                value={workForm.work_schedule_type}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const activeRules = (
                    companyExtra?.work_rules &&
                    companyExtra.work_rules.length > 0
                      ? companyExtra.work_rules
                      : DEFAULT_WORK_RULES
                  ).filter((r) => !r.is_hidden);
                  const matched = activeRules.find((r) => r.name === nextName);
                  setWorkForm({
                    ...workForm,
                    work_schedule_type: nextName,
                    work_schedule_mode: matched
                      ? patternShortBadge(matched.pattern_type)
                      : workForm.work_schedule_mode,
                    weekly_work_hours: matched
                      ? String(calcWeeklyWorkHours(matched))
                      : workForm.weekly_work_hours,
                  });
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                {(companyExtra?.work_rules && companyExtra.work_rules.length > 0
                  ? companyExtra.work_rules
                  : DEFAULT_WORK_RULES
                )
                  .filter((r) => !r.is_hidden)
                  .map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name} (출근 {formatHmToKoreanAmPm(r.start_time)} · 주{" "}
                      {calcWeeklyWorkHours(r)}시간)
                    </option>
                  ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="근무 방식">
                <select
                  value={workForm.work_schedule_mode}
                  onChange={(e) =>
                    setWorkForm({
                      ...workForm,
                      work_schedule_mode: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                >
                  <option value="고정">고정</option>
                  <option value="시차출퇴근">시차출퇴근</option>
                  <option value="선택적 근로">선택적 근로</option>
                  <option value="재택근무">재택근무</option>
                </select>
              </Field>
              <Field label="주 소정근로시간 (시간)">
                <input
                  type="number"
                  value={workForm.weekly_work_hours}
                  onChange={(e) =>
                    setWorkForm({
                      ...workForm,
                      weekly_work_hours: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </Field>
            </div>
          </div>
        </SubDialog>
      )}

      {/* 6. 휴가/연차 설정 */}
      {editModal === "leave_policy" && (
        <SubDialog
          title="휴가 정책 · 연차 일수 조정"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                annual_leave_total: Number(
                  leavePolicyForm.annual_leave_total || 15
                ),
                annual_leave_used: Number(
                  leavePolicyForm.annual_leave_used || 0
                ),
                profile_extra: {
                  leave_policy_name: leavePolicyForm.leave_policy_name,
                },
              },
              "연차 부여/사용 일수 조정"
            )
          }
        >
          <div className="space-y-3">
            <Field label="적용 연차 정책명">
              <input
                value={leavePolicyForm.leave_policy_name}
                onChange={(e) =>
                  setLeavePolicyForm({
                    ...leavePolicyForm,
                    leave_policy_name: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="총 부여 연차 (일)">
                <input
                  type="number"
                  step="0.5"
                  value={leavePolicyForm.annual_leave_total}
                  onChange={(e) =>
                    setLeavePolicyForm({
                      ...leavePolicyForm,
                      annual_leave_total: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </Field>
              <Field label="기 사용 연차 (일)">
                <input
                  type="number"
                  step="0.5"
                  value={leavePolicyForm.annual_leave_used}
                  onChange={(e) =>
                    setLeavePolicyForm({
                      ...leavePolicyForm,
                      annual_leave_used: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </Field>
            </div>
          </div>
        </SubDialog>
      )}

      {/* 7. 특이사항 & HR 메모 */}
      {editModal === "special" && (
        <SubDialog
          title="특이사항 편집"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                ...(isHrManager ? { hr_memo: specialForm.hr_memo } : {}),
                profile_extra: {
                  special_notes: specialForm.special_notes,
                },
              },
              "특이사항 수정"
            )
          }
        >
          <div className="space-y-3">
            <Field label="특이사항 (보훈·장애 대상 여부, 건강 참고사항 등)">
              <textarea
                rows={2}
                value={specialForm.special_notes}
                onChange={(e) =>
                  setSpecialForm({
                    ...specialForm,
                    special_notes: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 resize-none"
              />
            </Field>
            {isHrManager && (
              <Field label="🔒 인사팀 비공개 메모 (본인에게 표시되지 않음)">
                <textarea
                  rows={3}
                  value={specialForm.hr_memo}
                  onChange={(e) =>
                    setSpecialForm({ ...specialForm, hr_memo: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/40 resize-none"
                />
              </Field>
            )}
          </div>
        </SubDialog>
      )}

      {/* 8. 경력 추가 */}
      {editModal === "add_career" && (
        <SubDialog
          title="경력 정보 추가"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!careerDraft.company_name.trim() || !careerDraft.start_ym) {
              alert("회사명과 시작 년월을 입력해주세요.");
              return;
            }
            const nextItem: HqCareerItem = {
              id: makeUid(),
              company_name: careerDraft.company_name.trim(),
              start_ym: careerDraft.start_ym,
              end_ym: careerDraft.end_ym,
              contract_type: careerDraft.contract_type,
              department: careerDraft.department.trim(),
              job_title: careerDraft.job_title.trim(),
            };
            patchMember(
              {
                profile_extra: {
                  careers: [nextItem, ...(ex.careers || [])],
                },
              },
              `경력 추가 (${nextItem.company_name})`
            );
            setCareerDraft({
              company_name: "",
              start_ym: "",
              end_ym: "",
              contract_type: "정규직",
              department: "",
              job_title: "",
            });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="회사 · 기관명">
              <input
                required
                value={careerDraft.company_name}
                onChange={(e) =>
                  setCareerDraft({
                    ...careerDraft,
                    company_name: e.target.value,
                  })
                }
                placeholder="예: 천종현사고력수학학원"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </Field>
            <Field label="계약 유형">
              <select
                value={careerDraft.contract_type}
                onChange={(e) =>
                  setCareerDraft({
                    ...careerDraft,
                    contract_type: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="정규직">정규직</option>
                <option value="계약직">계약직</option>
                <option value="프리랜서">프리랜서</option>
                <option value="인턴">인턴</option>
              </select>
            </Field>
            <Field label="시작 년월">
              <input
                type="month"
                value={careerDraft.start_ym}
                onChange={(e) =>
                  setCareerDraft({ ...careerDraft, start_ym: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="종료 년월">
              <input
                type="month"
                value={careerDraft.end_ym}
                onChange={(e) =>
                  setCareerDraft({ ...careerDraft, end_ym: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="담당 부서 (선택)">
              <input
                value={careerDraft.department}
                onChange={(e) =>
                  setCareerDraft({ ...careerDraft, department: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="직위 · 직책 (선택)">
              <input
                value={careerDraft.job_title}
                onChange={(e) =>
                  setCareerDraft({ ...careerDraft, job_title: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
        </SubDialog>
      )}

      {/* 9. 학력 추가 */}
      {editModal === "add_edu" && (
        <SubDialog
          title="학력 정보 추가"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!eduDraft.school_name.trim()) {
              alert("학교명을 입력해주세요.");
              return;
            }
            const nextItem: HqEducationItem = {
              id: makeUid(),
              school_name: eduDraft.school_name.trim(),
              degree_type: eduDraft.degree_type,
              graduation_status: eduDraft.graduation_status,
              major: eduDraft.major.trim(),
              start_ym: eduDraft.start_ym,
              end_ym: eduDraft.end_ym,
            };
            patchMember(
              {
                profile_extra: {
                  educations: [nextItem, ...(ex.educations || [])],
                },
              },
              `학력 추가 (${nextItem.school_name})`
            );
            setEduDraft({
              school_name: "",
              degree_type: "대학교(일반대학)",
              graduation_status: "졸업",
              major: "",
              start_ym: "",
              end_ym: "",
            });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="학교명">
              <input
                value={eduDraft.school_name}
                onChange={(e) =>
                  setEduDraft({ ...eduDraft, school_name: e.target.value })
                }
                placeholder="예: 서울대학교"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </Field>
            <Field label="전공 / 학과">
              <input
                value={eduDraft.major}
                onChange={(e) =>
                  setEduDraft({ ...eduDraft, major: e.target.value })
                }
                placeholder="예: 수학교육과"
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="학력 구분">
              <select
                value={eduDraft.degree_type}
                onChange={(e) =>
                  setEduDraft({ ...eduDraft, degree_type: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="대학교(일반대학)">대학교(일반대학)</option>
                <option value="대학원(석사)">대학원(석사)</option>
                <option value="대학원(박사)">대학원(박사)</option>
                <option value="전문대학">전문대학</option>
                <option value="고등학교">고등학교</option>
              </select>
            </Field>
            <Field label="졸업 상태">
              <select
                value={eduDraft.graduation_status}
                onChange={(e) =>
                  setEduDraft({
                    ...eduDraft,
                    graduation_status: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="졸업">졸업</option>
                <option value="재학">재학</option>
                <option value="수료">수료</option>
                <option value="휴학">휴학</option>
                <option value="중퇴">중퇴</option>
              </select>
            </Field>
            <Field label="입학 년월">
              <input
                type="month"
                value={eduDraft.start_ym}
                onChange={(e) =>
                  setEduDraft({ ...eduDraft, start_ym: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="졸업 년월">
              <input
                type="month"
                value={eduDraft.end_ym}
                onChange={(e) =>
                  setEduDraft({ ...eduDraft, end_ym: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
        </SubDialog>
      )}

      {/* 10. 가족 추가 */}
      {editModal === "add_family" && (
        <SubDialog
          title="가족 구성원 추가"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!familyDraft.name.trim()) {
              alert("가족 성명을 입력해주세요.");
              return;
            }
            const nextItem: HqFamilyItem = {
              id: makeUid(),
              relation: familyDraft.relation,
              name: familyDraft.name.trim(),
              birth_date: familyDraft.birth_date,
              basic_deduction: familyDraft.basic_deduction,
              health_dependent: familyDraft.health_dependent,
            };
            patchMember(
              {
                profile_extra: {
                  families: [...families, nextItem],
                },
              },
              `가족 구성원 추가 (${nextItem.relation} ${nextItem.name})`
            );
            setFamilyDraft({
              relation: "배우자",
              name: "",
              birth_date: "",
              basic_deduction: true,
              health_dependent: false,
            });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="관계">
              <select
                value={familyDraft.relation}
                onChange={(e) =>
                  setFamilyDraft({ ...familyDraft, relation: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="배우자">배우자</option>
                <option value="자녀">자녀</option>
                <option value="부">부</option>
                <option value="모">모</option>
                <option value="형제자매">형제자매</option>
                <option value="조부모">조부모</option>
              </select>
            </Field>
            <Field label="성명">
              <input
                value={familyDraft.name}
                onChange={(e) =>
                  setFamilyDraft({ ...familyDraft, name: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </Field>
            <Field label="생년월일">
              <input
                type="date"
                value={familyDraft.birth_date}
                onChange={(e) =>
                  setFamilyDraft({ ...familyDraft, birth_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5 pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={familyDraft.basic_deduction}
                onChange={(e) =>
                  setFamilyDraft({
                    ...familyDraft,
                    basic_deduction: e.target.checked,
                  })
                }
                className="w-4 h-4 accent-brand rounded"
              />
              <span>연말정산 기본 공제 대상</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={familyDraft.health_dependent}
                onChange={(e) =>
                  setFamilyDraft({
                    ...familyDraft,
                    health_dependent: e.target.checked,
                  })
                }
                className="w-4 h-4 accent-brand rounded"
              />
              <span>건강보험 피부양자 등록</span>
            </label>
          </div>
        </SubDialog>
      )}

      {/* 11. 휴직 / 수상 / 징계 추가 */}
      {editModal === "add_leave_hist" && (
        <SubDialog
          title="휴직 이력 추가"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!leaveHistDraft.start_date) return alert("시작일을 입력하세요.");
            const nextItem: HqLeaveHistoryItem = {
              id: makeUid(),
              ...leaveHistDraft,
            };
            patchMember(
              {
                profile_extra: {
                  leave_histories: [nextItem, ...(ex.leave_histories || [])],
                },
              },
              "휴직 이력 등록"
            );
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="휴직 구분">
              <select
                value={leaveHistDraft.leave_kind}
                onChange={(e) =>
                  setLeaveHistDraft({
                    ...leaveHistDraft,
                    leave_kind: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="육아휴직">육아휴직</option>
                <option value="병가휴직">병가휴직</option>
                <option value="가족돌봄휴직">가족돌봄휴직</option>
                <option value="일반휴직">일반휴직</option>
              </select>
            </Field>
            <Field label="시작일">
              <input
                type="date"
                value={leaveHistDraft.start_date}
                onChange={(e) =>
                  setLeaveHistDraft({
                    ...leaveHistDraft,
                    start_date: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="복직(예정)일">
              <input
                type="date"
                value={leaveHistDraft.end_date}
                onChange={(e) =>
                  setLeaveHistDraft({
                    ...leaveHistDraft,
                    end_date: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
          <Field label="사유 메모">
            <input
              value={leaveHistDraft.reason}
              onChange={(e) =>
                setLeaveHistDraft({ ...leaveHistDraft, reason: e.target.value })
              }
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </Field>
        </SubDialog>
      )}

      {editModal === "add_award" && (
        <SubDialog
          title="수상 내역 추가"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!awardDraft.title.trim()) return alert("수상명을 입력하세요.");
            const nextItem: HqAwardItem = {
              id: makeUid(),
              ...awardDraft,
              title: awardDraft.title.trim(),
            };
            patchMember(
              {
                profile_extra: {
                  awards: [nextItem, ...(ex.awards || [])],
                },
              },
              `수상 내역 등록 (${nextItem.title})`
            );
            setAwardDraft({ ...awardDraft, title: "", note: "" });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="수상명 / 표창명">
              <input
                value={awardDraft.title}
                onChange={(e) =>
                  setAwardDraft({ ...awardDraft, title: e.target.value })
                }
                placeholder="예: 올해의 우수 연구원상"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </Field>
            <Field label="수상일">
              <input
                type="date"
                value={awardDraft.awarded_date}
                onChange={(e) =>
                  setAwardDraft({ ...awardDraft, awarded_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="수여 기관">
                <input
                  value={awardDraft.issuer}
                  onChange={(e) =>
                    setAwardDraft({ ...awardDraft, issuer: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </Field>
            </div>
          </div>
        </SubDialog>
      )}

      {editModal === "add_discipline" && (
        <SubDialog
          title="징계 내역 등록 (HR 전용)"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() => {
            if (!disciplineDraft.action_date) return alert("처분일을 입력하세요.");
            const nextItem: HqDisciplineItem = {
              id: makeUid(),
              ...disciplineDraft,
            };
            patchMember(
              {
                profile_extra: {
                  disciplines: [nextItem, ...(ex.disciplines || [])],
                },
              },
              "징계 기록 등록"
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="징계 구분">
              <select
                value={disciplineDraft.kind}
                onChange={(e) =>
                  setDisciplineDraft({
                    ...disciplineDraft,
                    kind: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              >
                <option value="주의">주의</option>
                <option value="경고">경고</option>
                <option value="감봉">감봉</option>
                <option value="정직">정직</option>
              </select>
            </Field>
            <Field label="처분 일자">
              <input
                type="date"
                value={disciplineDraft.action_date}
                onChange={(e) =>
                  setDisciplineDraft({
                    ...disciplineDraft,
                    action_date: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
          </div>
          <Field label="처분 사유">
            <input
              value={disciplineDraft.reason}
              onChange={(e) =>
                setDisciplineDraft({
                  ...disciplineDraft,
                  reason: e.target.value,
                })
              }
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </Field>
        </SubDialog>
      )}

      {/* 12. 메신저 근무시간 · 자동응답 설정 */}
      {editModal === "messenger" && (
        <SubDialog
          title="💬 메신저 근무시간 · 부재중 자동응답"
          saving={saving}
          onClose={() => setEditModal(null)}
          onSubmit={() =>
            patchMember(
              {
                auto_reply_active: msgForm.auto_reply_active,
                chat_allow_start: msgForm.chat_allow_start,
                chat_allow_end: msgForm.chat_allow_end,
                auto_reply_message: msgForm.auto_reply_message,
              },
              "메신저 자동응답 설정 변경"
            )
          }
        >
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800 text-xs">
              <input
                type="checkbox"
                checked={msgForm.auto_reply_active}
                onChange={(e) =>
                  setMsgForm({
                    ...msgForm,
                    auto_reply_active: e.target.checked,
                  })
                }
                className="w-4 h-4 accent-brand rounded"
              />
              <span>업무 외 시간 / 부재중 자동응답 활성화</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="메신저 업무 시작 시각">
                <input
                  type="time"
                  value={msgForm.chat_allow_start}
                  onChange={(e) =>
                    setMsgForm({ ...msgForm, chat_allow_start: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </Field>
              <Field label="메신저 업무 종료 시각">
                <input
                  type="time"
                  value={msgForm.chat_allow_end}
                  onChange={(e) =>
                    setMsgForm({ ...msgForm, chat_allow_end: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </Field>
            </div>
            <Field label="자동응답 안내 문구">
              <textarea
                rows={3}
                value={msgForm.auto_reply_message}
                onChange={(e) =>
                  setMsgForm({
                    ...msgForm,
                    auto_reply_message: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 resize-none"
              />
            </Field>
          </div>
        </SubDialog>
      )}

      {/* 13. 비밀번호 변경 */}
      {editModal === "password" && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <form
            onSubmit={handlePasswordUpdate}
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-xs"
          >
            <h4 className="text-sm font-bold text-slate-900">
              🔑 로그인 비밀번호 변경
            </h4>
            <Field label="새 비밀번호 (6자리 이상)">
              <input
                type="password"
                required
                minLength={6}
                value={pwForm.password}
                onChange={(e) =>
                  setPwForm({ ...pwForm, password: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <Field label="새 비밀번호 확인">
              <input
                type="password"
                required
                minLength={6}
                value={pwForm.confirm}
                onChange={(e) =>
                  setPwForm({ ...pwForm, confirm: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-brand text-white font-bold"
              >
                {saving ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 14. 정보 변경 내역 (Audit Log) */}
      {editModal === "changelog" && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[75vh]">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                🕒 프로필 정보 변경 내역
              </h4>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 flex-1 text-xs">
              {(ex.change_logs || []).length === 0 ? (
                <div className="py-10 text-center text-slate-400">
                  기록된 변경 내역이 없습니다.
                </div>
              ) : (
                (ex.change_logs || []).map((log, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-800">
                        {log.summary}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        변경자: {log.actor_name}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">
                      {new Date(log.at).toLocaleString("ko-KR", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 증명서 인쇄 모달 */}
      <CertificatePrintModal
        isOpen={certOpen}
        member={member}
        onClose={() => setCertOpen(false)}
      />
    </>
  );
}

// ============================================================================
// 내부 UI 헬퍼 컴포넌트 (Flex 스타일 클린 테이블 행)
// ============================================================================

function SectionHeader({
  title,
  rightSubText,
  actionLabel,
  onAction,
}: {
  title: string;
  rightSubText?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between pb-2.5">
      <h3 className="text-[13px] font-bold text-slate-500">{title}</h3>
      <div className="flex items-center gap-3">
        {rightSubText && (
          <span className="text-xs text-slate-400">{rightSubText}</span>
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-xs font-semibold text-slate-400 hover:text-slate-800 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
      <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
        <span className="w-5 text-center text-slate-400 text-xs select-none">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex flex-wrap items-center text-slate-800">
        {children}
      </div>
    </div>
  );
}

function EmptyText({ text = "없음" }: { text?: string }) {
  return <span className="text-slate-300 font-normal">{text}</span>;
}

function PlaceholderBtn({
  text,
  canClick,
  onClick,
}: {
  text: string;
  canClick: boolean;
  onClick: () => void;
}) {
  if (!canClick) return <EmptyText />;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-slate-300 hover:text-brand font-medium transition-colors"
    >
      {text}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function SubDialog({
  title,
  maxWidthClass = "max-w-lg",
  saving,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  maxWidthClass?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`bg-white w-full ${maxWidthClass} rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] text-xs`}
      >
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <h4 className="text-sm font-bold">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto overflow-x-hidden space-y-3 flex-1 custom-scroll">
          {children}
        </div>
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 font-bold"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSubmit}
            className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-bold disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
