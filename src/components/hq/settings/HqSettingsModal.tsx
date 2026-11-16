// src/components/hq/settings/HqSettingsModal.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  DEFAULT_HOLIDAYS_2025,
  DEFAULT_HOLIDAYS_2026,
  DEFAULT_HOLIDAYS_2027,
} from "@/lib/hq/defaultCompanySettings";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import type {
  HqAffiliateItem,
  HqApprovalPolicyCategory,
  HqCompanySeal,
  HqCompanySettings,
  HqHolidayGroup,
  HqHolidayItem,
} from "@/lib/hq/types";
import HqAnnualLeaveSettingsSection from "./HqAnnualLeaveSettingsSection";
import HqApprovalPolicySection, {
  HqApprovalLabelsSection,
  HqSubstituteApprovalModal,
} from "./HqApprovalPolicySection";
import {
  HqCustomInfoModal,
  HqDocBoxSettingsSection,
} from "./HqCustomInfoDocBoxSection";
import HqCustomLeaveSettingsSection from "./HqCustomLeaveSettingsSection";
import HqHrInfoSettingsSection from "./HqHrInfoSettingsSection";
import HqOvertimeCompSettingsSection from "./HqOvertimeCompSettingsSection";
import {
  HqPayrollDeductionSection,
  HqPayrollPaymentSection,
} from "./HqPayrollPayDeductionSection";
import {
  HqPayrollSettlementSection,
  HqPayrollTaxWorkplaceSection,
} from "./HqPayrollSettlementWorkplaceSection";
import HqRetireeDocSettingsSection from "./HqRetireeDocSettingsSection";
import HqWorkPolicySettingsSection from "./HqWorkPolicySettingsSection";
import HqWorkTypeSettingsSection from "./HqWorkTypeSettingsSection";
import HqWorkplaceSettingsSection from "./HqWorkplaceSettingsSection";

export type HqSettingsTab =
  | "company"
  | "holidays"
  | "seal"
  | "affiliates"
  | "hr-info"
  | "doc-box"
  | "approval-policy"
  | "approval-labels"
  | "work-type"
  | "work-policy"
  | "overtime-comp"
  | "work-place"
  | "leave-setting"
  | "custom-leave"
  | "payroll-payment"
  | "payroll-deduction"
  | "payroll-settlement"
  | "payroll-workplace"
  | "retiree-doc";

interface Props {
  isOpen: boolean;
  mode?: "modal" | "page";
  initialTab?: string;
  onClose: () => void;
}

interface TenantBranchOption {
  tenant_id: string;
  name: string;
  tenant_type: string;
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatKoreanFullDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

/**
 * 도장 스캔 이미지의 밝은(흰색) 배경 픽셀을 자동 투명화하여 깨끗한 PNG File로 변환
 */
async function removeWhiteBackgroundFromImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 420;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(file);

      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // 밝은 회색~흰색 배경 투명화
        if (r > 228 && g > 228 && b > 228) {
          data[i + 3] = 0;
        } else if (r > 205 && g > 205 && b > 205) {
          data[i + 3] = Math.round(data[i + 3] * 0.35);
        }
      }
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        resolve(new File([blob], "seal_transparent.png", { type: "image/png" }));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    img.src = objectUrl;
  });
}

/**
 * 법인명 텍스트로 고해상도 전통 원형 / 사각 붉은 전자직인 PNG 생성
 */
