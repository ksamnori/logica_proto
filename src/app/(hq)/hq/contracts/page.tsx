// src/app/hq/contracts/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import ContractTemplateStudioSection from "@/components/hq/contracts/ContractTemplateStudioSection";
import {
  buildContractTemplateBody,
  CONTRACT_CATEGORIES,
  CONTRACT_TAX_LABELS,
} from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import {
  calcContractTaxBreakdown,
  resolveContractTemplatePlaceholders,
} from "@/lib/hq/contractTemplateEngine";
import { DEFAULT_WORK_RULES } from "@/lib/hq/defaultWorkRules";
import type {
  HqContract,
  HqContractCategory,
  HqContractCustomField,
  HqContractTargetType,
  HqContractTaxType,
  HqContractTemplateItem,
  HqWorkRuleItem,
} from "@/lib/hq/types";

type TopViewMode = "CONTRACTS" | "TEMPLATES" | "REFLECTION";
type ContractTab =
  | "ALL"
  | "SENT"
  | "SIGNED"
  | "DRAFT"
  | "INTERNAL"
  | "EXTERNAL"
  | "EXPIRING";

export default function HqContractsPage() {
  const router = useRouter();
  const {
    me,
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshContractBadge,
    refreshMembers,
    openSettingsModal,
  } = useHqShell();

  const activeCompanySeal =
    companySettings?.seals?.find((s) => s.is_default) ||
    companySettings?.seals?.[0] ||
    null;
  const activeCompanySealUrl = activeCompanySeal
    ? resolveStoragePublicUrl(activeCompanySeal.image_url)
    : null;

  const [viewMode, setViewMode] = useState<TopViewMode>("CONTRACTS");
  const [contracts, setContracts] = useState<HqContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ContractTab>("ALL");
  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [keyword, setKeyword] = useState("");

  // 서식 관리 & 인사정보 반영 상태
  const [tplCategories, setTplCategories] = useState<string[]>([
    "자동계약서",
    "인사·서약서",
    "출판·외주 계약서",
  ]);
  const [customFields, setCustomFields] = useState<HqContractCustomField[]>([]);
  const [templates, setTemplates] = useState<HqContractTemplateItem[]>([]);
  const [reflectedIds, setReflectedIds] = useState<string[]>([]);
  const [reflectFilter, setReflectFilter] = useState<"NEEDED" | "DONE">(
    "NEEDED"
  );

  // 계약 생성 / 임시저장 편집 모달
  const [createOpen, setCreateOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<HqContractCategory>("OUTSOURCING");
  const [targetType, setTargetType] =
    useState<HqContractTargetType>("EXTERNAL");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [counterpartyRole, setCounterpartyRole] = useState("외주 디자이너");
  const [counterpartyPhone, setCounterpartyPhone] = useState("");
  const [counterpartyEmail, setCounterpartyEmail] = useState("");
  const [department, setDepartment] = useState("출판편집팀");
  const [title, setTitle] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState("");
  const [contractAmount, setContractAmount] = useState("1500000");
  const [royaltyRate, setRoyaltyRate] = useState("10");
  const [taxType, setTaxType] = useState<HqContractTaxType>("BIZ_33");
  const [bodyText, setBodyText] = useState("");
  const [specialTerms, setSpecialTerms] = useState("");

  // 상세 열람 · 전자서명 · 인쇄 모달
  const [selected, setSelected] = useState<HqContract | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);

  const canCreateContract = Boolean(
    isHrManager || isHqAdmin || (me && me.rank_level >= 3)
  );

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const workRules: HqWorkRuleItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.work_rules;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_WORK_RULES;
  }, [companySettings]);

  const resolveMemberRule = useCallback(
    (memberName?: string) =>
      workRules.find((r) =>
        (r.assigned_members || []).some(
          (am) => am.name === memberName && am.status === "ACTIVE"
        )
      ) ||
      workRules.find((r) => r.id === "wr-basic-9") ||
      DEFAULT_WORK_RULES[3] ||
      DEFAULT_WORK_RULES[0],
    [workRules]
  );

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { contracts: HqContract[] };
      }>("/api/hq/contracts");
      setContracts(res.data?.contracts || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          categories: string[];
          customFields: HqContractCustomField[];
          templates: HqContractTemplateItem[];
          reflectedContractIds: string[];
        };
      }>("/api/hq/contract-templates");
      if (res.data?.categories) setTplCategories(res.data.categories);
      setCustomFields(res.data?.customFields || []);
      setTemplates(res.data?.templates || []);
      setReflectedIds(res.data?.reflectedContractIds || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadContracts();
    loadTemplates();
  }, [loadContracts, loadTemplates]);

  const activeTemplateList = useMemo(
    () => templates.filter((t) => !t.is_archived),
    [templates]
  );

  const regenerateTemplate = useCallback(
    (
      nextCat: HqContractCategory,
      nextName: string,
      nextRole: string,
      nextDept: string,
      nextBook: string,
      nextStart: string,
      nextEnd: string,
      nextAmt: number,
      nextRoyalty: number | null,
      explicitTplId?: string,
      explicitMemberId?: string,
      explicitTaxType?: HqContractTaxType
    ) => {
      const catMeta = CONTRACT_CATEGORIES[nextCat];
      const tplIdToUse =
        explicitTplId !== undefined ? explicitTplId : selectedTemplateId;
      const customTpl = activeTemplateList.find((t) => t.id === tplIdToUse);

      const autoTitle = customTpl
        ? `[${customTpl.name}] ${
            nextBook ? `${nextBook} — ` : ""
          }${nextName || "계약상대방"}`
        : nextCat === "OUTSOURCING" || nextCat === "ROYALTY"
        ? `[${catMeta.shortLabel}] ${nextBook || "신간 교재"} — ${
            nextName || "파트너"
          }`
        : `[${catMeta.shortLabel}] ${new Date().getFullYear()}년 ${
            nextName || "구성원"
          } ${catMeta.label}`;

      setTitle(autoTitle);

      if (customTpl) {
        const matchedMember = activeMembers.find(
          (m) => m.instructor_id === (explicitMemberId ?? targetMemberId)
        );
        const customMap: Record<string, string> = {};
        customFields.forEach((cf) => {
          customMap[cf.token] = cf.default_value || "";
        });
        setBodyText(
          resolveContractTemplatePlaceholders({
            templateBody: customTpl.body_text,
            companySettings,
            member: matchedMember || null,
            workRule: resolveMemberRule(matchedMember?.name || nextName),
            counterpartyName: nextName,
            counterpartyRole: nextRole,
            department: nextDept,
            bookTitle: nextBook,
            startDate: nextStart,
            endDate: nextEnd,
            contractAmount: nextAmt,
            royaltyRate: nextRoyalty,
            taxLabel:
              CONTRACT_TAX_LABELS[explicitTaxType || taxType] || "",
            customValues: customMap,
          })
        );
        return;
      }

      setBodyText(
        buildContractTemplateBody({
          category: nextCat,
          counterpartyName: nextName,
          counterpartyRole: nextRole,
          department: nextDept,
          bookTitle: nextBook,
          startDate: nextStart,
          endDate: nextEnd,
          amount: nextAmt,
          royaltyRate: nextRoyalty,
        })
      );
    },
    [
      selectedTemplateId,
      activeTemplateList,
      activeMembers,
      targetMemberId,
      customFields,
      companySettings,
      resolveMemberRule,
      taxType,
    ]
  );

  const openNewModal = (
    presetCat?: HqContractCategory,
    presetTemplate?: HqContractTemplateItem
  ) => {
    const initCat: HqContractCategory =
      presetTemplate?.mapped_category ||
      presetCat ||
      (isHrManager ? "LABOR" : "OUTSOURCING");

    if ((initCat === "LABOR" || initCat === "SALARY") && !isHrManager) {
      alert(
        "근로·연봉계약서는 인사관리자(대표·임원·경영지원)만 작성할 수 있습니다."
      );
      return;
    }

    const meta = CONTRACT_CATEGORIES[initCat];
    const nextTarget = meta.targetDefault;
    const defaultMember =
      nextTarget === "INTERNAL" ? activeMembers[0] || null : null;

    const initName = defaultMember ? defaultMember.name : "";
    const initRole = defaultMember
      ? defaultMember.job_title
      : initCat === "ROYALTY"
      ? "집필 저자"
      : "외주 조판·디자인";
    const initDept = defaultMember ? defaultMember.department : "출판편집팀";
    const initAmt =
      defaultMember?.profile_extra?.wage_contract?.annual_salary ||
      (initCat === "LABOR" || initCat === "SALARY"
        ? 42000000
        : initCat === "NDA"
        ? 0
        : 2000000);
    const initStart = new Date().toISOString().slice(0, 10);

    setEditingDraftId("");
    setSelectedTemplateId(presetTemplate?.id || "");
    setCategory(initCat);
    setTargetType(nextTarget);
    setTargetMemberId(defaultMember?.instructor_id || "");
    setCounterpartyName(initName);
    setCounterpartyRole(initRole);
    setCounterpartyPhone(defaultMember?.phone || "");
    setCounterpartyEmail(defaultMember?.email || "");
    setDepartment(initDept);
    setBookTitle("");
    setStartDate(initStart);
    setEndDate("");
    setContractAmount(String(initAmt));
    setRoyaltyRate("10");
    setTaxType(meta.taxDefault);
    setSpecialTerms("");

    regenerateTemplate(
      initCat,
      initName,
      initRole,
      initDept,
      "",
      initStart,
      "",
      initAmt,
      initCat === "ROYALTY" ? 10 : null,
      presetTemplate?.id || "",
      defaultMember?.instructor_id || "",
      meta.taxDefault
    );
    setViewMode("CONTRACTS");
    setCreateOpen(true);
  };

  // 임시저장 수정 또는 기존 계약서 복제 열기
  const openFromExistingContract = (c: HqContract, mode: "EDIT_DRAFT" | "CLONE") => {
    setEditingDraftId(mode === "EDIT_DRAFT" ? c.contract_id : "");
    setSelectedTemplateId("");
    setCategory(c.category);
    setTargetType(c.target_type);
    setTargetMemberId(c.target_member_id || "");
    setCounterpartyName(c.counterparty_name);
    setCounterpartyRole(c.counterparty_role);
    setCounterpartyPhone(c.counterparty_phone || "");
    setCounterpartyEmail(c.counterparty_email || "");
    setDepartment(c.department);
    setTitle(mode === "CLONE" ? `${c.title} (갱신)` : c.title);
    setBookTitle(c.book_title || "");
    setStartDate(
      mode === "CLONE"
        ? new Date().toISOString().slice(0, 10)
        : c.start_date || new Date().toISOString().slice(0, 10)
    );
    setEndDate(c.end_date || "");
    setContractAmount(String(c.contract_amount || 0));
    setRoyaltyRate(String(c.royalty_rate ?? 10));
    setTaxType(c.tax_type);
    setBodyText(c.body_text);
    setSpecialTerms(c.special_terms || "");
    setSelected(null);
    setCreateOpen(true);
  };

  const handleSelectCategory = (nextCat: HqContractCategory) => {
    if ((nextCat === "LABOR" || nextCat === "SALARY") && !isHrManager) {
      alert(
        "근로·연봉계약서는 인사관리자(대표·임원·경영지원)만 작성할 수 있습니다."
      );
      return;
    }
    const meta = CONTRACT_CATEGORIES[nextCat];
    setCategory(nextCat);
    setTargetType(meta.targetDefault);
    setTaxType(meta.taxDefault);
    setSelectedTemplateId("");

    let nextName = counterpartyName;
    let nextRole = counterpartyRole;
    let nextDept = department;
    let nextMemberId = targetMemberId;

    if (meta.targetDefault === "INTERNAL" && activeMembers.length > 0) {
      const m =
        activeMembers.find((x) => x.instructor_id === targetMemberId) ||
        activeMembers[0];
      nextMemberId = m.instructor_id;
      setTargetMemberId(m.instructor_id);
      nextName = m.name;
      nextRole = m.job_title;
      nextDept = m.department;
      setCounterpartyName(m.name);
      setCounterpartyRole(m.job_title);
      setCounterpartyPhone(m.phone || "");
      setCounterpartyEmail(m.email || "");
      setDepartment(m.department);
    } else if (meta.targetDefault === "EXTERNAL") {
      nextMemberId = "";
      setTargetMemberId("");
      nextRole = nextCat === "ROYALTY" ? "집필 저자" : "외주 프리랜서";
      setCounterpartyRole(nextRole);
    }

    const nextAmt =
      nextCat === "LABOR" || nextCat === "SALARY"
        ? 42000000
        : nextCat === "NDA"
        ? 0
        : 2000000;
    setContractAmount(String(nextAmt));

    regenerateTemplate(
      nextCat,
      nextName,
      nextRole,
      nextDept,
      bookTitle,
      startDate,
      endDate,
      nextAmt,
      nextCat === "ROYALTY" ? Number(royaltyRate || 10) : null,
      "",
      nextMemberId,
      meta.taxDefault
    );
  };

  const handleSelectMember = (memberId: string) => {
    setTargetMemberId(memberId);
    const m = activeMembers.find((x) => x.instructor_id === memberId);
    if (!m) return;
    const memberAnnual =
      m.profile_extra?.wage_contract?.annual_salary ||
      (m.profile_extra?.wage_contract?.monthly_base
        ? m.profile_extra.wage_contract.monthly_base * 12
        : Number(contractAmount || 42000000));

    setCounterpartyName(m.name);
    setCounterpartyRole(m.job_title);
    setCounterpartyPhone(m.phone || "");
    setCounterpartyEmail(m.email || "");
    setDepartment(m.department);
    if (category === "SALARY" || category === "LABOR") {
      setContractAmount(String(memberAnnual));
    }

    regenerateTemplate(
      category,
      m.name,
      m.job_title,
      m.department,
      bookTitle,
      startDate,
      endDate,
      category === "SALARY" || category === "LABOR"
        ? memberAnnual
        : Number(contractAmount || 0),
      category === "ROYALTY" ? Number(royaltyRate || 10) : null,
      selectedTemplateId,
      m.instructor_id,
      taxType
    );
  };

  const handleSaveOrSendContract = async (
    submitStatus: "DRAFT" | "SENT"
  ) => {
    if (!counterpartyName.trim() || !title.trim() || !bodyText.trim()) {
      alert("상대방 성명, 계약 제목, 계약 본문 조항을 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category,
        target_type: targetType,
        target_member_id: targetType === "INTERNAL" ? targetMemberId : null,
        counterparty_name: counterpartyName,
        counterparty_role: counterpartyRole,
        counterparty_phone: counterpartyPhone,
        counterparty_email: counterpartyEmail,
        department,
        title,
        book_title: bookTitle,
        start_date: startDate || null,
        end_date: endDate || null,
        contract_amount: Number(contractAmount || 0),
        royalty_rate: category === "ROYALTY" ? Number(royaltyRate || 0) : null,
        tax_type: taxType,
        body_text: bodyText,
        special_terms: specialTerms,
        status: submitStatus,
        company_signer_name: `${
          companySettings?.company_name || "(주)천종현수학연구소"
        } 대표이사 ${companySettings?.ceo_names?.[0] || "천종현"}`,
      };

      if (editingDraftId) {
        await hqFetch("/api/hq/contracts", {
          method: "PATCH",
          body: {
            contract_id: editingDraftId,
            action: "UPDATE_DRAFT",
            next_status: submitStatus,
            ...payload,
          },
        });
      } else {
        await hqFetch("/api/hq/contracts", {
          method: "POST",
          body: payload,
        });
      }

      setCreateOpen(false);
      await Promise.all([loadContracts(), refreshContractBadge()]);
      window.dispatchEvent(new CustomEvent("hq:contract-updated"));
    } catch (err: any) {
      alert(err?.message || "계약 저장/발송 실패");
    } finally {
      setSaving(false);
    }
  };

  // 전자서명 캔버스 드로잉 핸들러
  const getCanvasPoint = (
    e:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return {
        x: ((t.clientX - rect.left) * canvas.width) / rect.width,
        y: ((t.clientY - rect.top) * canvas.height) / rect.height,
      };
    }
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const startDraw = (
    e:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    isDrawingRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (
    e:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignatureStroke(true);
  };

  const endDraw = () => {
    isDrawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureStroke(false);
  };

  const stampNameSeal = (nameText: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 28px serif";
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${nameText} (서명)`, canvas.width / 2, canvas.height / 2);
    setHasSignatureStroke(true);
  };

  const handleSignSubmit = async () => {
    if (!selected) return;
    const canvas = canvasRef.current;
    if (!canvas || !hasSignatureStroke) {
      alert(
        "서명 패드에 자필 서명을 그리거나 [성명 서명 자동생성]을 눌러주세요."
      );
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    setSaving(true);
    try {
      const res = await hqFetch<{ success: boolean; data: HqContract }>(
        "/api/hq/contracts",
        {
          method: "PATCH",
          body: {
            contract_id: selected.contract_id,
            action: "SIGN",
            party_signature_data: dataUrl,
          },
        }
      );
      setSelected(res.data);
      await Promise.all([loadContracts(), refreshContractBadge()]);
      window.dispatchEvent(new CustomEvent("hq:contract-updated"));
      alert("전자서명이 완료되어 계약이 공식 체결되었습니다.");
    } catch (err: any) {
      alert(err?.message || "전자서명 처리 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelContract = async (contractId: string) => {
    if (!confirm("이 계약서를 회수(파기) 상태로 변경하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/contracts", {
        method: "PATCH",
        body: { contract_id: contractId, action: "CANCEL" },
      });
      setSelected(null);
      await Promise.all([loadContracts(), refreshContractBadge()]);
    } catch (err: any) {
      alert(err?.message || "계약 회수 실패");
    }
  };

  // 체결 완료된 근로/연봉계약을 구성원 프로필에 원클릭 반영
  const handleReflectToProfile = async (c: HqContract) => {
    if (!c.target_member_id) return;
    setSaving(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { reflectedContractIds: string[] };
      }>("/api/hq/contract-templates", {
        method: "POST",
        body: {
          action: "REFLECT_TO_MEMBER_PROFILE",
          contract_id: c.contract_id,
          member_id: c.target_member_id,
          member_name: c.counterparty_name,
          category: c.category,
          contract_amount: c.contract_amount,
          start_date: c.start_date || "",
          end_date: c.end_date || "",
        },
      });
      setReflectedIds(res.data?.reflectedContractIds || []);
      await refreshMembers();
      alert(
        `${c.counterparty_name} 님의 체결 계약 조건이 구성원 인사·임금 프로필에 반영되었습니다.`
      );
    } catch (err: any) {
      alert(err?.message || "프로필 반영 실패");
    } finally {
      setSaving(false);
    }
  };

  const availableYears = useMemo(() => {
    const s = new Set<string>([String(new Date().getFullYear())]);
    contracts.forEach((c) => {
      const yr = (c.start_date || c.created_at || "").slice(0, 4);
      if (/^\d{4}$/.test(yr)) s.add(yr);
    });
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [contracts]);

  const nowMs = Date.now();
  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      if (tab === "SENT" && c.status !== "SENT") return false;
      if (tab === "SIGNED" && c.status !== "SIGNED") return false;
      if (tab === "DRAFT" && c.status !== "DRAFT") return false;
      if (tab === "INTERNAL" && c.target_type !== "INTERNAL") return false;
      if (tab === "EXTERNAL" && c.target_type !== "EXTERNAL") return false;
      if (tab === "EXPIRING") {
        if (!c.end_date || c.status !== "SIGNED") return false;
        const diffDays =
          (new Date(c.end_date).getTime() - nowMs) / (1000 * 60 * 60 * 24);
        if (diffDays < -7 || diffDays > 30) return false;
      }
      if (yearFilter !== "ALL") {
        const yr = (c.start_date || c.created_at || "").slice(0, 4);
        if (yr !== yearFilter) return false;
      }
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        const hay = `${c.title} ${c.counterparty_name} ${c.book_title || ""} ${
          c.contract_no
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, tab, yearFilter, keyword, nowMs]);

  const stats = useMemo(() => {
    const sent = contracts.filter((c) => c.status === "SENT").length;
    const signed = contracts.filter((c) => c.status === "SIGNED").length;
    const draft = contracts.filter((c) => c.status === "DRAFT").length;
    const externalCount = contracts.filter(
      (c) => c.target_type === "EXTERNAL"
    ).length;
    const expiring = contracts.filter((c) => {
      if (!c.end_date || c.status !== "SIGNED") return false;
      const diff =
        (new Date(c.end_date).getTime() - nowMs) / (1000 * 60 * 60 * 24);
      return diff >= -7 && diff <= 30;
    }).length;
    return { sent, signed, draft, externalCount, expiring };
  }, [contracts, nowMs]);

  // 체결 완료된 내부 근로·연봉계약 중 프로필 미반영 건
  const signedHrContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          c.status === "SIGNED" &&
          c.target_type === "INTERNAL" &&
          c.target_member_id &&
          (c.category === "LABOR" || c.category === "SALARY")
      ),
    [contracts]
  );

  const unreflectedCount = useMemo(
    () =>
      signedHrContracts.filter((c) => !reflectedIds.includes(c.contract_id))
        .length,
    [signedHrContracts, reflectedIds]
  );

  const taxPreview = useMemo(
    () => calcContractTaxBreakdown(Number(contractAmount || 0), taxType),
    [contractAmount, taxType]
  );

  const exportContractsLedgerCsv = () => {
    const header = [
      "계약번호",
      "유형",
      "제목",
      "대상도서",
      "상대방",
      "역할/직위",
      "금액",
      "인세율",
      "세무구분",
      "시작일",
      "종료일",
      "상태",
    ];
    const lines = [
      header.join(","),
      ...filteredContracts.map((c) =>
        [
          c.contract_no,
          CONTRACT_CATEGORIES[c.category]?.shortLabel || c.category,
          `"${(c.title || "").replace(/"/g, '""')}"`,
          `"${(c.book_title || "").replace(/"/g, '""')}"`,
          c.counterparty_name,
          c.counterparty_role,
          String(c.contract_amount || 0),
          c.royalty_rate ? `${c.royalty_rate}%` : "",
          CONTRACT_TAX_LABELS[c.tax_type] || c.tax_type,
          c.start_date || "",
          c.end_date || "",
          c.status,
        ].join(",")
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `전자계약대장_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div
        className={`p-6 max-w-[1440px] mx-auto w-full space-y-5 ${
          selected ? "print:hidden" : ""
        }`}
      >
        {/* 상단 모드 스위처: [계약서 · 요청 관리] | [서식 관리] | [구성원 정보 반영] */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode("CONTRACTS")}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                viewMode === "CONTRACTS"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>📑</span>
              <span>계약서 · 요청 관리</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("TEMPLATES")}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                viewMode === "TEMPLATES"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>📝</span>
              <span>서식 관리</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  viewMode === "TEMPLATES"
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {activeTemplateList.length}
              </span>
            </button>

            {(isHrManager || isHqAdmin) && (
              <button
                type="button"
                onClick={() => setViewMode("REFLECTION")}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                  viewMode === "REFLECTION"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>🔄</span>
                <span>구성원 인사·연봉 반영</span>
                {unreflectedCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">
                    {unreflectedCount}
                  </span>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            {activeCompanySealUrl ? (
              <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold">
                ✅ 공식 직인 이미지 자동 날인 연동됨
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openSettingsModal("seal")}
                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold"
              >
                ⚠️ 회사 직인 이미지 미등록 · 직인 설정 ›
              </button>
            )}
          </div>
        </div>

        {/* ===================================================================
            뷰 1: 기존 우리가 선호하는 [계약서 · 요청 관리] 메인 화면 (+ 기능 고도화)
           =================================================================== */}
        {viewMode === "CONTRACTS" && (
          <>
            {/* 상단 KPI 4개 카드 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  서명 대기 계약
                </div>
                <div className="text-2xl font-black text-amber-600 mt-1">
                  {stats.sent}건
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  전자서명 완료 즉시 인사·정산 기록 연동
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  체결 완료 보관
                </div>
                <div className="text-2xl font-black text-emerald-700 mt-1">
                  {stats.signed}건
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  상시 A4 계약서 출력 및 PDF 보관 가능
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  저자 · 외주 파트너 계약
                </div>
                <div className="text-2xl font-black text-brand mt-1">
                  {stats.externalCount}건
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  출판권(인세) · 조판 · 일러스트 · 문항출제 용역
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  30일 내 만료·갱신 도래
                </div>
                <div className="text-2xl font-black text-rose-600 mt-1">
                  {stats.expiring}건
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  출판권 연장 및 외주 납기 마감 사전 점검
                </div>
              </div>
            </div>

            {/* 빠른 표준 계약서 템플릿 런처 */}
            {canCreateContract && (
              <section className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-blue-300">
                      출판사 · 연구소 필수 표준 전자계약 5종 &amp; 맞춤 서식 연동
                    </div>
                    <h3 className="text-base font-extrabold mt-0.5">
                      양식을 선택하면 표준 법무 조항 및 구성원 자동입력 필드가 채워집니다
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      Object.keys(CONTRACT_CATEGORIES) as HqContractCategory[]
                    ).map((catKey) => {
                      const m = CONTRACT_CATEGORIES[catKey];
                      const disabled =
                        (catKey === "LABOR" || catKey === "SALARY") &&
                        !isHrManager;
                      if (disabled) return null;
                      return (
                        <button
                          key={catKey}
                          type="button"
                          onClick={() => openNewModal(catKey)}
                          className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold transition-colors flex items-center gap-1.5"
                        >
                          <span>{m.icon}</span>
                          <span>+ {m.shortLabel}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setViewMode("TEMPLATES")}
                      className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-200 text-xs font-extrabold transition-colors"
                    >
                      📝 서식 스튜디오 · 일괄 발송 ›
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* 필터 탭 및 계약서 목록 */}
            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["ALL", "전체 보관함"],
                      ["SENT", `서명 대기 (${stats.sent})`],
                      ["SIGNED", "체결 완료"],
                      ["DRAFT", `임시저장 (${stats.draft})`],
                      ["INTERNAL", "임직원 근로·연봉·NDA"],
                      ["EXTERNAL", "저자 출판권·외주용역"],
                      ["EXPIRING", `만료 임박 (${stats.expiring})`],
                    ] as [ContractTab, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                        tab === key
                          ? "bg-brand text-white"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 bg-white"
                  >
                    <option value="ALL">전체 연도</option>
                    {availableYears.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}년 계약
                      </option>
                    ))}
                  </select>

                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="계약명, 저자/구성원명, 도서명 검색..."
                    className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold w-56"
                  />

                  <button
                    type="button"
                    onClick={exportContractsLedgerCsv}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600"
                    title="계약 대장 엑셀(CSV) 다운로드"
                  >
                    ⤓ 대장 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase">
                      <th className="py-3 px-4">계약번호 / 구분</th>
                      <th className="py-3 px-4">계약서 제목 · 대상 도서</th>
                      <th className="py-3 px-4">계약 상대방 (을)</th>
                      <th className="py-3 px-4">계약 금액 · 인세율</th>
                      <th className="py-3 px-4">계약 기간</th>
                      <th className="py-3 px-4">서명 상태</th>
                      <th className="py-3 px-4 text-right">열람 · 서명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-12 text-center text-slate-400"
                        >
                          전자계약 문서를 불러오는 중입니다...
                        </td>
                      </tr>
                    ) : filteredContracts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-12 text-center text-slate-400"
                        >
                          표시할 전자계약 문서가 없습니다. 상단 버튼 또는 서식 관리에서 새 계약서를 발송해 보세요.
                        </td>
                      </tr>
                    ) : (
                      filteredContracts.map((c) => {
                        const catMeta = CONTRACT_CATEGORIES[c.category];
                        const isMySignTurn =
                          c.status === "SENT" &&
                          (c.target_member_id === me?.instructor_id ||
                            (c.target_type === "EXTERNAL" && canCreateContract));
                        return (
                          <tr
                            key={c.contract_id}
                            onClick={() => {
                              if (c.status === "DRAFT") {
                                openFromExistingContract(c, "EDIT_DRAFT");
                                return;
                              }
                              setSelected(c);
                              setHasSignatureStroke(false);
                            }}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-mono text-[11px] text-slate-400">
                                {c.contract_no}
                              </div>
                              <span
                                className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[11px] font-bold ${catMeta?.badgeClass}`}
                              >
                                {catMeta?.icon} {catMeta?.shortLabel}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-extrabold text-slate-900">
                                {c.title}
                              </div>
                              {c.book_title && (
                                <div className="text-[11px] text-brand font-semibold mt-0.5">
                                  📚 대상 도서: {c.book_title}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-bold text-slate-800">
                                {c.counterparty_name}{" "}
                                <span className="text-slate-400 font-semibold">
                                  ({c.counterparty_role})
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {c.target_type === "INTERNAL"
                                  ? `내부 임직원 · ${c.department}`
                                  : `외부 파트너 · ${
                                      CONTRACT_TAX_LABELS[c.tax_type]
                                    }`}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-800">
                              {c.contract_amount > 0
                                ? `${c.contract_amount.toLocaleString("ko-KR")}원`
                                : "-"}
                              {c.royalty_rate !== null &&
                                c.royalty_rate !== undefined && (
                                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px]">
                                    인세 {c.royalty_rate}%
                                  </span>
                                )}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                              {c.start_date || "-"} ~ {c.end_date || "상시"}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {c.status === "SIGNED" ? (
                                <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold">
                                  ✅ 전자서명 완료
                                </span>
                              ) : c.status === "SENT" ? (
                                <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-extrabold">
                                  ✍️ 서명 대기중
                                </span>
                              ) : c.status === "DRAFT" ? (
                                <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-extrabold">
                                  📝 임시저장
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">
                                  회수·만료
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                                  c.status === "DRAFT"
                                    ? "bg-sky-600 text-white"
                                    : isMySignTurn
                                    ? "bg-brand text-white"
                                    : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                {c.status === "DRAFT"
                                  ? "이어서 작성"
                                  : isMySignTurn
                                  ? "전자서명하기"
                                  : "계약서 보기"}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ===================================================================
            뷰 2: 플렉스 [서식 관리] 스튜디오 + 다수 구성원 일괄 발송
           =================================================================== */}
        {viewMode === "TEMPLATES" && (
          <ContractTemplateStudioSection
            categories={tplCategories}
            customFields={customFields}
            templates={templates}
            activeMembers={activeMembers}
            companySettings={companySettings}
            activeCompanySealUrl={activeCompanySealUrl}
            canManage={canCreateContract}
            isHrManager={isHrManager}
            onReloadTemplates={loadTemplates}
            onUseTemplateSingle={(tpl) => openNewModal(tpl.mapped_category, tpl)}
            onAfterBatchDispatched={async () => {
              await Promise.all([loadContracts(), refreshContractBadge()]);
              setViewMode("CONTRACTS");
            }}
          />
        )}

        {/* ===================================================================
            뷰 3: [구성원 인사·연봉 정보 반영] (체결 완료 계약 -> 구성원 프로필 동기화)
           =================================================================== */}
        {viewMode === "REFLECTION" && (
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  체결 완료 계약 → 구성원 인사·임금 정보 반영
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  전자서명이 완료된 근로·연봉계약의 계약연봉 및 계약기간을 구성원 프로필에 원클릭으로 동기화합니다.
                </p>
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setReflectFilter("NEEDED")}
                  className={`px-3 py-1 rounded-lg font-bold ${
                    reflectFilter === "NEEDED"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500"
                  }`}
                >
                  반영 필요 ({unreflectedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setReflectFilter("DONE")}
                  className={`px-3 py-1 rounded-lg font-bold ${
                    reflectFilter === "DONE"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500"
                  }`}
                >
                  반영 완료 ({signedHrContracts.length - unreflectedCount})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-3 px-6">대상 구성원</th>
                    <th className="py-3 px-4">계약서 제목</th>
                    <th className="py-3 px-4">체결 금액 (연봉)</th>
                    <th className="py-3 px-4">적용 기간</th>
                    <th className="py-3 px-4">서명 완료일</th>
                    <th className="py-3 px-6 text-right">프로필 반영</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {signedHrContracts.filter((c) =>
                    reflectFilter === "NEEDED"
                      ? !reflectedIds.includes(c.contract_id)
                      : reflectedIds.includes(c.contract_id)
                  ).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-20 text-center text-slate-400 font-semibold"
                      >
                        {reflectFilter === "NEEDED"
                          ? "인사·연봉 정보 반영이 필요한 체결 계약이 없습니다."
                          : "반영 완료된 내역이 없습니다."}
                      </td>
                    </tr>
                  ) : (
                    signedHrContracts
                      .filter((c) =>
                        reflectFilter === "NEEDED"
                          ? !reflectedIds.includes(c.contract_id)
                          : reflectedIds.includes(c.contract_id)
                      )
                      .map((c) => {
                        const isDone = reflectedIds.includes(c.contract_id);
                        return (
                          <tr
                            key={c.contract_id}
                            className="hover:bg-slate-50/70"
                          >
                            <td className="py-3.5 px-6 font-bold text-slate-900">
                              {c.counterparty_name}{" "}
                              <span className="text-slate-400 font-normal">
                                ({c.department})
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-800">
                              {c.title}
                            </td>
                            <td className="py-3.5 px-4 font-extrabold text-brand tabular-nums">
                              {c.contract_amount > 0
                                ? `${c.contract_amount.toLocaleString("ko-KR")}원`
                                : "-"}
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 tabular-nums">
                              {c.start_date || "-"} ~ {c.end_date || "상시"}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 tabular-nums">
                              {c.party_signed_at?.slice(0, 10) || "-"}
                            </td>
                            <td className="py-3.5 px-6 text-right">
                              {isDone ? (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold">
                                  ✓ 반영 완료
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleReflectToProfile(c)}
                                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
                                >
                                  구성원 정보에 반영
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* =====================================================================
          새 전자계약 작성·임시저장·발송 모달 (+ 서식 불러오기 & 원천세 계산기)
         ===================================================================== */}
      {createOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {editingDraftId
                    ? "임시저장 계약서 이어서 작성 · 발송"
                    : "새 전자계약서 작성 및 서명 요청 발송"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  저장된 맞춤 서식을 불러오거나 표준 양식으로 즉시 직인 날인 발송할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveOrSendContract("SENT");
              }}
              className="p-6 overflow-y-auto custom-scroll space-y-4 text-xs"
            >
              {/* 서식 관리 연동: 등록된 계약 서식 불러오기 */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-700">
                  📝 서식 관리 양식 불러오기:
                </span>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    const tplId = e.target.value;
                    setSelectedTemplateId(tplId);
                    const found = activeTemplateList.find((t) => t.id === tplId);
                    if (found) {
                      const nextCat = found.mapped_category;
                      const meta = CONTRACT_CATEGORIES[nextCat];
                      setCategory(nextCat);
                      setTargetType(meta.targetDefault);
                      setTaxType(meta.taxDefault);
                      regenerateTemplate(
                        nextCat,
                        counterpartyName,
                        counterpartyRole,
                        department,
                        bookTitle,
                        startDate,
                        endDate,
                        Number(contractAmount || 0),
                        nextCat === "ROYALTY" ? Number(royaltyRate || 10) : null,
                        tplId,
                        targetMemberId,
                        meta.taxDefault
                      );
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white min-w-[260px]"
                >
                  <option value="">기본 내장 표준 양식 사용</option>
                  {activeTemplateList.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      [{tpl.category_name}] {tpl.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 계약 양식 5종 선택 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(
                  Object.keys(CONTRACT_CATEGORIES) as HqContractCategory[]
                ).map((catKey) => {
                  const m = CONTRACT_CATEGORIES[catKey];
                  const active = category === catKey;
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => handleSelectCategory(catKey)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        active
                          ? "border-brand bg-blue-50/70 ring-2 ring-brand/20"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-base">{m.icon}</div>
                      <div className="font-extrabold text-slate-800 mt-1">
                        {m.shortLabel}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 대상 구분 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 대상 구분
                  </label>
                  <select
                    value={targetType}
                    onChange={(e) =>
                      setTargetType(e.target.value as HqContractTargetType)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    <option value="INTERNAL">내부 임직원 (구성원 연동)</option>
                    <option value="EXTERNAL">외부 저자 · 프리랜서 파트너</option>
                  </select>
                </div>

                {targetType === "INTERNAL" ? (
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">
                      본부 구성원 선택 (자동 정보 연동)
                    </label>
                    <select
                      value={targetMemberId}
                      onChange={(e) => handleSelectMember(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    >
                      <option value="">구성원을 선택하세요</option>
                      {activeMembers.map((m) => (
                        <option key={m.instructor_id} value={m.instructor_id}>
                          {m.name} ({m.department} · {m.job_title})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        저자 / 파트너 성명 (상호)
                      </label>
                      <input
                        required
                        value={counterpartyName}
                        onChange={(e) => setCounterpartyName(e.target.value)}
                        placeholder="예: 홍길동 작가 / 스튜디오 봄"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        과업 역할 / 직책
                      </label>
                      <input
                        value={counterpartyRole}
                        onChange={(e) => setCounterpartyRole(e.target.value)}
                        placeholder="예: 대표저자 / 내지 조판 / 문항 출제"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* 연락처 / 대상 도서 / 세무 구분 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    연락처
                  </label>
                  <input
                    value={counterpartyPhone}
                    onChange={(e) => setCounterpartyPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    대상 도서명 / 시리즈 (출판 계약용)
                  </label>
                  <input
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="예: 사고력 수학 노크 C단계 개정판"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    소득 · 세무 구분
                  </label>
                  <select
                    value={taxType}
                    onChange={(e) =>
                      setTaxType(e.target.value as HqContractTaxType)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    {Object.entries(CONTRACT_TAX_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 기간 · 금액 · 인세율 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 시작일 (인도기한)
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    종료일 (미지정 시 상시)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {category === "LABOR" || category === "SALARY"
                      ? "연봉 총액 (원)"
                      : category === "ROYALTY"
                      ? "선인세 / 계약금 (원)"
                      : "계약 대금 (원)"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={contractAmount}
                    onChange={(e) => setContractAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-brand"
                  />
                </div>
                {category === "ROYALTY" && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      약정 인세율 (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="50"
                      value={royaltyRate}
                      onChange={(e) => setRoyaltyRate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-emerald-700"
                    />
                  </div>
                )}
              </div>

              {/* 원천세 · 실수령액 즉시 계산 프리뷰 */}
              {Number(contractAmount || 0) > 0 &&
                (taxType === "BIZ_33" ||
                  taxType === "OTHER_88" ||
                  taxType === "INVOICE") && (
                  <div className="px-4 py-2.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-slate-700">
                      🧮 {taxPreview.formulaNote}
                    </span>
                    <span className="font-extrabold text-slate-900 tabular-nums">
                      총액 {taxPreview.gross.toLocaleString("ko-KR")}원
                      {taxPreview.withholdingTax > 0 &&
                        ` − 원천세 ${taxPreview.withholdingTax.toLocaleString(
                          "ko-KR"
                        )}원`}
                      {taxPreview.vatAdd > 0 &&
                        ` + 부가세 ${taxPreview.vatAdd.toLocaleString("ko-KR")}원`}{" "}
                      ={" "}
                      <strong className="text-brand">
                        실지급액 {taxPreview.netPayout.toLocaleString("ko-KR")}원
                      </strong>
                    </span>
                  </div>
                )}

              {/* 계약서 제목 + 표준 본문 자동 갱신 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">계약서 제목</label>
                  <button
                    type="button"
                    onClick={() =>
                      regenerateTemplate(
                        category,
                        counterpartyName,
                        counterpartyRole,
                        department,
                        bookTitle,
                        startDate,
                        endDate,
                        Number(contractAmount || 0),
                        category === "ROYALTY"
                          ? Number(royaltyRate || 10)
                          : null
                      )
                    }
                    className="text-brand font-extrabold hover:underline"
                  >
                    🔄 입력한 정보로 본문 플레이스홀더 다시 채우기
                  </button>
                </div>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-extrabold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  계약 본문 조항 (자유 편집 가능)
                </label>
                <textarea
                  rows={10}
                  required
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full p-3.5 rounded-xl border border-slate-300 font-medium leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  특약 사항 (선택)
                </label>
                <input
                  value={specialTerms}
                  onChange={(e) => setSpecialTerms(e.target.value)}
                  placeholder="예: 초판 2,000부 기준 선인세 지급 후 추가 쇄부터 판매부수 인세 정산"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveOrSendContract("DRAFT")}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-extrabold"
                >
                  💾 임시저장 (발송 전 보관)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-sm disabled:opacity-50"
                  >
                    {saving
                      ? "발송 중..."
                      : "✍️ 회사 직인 날인 후 서명 요청 발송"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          계약서 열람 · 전자서명 · A4 인쇄 모달 (+ 재계약 복제 & 정산 이동)
         ===================================================================== */}
      {selected && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
          <div className="bg-white rounded-2xl max-w-3xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none print:max-w-none">
            {/* 상단 컨트롤 바 (인쇄 시 숨김) */}
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 print:hidden">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">
                  {selected.contract_no}
                </span>
                <span className="text-sm font-extrabold">{selected.title}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canCreateContract && (
                  <button
                    type="button"
                    onClick={() => openFromExistingContract(selected, "CLONE")}
                    className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-bold"
                  >
                    📋 복제하여 재계약 작성
                  </button>
                )}
                {selected.status === "SIGNED" &&
                  selected.target_type === "EXTERNAL" && (
                    <button
                      type="button"
                      onClick={() => router.push("/hq/payroll")}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 text-xs font-bold"
                    >
                      💸 원천세·인세 정산 이동
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-bold"
                >
                  🖨️ A4 인쇄 / PDF 저장
                </button>
                {selected.status === "SENT" && isHrManager && (
                  <button
                    type="button"
                    onClick={() => handleCancelContract(selected.contract_id)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-bold"
                  >
                    계약 회수
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-2.5 py-1 rounded-lg hover:bg-white/10 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* A4 계약서 본문 시트 */}
            <div className="p-8 sm:p-10 space-y-6 text-slate-900 max-h-[82vh] overflow-y-auto custom-scroll print:max-h-none print:overflow-visible">
              <div className="text-center border-b-2 border-slate-900 pb-5">
                <div className="text-xs font-bold text-slate-500 tracking-widest">
                  전자계약 문서번호 {selected.contract_no}
                </div>
                <h1 className="text-2xl font-black mt-1.5">
                  {CONTRACT_CATEGORIES[selected.category]?.label ||
                    selected.title}
                </h1>
                {selected.book_title && (
                  <p className="text-sm font-bold text-slate-700 mt-1">
                    대상 저작물(프로젝트): 「{selected.book_title}」
                  </p>
                )}
              </div>

              {/* 계약 요약 표 */}
              <table className="w-full text-xs border border-slate-300 border-collapse">
                <tbody>
                  <tr className="border-b border-slate-300">
                    <th className="w-28 bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      갑 (발행처·사용자)
                    </th>
                    <td className="py-2.5 px-3 font-bold border-r border-slate-300">
                      {companySettings?.company_name || "(주)천종현수학연구소"}
                    </td>
                    <th className="w-28 bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      을 (계약상대방)
                    </th>
                    <td className="py-2.5 px-3 font-bold">
                      {selected.counterparty_name} ({selected.counterparty_role})
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <th className="bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      계약 기간
                    </th>
                    <td className="py-2.5 px-3 border-r border-slate-300">
                      {selected.start_date || "-"} ~{" "}
                      {selected.end_date || "기간의 정함이 없음"}
                    </td>
                    <th className="bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      계약금액 / 세무
                    </th>
                    <td className="py-2.5 px-3 font-bold">
                      {selected.contract_amount > 0
                        ? `${selected.contract_amount.toLocaleString("ko-KR")}원`
                        : "해당없음"}
                      {selected.royalty_rate
                        ? ` (인세 ${selected.royalty_rate}%)`
                        : ""}{" "}
                      · {CONTRACT_TAX_LABELS[selected.tax_type]}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 조항 전문 */}
              <div className="whitespace-pre-wrap text-[13px] leading-7 text-slate-800 border border-slate-200 rounded-xl p-5 bg-slate-50/40 print:bg-white">
                {selected.body_text}
                {selected.special_terms && (
                  <div className="mt-4 pt-4 border-t border-slate-200 font-semibold">
                    [특약 사항]{"\n"}
                    {selected.special_terms}
                  </div>
                )}
              </div>

              <p className="text-xs text-center text-slate-600 font-semibold">
                위 계약 내용에 상호 이의가 없음을 확인하고 전자서명하여 각 1부씩 전자 보관한다.
              </p>

              {/* 갑 / 을 전자서명 란 */}
              <div className="grid grid-cols-2 gap-5 pt-2">
                <div className="border border-slate-300 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">
                      갑 (회사)
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-1">
                      {selected.company_signer_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      서명일시:{" "}
                      {selected.company_signed_at?.slice(0, 10) || "-"}
                    </div>
                  </div>
                  {activeCompanySealUrl ? (
                    <img
                      src={activeCompanySealUrl}
                      alt="회사 직인"
                      className="w-16 h-16 object-contain shrink-0 select-none"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full border-2 border-rose-600 text-rose-600 flex flex-col items-center justify-center font-black text-[11px] leading-tight rotate-[-6deg] shrink-0">
                      <span>천종현수학</span>
                      <span>연구소인</span>
                    </div>
                  )}
                </div>

                <div className="border border-slate-300 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">
                      을 (서명자)
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-1">
                      {selected.counterparty_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {selected.status === "SIGNED"
                        ? `체결일시: ${selected.party_signed_at
                            ?.replace("T", " ")
                            .slice(0, 16)}`
                        : "전자서명 대기중"}
                    </div>
                  </div>
                  {selected.party_signature_data ? (
                    <img
                      src={selected.party_signature_data}
                      alt="전자서명"
                      className="h-16 max-w-[140px] object-contain border border-slate-200 rounded bg-white px-2"
                    />
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold">
                      미서명
                    </div>
                  )}
                </div>
              </div>

              {/* 서명 대기 상태일 때 전자서명 캔버스 노출 */}
              {selected.status === "SENT" &&
                (selected.target_member_id === me?.instructor_id ||
                  isHrManager ||
                  (selected.target_type === "EXTERNAL" &&
                    canCreateContract)) && (
                  <div className="mt-4 p-5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-3 print:hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">
                          ✍️ 을({selected.counterparty_name}) 자필 전자서명 패드
                        </h4>
                        <p className="text-xs text-slate-600">
                          마우스나 터치로 아래 흰색 영역에 서명한 뒤 [서명 완료 및 계약 체결]을 눌러주세요.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            stampNameSeal(selected.counterparty_name)
                          }
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          성명 서명 자동생성
                        </button>
                        <button
                          type="button"
                          onClick={clearSignature}
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          지우기
                        </button>
                      </div>
                    </div>

                    <canvas
                      ref={canvasRef}
                      width={560}
                      height={150}
                      onMouseDown={startDraw}
                      onMouseMove={moveDraw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={moveDraw}
                      onTouchEnd={endDraw}
                      className="w-full h-36 bg-white rounded-xl border-2 border-dashed border-blue-300 cursor-crosshair touch-none"
                    />

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleSignSubmit}
                        className="px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                      >
                        {saving
                          ? "체결 처리중..."
                          : "✅ 서명 완료 및 계약 체결"}
                      </button>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
