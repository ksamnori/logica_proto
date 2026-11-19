// src/components/hq/members/HqMemberProfileModal.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useOptionalHqShell } from "@/components/hq/HqShellContext";
import { useHqHref } from "@/lib/hq/hqRoutes";
import DaumPostcodeModal from "./DaumPostcodeModal";
import {
  HQ_DEFAULT_DEPARTMENTS,
  HQ_RANK_LIST,
  getRankMeta,
} from "@/lib/hq/constants";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import { DEFAULT_DOC_FOLDERS } from "@/lib/hq/defaultApprovalPolicies";
import type {
  HqAwardItem,
  HqCareerItem,
  HqDisciplineItem,
  HqEducationItem,
  HqFamilyItem,
  HqGrowthItem,
  HqLaborContractItem,
  HqLeaveHistoryItem,
  HqMember,
  HqPayPaymentInfoItem,
  HqRankCode,
  HqTrainingItem,
  HqWageContractItem,
  HqWorkStatus,
} from "@/lib/hq/types";
import { getRegisteredOrgNames } from "@/lib/hq/orgTreeHelper";
import CertificatePrintModal from "./CertificatePrintModal";
import {
  HqLaborContractModal,
  HqMemberProfilePdfDownloadModal,
  HqWageContractModal,
  formatDotDateShort,
  formatFixedOvertimeSummary,
  resolveLaborContractsList,
  resolveWageContractsList,
} from "./HqContractModals";
import HqMemberHrChangeModal from "./HqMemberHrChangeModal";
import {
  HqAwardModal,
  HqDisciplineModal,
  HqLeaveHistoryModal,
  HqPayPaymentInfoModal,
  resolvePayPaymentInfosList,
} from "./HqMemberHrRecordModals";
import {
  HqCareerModal,
  HqEducationModal,
  HqFamilyModal,
  HqLeavePolicyChangeModal,
  HqOvertimeCompChangeModal,
  HqSpecialNotesModal,
  HqWorkInfoChangeModal,
  formatTaxReductionLabel,
} from "./HqMemberLowerSectionModals";

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
  | "overtime_comp"
  | "leave_policy"
  | "special"
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
  { id: "sec-pay-info", label: "급여 지급" },
  { id: "sec-work", label: "근무" },
  { id: "sec-overtime-comp", label: "초과 근무 보상" },
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
  const [postcodeOpen, setPostcodeOpen] = useState(false);
  const addressDetailRef = useRef<HTMLInputElement | null>(null);
  const [basicForm, setBasicForm] = useState({
    name: "",
    nickname: "",
    email: "",
    personal_email: "",
    employee_no: "",
    hire_date: "",
    use_group_hire_date: true,
    group_hire_date: "",
    hire_type: "",
    rrn_front: "",
    rrn_gender_digit: "",
    gender: "" as "" | "남" | "여",
    birth_date: "",
    birth_is_lunar: false,
    nationality: "대한민국(KOR)",
    phone: "",
    extension_no: "",
    emergency_contact: "",
    postal_code: "",
    address_base: "",
    address_detail: "",
    bank_name: "",
    bank_account: "",
    account_holder: "",
    military_status: "",
    military_branch: "",
    veteran_disability_type: "",
    veteran_disability_detail: "",
  });

  // 3) 플렉스형 근로계약 / 임금계약 / 프로필 PDF 다운로드 모달 상태
  const [pdfDownloadOpen, setPdfDownloadOpen] = useState(false);
  const [laborModalState, setLaborModalState] = useState<{
    mode: "create" | "edit";
    item?: HqLaborContractItem;
  } | null>(null);
  const [wageModalState, setWageModalState] = useState<{
    mode: "create" | "edit";
    item?: HqWageContractItem;
  } | null>(null);

  // 5) 플렉스형 경력 / 학력 / 가족 추가·수정 모달 상태
  const [careerModalState, setCareerModalState] = useState<{
    mode: "create" | "edit";
    item?: HqCareerItem;
  } | null>(null);

  const [eduModalState, setEduModalState] = useState<{
    mode: "create" | "edit";
    item?: HqEducationItem;
  } | null>(null);

  const [familyModalState, setFamilyModalState] = useState<{
    mode: "create" | "edit";
    item?: HqFamilyItem;
  } | null>(null);

  const [payInfoModalState, setPayInfoModalState] = useState<{
    mode: "create" | "edit";
    item?: HqPayPaymentInfoItem;
  } | null>(null);

  const [leaveHistModalState, setLeaveHistModalState] = useState<{
    mode: "create" | "edit";
    item?: HqLeaveHistoryItem;
  } | null>(null);

  const [awardModalState, setAwardModalState] = useState<{
    mode: "create" | "edit";
    item?: HqAwardItem;
  } | null>(null);

  const [disciplineModalState, setDisciplineModalState] = useState<{
    mode: "create" | "edit";
    item?: HqDisciplineItem;
  } | null>(null);

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
      const legacyAddress = member.address || "";
      const savedBase = mEx.address_base ?? legacyAddress;
      const savedDetail = mEx.address_detail ?? "";
      setBasicForm({
        name: member.name,
        nickname: mEx.nickname || "",
        email: member.email || "",
        personal_email: mEx.personal_email || "",
        employee_no: member.employee_no || "",
        hire_date: member.hire_date || "",
        use_group_hire_date: mEx.use_group_hire_date !== false,
        group_hire_date: mEx.group_hire_date || member.hire_date || "",
        hire_type: mEx.hire_type || "",
        rrn_front: mEx.rrn_front || "",
        rrn_gender_digit: mEx.rrn_gender_digit || "",
        gender: (mEx.gender as "" | "남" | "여") || "",
        birth_date: member.birth_date || "",
        birth_is_lunar: Boolean(mEx.birth_is_lunar),
        nationality: mEx.nationality || "대한민국(KOR)",
        phone: member.phone || "",
        extension_no: member.extension_no || "",
        emergency_contact: member.emergency_contact || "",
        postal_code: mEx.postal_code || "",
        address_base: savedBase,
        address_detail: savedDetail,
        bank_name: member.bank_name || "",
        bank_account: member.bank_account || "",
        account_holder: member.account_holder || member.name,
        military_status: mEx.military_status || "",
        military_branch: mEx.military_branch || "",
        veteran_disability_type: mEx.veteran_disability_type || "",
        veteran_disability_detail: mEx.veteran_disability_detail || "",
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
    const savedBase =
      ex.address_base !== undefined ? ex.address_base : member.address || "";
    const savedDetail = ex.address_detail || "";
    setBasicForm({
      name: member.name,
      nickname: ex.nickname || "",
      email: member.email || "",
      personal_email: ex.personal_email || "",
      employee_no: member.employee_no || "",
      hire_date: member.hire_date || "",
      use_group_hire_date: ex.use_group_hire_date !== false,
      group_hire_date: ex.group_hire_date || member.hire_date || "",
      hire_type: ex.hire_type || "",
      rrn_front: ex.rrn_front || "",
      rrn_gender_digit: ex.rrn_gender_digit || "",
      gender: (ex.gender as "" | "남" | "여") || "",
      birth_date: member.birth_date || "",
      birth_is_lunar: Boolean(ex.birth_is_lunar),
      nationality: ex.nationality || "대한민국(KOR)",
      phone: member.phone || "",
      extension_no: member.extension_no || "",
      emergency_contact: member.emergency_contact || "",
      postal_code: ex.postal_code || "",
      address_base: savedBase,
      address_detail: savedDetail,
      bank_name: member.bank_name || "",
      bank_account: member.bank_account || "",
      account_holder: member.account_holder || member.name,
      military_status: ex.military_status || "",
      military_branch: ex.military_branch || "",
      veteran_disability_type: ex.veteran_disability_type || "",
      veteran_disability_detail: ex.veteran_disability_detail || "",
    });
    setEditModal("basic");
  };

  const laborContractsList = resolveLaborContractsList(member);
  const wageContractsList = resolveWageContractsList(ex);

  const openAddLaborContract = () => {
    setLaborModalState({ mode: "create" });
  };

  const openEditLaborContract = (item: HqLaborContractItem) => {
    setLaborModalState({ mode: "edit", item });
  };

  const handleSaveLaborContract = async (saved: HqLaborContractItem) => {
    const baseList = [...laborContractsList];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.start_date || "").localeCompare(String(a.start_date || ""))
    );
    const primary = baseList[0] || saved;

    await patchMember(
      {
        employment_type: primary.employment_type || member.employment_type,
        profile_extra: {
          labor_contract: primary,
          labor_contracts: baseList,
        },
      },
      laborModalState?.mode === "edit"
        ? "근로 계약 정보 수정"
        : "근로 계약 정보 추가"
    );
    setLaborModalState(null);
  };

  const handleDeleteLaborContract = async (targetId: string) => {
    if (!confirm("이 근로 계약 정보를 삭제하시겠습니까?")) return;
    const nextList = laborContractsList.filter((x) => x.id !== targetId);
    const primary = nextList[0] || {};
    await patchMember(
      {
        ...(primary.employment_type
          ? { employment_type: primary.employment_type }
          : {}),
        profile_extra: {
          labor_contract: primary,
          labor_contracts: nextList,
        },
      },
      "근로 계약 정보 삭제"
    );
    setLaborModalState(null);
  };

  const openAddWageContract = () => {
    setWageModalState({ mode: "create" });
  };

  const openEditWageContract = (item: HqWageContractItem) => {
    setWageModalState({ mode: "edit", item });
  };

  const handleSaveWageContract = async (saved: HqWageContractItem) => {
    const baseList = [...wageContractsList];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.start_date || b.effective_date || "").localeCompare(
        String(a.start_date || a.effective_date || "")
      )
    );
    const primary = baseList[0] || saved;

    await patchMember(
      {
        profile_extra: {
          wage_contract: primary,
          wage_contracts: baseList,
        },
      },
      wageModalState?.mode === "edit"
        ? "임금 계약 정보 수정"
        : "임금 계약 정보 추가"
    );
    setWageModalState(null);
  };

  const handleDeleteWageContract = async (targetId: string) => {
    if (!confirm("이 임금 계약 정보를 삭제하시겠습니까?")) return;
    const nextList = wageContractsList.filter((x) => x.id !== targetId);
    const primary = nextList[0] || {};
    await patchMember(
      {
        profile_extra: {
          wage_contract: primary,
          wage_contracts: nextList,
        },
      },
      "임금 계약 정보 삭제"
    );
    setWageModalState(null);
  };

  const payPaymentInfosList = resolvePayPaymentInfosList(ex);

  const openAddPayPaymentInfo = () => {
    setPayInfoModalState({ mode: "create" });
  };

  const openEditPayPaymentInfo = (item: HqPayPaymentInfoItem) => {
    setPayInfoModalState({ mode: "edit", item });
  };

  const handleSavePayPaymentInfo = async (saved: HqPayPaymentInfoItem) => {
    const baseList = [...payPaymentInfosList];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.effective_date || "").localeCompare(String(a.effective_date || ""))
    );
    const primary = baseList[0];
    await patchMember(
      {
        profile_extra: {
          pay_payment_info: primary,
          pay_payment_infos: baseList,
        },
      },
      payInfoModalState?.mode === "edit"
        ? "급여 지급 정보 수정"
        : "급여 지급 정보 추가"
    );
    setPayInfoModalState(null);
  };

  const handleDeletePayPaymentInfo = async (targetId: string) => {
    if (!confirm("이 급여 지급 정보를 삭제하시겠습니까?")) return;
    const nextList = payPaymentInfosList.filter((x) => x.id !== targetId);
    await patchMember(
      {
        profile_extra: {
          pay_payment_info: nextList[0] || undefined,
          pay_payment_infos: nextList,
        },
      },
      "급여 지급 정보 삭제"
    );
    setPayInfoModalState(null);
  };

  const handleSaveLeaveHistory = async (saved: HqLeaveHistoryItem) => {
    const baseList = [...(ex.leave_histories || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.start_date || "").localeCompare(String(a.start_date || ""))
    );
    await patchMember(
      { profile_extra: { leave_histories: baseList } },
      leaveHistModalState?.mode === "edit" ? "휴직 이력 수정" : "휴직 이력 등록"
    );
    setLeaveHistModalState(null);
  };

  const handleSaveAward = async (saved: HqAwardItem) => {
    const baseList = [...(ex.awards || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.awarded_date || "").localeCompare(String(a.awarded_date || ""))
    );
    await patchMember(
      { profile_extra: { awards: baseList } },
      awardModalState?.mode === "edit"
        ? `수상 내역 수정 (${saved.title})`
        : `수상 내역 등록 (${saved.title})`
    );
    setAwardModalState(null);
  };

  const handleSaveDiscipline = async (saved: HqDisciplineItem) => {
    const baseList = [...(ex.disciplines || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.action_date || "").localeCompare(String(a.action_date || ""))
    );
    await patchMember(
      { profile_extra: { disciplines: baseList } },
      disciplineModalState?.mode === "edit"
        ? `징계 기록 수정 (${saved.kind})`
        : `징계 기록 등록 (${saved.kind})`
    );
    setDisciplineModalState(null);
  };

  const openWorkEdit = () => {
    setEditModal("work");
  };

  const openOvertimeCompEdit = () => {
    setEditModal("overtime_comp");
  };

  const openLeavePolicyEdit = () => {
    setEditModal("leave_policy");
  };

  const openSpecialEdit = () => {
    setEditModal("special");
  };

  const handleSaveCareer = async (saved: HqCareerItem) => {
    const baseList = [...(ex.careers || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.start_ym || "").localeCompare(String(a.start_ym || ""))
    );
    await patchMember(
      { profile_extra: { careers: baseList } },
      careerModalState?.mode === "edit"
        ? `경력 수정 (${saved.company_name})`
        : `경력 추가 (${saved.company_name})`
    );
    setCareerModalState(null);
  };

  const handleSaveEducation = async (saved: HqEducationItem) => {
    const baseList = [...(ex.educations || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.unshift(saved);
    }
    baseList.sort((a, b) =>
      String(b.start_ym || "").localeCompare(String(a.start_ym || ""))
    );
    await patchMember(
      { profile_extra: { educations: baseList } },
      eduModalState?.mode === "edit"
        ? `학력 수정 (${saved.school_name})`
        : `학력 추가 (${saved.school_name})`
    );
    setEduModalState(null);
  };

  const handleSaveFamily = async (saved: HqFamilyItem) => {
    const baseList = [...(ex.families || [])];
    const idx = baseList.findIndex((x) => x.id === saved.id);
    if (idx >= 0) {
      baseList[idx] = saved;
    } else {
      baseList.push(saved);
    }
    await patchMember(
      { profile_extra: { families: baseList } },
      familyModalState?.mode === "edit"
        ? `가족 정보 수정 (${saved.relation} ${saved.name})`
        : `가족 구성원 추가 (${saved.relation} ${saved.name})`
    );
    setFamilyModalState(null);
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
              {canSeePrivate && (
                <button
                  type="button"
                  onClick={() => setPdfDownloadOpen(true)}
                  className="w-8 h-8 rounded-lg bg-black/25 hover:bg-black/45 text-white flex items-center justify-center transition-colors"
                  title="프로필 PDF 다운로드"
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
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
              )}
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
                              {ex.use_group_hire_date === false ? (
                                <span className="text-slate-400 text-xs">
                                  미사용
                                </span>
                              ) : (
                                formatKoreanDate(
                                  ex.group_hire_date || member.hire_date
                                ) || "-"
                              )}
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
                              {birthdayShort
                                ? `${birthdayShort}${
                                    ex.birth_is_lunar ? " (음력)" : ""
                                  }`
                                : "미입력"}
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

                          <InfoRow icon="🎖️" label="병역 사항">
                            {ex.military_status ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-800">
                                  {ex.military_status}
                                </span>
                                {ex.military_branch && (
                                  <span className="text-xs text-slate-500">
                                    ({ex.military_branch})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <PlaceholderBtn
                                text="병역 사항 선택하기"
                                canClick={canEditSelfOrHr}
                                onClick={openBasicEdit}
                              />
                            )}
                          </InfoRow>

                          <InfoRow icon="🤝" label="장애인 · 국가유공자">
                            {ex.veteran_disability_type ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-800">
                                  {ex.veteran_disability_type}
                                </span>
                                {ex.veteran_disability_detail && (
                                  <span className="text-xs text-slate-500">
                                    ({ex.veteran_disability_detail})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <PlaceholderBtn
                                text="해당 여부 선택하기"
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
                      {/* (3) 근로 계약 정보 (플렉스형 + 추가 & 마우스 호버 + 버튼 & 급여지급률 표시) */}
                      <section id="sec-labor" className="scroll-mt-4">
                        <SectionHeader
                          title="근로 계약 정보"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={isHrManager ? openAddLaborContract : undefined}
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {laborContractsList.length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  ✍️
                                </span>
                                <span className="truncate">근로 계약 정보</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                {isHrManager ? (
                                  <PlaceholderBtn
                                    text="입력하기"
                                    canClick={isHrManager}
                                    onClick={openAddLaborContract}
                                  />
                                ) : member.employment_type ? (
                                  <span className="font-semibold text-slate-800">
                                    {member.employment_type}
                                  </span>
                                ) : (
                                  <EmptyText />
                                )}
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={openAddLaborContract}
                                    title="근로 계약 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            laborContractsList.map((lc, idx) => {
                              const periodText = lc.start_date
                                ? `${formatDotDateShort(lc.start_date)} ~ ${
                                    lc.end_date
                                      ? formatDotDateShort(lc.end_date)
                                      : "기간의 정함 없음"
                                  }`
                                : "계약시작일 없음";
                              const probText =
                                lc.probation_start_date || lc.probation_end_date
                                  ? `수습 ${
                                      lc.probation_start_date
                                        ? formatDotDateShort(lc.probation_start_date)
                                        : ""
                                    } ~ ${
                                      lc.probation_end_date
                                        ? formatDotDateShort(lc.probation_end_date)
                                        : ""
                                    }`
                                  : "";
                              return (
                                <div
                                  key={lc.id}
                                  onClick={() => {
                                    if (isHrManager) openEditLaborContract(lc);
                                  }}
                                  className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                    isHrManager
                                      ? "hover:bg-slate-50/80 cursor-pointer"
                                      : ""
                                  }`}
                                >
                                  <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                    <span className="w-5 text-center text-slate-400 text-xs select-none">
                                      ✍️
                                    </span>
                                    <span className="truncate">
                                      {idx === 0 ? "근로 계약 정보" : "이전 근로 계약"}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-slate-800">
                                        {lc.employment_type || member.employment_type}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {periodText}
                                      </span>
                                      {probText && (
                                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-bold">
                                          {probText}
                                        </span>
                                      )}
                                      {lc.salary_pay_rate !== undefined &&
                                        lc.salary_pay_rate !== null && (
                                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[11px] font-bold">
                                            급여지급률 {lc.salary_pay_rate}%
                                          </span>
                                        )}
                                      {lc.memo && isHrManager && (
                                        <span
                                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold"
                                          title={lc.memo}
                                        >
                                          🔒 메모
                                        </span>
                                      )}
                                    </div>

                                    {isHrManager && (
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                          수정
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openAddLaborContract();
                                          }}
                                          title="근로 계약 추가하기"
                                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>

                      {/* (4) 임금 계약 정보 (플렉스형 마우스 호버 + 버튼 & 포괄임금제 상세 표시) */}
                      <section id="sec-wage" className="scroll-mt-4">
                        <SectionHeader
                          title="임금 계약 정보"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={isHrManager ? openAddWageContract : undefined}
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {wageContractsList.length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 h-5 rounded-full border border-slate-300 text-slate-400 text-[10px] font-bold flex items-center justify-center select-none">
                                  ₩
                                </span>
                                <span className="truncate">임금 계약 정보</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={isHrManager}
                                  onClick={openAddWageContract}
                                />
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={openAddWageContract}
                                    title="임금 계약 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            wageContractsList.map((wc, idx) => {
                              const incomeLabel = wc.income_type || "근로소득";
                              const unitLabel = wc.amount_unit || "연봉";
                              const displayAmt =
                                wc.contract_amount ??
                                wc.annual_salary ??
                                wc.monthly_base ??
                                0;
                              const otSummary = formatFixedOvertimeSummary(
                                wc.fixed_overtime
                              );
                              const startStr =
                                wc.start_date || wc.effective_date || "";
                              const dateBadge = startStr
                                ? `${formatDotDateShort(startStr)}${
                                    wc.end_date
                                      ? ` ~ ${formatDotDateShort(wc.end_date)}`
                                      : " ~"
                                  }`
                                : "계약시작일 없음";

                              return (
                                <div
                                  key={wc.id}
                                  onClick={() => {
                                    if (isHrManager) openEditWageContract(wc);
                                  }}
                                  className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                    isHrManager
                                      ? "hover:bg-slate-50/80 cursor-pointer"
                                      : ""
                                  }`}
                                >
                                  <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                    <span className="w-5 h-5 rounded-full border border-slate-300 text-slate-400 text-[10px] font-bold flex items-center justify-center select-none">
                                      ₩
                                    </span>
                                    <span className="truncate">
                                      {idx === 0 ? "임금 계약 정보" : "이전 임금 계약"}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                        {incomeLabel}
                                      </span>
                                      {incomeLabel === "무보수" ? (
                                        <span className="font-bold text-slate-700">
                                          무보수
                                        </span>
                                      ) : (
                                        <span className="font-extrabold text-slate-900">
                                          {unitLabel}{" "}
                                          {Number(displayAmt).toLocaleString()}원
                                        </span>
                                      )}
                                      {otSummary && (
                                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] border border-emerald-200/70 text-[11px] font-bold">
                                          포괄 {otSummary}
                                        </span>
                                      )}
                                      <span className="text-xs text-slate-400">
                                        {dateBadge}
                                      </span>
                                      {wc.memo && isHrManager && (
                                        <span
                                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold"
                                          title={wc.memo}
                                        >
                                          🔒 메모
                                        </span>
                                      )}
                                    </div>

                                    {isHrManager && (
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                          수정
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openAddWageContract();
                                          }}
                                          title="임금 계약 추가하기"
                                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>

                      {/* (4-2) 급여 지급 정보 🔒 (플렉스형 + 추가 & 마우스 호버 + 버튼) */}
                      <section id="sec-pay-info" className="scroll-mt-4">
                        <div className="flex items-center justify-between pb-2.5">
                          <h3 className="text-[13px] font-bold text-slate-500 inline-flex items-center gap-1.5">
                            <span>급여 지급 정보</span>
                            <svg
                              className="w-3.5 h-3.5 text-slate-300"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </h3>
                          {isHrManager && (
                            <button
                              type="button"
                              onClick={openAddPayPaymentInfo}
                              className="text-xs font-semibold text-slate-400 hover:text-slate-800 transition-colors"
                            >
                              + 추가
                            </button>
                          )}
                        </div>

                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {payPaymentInfosList.length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  💰
                                </span>
                                <span className="truncate">급여 지급 정보</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={isHrManager}
                                  onClick={openAddPayPaymentInfo}
                                />
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={openAddPayPaymentInfo}
                                    title="급여 지급 정보 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            payPaymentInfosList.map((pi, idx) => {
                              const effText = pi.effective_date
                                ? `${formatDotDateShort(pi.effective_date)} ~`
                                : "적용일 없음";
                              const nonZeroItems = (pi.items || []).filter(
                                (it) => it.amount > 0
                              );
                              return (
                                <div
                                  key={pi.id}
                                  onClick={() => {
                                    if (isHrManager) openEditPayPaymentInfo(pi);
                                  }}
                                  className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                    isHrManager
                                      ? "hover:bg-slate-50/80 cursor-pointer"
                                      : ""
                                  }`}
                                >
                                  <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                    <span className="w-5 text-center text-slate-400 text-xs select-none">
                                      💰
                                    </span>
                                    <span className="truncate">
                                      {idx === 0
                                        ? "급여 지급 정보"
                                        : "이전 급여 지급 정보"}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-extrabold text-slate-900">
                                        월 지급액{" "}
                                        {Number(
                                          pi.monthly_total || 0
                                        ).toLocaleString()}
                                        원
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        (연간{" "}
                                        {Number(
                                          pi.annual_total || 0
                                        ).toLocaleString()}
                                        원)
                                      </span>
                                      {nonZeroItems.slice(0, 3).map((it) => (
                                        <span
                                          key={it.pay_item_id}
                                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold"
                                        >
                                          {it.name}{" "}
                                          {it.amount.toLocaleString()}원
                                        </span>
                                      ))}
                                      {pi.ordinary_hourly_wage > 0 && (
                                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-bold">
                                          통상시급{" "}
                                          {pi.ordinary_hourly_wage.toLocaleString()}
                                          원
                                        </span>
                                      )}
                                      <span className="text-xs text-slate-400">
                                        {effText}
                                      </span>
                                    </div>

                                    {isHrManager && (
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                          수정
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openAddPayPaymentInfo();
                                          }}
                                          title="급여 지급 정보 추가하기"
                                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>

                      {/* (5) 근무 정보 (플렉스 스타일) */}
                      <section id="sec-work" className="scroll-mt-4">
                        <SectionHeader
                          title="근무 정보"
                          rightSubText={
                            ex.work_effective_date || member.hire_date
                              ? `🕒 ${formatDotDateShort(
                                  ex.work_effective_date || member.hire_date
                                )} - 현재`
                              : undefined
                          }
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openWorkEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <div
                            onClick={() => {
                              if (isHrManager) openWorkEdit();
                            }}
                            className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                              isHrManager
                                ? "hover:bg-slate-50/80 cursor-pointer"
                                : ""
                            }`}
                          >
                            <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                              <span className="w-5 text-center text-slate-400 text-xs select-none">
                                🧳
                              </span>
                              <span className="truncate">근무 유형</span>
                            </div>
                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-800">
                                  {ex.work_schedule_type || "기본 9시"}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/70 text-[11px] font-bold">
                                  {ex.work_schedule_mode || "고정"}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                  주 {weeklyHours}시간
                                </span>
                              </div>
                              {isHrManager && (
                                <span className="text-slate-300 group-hover:text-slate-500 text-base leading-none shrink-0 pr-1">
                                  ›
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* (5-2) 초과 근무 보상 정보 🔒 (플렉스 스타일) */}
                      <section id="sec-overtime-comp" className="scroll-mt-4">
                        <div className="flex items-center justify-between pb-2.5">
                          <h3 className="text-[13px] font-bold text-slate-500 inline-flex items-center gap-1.5">
                            <span>초과 근무 보상 정보</span>
                            <svg
                              className="w-3.5 h-3.5 text-slate-300"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </h3>
                          <div className="flex items-center gap-3">
                            {(ex.overtime_comp_effective_date ||
                              member.hire_date) && (
                              <span className="text-xs text-slate-400">
                                🕒{" "}
                                {formatDotDateShort(
                                  ex.overtime_comp_effective_date ||
                                    member.hire_date
                                )}{" "}
                                - 현재
                              </span>
                            )}
                            {isHrManager && (
                              <button
                                type="button"
                                onClick={openOvertimeCompEdit}
                                className="text-xs font-semibold text-slate-400 hover:text-slate-800 transition-colors"
                              >
                                ✏️ 변경
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="border-t border-slate-100">
                          <div
                            onClick={() => {
                              if (isHrManager) openOvertimeCompEdit();
                            }}
                            className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                              isHrManager
                                ? "hover:bg-slate-50/80 cursor-pointer"
                                : ""
                            }`}
                          >
                            <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                              <span className="w-5 text-center text-slate-400 text-xs select-none">
                                🔥
                              </span>
                              <span className="truncate">초과 근무 보상 정책</span>
                            </div>
                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-800 mr-2">
                                  {ex.overtime_comp_policy_name ||
                                    "기본 초과 근무 보상 정책"}
                                </span>
                                <span className="text-slate-400 text-xs">
                                  포괄 계약 공제 주기
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {(
                                    ex.overtime_comp_cycle_label ||
                                    "매달 1일 - 매달 31일 (말일)"
                                  ).replace(/\s*~\s*/g, " - ")}
                                </span>
                              </div>
                              {isHrManager && (
                                <span className="text-slate-300 group-hover:text-slate-500 text-base leading-none shrink-0 pr-1">
                                  ›
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* (6) 휴가 정보 (플렉스 스타일) */}
                      <section id="sec-leave" className="scroll-mt-4">
                        <SectionHeader
                          title="휴가 정보"
                          actionLabel={isHrManager ? "✏️ 변경" : undefined}
                          onAction={isHrManager ? openLeavePolicyEdit : undefined}
                        />
                        <div className="border-t border-slate-100">
                          <div
                            onClick={() => {
                              if (isHrManager) openLeavePolicyEdit();
                            }}
                            className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                              isHrManager
                                ? "hover:bg-slate-50/80 cursor-pointer"
                                : ""
                            }`}
                          >
                            <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                              <span className="w-5 text-center text-slate-400 text-xs select-none">
                                🏖️
                              </span>
                              <span className="truncate">연차 정책</span>
                            </div>
                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
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
                              </div>
                              {isHrManager && (
                                <span className="text-slate-300 group-hover:text-slate-500 text-base leading-none shrink-0 pr-1">
                                  ›
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* (7) 쉬는 날 정보 (플렉스 스타일) */}
                      <section id="sec-holiday" className="scroll-mt-4">
                        <SectionHeader
                          title="쉬는 날 정보"
                          actionLabel={isHrManager ? "✏️ 변경" : "쉬는 날 보기 ›"}
                          onAction={() => {
                            shell?.openSettingsModal("holidays");
                          }}
                        />
                        <div className="border-t border-slate-100">
                          <div
                            onClick={() => {
                              shell?.openSettingsModal("holidays");
                            }}
                            className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/80 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4"
                          >
                            <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                              <span className="w-5 text-center text-slate-400 text-xs select-none">
                                📅
                              </span>
                              <span className="truncate">쉬는 날</span>
                            </div>
                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                              <div className="flex items-center min-w-0">
                                {(() => {
                                  const curYear = String(
                                    new Date().getFullYear()
                                  );
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
                                      "1월 1일, 설날, 3 · 1절, 부처님 오신 날, 노동절, 어린이날, 현충일, 제헌절, 광복절, 추석, 개천절, 한글날, 성탄절...";
                                  return (
                                    <>
                                      <span className="font-semibold text-slate-800 mr-2.5 shrink-0">
                                        기본 ({totalDays}일)
                                      </span>
                                      <span className="text-slate-400 text-xs truncate max-w-md">
                                        {names}
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                              <span className="text-slate-300 group-hover:text-slate-500 text-base leading-none shrink-0 pr-1">
                                ›
                              </span>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* (8) 휴직 이력 (플렉스형 + 추가 & 호버 + 버튼) */}
                      <section id="sec-leave-hist" className="scroll-mt-4">
                        <SectionHeader
                          title="휴직 이력"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={
                            isHrManager
                              ? () => setLeaveHistModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.leave_histories || []).length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  🌿
                                </span>
                                <span className="truncate">휴직 이력</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={isHrManager}
                                  onClick={() =>
                                    setLeaveHistModalState({ mode: "create" })
                                  }
                                />
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLeaveHistModalState({ mode: "create" })
                                    }
                                    title="휴직 등록하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            (ex.leave_histories || []).map((lh) => (
                              <div
                                key={lh.id}
                                onClick={() => {
                                  if (isHrManager)
                                    setLeaveHistModalState({
                                      mode: "edit",
                                      item: lh,
                                    });
                                }}
                                className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                  isHrManager
                                    ? "hover:bg-slate-50/80 cursor-pointer"
                                    : ""
                                }`}
                              >
                                <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                  <span className="w-5 text-center text-slate-400 text-xs select-none">
                                    🌿
                                  </span>
                                  <span className="truncate font-semibold text-slate-700">
                                    {lh.leave_kind}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-slate-800">
                                      {formatDotDateShort(lh.start_date)} ~{" "}
                                      {lh.end_date
                                        ? formatDotDateShort(lh.end_date)
                                        : "진행중"}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                      근속{" "}
                                      {lh.include_in_tenure !== false
                                        ? "포함"
                                        : "미포함"}
                                    </span>
                                    {lh.salary_pay_rate !== undefined &&
                                      lh.salary_pay_rate !== null && (
                                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[11px] font-bold">
                                          급여지급률 {lh.salary_pay_rate}%
                                        </span>
                                      )}
                                    {lh.memo && isHrManager && (
                                      <span
                                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold"
                                        title={lh.memo}
                                      >
                                        🔒 메모
                                      </span>
                                    )}
                                  </div>
                                  {isHrManager && (
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                        수정
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLeaveHistModalState({
                                            mode: "create",
                                          });
                                        }}
                                        title="휴직 등록하기"
                                        className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (9) 수상 (플렉스형 + 추가 & 호버 + 버튼) */}
                      <section id="sec-award" className="scroll-mt-4">
                        <SectionHeader
                          title="수상"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setAwardModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.awards || []).length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  🏅
                                </span>
                                <span className="truncate">수상</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={canEditSelfOrHr}
                                  onClick={() =>
                                    setAwardModalState({ mode: "create" })
                                  }
                                />
                                {canEditSelfOrHr && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAwardModalState({ mode: "create" })
                                    }
                                    title="수상 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            (ex.awards || []).map((aw) => (
                              <div
                                key={aw.id}
                                onClick={() => {
                                  if (canEditSelfOrHr)
                                    setAwardModalState({
                                      mode: "edit",
                                      item: aw,
                                    });
                                }}
                                className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                  canEditSelfOrHr
                                    ? "hover:bg-slate-50/80 cursor-pointer"
                                    : ""
                                }`}
                              >
                                <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                  <span className="w-5 text-center text-slate-400 text-xs select-none">
                                    🏅
                                  </span>
                                  <span className="truncate font-semibold text-slate-800">
                                    {aw.title}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-slate-700 font-medium">
                                      {formatKoreanDate(aw.awarded_date)}
                                    </span>
                                    {aw.issuer_type && (
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                        {aw.issuer_type}
                                      </span>
                                    )}
                                    {aw.issuer && (
                                      <span className="text-slate-500">
                                        {aw.issuer}
                                      </span>
                                    )}
                                    {aw.note && (
                                      <span className="text-xs text-slate-400 truncate max-w-[240px]">
                                        · {aw.note}
                                      </span>
                                    )}
                                  </div>
                                  {canEditSelfOrHr && (
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                        수정
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAwardModalState({
                                            mode: "create",
                                          });
                                        }}
                                        title="수상 추가하기"
                                        className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (10) 징계 (플렉스형 + 추가 & 호버 + 버튼) */}
                      <section id="sec-discipline" className="scroll-mt-4">
                        <SectionHeader
                          title="징계"
                          actionLabel={isHrManager ? "+ 추가" : undefined}
                          onAction={
                            isHrManager
                              ? () =>
                                  setDisciplineModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.disciplines || []).length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  ⚖️
                                </span>
                                <span className="truncate">징계</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={isHrManager}
                                  onClick={() =>
                                    setDisciplineModalState({ mode: "create" })
                                  }
                                />
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDisciplineModalState({ mode: "create" })
                                    }
                                    title="징계 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            (ex.disciplines || []).map((ds) => (
                              <div
                                key={ds.id}
                                onClick={() => {
                                  if (isHrManager)
                                    setDisciplineModalState({
                                      mode: "edit",
                                      item: ds,
                                    });
                                }}
                                className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                  isHrManager
                                    ? "hover:bg-slate-50/80 cursor-pointer"
                                    : ""
                                }`}
                              >
                                <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                  <span className="w-5 text-center text-slate-400 text-xs select-none">
                                    ⚖️
                                  </span>
                                  <span className="truncate font-semibold text-slate-800">
                                    {ds.kind}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-slate-700 font-medium">
                                      {ds.end_date && ds.end_date !== ds.action_date
                                        ? `${formatDotDateShort(ds.action_date)} ~ ${formatDotDateShort(ds.end_date)}`
                                        : formatKoreanDate(ds.action_date)}
                                    </span>
                                    {ds.reason && (
                                      <span className="text-slate-500">
                                        {ds.reason}
                                      </span>
                                    )}
                                  </div>
                                  {isHrManager && (
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                        수정
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDisciplineModalState({
                                            mode: "create",
                                          });
                                        }}
                                        title="징계 추가하기"
                                        className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (11) 경력 정보 (플렉스 스타일) */}
                      <section id="sec-career" className="scroll-mt-4">
                        <SectionHeader
                          title="경력 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setCareerModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.careers || []).length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  🏢
                                </span>
                                <span className="truncate">경력 정보</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={canEditSelfOrHr}
                                  onClick={() =>
                                    setCareerModalState({ mode: "create" })
                                  }
                                />
                                {canEditSelfOrHr && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCareerModalState({ mode: "create" })
                                    }
                                    title="경력 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            (ex.careers || []).map((c) => {
                              const dur = calcYmDuration(c.start_ym, c.end_ym);
                              return (
                                <div
                                  key={c.id}
                                  onClick={() => {
                                    if (canEditSelfOrHr)
                                      setCareerModalState({
                                        mode: "edit",
                                        item: c,
                                      });
                                  }}
                                  className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                    canEditSelfOrHr
                                      ? "hover:bg-slate-50/80 cursor-pointer"
                                      : ""
                                  }`}
                                >
                                  <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                    <span className="w-5 text-center text-slate-400 text-xs select-none">
                                      🏢
                                    </span>
                                    <span className="truncate font-semibold text-slate-800">
                                      {c.company_name}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-slate-400">기간</span>
                                      <span className="font-semibold text-slate-800">
                                        {formatKoreanYm(c.start_ym)} –{" "}
                                        {formatKoreanYm(c.end_ym)}
                                      </span>
                                      {dur && (
                                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                          {dur}
                                        </span>
                                      )}
                                      <span className="text-slate-400 ml-1">
                                        계약유형
                                      </span>
                                      <span className="font-semibold text-slate-800">
                                        {c.contract_type}
                                      </span>
                                      {(c.job_role ||
                                        c.department ||
                                        c.job_title) && (
                                        <span className="text-xs text-slate-500">
                                          ·{" "}
                                          {[
                                            c.job_role,
                                            c.department,
                                            c.job_title,
                                          ]
                                            .filter(Boolean)
                                            .join(" / ")}
                                        </span>
                                      )}
                                    </div>
                                    {canEditSelfOrHr && (
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                          수정
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCareerModalState({
                                              mode: "create",
                                            });
                                          }}
                                          title="경력 추가하기"
                                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>

                      {/* (12) 학력 정보 (플렉스 스타일) */}
                      <section id="sec-edu" className="scroll-mt-4">
                        <SectionHeader
                          title="학력 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setEduModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(ex.educations || []).length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  🎓
                                </span>
                                <span className="truncate">학력 정보</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={canEditSelfOrHr}
                                  onClick={() =>
                                    setEduModalState({ mode: "create" })
                                  }
                                />
                                {canEditSelfOrHr && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEduModalState({ mode: "create" })
                                    }
                                    title="학력 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            (ex.educations || []).map((ed) => (
                              <div
                                key={ed.id}
                                onClick={() => {
                                  if (canEditSelfOrHr)
                                    setEduModalState({
                                      mode: "edit",
                                      item: ed,
                                    });
                                }}
                                className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                  canEditSelfOrHr
                                    ? "hover:bg-slate-50/80 cursor-pointer"
                                    : ""
                                }`}
                              >
                                <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                  <span className="w-5 text-center text-slate-400 text-xs select-none">
                                    🎓
                                  </span>
                                  <span className="truncate font-semibold text-slate-800">
                                    {ed.school_name}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(ed.start_ym || ed.end_ym) && (
                                      <>
                                        <span className="text-slate-400">
                                          기간
                                        </span>
                                        <span className="font-semibold text-slate-800 mr-1">
                                          {formatKoreanYm(ed.start_ym)} –{" "}
                                          {formatKoreanYm(ed.end_ym)}
                                        </span>
                                      </>
                                    )}
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                      {ed.graduation_status}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                                      {ed.degree_type}
                                    </span>
                                    {ed.major && (
                                      <span className="text-xs text-slate-500 ml-1">
                                        {ed.major}
                                      </span>
                                    )}
                                  </div>
                                  {canEditSelfOrHr && (
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                        수정
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEduModalState({ mode: "create" });
                                        }}
                                        title="학력 추가하기"
                                        className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {/* (13) 특이사항 (플렉스 스타일) */}
                      <section id="sec-special" className="scroll-mt-4">
                        <SectionHeader
                          title="특이사항"
                          actionLabel={canEditSelfOrHr ? "✏️ 변경" : undefined}
                          onAction={canEditSelfOrHr ? openSpecialEdit : undefined}
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {(() => {
                            const sp = ex.special_notes_detail || {};
                            const hasCc = Boolean(
                              sp.childcare_short_work_start ||
                                sp.childcare_short_work_end
                            );
                            const hasFg = Boolean(
                              sp.foreigner_flat_tax_start ||
                                sp.foreigner_flat_tax_end
                            );
                            const hasTx = Boolean(
                              sp.income_tax_reduction_code ||
                                sp.income_tax_reduction_start
                            );
                            const hasNotes = Boolean(ex.special_notes);
                            const hasAny = hasCc || hasFg || hasTx || hasNotes;

                            return (
                              <div
                                onClick={() => {
                                  if (canEditSelfOrHr && hasAny) openSpecialEdit();
                                }}
                                className={`group py-3.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                  canEditSelfOrHr && hasAny
                                    ? "hover:bg-slate-50/80 cursor-pointer"
                                    : ""
                                }`}
                              >
                                <div className="w-44 shrink-0 flex items-center gap-2 text-slate-500 font-medium">
                                  <span className="w-5 text-center text-slate-400 text-xs select-none">
                                    🙂
                                  </span>
                                  <span className="truncate font-semibold text-slate-700">
                                    특이사항
                                  </span>
                                  <span
                                    title="육아기 단축 근무, 외국인 단일 세율, 중소기업 취업자 소득세 감면 등 인사·급여 특이사항을 관리합니다."
                                    className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] font-bold inline-flex items-center justify-center cursor-help shrink-0"
                                  >
                                    ?
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                                  {!hasAny ? (
                                    <PlaceholderBtn
                                      text="입력하기"
                                      canClick={canEditSelfOrHr}
                                      onClick={openSpecialEdit}
                                    />
                                  ) : (
                                    <>
                                      {hasCc && (
                                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-[#00a84b] text-[11px] font-bold">
                                          육아기 단축 근무{" "}
                                          {formatDotDateShort(
                                            sp.childcare_short_work_start
                                          )}{" "}
                                          –{" "}
                                          {formatDotDateShort(
                                            sp.childcare_short_work_end
                                          )}
                                        </span>
                                      )}
                                      {hasFg && (
                                        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold">
                                          외국인 단일 세율{" "}
                                          {formatDotDateShort(
                                            sp.foreigner_flat_tax_start
                                          )}{" "}
                                          –{" "}
                                          {formatDotDateShort(
                                            sp.foreigner_flat_tax_end
                                          )}
                                        </span>
                                      )}
                                      {hasTx && (
                                        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 text-[11px] font-bold">
                                          {formatTaxReductionLabel(
                                            sp.income_tax_reduction_code
                                          ) || "소득세 감면"}
                                          {sp.income_tax_reduction_start && (
                                            <span className="ml-1.5 font-semibold text-violet-600">
                                              (
                                              {formatDotDateShort(
                                                sp.income_tax_reduction_start
                                              )}{" "}
                                              –{" "}
                                              {formatDotDateShort(
                                                sp.income_tax_reduction_end
                                              )}
                                              )
                                            </span>
                                          )}
                                        </span>
                                      )}
                                      {hasNotes && (
                                        <span className="text-slate-700 font-medium">
                                          {ex.special_notes}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                          {isHrManager && member.hr_memo && (
                            <InfoRow icon="🔒" label="인사 비공개 메모">
                              <span className="text-amber-800 font-medium">
                                {member.hr_memo}
                              </span>
                            </InfoRow>
                          )}
                        </div>
                      </section>

                      {/* (14) 가족 정보 (플렉스 스타일) */}
                      <section id="sec-family" className="scroll-mt-4 pb-6">
                        <SectionHeader
                          title="가족 정보"
                          actionLabel={canEditSelfOrHr ? "+ 추가" : undefined}
                          onAction={
                            canEditSelfOrHr
                              ? () => setFamilyModalState({ mode: "create" })
                              : undefined
                          }
                        />
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {families.length === 0 ? (
                            <div className="group py-3.5 px-2 -mx-2 rounded-lg hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                              <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                <span className="w-5 text-center text-slate-400 text-xs select-none">
                                  👤
                                </span>
                                <span className="truncate">가족 구성원</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <PlaceholderBtn
                                  text="입력하기"
                                  canClick={canEditSelfOrHr}
                                  onClick={() =>
                                    setFamilyModalState({ mode: "create" })
                                  }
                                />
                                {canEditSelfOrHr && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFamilyModalState({ mode: "create" })
                                    }
                                    title="가족 정보 추가하기"
                                    className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="py-2 divide-y divide-slate-50">
                              {families.map((fm, idx) => (
                                <div
                                  key={fm.id}
                                  onClick={() => {
                                    if (canEditSelfOrHr)
                                      setFamilyModalState({
                                        mode: "edit",
                                        item: fm,
                                      });
                                  }}
                                  className={`group py-2.5 px-2 -mx-2 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 ${
                                    canEditSelfOrHr
                                      ? "hover:bg-slate-50/80 cursor-pointer"
                                      : ""
                                  }`}
                                >
                                  <div className="w-44 shrink-0 flex items-center gap-2.5 text-slate-500 font-medium">
                                    <span className="w-5 text-center text-slate-400 text-xs select-none">
                                      {idx === 0 ? "👤" : ""}
                                    </span>
                                    <span className="truncate">
                                      {idx === 0 ? "가족 구성원" : ""}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                                        {fm.relation}
                                      </span>
                                      <span className="font-semibold text-slate-800">
                                        {fm.name}
                                      </span>
                                      {(fm.rrn_masked || fm.birth_date) && (
                                        <span className="text-xs text-slate-400 font-mono">
                                          {fm.rrn_masked || fm.birth_date}
                                        </span>
                                      )}
                                      {fm.phone && (
                                        <span className="text-xs text-slate-400">
                                          · {fm.phone}
                                        </span>
                                      )}
                                      {fm.basic_deduction && (
                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                                          기본공제
                                        </span>
                                      )}
                                      {fm.health_dependent && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[10px] font-bold">
                                          건보피부양자
                                        </span>
                                      )}
                                      {fm.is_cohabiting && (
                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                          동거
                                        </span>
                                      )}
                                      {fm.disability_veteran_type &&
                                        fm.disability_veteran_type !==
                                          "비대상" && (
                                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">
                                            {fm.disability_veteran_type}
                                          </span>
                                        )}
                                    </div>
                                    {canEditSelfOrHr && (
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <span className="text-[11px] text-slate-400 font-semibold mr-0.5">
                                          수정
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setFamilyModalState({
                                              mode: "create",
                                            });
                                          }}
                                          title="가족 정보 추가하기"
                                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-2xs flex items-center justify-center text-sm font-bold"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="py-3.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                            <div className="w-44 shrink-0 flex items-center gap-2 text-slate-500 font-medium">
                              <span className="w-5 text-center text-slate-400 text-xs select-none">
                                🧮
                              </span>
                              <span className="truncate font-semibold text-slate-700">
                                총 공제 대상
                              </span>
                              <span
                                title="본인 1명을 포함한 연말정산 기본 공제 인원 및 건강보험 피부양자 수입니다."
                                className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] font-bold inline-flex items-center justify-center cursor-help shrink-0"
                              >
                                ?
                              </span>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-wrap items-center text-slate-800">
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
                            </div>
                          </div>
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
                          {ex.wage_contract?.income_type === "무보수"
                            ? "무보수"
                            : ex.wage_contract?.contract_amount
                              ? `${ex.wage_contract.amount_unit || "연봉"} ${Number(
                                  ex.wage_contract.contract_amount
                                ).toLocaleString()}원`
                              : ex.wage_contract?.annual_salary
                                ? `연봉 ${Number(
                                    ex.wage_contract.annual_salary
                                  ).toLocaleString()}원`
                                : ex.wage_contract?.monthly_base
                                  ? `월 기본급 ${Number(
                                      ex.wage_contract.monthly_base
                                    ).toLocaleString()}원`
                                  : "임금 계약 미입력"}
                        </div>
                        {ex.wage_contract?.fixed_overtime?.enabled && (
                          <div className="text-xs font-bold text-[#00a84b]">
                            포괄계약:{" "}
                            {formatFixedOvertimeSummary(
                              ex.wage_contract.fixed_overtime
                            )}
                          </div>
                        )}
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

                      <div className="sm:col-span-2 p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-900 text-xs">
                            🧾 근로소득 원천징수영수증 (연말정산)
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            금융기관 대출·청약 제출용 귀속연도별 근로소득 원천징수영수증 PDF를 내려받거나 간소화 자료를 제출합니다.
                          </p>
                        </div>
                        <Link
                          href={hqHref("/hq/year-end-tax")}
                          onClick={onClose}
                          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
                        >
                          연말정산 보관함 이동 →
                        </Link>
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
                          onClick={openAddLaborContract}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          + 근로계약 추가
                        </button>
                        <button
                          type="button"
                          onClick={openAddWageContract}
                          className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold"
                        >
                          + 임금계약 추가
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
                            표준 근로계약서 (
                            {ex.labor_contract?.employment_type ||
                              member.employment_type}
                            )
                          </span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-bold">
                            적용중
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>
                            근로 유형:{" "}
                            {ex.labor_contract?.employment_type ||
                              ex.labor_contract?.contract_type ||
                              member.employment_type}
                          </div>
                          <div>
                            계약 기간:{" "}
                            {ex.labor_contract?.start_date ||
                              member.hire_date ||
                              "-"}{" "}
                            ~ {ex.labor_contract?.end_date || "기간의 정함 없음"}
                          </div>
                          {(ex.labor_contract?.probation_start_date ||
                            ex.labor_contract?.probation_end_date ||
                            (ex.labor_contract?.salary_pay_rate !== undefined &&
                              ex.labor_contract?.salary_pay_rate !== null)) && (
                            <div>
                              수습 정보:{" "}
                              {ex.labor_contract?.probation_start_date ||
                              ex.labor_contract?.probation_end_date
                                ? `${ex.labor_contract?.probation_start_date || ""} ~ ${ex.labor_contract?.probation_end_date || ""}`
                                : "기간 미지정"}
                              {ex.labor_contract?.salary_pay_rate !==
                                undefined &&
                              ex.labor_contract?.salary_pay_rate !== null
                                ? ` · 급여지급률 ${ex.labor_contract.salary_pay_rate}%`
                                : ""}
                            </div>
                          )}
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
                            임금(포괄임금) 계약서
                          </span>
                          <span className="text-xs text-slate-400">
                            적용일:{" "}
                            {ex.wage_contract?.start_date ||
                              ex.wage_contract?.effective_date ||
                              "계약시작일 없음"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>
                            소득 유형 · 임금 형태:{" "}
                            {ex.wage_contract?.income_type || "근로소득"} ·{" "}
                            {ex.wage_contract?.wage_type || "연봉제"}
                          </div>
                          <div>
                            계약 금액:{" "}
                            {ex.wage_contract?.income_type === "무보수"
                              ? "무보수"
                              : ex.wage_contract?.contract_amount
                                ? `${ex.wage_contract.amount_unit || "연봉"} ${Number(
                                    ex.wage_contract.contract_amount
                                  ).toLocaleString()}원`
                                : ex.wage_contract?.annual_salary
                                  ? `${Number(
                                      ex.wage_contract.annual_salary
                                    ).toLocaleString()}원`
                                  : "미등록"}
                          </div>
                          {ex.wage_contract?.fixed_overtime?.enabled && (
                            <div className="text-[#00a84b] font-semibold">
                              포괄계약 근로시간:{" "}
                              {formatFixedOvertimeSummary(
                                ex.wage_contract.fixed_overtime
                              )}
                            </div>
                          )}
                          {ex.wage_contract?.other_terms && (
                            <div className="text-slate-500">
                              기타 계약 내용: {ex.wage_contract.other_terms}
                            </div>
                          )}
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
                      <span>
                        {birthdayShort
                          ? `${birthdayShort}${
                              ex.birth_is_lunar ? " (음력)" : ""
                            }`
                          : "생일 미등록"}
                      </span>
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

            const combinedAddress = [
              basicForm.address_base.trim(),
              basicForm.address_detail.trim(),
            ]
              .filter(Boolean)
              .join(" ");

            const payload: Record<string, unknown> = {
              phone: basicForm.phone,
              email: basicForm.email,
              extension_no: basicForm.extension_no,
              emergency_contact: basicForm.emergency_contact,
              birth_date: effBirthDate || null,
              address: combinedAddress,
              bank_name: basicForm.bank_name,
              bank_account: basicForm.bank_account,
              account_holder: basicForm.account_holder,
              profile_extra: {
                nickname: basicForm.nickname.trim(),
                personal_email: basicForm.personal_email.trim(),
                rrn_front: cleanFront,
                rrn_gender_digit: cleanDigit,
                gender: derivedGender,
                birth_is_lunar: Boolean(basicForm.birth_is_lunar),
                nationality: basicForm.nationality.trim() || "대한민국(KOR)",
                postal_code: basicForm.postal_code.trim(),
                address_base: basicForm.address_base.trim(),
                address_detail: basicForm.address_detail.trim(),
                military_status: basicForm.military_status,
                military_branch: basicForm.military_branch.trim(),
                veteran_disability_type: basicForm.veteran_disability_type,
                veteran_disability_detail:
                  basicForm.veteran_disability_detail.trim(),
                ...(isHrManager
                  ? {
                      use_group_hire_date: Boolean(
                        basicForm.use_group_hire_date
                      ),
                      group_hire_date: basicForm.use_group_hire_date
                        ? basicForm.group_hire_date || basicForm.hire_date
                        : "",
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
              <div className="sm:col-span-2 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="입사일 *">
                    <input
                      type="date"
                      value={basicForm.hire_date}
                      onChange={(e) => {
                        const nextHire = e.target.value;
                        setBasicForm((prev) => ({
                          ...prev,
                          hire_date: nextHire,
                          group_hire_date:
                            prev.use_group_hire_date &&
                            (!prev.group_hire_date ||
                              prev.group_hire_date === prev.hire_date)
                              ? nextHire
                              : prev.group_hire_date,
                        }));
                      }}
                      className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-semibold"
                    />
                  </Field>
                  <Field
                    label={
                      basicForm.use_group_hire_date
                        ? "그룹 입사일 *"
                        : "그룹 입사일 (미사용)"
                    }
                  >
                    <input
                      type="date"
                      disabled={!basicForm.use_group_hire_date}
                      value={
                        basicForm.use_group_hire_date
                          ? basicForm.group_hire_date
                          : ""
                      }
                      onChange={(e) =>
                        setBasicForm({
                          ...basicForm,
                          group_hire_date: e.target.value,
                        })
                      }
                      className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </Field>
                </div>

                {/* 플렉스 스타일 '그룹 입사일 사용하기' 토글 스위치 */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={basicForm.use_group_hire_date}
                    onClick={() =>
                      setBasicForm((prev) => {
                        const nextUse = !prev.use_group_hire_date;
                        return {
                          ...prev,
                          use_group_hire_date: nextUse,
                          group_hire_date:
                            nextUse && !prev.group_hire_date
                              ? prev.hire_date
                              : prev.group_hire_date,
                        };
                      })
                    }
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                      basicForm.use_group_hire_date
                        ? "bg-[#00c73c]"
                        : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                        basicForm.use_group_hire_date ? "left-4.5" : "left-0.5"
                      }`}
                    />
                  </button>
                  <span
                    onClick={() =>
                      setBasicForm((prev) => {
                        const nextUse = !prev.use_group_hire_date;
                        return {
                          ...prev,
                          use_group_hire_date: nextUse,
                          group_hire_date:
                            nextUse && !prev.group_hire_date
                              ? prev.hire_date
                              : prev.group_hire_date,
                        };
                      })
                    }
                    className="text-xs font-bold text-slate-700 cursor-pointer select-none"
                  >
                    그룹 입사일 사용하기
                  </span>
                  <span className="text-[11px] text-slate-400">
                    (법정 연차는 입사일을 기준으로 산정됩니다)
                  </span>
                </div>

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
                    <option value="">입사 유형 선택</option>
                    <option value="신입">신입</option>
                    <option value="경력">경력</option>
                    <option value="전배">전배</option>
                    <option value="재입사">재입사</option>
                  </select>
                </Field>
              </div>
            )}

            <Field label="주민등록번호 (예: 000101 - 4)">
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
                      if (
                        !prev.birth_is_lunar &&
                        front.length === 6 &&
                        prev.rrn_gender_digit
                      ) {
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
                  placeholder="000101"
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
                      if (
                        !prev.birth_is_lunar &&
                        digit &&
                        /^\d{6}$/.test(prev.rrn_front)
                      ) {
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
                  placeholder="4"
                  className="w-10 shrink-0 px-1 py-2.5 rounded-xl border border-slate-300 font-mono text-center font-bold"
                />
                <span className="text-slate-400 font-mono text-xs tracking-wider select-none shrink-0">
                  ••••••
                </span>
              </div>
            </Field>

            <Field
              label="생년월일"
              rightSlot={
                <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={basicForm.birth_is_lunar}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        birth_is_lunar: e.target.checked,
                      })
                    }
                    className="w-3.5 h-3.5 rounded accent-brand cursor-pointer"
                  />
                  <span>음력</span>
                </label>
              }
            >
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
                <div className="space-y-2">
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
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
                      className="w-28 shrink-0 px-3 py-2.5 rounded-xl border border-slate-300 font-mono text-center font-bold bg-slate-50/60"
                    />
                    <button
                      type="button"
                      onClick={() => setPostcodeOpen(true)}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold shrink-0 whitespace-nowrap"
                    >
                      🔍 주소 검색
                    </button>
                    <input
                      value={basicForm.address_base}
                      onChange={(e) =>
                        setBasicForm({
                          ...basicForm,
                          address_base: e.target.value,
                        })
                      }
                      placeholder="도로명 / 지번 기본주소"
                      className="flex-1 min-w-[200px] px-3 py-2.5 rounded-xl border border-slate-300"
                    />
                  </div>
                  <input
                    ref={addressDetailRef}
                    value={basicForm.address_detail}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        address_detail: e.target.value,
                      })
                    }
                    placeholder="상세주소 입력 (예: A동 1403호, 층·호수)"
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
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

            {/* 병역 사항 (Screenshot 4) */}
            <div className="sm:col-span-2">
              <Field label="병역 사항">
                <div className="space-y-2">
                  <select
                    value={basicForm.military_status}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        military_status: e.target.value,
                        military_branch:
                          e.target.value === "" || e.target.value === "해당없음"
                            ? ""
                            : basicForm.military_branch,
                      })
                    }
                    className={`w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold ${
                      basicForm.military_status
                        ? "text-slate-900"
                        : "text-slate-400"
                    }`}
                  >
                    <option value="">병역 사항 선택</option>
                    <option value="해당없음">해당없음</option>
                    <option value="군필">군필 (만기·의병·조기전역 등)</option>
                    <option value="미필">미필</option>
                    <option value="복무중">복무중 (산업기능·전문연구요원 등)</option>
                    <option value="면제">면제 (전시근로역·병역면제)</option>
                  </select>
                  {basicForm.military_status &&
                    basicForm.military_status !== "해당없음" &&
                    basicForm.military_status !== "미필" && (
                      <input
                        value={basicForm.military_branch}
                        onChange={(e) =>
                          setBasicForm({
                            ...basicForm,
                            military_branch: e.target.value,
                          })
                        }
                        placeholder="군별 · 계급 · 전역구분 또는 사유 입력 (예: 육군 병장 만기전역, 선택)"
                        className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                      />
                    )}
                </div>
              </Field>
            </div>

            {/* 장애인 · 국가유공자 (Screenshot 4) */}
            <div className="sm:col-span-2">
              <Field label="장애인 · 국가유공자">
                <div className="space-y-2">
                  <select
                    value={basicForm.veteran_disability_type}
                    onChange={(e) =>
                      setBasicForm({
                        ...basicForm,
                        veteran_disability_type: e.target.value,
                        veteran_disability_detail:
                          e.target.value === "" || e.target.value === "해당없음"
                            ? ""
                            : basicForm.veteran_disability_detail,
                      })
                    }
                    className={`w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold ${
                      basicForm.veteran_disability_type
                        ? "text-slate-900"
                        : "text-slate-400"
                    }`}
                  >
                    <option value="">종류 선택</option>
                    <option value="해당없음">해당없음</option>
                    <option value="장애인">장애인</option>
                    <option value="국가유공자">국가유공자 (보훈대상자)</option>
                    <option value="장애인 및 국가유공자">
                      장애인 및 국가유공자
                    </option>
                  </select>
                  {basicForm.veteran_disability_type &&
                    basicForm.veteran_disability_type !== "해당없음" && (
                      <input
                        value={basicForm.veteran_disability_detail}
                        onChange={(e) =>
                          setBasicForm({
                            ...basicForm,
                            veteran_disability_detail: e.target.value,
                          })
                        }
                        placeholder="장애 정도(중증·경증) · 보훈번호 · 보훈관계 등 세부 내용 입력 (선택)"
                        className="w-full min-w-0 px-3 py-2.5 rounded-xl border border-slate-300"
                      />
                    )}
                </div>
              </Field>
            </div>
          </div>
        </SubDialog>
      )}

      <DaumPostcodeModal
        open={postcodeOpen}
        onClose={() => setPostcodeOpen(false)}
        onSelect={({ postalCode, baseAddress }) => {
          setBasicForm((prev) => ({
            ...prev,
            postal_code: postalCode,
            address_base: baseAddress,
          }));
          setTimeout(() => {
            addressDetailRef.current?.focus();
          }, 80);
        }}
      />

      {/* 3. 플렉스형 근로 계약 추가하기 / 수정하기 (수습 기간 + 급여지급률 %) */}
      {laborModalState && (
        <HqLaborContractModal
          key={`${laborModalState.mode}_${laborModalState.item?.id || "new"}`}
          mode={laborModalState.mode}
          initialItem={laborModalState.item || null}
          defaultEmploymentType={member.employment_type || "정규직"}
          saving={saving}
          onClose={() => setLaborModalState(null)}
          onSave={handleSaveLaborContract}
          onDelete={
            laborModalState.mode === "edit" && laborModalState.item?.id
              ? () => handleDeleteLaborContract(laborModalState.item!.id)
              : undefined
          }
        />
      )}

      {/* 4. 플렉스형 임금 계약 추가하기 / 수정하기 (포괄계약 근로시간 설정 서브모달 포함) */}
      {wageModalState && (
        <HqWageContractModal
          key={`${wageModalState.mode}_${wageModalState.item?.id || "new"}`}
          mode={wageModalState.mode}
          initialItem={wageModalState.item || null}
          weeklyWorkHours={weeklyHours}
          saving={saving}
          onClose={() => setWageModalState(null)}
          onSave={handleSaveWageContract}
          onDelete={
            wageModalState.mode === "edit" && wageModalState.item?.id
              ? () => handleDeleteWageContract(wageModalState.item!.id)
              : undefined
          }
        />
      )}

      {/* 구성원 프로필 PDF 다운로드 모달 */}
      {pdfDownloadOpen && (
        <HqMemberProfilePdfDownloadModal
          isOpen={pdfDownloadOpen}
          members={[member]}
          companyName={
            shell?.companySettings?.company_name || "(주)천종현수학연구소"
          }
          appointments={
            shell?.companySettings?.extra_settings?.hr_lifecycle_state
              ?.appointments || []
          }
          onClose={() => setPdfDownloadOpen(false)}
        />
      )}

      {/* 5. 플렉스형 근무 정보 변경하기 */}
      {editModal === "work" && (
        <HqWorkInfoChangeModal
          currentScheduleName={ex.work_schedule_type || "기본 9시"}
          currentEffectiveDate={ex.work_effective_date}
          workRules={companyExtra?.work_rules}
          saving={saving}
          onOpenSettings={
            isHrManager && shell?.openSettingsModal
              ? () => shell.openSettingsModal("work-type")
              : undefined
          }
          onClose={() => setEditModal(null)}
          onSave={(payload) =>
            patchMember(
              { profile_extra: payload },
              `근무 정보 변경 (${payload.work_schedule_type})`
            )
          }
        />
      )}

      {/* 5-2. 플렉스형 초과 근무 보상 정보 변경하기 */}
      {editModal === "overtime_comp" && (
        <HqOvertimeCompChangeModal
          currentPolicyName={
            ex.overtime_comp_policy_name || "기본 초과 근무 보상 정책"
          }
          currentEffectiveDate={ex.overtime_comp_effective_date}
          policies={companyExtra?.overtime_comp_settings?.policies}
          saving={saving}
          onOpenSettings={
            isHrManager && shell?.openSettingsModal
              ? () => shell.openSettingsModal("overtime-comp")
              : undefined
          }
          onClose={() => setEditModal(null)}
          onSave={(payload) =>
            patchMember(
              { profile_extra: payload },
              `초과 근무 보상 정책 변경 (${payload.overtime_comp_policy_name})`
            )
          }
        />
      )}

      {/* 6. 플렉스형 연차 정책 변경하기 */}
      {editModal === "leave_policy" && (
        <HqLeavePolicyChangeModal
          currentPolicyName={ex.leave_policy_name || "기본 연차 정책"}
          policies={companyExtra?.annual_leave_settings?.policies}
          saving={saving}
          onOpenSettings={
            isHrManager && shell?.openSettingsModal
              ? () => shell.openSettingsModal("leave-setting")
              : undefined
          }
          onClose={() => setEditModal(null)}
          onSave={(payload) =>
            patchMember(
              { profile_extra: payload },
              `연차 정책 변경 (${payload.leave_policy_name})`
            )
          }
        />
      )}

      {/* 7. 플렉스형 특이사항 수정하기 */}
      {editModal === "special" && (
        <HqSpecialNotesModal
          initialDetail={ex.special_notes_detail}
          initialSpecialNotes={ex.special_notes}
          initialHrMemo={member.hr_memo || ""}
          isHrManager={isHrManager}
          saving={saving}
          onClose={() => setEditModal(null)}
          onSave={(payload) =>
            patchMember(
              {
                ...(isHrManager && payload.hr_memo !== undefined
                  ? { hr_memo: payload.hr_memo }
                  : {}),
                profile_extra: {
                  special_notes: payload.special_notes,
                  special_notes_detail: payload.special_notes_detail,
                },
              },
              "특이사항 수정"
            )
          }
        />
      )}

      {/* 8. 플렉스형 경력 추가하기 / 수정하기 */}
      {careerModalState && (
        <HqCareerModal
          key={`car_${careerModalState.mode}_${careerModalState.item?.id || "new"}`}
          mode={careerModalState.mode}
          initialItem={careerModalState.item || null}
          saving={saving}
          onClose={() => setCareerModalState(null)}
          onSave={handleSaveCareer}
          onDelete={
            careerModalState.mode === "edit" && careerModalState.item?.id
              ? () => {
                  const id = careerModalState.item!.id;
                  setCareerModalState(null);
                  removeArrayItem("careers", id, "경력");
                }
              : undefined
          }
        />
      )}

      {/* 9. 플렉스형 학력 추가하기 / 수정하기 */}
      {eduModalState && (
        <HqEducationModal
          key={`edu_${eduModalState.mode}_${eduModalState.item?.id || "new"}`}
          mode={eduModalState.mode}
          initialItem={eduModalState.item || null}
          saving={saving}
          onClose={() => setEduModalState(null)}
          onSave={handleSaveEducation}
          onDelete={
            eduModalState.mode === "edit" && eduModalState.item?.id
              ? () => {
                  const id = eduModalState.item!.id;
                  setEduModalState(null);
                  removeArrayItem("educations", id, "학력");
                }
              : undefined
          }
        />
      )}

      {/* 10. 플렉스형 가족 정보 추가하기 / 수정하기 */}
      {familyModalState && (
        <HqFamilyModal
          key={`fam_${familyModalState.mode}_${familyModalState.item?.id || "new"}`}
          mode={familyModalState.mode}
          initialItem={familyModalState.item || null}
          saving={saving}
          onClose={() => setFamilyModalState(null)}
          onSave={handleSaveFamily}
          onDelete={
            familyModalState.mode === "edit" && familyModalState.item?.id
              ? () => {
                  const id = familyModalState.item!.id;
                  setFamilyModalState(null);
                  removeArrayItem("families", id, "가족");
                }
              : undefined
          }
        />
      )}

      {/* 11-1. 플렉스형 급여 지급 정보 추가하기 / 수정하기 */}
      {payInfoModalState && (
        <HqPayPaymentInfoModal
          key={`pay_${payInfoModalState.mode}_${payInfoModalState.item?.id || "new"}`}
          mode={payInfoModalState.mode}
          initialItem={payInfoModalState.item || null}
          wageContracts={wageContractsList}
          companyPayItems={companyExtra?.payroll_settings?.pay_items}
          weeklyWorkHours={weeklyHours}
          saving={saving}
          onOpenPayrollSettings={
            isHrManager && shell?.openSettingsModal
              ? () => shell.openSettingsModal("payroll-payment")
              : undefined
          }
          onClose={() => setPayInfoModalState(null)}
          onSave={handleSavePayPaymentInfo}
          onDelete={
            payInfoModalState.mode === "edit" && payInfoModalState.item?.id
              ? () => handleDeletePayPaymentInfo(payInfoModalState.item!.id)
              : undefined
          }
        />
      )}

      {/* 11-2. 플렉스형 휴직 등록하기 / 수정하기 */}
      {leaveHistModalState && (
        <HqLeaveHistoryModal
          key={`lvh_${leaveHistModalState.mode}_${leaveHistModalState.item?.id || "new"}`}
          mode={leaveHistModalState.mode}
          initialItem={leaveHistModalState.item || null}
          saving={saving}
          onClose={() => setLeaveHistModalState(null)}
          onSave={handleSaveLeaveHistory}
          onDelete={
            leaveHistModalState.mode === "edit" && leaveHistModalState.item?.id
              ? () => {
                  const id = leaveHistModalState.item!.id;
                  setLeaveHistModalState(null);
                  removeArrayItem("leave_histories", id, "휴직 이력");
                }
              : undefined
          }
        />
      )}

      {/* 11-3. 플렉스형 수상 추가하기 / 수정하기 */}
      {awardModalState && (
        <HqAwardModal
          key={`awd_${awardModalState.mode}_${awardModalState.item?.id || "new"}`}
          mode={awardModalState.mode}
          initialItem={awardModalState.item || null}
          companyName={
            shell?.companySettings?.company_name || "(주)천종현수학연구소"
          }
          saving={saving}
          onClose={() => setAwardModalState(null)}
          onSave={handleSaveAward}
          onDelete={
            awardModalState.mode === "edit" && awardModalState.item?.id
              ? () => {
                  const id = awardModalState.item!.id;
                  setAwardModalState(null);
                  removeArrayItem("awards", id, "수상");
                }
              : undefined
          }
        />
      )}

      {/* 11-4. 플렉스형 징계 추가하기 / 수정하기 */}
      {disciplineModalState && (
        <HqDisciplineModal
          key={`dsc_${disciplineModalState.mode}_${disciplineModalState.item?.id || "new"}`}
          mode={disciplineModalState.mode}
          initialItem={disciplineModalState.item || null}
          customKinds={(ex.disciplines || []).map((d) => d.kind)}
          saving={saving}
          onClose={() => setDisciplineModalState(null)}
          onSave={handleSaveDiscipline}
          onDelete={
            disciplineModalState.mode === "edit" &&
            disciplineModalState.item?.id
              ? () => {
                  const id = disciplineModalState.item!.id;
                  setDisciplineModalState(null);
                  removeArrayItem("disciplines", id, "징계");
                }
              : undefined
          }
        />
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
  rightSlot,
  children,
}: {
  label: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="block text-[11px] font-bold text-slate-600">
          {label}
        </label>
        {rightSlot}
      </div>
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