function renderGeneratedSealDataUrl(
  sealText: string,
  shape: "CIRCLE" | "SQUARE"
): string {
  const size = 280;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.clearRect(0, 0, size, size);
  const red = "#d62828";
  ctx.strokeStyle = red;
  ctx.fillStyle = red;

  const clean =
    sealText.replace(/\(주\)|주식회사|\s+/g, "").trim() || "천종현수학연구소인";
  const withIn = clean.endsWith("인") ? clean : `${clean}인`;

  if (shape === "CIRCLE") {
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 118, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 104, 0, Math.PI * 2);
    ctx.stroke();

    const mid = Math.ceil(withIn.length / 2);
    const line1 = withIn.slice(0, mid);
    const line2 = withIn.slice(mid);

    ctx.font = "900 40px 'Malgun Gothic', 'Pretendard', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(line1, size / 2, size / 2 - 26, 175);
    ctx.fillText(line2, size / 2, size / 2 + 28, 175);
  } else {
    ctx.lineWidth = 10;
    ctx.strokeRect(26, 26, size - 52, size - 52);
    ctx.lineWidth = 3;
    ctx.strokeRect(38, 38, size - 76, size - 76);

    const cols = Math.ceil(Math.sqrt(withIn.length));
    const padded = withIn.padEnd(cols * cols, " ");
    const cell = (size - 96) / cols;

    ctx.font = `900 ${Math.floor(cell * 0.72)}px 'Malgun Gothic', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 전통 인장 우→좌 세로 배열 느낌으로 배치
    let idx = 0;
    for (let c = cols - 1; c >= 0; c--) {
      for (let r = 0; r < cols; r++) {
        const ch = padded[idx++] || "";
        if (ch.trim()) {
          ctx.fillText(
            ch,
            48 + c * cell + cell / 2,
            48 + r * cell + cell / 2
          );
        }
      }
    }
  }

  return canvas.toDataURL("image/png");
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: "image/png" });
}

export default function HqSettingsModal({
  isOpen,
  mode = "modal",
  initialTab = "company",
  onClose,
}: Props) {
  const router = useRouter();
  const {
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshCompanySettings,
  } = useHqShell();

  const canEdit = isHrManager || isHqAdmin;

  const [activeTab, setActiveTab] = useState<HqSettingsTab>(
    (initialTab as HqSettingsTab) || "company"
  );
  const [settings, setSettings] = useState<HqCompanySettings>(companySettings);
  const [tenantBranches, setTenantBranches] = useState<TenantBranchOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const [customInfoModalOpen, setCustomInfoModalOpen] = useState(false);
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [approvalPolicySubCat, setApprovalPolicySubCat] =
    useState<HqApprovalPolicyCategory>("workflow");

  // 1) 회사 정보 로컬 폼 상태
  const [editingName, setEditingName] = useState(false);
  const [companyNameDraft, setCompanyNameDraft] = useState("");
  const [ceoDropdownOpen, setCeoDropdownOpen] = useState(false);
  const [customCeoInput, setCustomCeoInput] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [foundedDraft, setFoundedDraft] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [bizNoDraft, setBizNoDraft] = useState("");
  const [corpNoDraft, setCorpNoDraft] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 2) 쉬는 날 상태
  const [selectedYear, setSelectedYear] = useState("2026");
  const [openHolidayMenuId, setOpenHolidayMenuId] = useState<string | null>(null);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<HqHolidayItem | null>(null);
  const [holidayForm, setHolidayForm] = useState({
    name: "",
    start_date: "2026-08-01",
    end_date: "",
    date_text: "",
    icon: "🎉",
    days_count: "1",
    is_annual: true,
    is_mandatory: false,
    substitute_label: "",
  });
  const [holidayGroupModalOpen, setHolidayGroupModalOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: "",
    description: "",
    target_dept: "",
  });

  // 3) 회사 직인 상태
  const [sealModalOpen, setSealModalOpen] = useState(false);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [sealTab, setSealTab] = useState<"UPLOAD" | "GENERATE">("UPLOAD");
  const [sealName, setSealName] = useState("법인 대표 직인");
  const [autoTransparent, setAutoTransparent] = useState(true);
  const [sealUploadFile, setSealUploadFile] = useState<File | null>(null);
  const [sealPreviewUrl, setSealPreviewUrl] = useState<string | null>(null);
  const [genText, setGenText] = useState("천종현수학연구소인");
  const [genShape, setGenShape] = useState<"CIRCLE" | "SQUARE">("CIRCLE");
  const [genPreviewUrl, setGenPreviewUrl] = useState<string>("");

  // 4) 계열사 관리 상태
  const [copiedCode, setCopiedCode] = useState(false);
  const [affiliateModalOpen, setAffiliateModalOpen] = useState(false);
  const [editingAffiliate, setEditingAffiliate] =
    useState<HqAffiliateItem | null>(null);
  const [openAffiliateMenuId, setOpenAffiliateMenuId] = useState<string | null>(
    null
  );
  const [affiliateForm, setAffiliateForm] = useState({
    name: "",
    relation_type: "계열사" as HqAffiliateItem["relation_type"],
    ceo_name: "천종현",
    founded_date: "2024-03-01",
    business_reg_no: "",
    company_code: "",
    address: "",
    tenant_id: "",
  });

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const syncFromSettings = useCallback((s: HqCompanySettings) => {
    setSettings(s);
    setCompanyNameDraft(s.company_name);
    setPhoneDraft(s.phone);
    setFoundedDraft(s.founded_date);
    setAddressDraft(s.address);
    setBizNoDraft(s.business_reg_no || "");
    setCorpNoDraft(s.corp_reg_no || "");
    setGenText(
      `${s.company_name.replace(/\(주\)|주식회사|\s+/g, "")}인` ||
        "천종현수학연구소인"
    );
  }, []);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab as HqSettingsTab);
  }, [initialTab]);

  useEffect(() => {
    rightPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    syncFromSettings(companySettings);
    hqFetch<{
      success: boolean;
      data: {
        settings: HqCompanySettings;
        tenantBranches: TenantBranchOption[];
      };
    }>("/api/hq/settings")
      .then((res) => {
        if (res.data?.settings) syncFromSettings(res.data.settings);
        if (res.data?.tenantBranches) setTenantBranches(res.data.tenantBranches);
      })
      .catch(() => {});
  }, [isOpen, companySettings, syncFromSettings]);

  useEffect(() => {
    if (!sealModalOpen || sealTab !== "GENERATE") return;
    setGenPreviewUrl(renderGeneratedSealDataUrl(genText, genShape));
  }, [sealModalOpen, sealTab, genText, genShape]);

  const activeMemberCount = useMemo(
    () => members.filter((m) => m.work_status === "재직").length,
    [members]
  );

  if (!isOpen) return null;

  const savePartialSettings = async (
    patch: Partial<HqCompanySettings>,
    successText = "설정이 저장되었습니다."
  ) => {
    if (!canEdit) {
      alert("설정 변경 권한이 없습니다. (인사관리자·최고관리자 전용)");
      return;
    }
    setSaving(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { settings: HqCompanySettings };
      }>("/api/hq/settings", {
        method: "PATCH",
        body: patch as Record<string, unknown>,
      });
      if (res.data?.settings) {
        syncFromSettings(res.data.settings);
      }
      await refreshCompanySettings();
      showToast(successText);
    } catch (err: any) {
      alert(err?.message || "설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  // =========================================================================
  // 1) 회사 정보 핸들러
  // =========================================================================
  const coverPublicUrl = resolveStoragePublicUrl(settings.cover_image_url);
  const logoPublicUrl = resolveStoragePublicUrl(settings.logo_image_url);

  const isCompanyInfoDirty =
    companyNameDraft.trim() !== settings.company_name ||
    phoneDraft.trim() !== settings.phone ||
    foundedDraft !== settings.founded_date ||
    addressDraft.trim() !== settings.address ||
    bizNoDraft.trim() !== (settings.business_reg_no || "") ||
    corpNoDraft.trim() !== (settings.corp_reg_no || "");

  const handleSaveCompanyInfo = () => {
    savePartialSettings(
      {
        company_name: companyNameDraft.trim() || settings.company_name,
        phone: phoneDraft.trim(),
        founded_date: foundedDraft,
        address: addressDraft.trim(),
        business_reg_no: bizNoDraft.trim(),
        corp_reg_no: corpNoDraft.trim(),
      },
      "회사 기본 정보가 저장되었습니다."
    );
    setEditingName(false);
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_company_cover");
      await savePartialSettings(
        { cover_image_url: path },
        "커버 사진이 변경되었습니다."
      );
    } catch (err: any) {
      alert(err?.message || "커버 업로드 실패");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_company_logo");
      await savePartialSettings(
        { logo_image_url: path },
        "회사 로고가 변경되었습니다."
      );
    } catch (err: any) {
      alert(err?.message || "로고 업로드 실패");
    } finally {
      setUploadingLogo(false);
    }
  };

  const toggleCeoName = (name: string) => {
    if (!canEdit) return;
    const exists = settings.ceo_names.includes(name);
    const next = exists
      ? settings.ceo_names.filter((x) => x !== name)
      : [...settings.ceo_names, name];
    if (next.length === 0) {
      alert("최소 1명의 대표자가 지정되어야 합니다.");
      return;
    }
    savePartialSettings({ ceo_names: next }, "대표자 정보가 업데이트되었습니다.");
  };

  // =========================================================================
  // 2) 쉬는 날 핸들러
  // =========================================================================
  const yearHolidays = settings.holidays_by_year[selectedYear] || [];
  const totalHolidayDays = yearHolidays.reduce(
    (sum, h) => sum + Number(h.days_count ?? 1),
    0
  );

  const openAddHoliday = () => {
    setEditingHoliday(null);
    setHolidayForm({
      name: "",
      start_date: `${selectedYear}-08-01`,
      end_date: "",
      date_text: "",
      icon: "🎉",
      days_count: "1",
      is_annual: true,
      is_mandatory: false,
      substitute_label: "",
    });
    setHolidayModalOpen(true);
  };

  const openEditHoliday = (h: HqHolidayItem) => {
    setOpenHolidayMenuId(null);
    setEditingHoliday(h);
    setHolidayForm({
      name: h.name,
      start_date: h.start_date,
      end_date: h.end_date || "",
      date_text: h.date_text,
      icon: h.icon || "📅",
      days_count: String(h.days_count ?? 1),
      is_annual: Boolean(h.is_annual),
      is_mandatory: Boolean(h.is_mandatory),
      substitute_label: h.substitute_label || "",
    });
    setHolidayModalOpen(true);
  };

  const handleSaveHoliday = async () => {
    if (!holidayForm.name.trim() || !holidayForm.start_date) {
      alert("휴일 이름과 시작 날짜를 입력해주세요.");
      return;
    }
    const sParts = holidayForm.start_date.split("-").map(Number);
    const autoDateText =
      holidayForm.date_text.trim() ||
      (holidayForm.end_date
        ? `${sParts[1]}월 ${sParts[2]}일 ~ ${Number(
            holidayForm.end_date.split("-")[1]
          )}월 ${Number(holidayForm.end_date.split("-")[2])}일`
        : `${sParts[1]}월 ${sParts[2]}일`);

    const item: HqHolidayItem = {
      id: editingHoliday ? editingHoliday.id : makeId(),
      name: holidayForm.name.trim(),
      start_date: holidayForm.start_date,
      end_date: holidayForm.end_date || undefined,
      date_text: autoDateText,
      icon: holidayForm.icon || "🎉",
      days_count: Math.max(0, Number(holidayForm.days_count || 1)),
      is_annual: holidayForm.is_annual,
      is_mandatory: holidayForm.is_mandatory,
      substitute_label: holidayForm.substitute_label || undefined,
      is_custom: editingHoliday ? editingHoliday.is_custom : true,
    };

    const nextList = editingHoliday
      ? yearHolidays.map((x) => (x.id === editingHoliday.id ? item : x))
      : [...yearHolidays, item];

    nextList.sort((a, b) => a.start_date.localeCompare(b.start_date));

    await savePartialSettings(
      {
        holidays_by_year: {
          ...settings.holidays_by_year,
          [selectedYear]: nextList,
        },
      },
      editingHoliday ? "쉬는 날이 수정되었습니다." : "새 쉬는 날이 추가되었습니다."
    );
    setHolidayModalOpen(false);
  };

  const handleDeleteHoliday = async (id: string) => {
    setOpenHolidayMenuId(null);
    if (!confirm("이 쉬는 날 항목을 목록에서 삭제하시겠습니까?")) return;
    const nextList = yearHolidays.filter((x) => x.id !== id);
    await savePartialSettings(
      {
        holidays_by_year: {
          ...settings.holidays_by_year,
          [selectedYear]: nextList,
        },
      },
      "쉬는 날이 삭제되었습니다."
    );
  };

  const handleResetHolidays = async () => {
    if (
      !confirm(`${selectedYear}년 법정 공휴일 기본 목록으로 초기화하시겠습니까?`)
    ) {
      return;
    }
    const defaults =
      selectedYear === "2025"
        ? DEFAULT_HOLIDAYS_2025
        : selectedYear === "2027"
          ? DEFAULT_HOLIDAYS_2027
          : DEFAULT_HOLIDAYS_2026;
    await savePartialSettings(
      {
        holidays_by_year: {
          ...settings.holidays_by_year,
          [selectedYear]: defaults,
        },
      },
      `${selectedYear}년 기본 법정 공휴일로 복원되었습니다.`
    );
  };

  const handleAddHolidayGroup = async () => {
    if (!groupForm.name.trim()) {
      alert("쉬는 날 유형 이름을 입력해주세요.");
      return;
    }
    const nextGroup: HqHolidayGroup = {
      id: makeId(),
      name: groupForm.name.trim(),
      description: groupForm.description.trim() || "맞춤 휴일 그룹",
      target_dept: groupForm.target_dept.trim(),
    };
    await savePartialSettings(
      {
        holiday_groups: [...settings.holiday_groups, nextGroup],
      },
      "쉬는 날 유형이 추가되었습니다."
    );
    setGroupForm({ name: "", description: "", target_dept: "" });
    setHolidayGroupModalOpen(false);
  };

  // =========================================================================
  // 3) 회사 직인 핸들러
  // =========================================================================
  const defaultSeal =
    settings.seals.find((s) => s.is_default) || settings.seals[0] || null;
  const defaultSealUrl = defaultSeal
    ? resolveStoragePublicUrl(defaultSeal.image_url)
    : null;

  const handleSelectSealFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    try {
      const processed = autoTransparent
        ? await removeWhiteBackgroundFromImage(rawFile)
        : rawFile;
      setSealUploadFile(processed);
      setSealPreviewUrl(URL.createObjectURL(processed));
    } catch {
      setSealUploadFile(rawFile);
      setSealPreviewUrl(URL.createObjectURL(rawFile));
    }
  };

  const handleRegisterSeal = async () => {
    if (!sealName.trim()) {
      alert("직인 명칭을 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      let fileToUpload: File | null = null;
      if (sealTab === "UPLOAD") {
        if (!sealUploadFile) {
          alert("업로드할 직인 이미지 파일을 선택해주세요.");
          setSaving(false);
          return;
        }
        fileToUpload = sealUploadFile;
      } else {
        const dataUrl = renderGeneratedSealDataUrl(genText, genShape);
        fileToUpload = await dataUrlToFile(dataUrl, "generated_seal.png");
      }

      const storagePath = await uploadHqReceiptFile(fileToUpload, "hq_seals");
      const newSeal: HqCompanySeal = {
        id: makeId(),
        name: sealName.trim(),
        image_url: storagePath,
        seal_type: sealTab === "UPLOAD" ? "UPLOAD" : "GENERATED",
        is_default: settings.seals.length === 0,
        created_at: new Date().toISOString(),
      };

      await savePartialSettings(
        { seals: [...settings.seals, newSeal] },
        "회사 직인이 등록되었습니다. 증명서·전자계약에 즉시 반영됩니다."
      );
      setSealUploadFile(null);
      setSealPreviewUrl(null);
      setSealModalOpen(false);
    } catch (err: any) {
      alert(err?.message || "직인 등록 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultSeal = (id: string) => {
    const next = settings.seals.map((s) => ({
      ...s,
      is_default: s.id === id,
    }));
    savePartialSettings({ seals: next }, "기본 사용 직인이 변경되었습니다.");
  };

  const handleDeleteSeal = (id: string) => {
    if (!confirm("이 직인을 삭제하시겠습니까?")) return;
    const remaining = settings.seals.filter((s) => s.id !== id);
    if (remaining.length > 0 && !remaining.some((s) => s.is_default)) {
      remaining[0].is_default = true;
    }
    savePartialSettings({ seals: remaining }, "직인이 삭제되었습니다.");
  };

  // =========================================================================
  // 4) 계열사 관리 핸들러
  // =========================================================================
  const handleCopyCompanyCode = async () => {
    try {
      await navigator.clipboard.writeText(settings.company_code);
      setCopiedCode(true);
      showToast(`우리 회사코드(${settings.company_code})가 복사되었습니다.`);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      prompt("우리 회사코드:", settings.company_code);
    }
  };

  const openAddAffiliate = () => {
    setEditingAffiliate(null);
    setAffiliateForm({
      name: "",
      relation_type: "계열사",
      ceo_name: settings.ceo_names[0] || "천종현",
      founded_date: new Date().toISOString().slice(0, 10),
      business_reg_no: "",
      company_code: "",
      address: "",
      tenant_id: "",
    });
    setAffiliateModalOpen(true);
  };

  const openEditAffiliate = (af: HqAffiliateItem) => {
    setOpenAffiliateMenuId(null);
    setEditingAffiliate(af);
    setAffiliateForm({
      name: af.name,
      relation_type: af.relation_type,
      ceo_name: af.ceo_name,
      founded_date: af.founded_date,
      business_reg_no: af.business_reg_no || "",
      company_code: af.company_code || "",
      address: af.address || "",
      tenant_id: af.tenant_id || "",
    });
    setAffiliateModalOpen(true);
  };

  const handleSaveAffiliate = async () => {
    if (!affiliateForm.name.trim()) {
      alert("계열사·관계사 법인명을 입력해주세요.");
      return;
    }
    const item: HqAffiliateItem = {
      id: editingAffiliate ? editingAffiliate.id : makeId(),
      name: affiliateForm.name.trim(),
      relation_type: affiliateForm.relation_type,
      ceo_name: affiliateForm.ceo_name.trim() || "-",
      founded_date: affiliateForm.founded_date,
      business_reg_no: affiliateForm.business_reg_no.trim(),
      company_code: affiliateForm.company_code.trim(),
      address: affiliateForm.address.trim(),
      tenant_id: affiliateForm.tenant_id || null,
    };
    const next = editingAffiliate
      ? settings.affiliates.map((x) =>
          x.id === editingAffiliate.id ? item : x
        )
      : [...settings.affiliates, item];

    await savePartialSettings(
      { affiliates: next },
      editingAffiliate
        ? "계열사 정보가 수정되었습니다."
        : "새 계열사가 등록되었습니다."
    );
    setAffiliateModalOpen(false);
  };

  const handleDeleteAffiliate = (id: string) => {
    setOpenAffiliateMenuId(null);
    if (!confirm("이 계열사를 목록에서 삭제하시겠습니까?")) return;
    savePartialSettings(
      { affiliates: settings.affiliates.filter((x) => x.id !== id) },
      "계열사가 삭제되었습니다."
    );
  };

  // 좌측 네비게이션 헬퍼
  const navBtnClass = (tabKey: HqSettingsTab) =>
    `w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] transition-colors ${
      activeTab === tabKey
        ? "bg-[#eceef1] text-slate-900 font-bold"
        : "text-slate-600 hover:bg-slate-200/50 font-medium"
    }`;

  const containerInner = (
    <div
      className={`bg-white flex overflow-hidden relative ${
        mode === "modal"
          ? "w-full max-w-[1140px] h-[94vh] max-h-[920px] rounded-2xl shadow-2xl border border-slate-200"
          : "w-full h-full"
      }`}
    >
      {/* 토스트 알림 */}
      {toastMsg && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-lg flex items-center gap-2">
          <span className="text-emerald-400">✓</span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* 좌측 Flex 설정 사이드바                                            */}
      {/* ================================================================= */}
      <aside className="w-[235px] bg-[#f9fafb] border-r border-slate-200/80 flex flex-col justify-between shrink-0 select-none">
        <div className="flex-1 overflow-y-auto px-3.5 py-6 space-y-6 custom-scroll">
          {/* 기본 정보 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              기본 정보
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("company")}
                className={navBtnClass("company")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🏢</span>
                  <span>회사 정보</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("holidays")}
                className={navBtnClass("holidays")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">📅</span>
                  <span>쉬는 날</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("seal")}
                className={navBtnClass("seal")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">💮</span>
                  <span>회사 직인</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("affiliates")}
                className={navBtnClass("affiliates")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🏛️</span>
                  <span>계열사 관리</span>
                </span>
              </button>
            </div>
          </div>

          {/* 인사·계약 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              인사·계약
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("hr-info")}
                className={navBtnClass("hr-info")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">👤</span>
                  <span>인사 · 구성원 정보</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCustomInfoModalOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] text-slate-600 hover:bg-slate-200/50 font-medium"
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🏷️</span>
                  <span>커스텀 정보</span>
                </span>
                <span className="text-[11px] text-slate-400">↗</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("doc-box")}
                className={navBtnClass("doc-box")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">📄</span>
                  <span>문서함 설정</span>
                </span>
              </button>
            </div>
          </div>

          {/* 승인관리 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              승인관리
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setApprovalPolicySubCat("workflow");
                  setActiveTab("approval-policy");
                }}
                className={navBtnClass("approval-policy")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">👤</span>
                  <span>승인 정책 관리</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("approval-labels")}
                className={navBtnClass("approval-labels")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🏷️</span>
                  <span>커스텀 승인 라벨</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubstituteModalOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] text-slate-600 hover:bg-slate-200/50 font-medium"
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">👥</span>
                  <span>대결 관리</span>
                </span>
                <span className="text-[11px] text-slate-400">↗</span>
              </button>
            </div>
          </div>

          {/* 근무 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              근무
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("work-type")}
                className={navBtnClass("work-type")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🕒</span>
                  <span>근무 유형</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("work-policy")}
                className={navBtnClass("work-policy")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">⚙️</span>
                  <span>근무 정책 · 승인</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("overtime-comp")}
                className={navBtnClass("overtime-comp")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🔥</span>
                  <span>초과 근무 보상</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("work-place")}
                className={navBtnClass("work-place")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">📍</span>
                  <span>근무지</span>
                </span>
              </button>
            </div>
          </div>

          {/* 휴가 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              휴가
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("leave-setting")}
                className={navBtnClass("leave-setting")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🏖️</span>
                  <span>연차 설정</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("custom-leave")}
                className={navBtnClass("custom-leave")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🌴</span>
                  <span>맞춤 휴가</span>
                </span>
              </button>
            </div>
          </div>

          {/* 급여·정산 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              급여·정산
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("payroll-payment")}
                className={navBtnClass("payroll-payment")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">💰</span>
                  <span>지급 항목</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("payroll-deduction")}
                className={navBtnClass("payroll-deduction")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">🧾</span>
                  <span>공제 항목</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("payroll-settlement")}
                className={navBtnClass("payroll-settlement")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">⚖️</span>
                  <span>정산 설정</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("payroll-workplace")}
                className={navBtnClass("payroll-workplace")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">💼</span>
                  <span>사업장 설정</span>
                </span>
              </button>
            </div>
          </div>

          {/* 셀프 서비스 */}
          <div>
            <div className="px-3 mb-1.5 text-[11px] font-bold text-slate-400">
              셀프 서비스
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("retiree-doc")}
                className={navBtnClass("retiree-doc")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-slate-400 text-sm">📑</span>
                  <span>퇴직자 문서 발급 설정</span>
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 좌측 하단 권한 설정 안내 카드 */}
        {isHqAdmin && (
          <div className="p-3 border-t border-slate-200/70">
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/hq/permissions");
              }}
              className="w-full text-left p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-colors"
            >
              <div className="text-xs font-bold text-slate-800">
                권한 설정 바로가기
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                임직원별 메뉴·DB 권한을 설정해 보세요.
              </div>
            </button>
          </div>
        )}
      </aside>

      {/* ================================================================= */}
      {/* 우측 메인 콘텐츠 영역                                              */}
      {/* ================================================================= */}
      <div className="flex-1 flex flex-col min-w-0 bg-white relative">
        {/* 우상단 닫기 버튼 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-6 z-20 w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-xl leading-none transition-colors"
          title="설정 닫기"
        >
          &times;
        </button>

        <div
          ref={rightPaneRef}
          className="flex-1 overflow-y-auto px-8 sm:px-14 py-10 custom-scroll"
        >
          <div className="max-w-[660px] mx-auto space-y-8 pb-12">
            {!canEdit && (
              <div className="px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                👀 일반 구성원은 회사 기본 정보와 공휴일 일정을 열람할 수 있으며, 설정 변경은 인사관리자·최고관리자만 가능합니다.
              </div>
            )}

            {/* =========================================================== */}
            {/* TAB 1: 회사 정보 (Image 2)                                   */}
            {/* =========================================================== */}
            {activeTab === "company" && (
              <>
                <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                  회사 정보
                </h2>

                {/* 상단 브랜드 커버 카드 */}
                <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
                  <div
                    className="h-32 sm:h-36 rounded-xl relative overflow-hidden"
                    style={
                      coverPublicUrl
                        ? {
                            backgroundImage: `url(${coverPublicUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : {
                            background:
                              "linear-gradient(125deg, #eadfd2 0%, #dde6d8 48%, #dce5f7 100%)",
                          }
                    }
                  />

                  <div className="px-3 pb-2 flex flex-wrap items-end justify-between gap-4">
                    <div>
                      {/* 빌딩/로고 아이콘 아바타 */}
                      <div className="relative group -mt-9 w-[68px] h-[68px] rounded-[20px] bg-[#9ba8cf] border-4 border-white shadow-sm flex items-center justify-center text-white overflow-hidden">
                        {logoPublicUrl ? (
                          <img
                            src={logoPublicUrl}
                            alt="회사 로고"
                            className="w-full h-full object-cover bg-white"
                          />
                        ) : (
                          <svg
                            className="w-8 h-8"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v4h3a2 2 0 012 2v10h-2v-2h-3v2H4zm2-2h3v-2H6v2zm0-4h3v-2H6v2zm0-4h3V9H6v2zm0-4h3V5H6v2zm4 12h3v-2h-3v2zm0-4h3v-2h-3v2zm0-4h3V9h-3v2zm0-4h3V5h-3v2zm5 12h3v-6h-3v6z" />
                          </svg>
                        )}
                        {canEdit && (
                          <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] font-bold text-white cursor-pointer">
                            <span>{uploadingLogo ? "..." : "로고변경"}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleLogoUpload}
                              className="hidden"
                            />
                          </label>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        {editingName ? (
                          <input
                            autoFocus
                            value={companyNameDraft}
                            onChange={(e) => setCompanyNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveCompanyInfo();
                              if (e.key === "Escape") {
                                setCompanyNameDraft(settings.company_name);
                                setEditingName(false);
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg border border-brand text-lg font-extrabold text-slate-900 focus:outline-none"
                          />
                        ) : (
                          <h3 className="text-[19px] font-extrabold text-slate-900">
                            {companyNameDraft}
                          </h3>
                        )}
                        {canEdit && !editingName && (
                          <button
                            type="button"
                            onClick={() => setEditingName(true)}
                            className="text-slate-300 hover:text-slate-600 text-sm"
                            title="회사명 수정"
                          >
                            ✏️
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 font-medium mt-1">
                        대표 {settings.ceo_names.join(", ")} · 구성원{" "}
                        {activeMemberCount}명
                      </p>
                    </div>

                    {canEdit && (
                      <label className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 cursor-pointer flex items-center gap-1.5 shadow-2xs">
                        <span>🖼️</span>
                        <span>
                          {uploadingCover ? "업로드 중..." : "커버 사진 변경"}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCoverUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* 회사 기본 정보 폼 */}
                <section className="space-y-5 pt-2">
                  <h3 className="text-[15px] font-extrabold text-slate-900">
                    회사 기본 정보
                  </h3>

                  {/* 대표자 */}
                  <div className="relative">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                      <span>👤</span>
                      <span>대표자</span>
                    </label>
                    <div
                      onClick={() => canEdit && setCeoDropdownOpen((p) => !p)}
                      className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#f5f6f8] hover:bg-[#eef0f4] transition-colors flex flex-wrap items-center justify-between gap-2 ${
                        canEdit ? "cursor-pointer" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {settings.ceo_names.map((ceo) => (
                          <span
                            key={ceo}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200/80 text-xs font-bold text-slate-800 shadow-2xs"
                          >
                            <span className="w-4 h-4 rounded bg-[#9ba8cf] text-white text-[9px] flex items-center justify-center">
                              🏢
                            </span>
                            <span>{ceo}</span>
                            {canEdit && settings.ceo_names.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCeoName(ceo);
                                }}
                                className="text-slate-400 hover:text-rose-500 ml-0.5"
                              >
                                &times;
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      <span className="text-slate-400 text-xs">▾</span>
                    </div>

                    {ceoDropdownOpen && canEdit && (
                      <div className="mt-1.5 p-3 rounded-xl bg-white border border-slate-200 shadow-xl space-y-2.5 z-20 relative text-xs">
                        <div className="text-[11px] font-bold text-slate-400">
                          본부 구성원에서 대표자 선택 또는 직접 추가
                        </div>
                        <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5">
                          {members
                            .filter((m) => m.work_status === "재직")
                            .map((m) => {
                              const selected = settings.ceo_names.includes(
                                m.name
                              );
                              return (
                                <button
                                  key={m.instructor_id}
                                  type="button"
                                  onClick={() => toggleCeoName(m.name)}
                                  className={`px-2.5 py-1 rounded-lg border font-bold ${
                                    selected
                                      ? "bg-blue-50 border-brand text-brand"
                                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                  }`}
                                >
                                  {m.name} ({m.job_title}) {selected && "✓"}
                                </button>
                              );
                            })}
                        </div>
                        <div className="flex gap-2 pt-1 border-t border-slate-100">
                          <input
                            value={customCeoInput}
                            onChange={(e) => setCustomCeoInput(e.target.value)}
                            placeholder="대표자 성명 직접 입력"
                            className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!customCeoInput.trim()) return;
                              toggleCeoName(customCeoInput.trim());
                              setCustomCeoInput("");
                              setCeoDropdownOpen(false);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                          >
                            추가
                          </button>
                          <button
                            type="button"
                            onClick={() => setCeoDropdownOpen(false)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 font-semibold"
                          >
                            닫기
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 대표 전화번호 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                      <span>📞</span>
                      <span>대표 전화번호</span>
                    </label>
                    <input
                      disabled={!canEdit}
                      value={phoneDraft}
                      onChange={(e) => setPhoneDraft(e.target.value)}
                      placeholder="031-745-9675"
                      className="w-full px-4 py-3 rounded-xl bg-[#f5f6f8] focus:bg-white border border-transparent focus:border-slate-300 text-[13px] font-medium text-slate-800 focus:outline-none transition-colors"
                    />
                  </div>

                  {/* 설립일 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                      <span>📅</span>
                      <span>설립일</span>
                    </label>
                    <div
                      onClick={() =>
                        canEdit && dateInputRef.current?.showPicker?.()
                      }
                      className="relative w-full px-4 py-3 rounded-xl bg-[#f5f6f8] flex items-center justify-between text-[13px] font-medium text-slate-800"
                    >
                      <span>
                        {formatKoreanFullDate(foundedDraft) || "설립일 선택"}
                      </span>
                      <input
                        ref={dateInputRef}
                        type="date"
                        disabled={!canEdit}
                        value={foundedDraft}
                        onChange={(e) => setFoundedDraft(e.target.value)}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                      />
                      <span className="text-slate-400 text-xs">▾</span>
                    </div>
                  </div>

                  {/* 주소 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                      <span>📍</span>
                      <span>주소</span>
                    </label>
                    <input
                      disabled={!canEdit}
                      value={addressDraft}
                      onChange={(e) => setAddressDraft(e.target.value)}
                      placeholder="경기도 성남시 수정구 복정로 121 (복정동) 402호"
                      className="w-full px-4 py-3 rounded-xl bg-[#f5f6f8] focus:bg-white border border-transparent focus:border-slate-300 text-[13px] font-medium text-slate-800 focus:outline-none transition-colors"
                    />
                  </div>

                  {/* 사업자등록번호 · 법인등록번호 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                        <span>🧾</span>
                        <span>사업자등록번호 (선택)</span>
                      </label>
                      <input
                        disabled={!canEdit}
                        value={bizNoDraft}
                        onChange={(e) => setBizNoDraft(e.target.value)}
                        placeholder="000-00-00000"
                        className="w-full px-4 py-3 rounded-xl bg-[#f5f6f8] focus:bg-white border border-transparent focus:border-slate-300 text-[13px] font-medium text-slate-800 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                        <span>🏛️</span>
                        <span>법인등록번호 (선택)</span>
                      </label>
                      <input
                        disabled={!canEdit}
                        value={corpNoDraft}
                        onChange={(e) => setCorpNoDraft(e.target.value)}
                        placeholder="000000-0000000"
                        className="w-full px-4 py-3 rounded-xl bg-[#f5f6f8] focus:bg-white border border-transparent focus:border-slate-300 text-[13px] font-medium text-slate-800 focus:outline-none"
                      />
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        disabled={saving || !isCompanyInfoDirty}
                        onClick={handleSaveCompanyInfo}
                        className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs disabled:opacity-35 transition-all"
                      >
                        {saving ? "저장 중..." : "변경사항 저장"}
                      </button>
                    </div>
                  )}
                </section>

                <StepNavFooter
                  nextLabel="쉬는 날"
                  onNext={() => setActiveTab("holidays")}
                />
              </>
            )}

            {/* =========================================================== */}
            {/* TAB 2: 쉬는 날 (Images 3 & 4)                                */}
            {/* =========================================================== */}
            {activeTab === "holidays" && (
              <>
                <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                  쉬는 날
                </h2>

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-[16px] font-extrabold text-slate-900">
                      <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(e.target.value)}
                        className="bg-transparent font-extrabold text-slate-900 focus:outline-none cursor-pointer pr-1"
                      >
                        <option value="2025">2025년</option>
                        <option value="2026">2026년</option>
                        <option value="2027">2027년</option>
                      </select>
                      <span className="text-emerald-600">
                        총 {totalHolidayDays}일
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-medium mt-1">
                      국가에서 지정한 법정 공휴일과 함께, 회사만의 지정 휴일도 정할 수 있어요.
                    </p>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetHolidays}
                        className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-500"
                      >
                        기본값 복원
                      </button>
                      <button
                        type="button"
                        onClick={openAddHoliday}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
                      >
                        <span className="text-emerald-500 text-sm leading-none font-extrabold">
                          +
                        </span>
                        <span>쉬는 날 추가</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 공휴일 카드 리스트 */}
                <div className="space-y-2.5">
                  {yearHolidays.map((h) => (
                    <div
                      key={h.id}
                      className="px-5 py-4 rounded-2xl border border-slate-200/80 bg-white hover:border-slate-300 transition-colors flex items-center justify-between gap-3 relative"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                          {h.icon || "📅"}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-slate-900 truncate">
                            {h.name}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {h.date_text}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {h.is_custom && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            회사 지정
                          </span>
                        )}
                        {h.is_mandatory && (
                          <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-500 text-[10px] font-bold">
                            필수
                          </span>
                        )}
                        {h.substitute_label && (
                          <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                            {h.substitute_label}
                          </span>
                        )}
                        {h.is_annual && (
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            매년
                          </span>
                        )}

                        {canEdit && (
                          <div className="relative ml-1">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenHolidayMenuId((prev) =>
                                  prev === h.id ? null : h.id
                                )
                              }
                              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center font-bold"
                            >
                              ⋯
                            </button>

                            {openHolidayMenuId === h.id && (
                              <div className="absolute right-0 mt-1 w-28 rounded-xl bg-white border border-slate-200 shadow-lg py-1 z-30 text-xs">
                                <button
                                  type="button"
                                  onClick={() => openEditHoliday(h)}
                                  className="w-full px-3 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  수정하기
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHoliday(h.id)}
                                  className="w-full px-3 py-1.5 text-left font-semibold text-rose-600 hover:bg-rose-50"
                                >
                                  삭제하기
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 구성원별 다른 쉬는 날 유형 안내 박스 (Image 4) */}
                <div className="rounded-2xl bg-[#fbf7f0] border border-[#f2e8d9] p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-bold text-[#7c5828]">
                        구성원 별로 다르게 설정하고 싶나요?
                      </div>
                      <p className="text-[11px] text-[#9b7b52] mt-0.5">
                        구성원들이 서로 다른 쉬는 날을 가질 수 있도록 관리하고 싶다면 쉬는 날 유형을 추가하세요.
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setHolidayGroupModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg bg-[#f3eadc] hover:bg-[#eadcc8] text-[#6d4c21] text-xs font-bold transition-colors shrink-0"
                      >
                        쉬는 날 유형 추가
                      </button>
                    )}
                  </div>

                  {settings.holiday_groups.length > 0 && (
                    <div className="pt-2 border-t border-[#efe3d1] space-y-2">
                      {settings.holiday_groups.map((grp) => (
                        <div
                          key={grp.id}
                          className="px-3.5 py-2.5 rounded-xl bg-white border border-[#eee2d0] flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-800">
                              {grp.name}
                            </span>
                            {grp.target_dept && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">
                                {grp.target_dept}
                              </span>
                            )}
                            <span className="ml-2 text-slate-500">
                              {grp.description}
                            </span>
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                savePartialSettings(
                                  {
                                    holiday_groups:
                                      settings.holiday_groups.filter(
                                        (g) => g.id !== grp.id
                                      ),
                                  },
                                  "쉬는 날 유형이 삭제되었습니다."
                                )
                              }
                              className="text-slate-400 hover:text-rose-500 font-semibold"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <StepNavFooter
                  prevLabel="회사 정보"
                  onPrev={() => setActiveTab("company")}
                  nextLabel="회사 직인"
                  onNext={() => setActiveTab("seal")}
                />
              </>
            )}

            {/* =========================================================== */}
            {/* TAB 3: 회사 직인 (Image 5)                                   */}
            {/* =========================================================== */}
            {activeTab === "seal" && (
              <>
                <div>
                  <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                    회사 직인
                  </h2>
                  <p className="text-xs text-slate-400 font-medium mt-1.5">
                    설정한 직인은 재직증명서, 경력증명서, 전자계약 등에 사용돼요.
                  </p>
                </div>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-extrabold text-slate-900">
                        전자 직인 관리하기
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        전자계약 관련 법령{" "}
                        <button
                          type="button"
                          onClick={() => setLegalModalOpen(true)}
                          className="text-blue-600 font-semibold hover:underline"
                        >
                          자세히 보기
                        </button>
                      </p>
                    </div>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setSealModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
                      >
                        <span className="text-emerald-500 text-sm leading-none font-extrabold">
                          +
                        </span>
                        <span>직인 등록하기</span>
                      </button>
                    )}
                  </div>

                  {/* 문서 서명(인) 날인 프리뷰 스테이지 (Image 5 동일 레이아웃) */}
                  <div className="rounded-2xl bg-[#f3f2ee] border border-slate-200/70 pr-8 sm:pr-14 pb-8 pt-0 pl-0 overflow-hidden">
                    <div className="bg-white rounded-br-xl shadow-[0_8px_24px_rgba(15,23,42,0.06)] px-8 sm:px-12 py-12 flex items-center justify-end gap-6 min-h-[195px]">
                      <div className="text-right select-none">
                        {defaultSealUrl && (
                          <div className="text-xs font-bold text-slate-400 mb-1">
                            {settings.company_name} 대표이사{" "}
                            {settings.ceo_names[0] || ""}
                          </div>
                        )}
                        <span
                          className={`text-lg font-extrabold tracking-wide ${
                            defaultSealUrl ? "text-slate-700" : "text-slate-300"
                          }`}
                        >
                          서명 (인)
                        </span>
                      </div>

                      {defaultSealUrl ? (
                        <div
                          onClick={() => canEdit && setSealModalOpen(true)}
                          className="w-24 h-24 rounded-xl border border-slate-100 bg-white flex items-center justify-center p-2 cursor-pointer hover:border-slate-300 transition-colors relative group"
                          title="새 직인 추가 등록"
                        >
                          <img
                            src={defaultSealUrl}
                            alt={defaultSeal?.name || "회사 직인"}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setSealModalOpen(true)}
                          className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50/40 flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors disabled:cursor-default"
                        >
                          <span className="text-xl opacity-60">🖼️</span>
                          <span className="text-[11px] font-bold">직인등록</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 등록된 직인 목록 관리 */}
                  {settings.seals.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <div className="text-xs font-bold text-slate-500">
                        등록된 직인 목록 ({settings.seals.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {settings.seals.map((s) => {
                          const url = resolveStoragePublicUrl(s.image_url);
                          return (
                            <div
                              key={s.id}
                              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                                s.is_default
                                  ? "border-emerald-300 bg-emerald-50/30"
                                  : "border-slate-200 bg-white"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-12 h-12 rounded-lg border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0">
                                  {url && (
                                    <img
                                      src={url}
                                      alt={s.name}
                                      className="w-full h-full object-contain"
                                    />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate">
                                    <span>{s.name}</span>
                                    {s.is_default && (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                                        기본 직인
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    {new Date(s.created_at).toLocaleDateString(
                                      "ko-KR"
                                    )}
                                  </div>
                                </div>
                              </div>

                              {canEdit && (
                                <div className="flex items-center gap-2 shrink-0 text-xs">
                                  {!s.is_default && (
                                    <button
                                      type="button"
                                      onClick={() => handleSetDefaultSeal(s.id)}
                                      className="font-bold text-brand hover:underline"
                                    >
                                      기본지정
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSeal(s.id)}
                                    className="font-semibold text-slate-400 hover:text-rose-500"
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>

                <StepNavFooter
                  prevLabel="쉬는 날"
                  onPrev={() => setActiveTab("holidays")}
                  nextLabel="계열사 관리"
                  onNext={() => setActiveTab("affiliates")}
                />
              </>
            )}

            {/* =========================================================== */}
            {/* TAB 4: 계열사 관리 (Image 6)                                 */}
            {/* =========================================================== */}
            {activeTab === "affiliates" && (
              <>
                <div className="flex items-start gap-1.5">
                  <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                    계열사 관리
                  </h2>
                  <span className="text-[11px] font-extrabold text-rose-400 mt-1">
                    Beta
                  </span>
                </div>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-extrabold text-slate-900">
                        계열사 목록
                      </h3>
                      <button
                        type="button"
                        onClick={handleCopyCompanyCode}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600 flex items-center gap-1 shadow-2xs"
                        title={`회사코드: ${settings.company_code}`}
                      >
                        <span>📋</span>
                        <span>
                          {copiedCode ? "복사 완료!" : "우리 회사코드"}
                        </span>
                      </button>
                    </div>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={openAddAffiliate}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
                      >
                        <span className="text-emerald-500 text-sm leading-none font-extrabold">
                          +
                        </span>
                        <span>계열사 추가</span>
                      </button>
                    )}
                  </div>

                  {/* 대표회사 카드 (항상 최상단 표시) */}
                  <div className="space-y-2.5">
                    <div className="p-5 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-4 shadow-2xs">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#9ba8cf] text-white flex items-center justify-center shrink-0 overflow-hidden">
                          {logoPublicUrl ? (
                            <img
                              src={logoPublicUrl}
                              alt="logo"
                              className="w-full h-full object-cover bg-white"
                            />
                          ) : (
                            <span className="text-base">🏢</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-extrabold text-slate-900 truncate">
                              {settings.company_name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                              대표회사
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            설립일 {settings.founded_date || "-"} · 대표{" "}
                            {settings.ceo_names.join(", ")}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 추가된 계열사 · 직영기관 카드 목록 */}
                    {settings.affiliates.map((af) => (
                      <div
                        key={af.id}
                        className="p-5 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-colors flex items-center justify-between gap-4 relative"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                            🏛️
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-extrabold text-slate-900 truncate">
                                {af.name}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold shrink-0">
                                {af.relation_type}
                              </span>
                              {af.company_code && (
                                <span className="text-[11px] font-mono text-slate-400">
                                  ({af.company_code})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              설립일 {af.founded_date || "-"} · 대표{" "}
                              {af.ceo_name}
                              {af.business_reg_no
                                ? ` · 사업자 ${af.business_reg_no}`
                                : ""}
                            </div>
                          </div>
                        </div>

                        {canEdit && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenAffiliateMenuId((p) =>
                                  p === af.id ? null : af.id
                                )
                              }
                              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold"
                            >
                              ⋯
                            </button>
                            {openAffiliateMenuId === af.id && (
                              <div className="absolute right-0 mt-1 w-28 rounded-xl bg-white border border-slate-200 shadow-lg py-1 z-30 text-xs">
                                <button
                                  type="button"
                                  onClick={() => openEditAffiliate(af)}
                                  className="w-full px-3 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  수정하기
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAffiliate(af.id)}
                                  className="w-full px-3 py-1.5 text-left font-semibold text-rose-600 hover:bg-rose-50"
                                >
                                  삭제하기
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <StepNavFooter
                  prevLabel="회사 직인"
                  onPrev={() => setActiveTab("seal")}
                  nextLabel="인사 · 구성원 정보"
                  onNext={() => setActiveTab("hr-info")}
                />
              </>
            )}

            {/* =========================================================== */}
            {/* 부가 설정 탭들 (인사·문서함·승인정책·근무유형·근무지·연차설정)   */}
            {/* =========================================================== */}
            {activeTab === "hr-info" && (
              <HqHrInfoSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => {
                  if (tab === "approval-policy") {
                    setApprovalPolicySubCat("member_info");
                  }
                  setActiveTab(tab);
                }}
                onCloseSettings={onClose}
              />
            )}

            {activeTab === "doc-box" && (
              <HqDocBoxSettingsSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => {
                  if (tab === "approval-policy") {
                    setApprovalPolicySubCat("workflow");
                  }
                  setActiveTab(tab);
                }}
              />
            )}

            {activeTab === "approval-policy" && (
              <HqApprovalPolicySection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                initialSubCategory={approvalPolicySubCat}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "approval-labels" && (
              <HqApprovalLabelsSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => {
                  if (tab === "approval-policy") {
                    setApprovalPolicySubCat("workflow");
                  }
                  setActiveTab(tab);
                }}
              />
            )}

            {activeTab === "work-type" && (
              <HqWorkTypeSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "work-policy" && (
              <HqWorkPolicySettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "overtime-comp" && (
              <HqOvertimeCompSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "work-place" && (
              <HqWorkplaceSettingsSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "leave-setting" && (
              <HqAnnualLeaveSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "custom-leave" && (
              <HqCustomLeaveSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "payroll-payment" && (
              <HqPayrollPaymentSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "payroll-deduction" && (
              <HqPayrollDeductionSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "payroll-settlement" && (
              <HqPayrollSettlementSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "payroll-workplace" && (
              <HqPayrollTaxWorkplaceSection
                settings={settings}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "retiree-doc" && (
              <HqRetireeDocSettingsSection
                settings={settings}
                members={members}
                canEdit={canEdit}
                saving={saving}
                onSaveExtra={async (nextExtra, toastMessage) => {
                  await savePartialSettings(
                    {
                      extra_settings: {
                        ...settings.extra_settings,
                        ...nextExtra,
                      },
                    },
                    toastMessage
                  );
                }}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 서브 모달들 (쉬는 날 추가 / 휴일유형 추가 / 직인 등록 / 계열사 추가) */}
      {/* ================================================================= */}

      {/* 1. 쉬는 날 추가/수정 모달 */}
      {holidayModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h4 className="text-sm font-bold">
                {editingHoliday ? "쉬는 날 수정" : "+ 회사 지정 쉬는 날 추가"}
              </h4>
              <button
                type="button"
                onClick={() => setHolidayModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    아이콘
                  </label>
                  <select
                    value={holidayForm.icon}
                    onChange={(e) =>
                      setHolidayForm({ ...holidayForm, icon: e.target.value })
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-base text-center"
                  >
                    {["🎉", "🏢", "🌴", "🇰🇷", "🌕", "🎄", "🌅", "🗳️"].map(
                      (ic) => (
                        <option key={ic} value={ic}>
                          {ic}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block font-bold text-slate-600 mb-1">
                    쉬는 날 이름
                  </label>
                  <input
                    value={holidayForm.name}
                    onChange={(e) =>
                      setHolidayForm({ ...holidayForm, name: e.target.value })
                    }
                    placeholder="예: 창립기념일, 하계 리프레시 휴무"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    시작일
                  </label>
                  <input
                    type="date"
                    value={holidayForm.start_date}
                    onChange={(e) =>
                      setHolidayForm({
                        ...holidayForm,
                        start_date: e.target.value,
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    종료일 (연휴 시)
                  </label>
                  <input
                    type="date"
                    value={holidayForm.end_date}
                    onChange={(e) =>
                      setHolidayForm({
                        ...holidayForm,
                        end_date: e.target.value,
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    휴일 일수(일)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={holidayForm.days_count}
                    onChange={(e) =>
                      setHolidayForm({
                        ...holidayForm,
                        days_count: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  날짜 표시 문구 (비워두면 자동 생성)
                </label>
                <input
                  value={holidayForm.date_text}
                  onChange={(e) =>
                    setHolidayForm({
                      ...holidayForm,
                      date_text: e.target.value,
                    })
                  }
                  placeholder="예: 8월 1일 (연구소 창립기념일)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  대체휴일 배지 (선택)
                </label>
                <select
                  value={holidayForm.substitute_label}
                  onChange={(e) =>
                    setHolidayForm({
                      ...holidayForm,
                      substitute_label: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                >
                  <option value="">적용 안함</option>
                  <option value="토·일요일 대체휴일">토·일요일 대체휴일</option>
                  <option value="일요일 대체휴일">일요일 대체휴일</option>
                </select>
              </div>

              <div className="flex items-center gap-5 pt-1">
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holidayForm.is_annual}
                    onChange={(e) =>
                      setHolidayForm({
                        ...holidayForm,
                        is_annual: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-brand rounded"
                  />
                  <span>매년 반복</span>
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holidayForm.is_mandatory}
                    onChange={(e) =>
                      setHolidayForm({
                        ...holidayForm,
                        is_mandatory: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-rose-500 rounded"
                  />
                  <span>필수 유급휴일 표시</span>
                </label>
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHolidayModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveHoliday}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 쉬는 날 유형 추가 모달 */}
      {holidayGroupModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h4 className="text-sm font-bold">맞춤 쉬는 날 유형 추가</h4>
              <button
                type="button"
                onClick={() => setHolidayGroupModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  유형 명칭
                </label>
                <input
                  value={groupForm.name}
                  onChange={(e) =>
                    setGroupForm({ ...groupForm, name: e.target.value })
                  }
                  placeholder="예: 출판편집팀 마감 후 대체휴무제"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  적용 부서 (선택)
                </label>
                <input
                  value={groupForm.target_dept}
                  onChange={(e) =>
                    setGroupForm({ ...groupForm, target_dept: e.target.value })
                  }
                  placeholder="예: 출판편집팀"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  운영 기준 설명
                </label>
                <input
                  value={groupForm.description}
                  onChange={(e) =>
                    setGroupForm({ ...groupForm, description: e.target.value })
                  }
                  placeholder="예: 인쇄 하판 주간 주말 근무 시 차주 평일 지정 휴무"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHolidayGroupModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAddHolidayGroup}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold"
              >
                유형 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. 회사 직인 등록 모달 */}
      {sealModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h4 className="text-sm font-bold">💮 전자 직인 등록하기</h4>
              <button
                type="button"
                onClick={() => setSealModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  직인 명칭
                </label>
                <input
                  value={sealName}
                  onChange={(e) => setSealName(e.target.value)}
                  placeholder="예: 법인인감, 인사증명서용 사용인감"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => setSealTab("UPLOAD")}
                  className={`py-2 rounded-lg font-bold transition-colors ${
                    sealTab === "UPLOAD"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500"
                  }`}
                >
                  도장 이미지 업로드
                </button>
                <button
                  type="button"
                  onClick={() => setSealTab("GENERATE")}
                  className={`py-2 rounded-lg font-bold transition-colors ${
                    sealTab === "GENERATE"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500"
                  }`}
                >
                  전자 직인 자동 생성
                </button>
              </div>

              {sealTab === "UPLOAD" ? (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoTransparent}
                      onChange={(e) => setAutoTransparent(e.target.checked)}
                      className="w-4 h-4 accent-brand rounded"
                    />
                    <span>흰색 배경 자동 투명화 처리 (스캔본 추천)</span>
                  </label>

                  <label className="h-36 rounded-2xl border-2 border-dashed border-slate-300 hover:border-brand bg-slate-50 flex flex-col items-center justify-center gap-2 cursor-pointer p-3">
                    {sealPreviewUrl ? (
                      <img
                        src={sealPreviewUrl}
                        alt="미리보기"
                        className="h-24 w-24 object-contain"
                      />
                    ) : (
                      <>
                        <span className="text-2xl">📎</span>
                        <span className="font-bold text-slate-600">
                          클릭하여 PNG · JPG 도장 파일 선택
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSelectSealFile}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block font-bold text-slate-600 mb-1">
                        인장 각인 문구
                      </label>
                      <input
                        value={genText}
                        onChange={(e) => setGenText(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-600 mb-1">
                        인장 형태
                      </label>
                      <select
                        value={genShape}
                        onChange={(e) =>
                          setGenShape(e.target.value as "CIRCLE" | "SQUARE")
                        }
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                      >
                        <option value="CIRCLE">원형 직인</option>
                        <option value="SQUARE">사각 직인</option>
                      </select>
                    </div>
                  </div>

                  <div className="h-32 rounded-2xl bg-[#f4f3ef] flex items-center justify-center">
                    {genPreviewUrl && (
                      <img
                        src={genPreviewUrl}
                        alt="자동 생성 미리보기"
                        className="w-24 h-24 object-contain"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSealModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleRegisterSeal}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-50"
              >
                {saving ? "등록 중..." : "직인 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전자계약 관련 법령 안내 모달 */}
      {legalModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-3 text-xs">
            <h4 className="text-sm font-extrabold text-slate-900">
              ⚖️ 전자직인 및 전자계약의 법적 효력 안내
            </h4>
            <p className="text-slate-600 leading-relaxed">
              • <strong>전자서명법 제3조(전자서명의 효력)</strong>: 전자서명은 전자적 형태라는 이유만으로 서명, 서명날인 또는 기명날인으로서의 효력이 부인되지 아니합니다.
            </p>
            <p className="text-slate-600 leading-relaxed">
              • <strong>전자문서 및 전자거래 기본법 제4조</strong>: 전자문서는 전자적 형태로 되어 있다는 이유만으로 법적 효력이 부인되지 아니합니다.
            </p>
            <p className="text-slate-500 leading-relaxed">
              등록된 회사 직인은 권한이 부여된 관리자의 승인 하에 재직·경력증명서 및 사내 근로·용역 전자계약서 날인란에 안전하게 사용됩니다.
            </p>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setLegalModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. 계열사 추가/수정 모달 */}
      {affiliateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h4 className="text-sm font-bold">
                {editingAffiliate ? "계열사 정보 수정" : "+ 계열사 · 관계기관 추가"}
              </h4>
              <button
                type="button"
                onClick={() => setAffiliateModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-3">
              {!editingAffiliate && tenantBranches.length > 0 && (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    등록된 학원/지점에서 빠르게 불러오기 (선택)
                  </label>
                  <select
                    value={affiliateForm.tenant_id}
                    onChange={(e) => {
                      const tId = e.target.value;
                      const found = tenantBranches.find(
                        (b) => b.tenant_id === tId
                      );
                      setAffiliateForm({
                        ...affiliateForm,
                        tenant_id: tId,
                        name: found ? found.name : affiliateForm.name,
                        relation_type: "직영학원",
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 font-semibold"
                  >
                    <option value="">직접 입력하기</option>
                    {tenantBranches.map((b) => (
                      <option key={b.tenant_id} value={b.tenant_id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">
                    법인 · 기관명
                  </label>
                  <input
                    value={affiliateForm.name}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        name: e.target.value,
                      })
                    }
                    placeholder="예: 천종현수학 대치본원"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    구분
                  </label>
                  <select
                    value={affiliateForm.relation_type}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        relation_type: e.target.value as any,
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value="계열사">계열사</option>
                    <option value="자회사">자회사</option>
                    <option value="직영학원">직영학원</option>
                    <option value="관계사">관계사</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    대표자명
                  </label>
                  <input
                    value={affiliateForm.ceo_name}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        ceo_name: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    설립일
                  </label>
                  <input
                    type="date"
                    value={affiliateForm.founded_date}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        founded_date: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    사업자등록번호 (선택)
                  </label>
                  <input
                    value={affiliateForm.business_reg_no}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        business_reg_no: e.target.value,
                      })
                    }
                    placeholder="000-00-00000"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    회사코드 (선택)
                  </label>
                  <input
                    value={affiliateForm.company_code}
                    onChange={(e) =>
                      setAffiliateForm({
                        ...affiliateForm,
                        company_code: e.target.value,
                      })
                    }
                    placeholder="예: CJH-DC-01"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAffiliateModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAffiliate}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 5. 커스텀 정보 오버레이 모달 (Image 1) */}
      <HqCustomInfoModal
        isOpen={customInfoModalOpen}
        settings={settings}
        canEdit={canEdit}
        saving={saving}
        onSaveExtra={async (nextExtra, toastMessage) => {
          await savePartialSettings(
            {
              extra_settings: {
                ...settings.extra_settings,
                ...nextExtra,
              },
            },
            toastMessage
          );
        }}
        onClose={() => setCustomInfoModalOpen(false)}
      />

      {/* 6. 대결 관리 오버레이 모달 */}
      <HqSubstituteApprovalModal
        isOpen={substituteModalOpen}
        settings={settings}
        members={members}
        canEdit={canEdit}
        saving={saving}
        onSaveExtra={async (nextExtra, toastMessage) => {
          await savePartialSettings(
            {
              extra_settings: {
                ...settings.extra_settings,
                ...nextExtra,
              },
            },
            toastMessage
          );
        }}
        onClose={() => setSubstituteModalOpen(false)}
        onCloseSettings={onClose}
      />
    </div>
  );

  if (mode === "page") {
    return containerInner;
  }

  return (
    <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px] z-50 flex items-center justify-center p-2 sm:p-4">
      {containerInner}
    </div>
  );
}

/**
 * 하단 이전으로 / 다음으로 이동 카드 (Images 4 & 5 동일 스타일)
 */
function StepNavFooter({
  prevLabel,
  onPrev,
  nextLabel,
  onNext,
}: {
  prevLabel?: string;
  onPrev?: () => void;
  nextLabel?: string;
  onNext?: () => void;
}) {
  return (
    <div className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {prevLabel && onPrev ? (
        <button
          type="button"
          onClick={onPrev}
          className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
        >
          <span className="text-slate-400 text-base">←</span>
          <div className="text-right">
            <div className="text-xs font-extrabold text-slate-800">
              {prevLabel}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
          </div>
        </button>
      ) : (
        <div />
      )}

      {nextLabel && onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
        >
          <div>
            <div className="text-xs font-extrabold text-slate-800">
              {nextLabel}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
          </div>
          <span className="text-slate-400 text-base">→</span>
        </button>
      ) : (
        <div />
      )}
    </div>
  );
}
