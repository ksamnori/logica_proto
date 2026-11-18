// src/components/hq/approvals/ApprovalCreateModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useOptionalHqShell } from "@/components/hq/HqShellContext";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_POLICY,
  getRankLevel,
  LEAVE_TYPES,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import {
  DEFAULT_APPROVAL_POLICIES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import {
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  DEFAULT_CUSTOM_LEAVES,
} from "@/lib/hq/defaultLeaveSettings";
import {
  DEFAULT_WORKFLOW_FORMS,
  isAutoLinkedMemberField,
  mergeFormsWithPolicies,
  resolveAutoMemberFieldValue,
  resolvePolicyApprovalLine,
  type ResolvedWorkflowStep,
} from "@/lib/hq/defaultWorkflowForms";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqApprovalPolicyItem,
  HqCustomLeaveItem,
  HqMember,
  HqWorkflowDocAttachment,
  HqWorkflowFormDef,
  PurchaseLineItem,
} from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  me: HqMember | null;
  members: HqMember[];
  defaultDocType?: HqApprovalDocType;
  defaultPolicyId?: string | null;
  workflowForms?: HqWorkflowFormDef[];
  availableRefDocs?: HqApprovalDoc[];
  presetRefDoc?: HqApprovalDoc | null;
  cloneSourceDoc?: HqApprovalDoc | null;
  onClose: () => void;
  onCreated: () => void;
}

export default function ApprovalCreateModal({
  isOpen,
  me,
  members,
  defaultDocType = "GENERAL",
  defaultPolicyId = null,
  workflowForms,
  availableRefDocs = [],
  presetRefDoc = null,
  cloneSourceDoc = null,
  onClose,
  onCreated,
}: Props) {
  const shell = useOptionalHqShell();

  const allApprovalPolicies = useMemo(() => {
    return shell?.companySettings?.extra_settings?.approval_policies &&
      shell.companySettings.extra_settings.approval_policies.length > 0
      ? shell.companySettings.extra_settings.approval_policies
      : DEFAULT_APPROVAL_POLICIES;
  }, [shell?.companySettings?.extra_settings?.approval_policies]);

  const effectiveForms = useMemo(() => {
    const wfPols = allApprovalPolicies.filter((p) => p.category === "workflow");
    const baseForms =
      workflowForms && workflowForms.length > 0
        ? workflowForms
        : DEFAULT_WORKFLOW_FORMS;
    return mergeFormsWithPolicies(baseForms, wfPols);
  }, [workflowForms, allApprovalPolicies]);

  const workPolicies = useMemo(
    () =>
      allApprovalPolicies.filter(
        (p) =>
          p.category === "work" &&
          (p.steps.some((s) => s.assignees.length > 0) || p.cc_list.length > 0)
      ),
    [allApprovalPolicies]
  );

  const customLeaveList: HqCustomLeaveItem[] = useMemo(() => {
    const saved = shell?.companySettings?.extra_settings?.custom_leaves;
    return saved && saved.length > 0 ? saved : DEFAULT_CUSTOM_LEAVES;
  }, [shell?.companySettings?.extra_settings?.custom_leaves]);

  const primaryAnnualPolicy = useMemo(() => {
    const saved =
      shell?.companySettings?.extra_settings?.annual_leave_settings?.policies;
    const list =
      saved && saved.length > 0
        ? saved
        : DEFAULT_ANNUAL_LEAVE_SETTINGS.policies;
    return list.find((p) => p.is_default) || list[0];
  }, [shell?.companySettings?.extra_settings?.annual_leave_settings]);

  const selectableLeaveOptions = useMemo(() => {
    const base: {
      label: string;
      deductAnnual: boolean;
      defaultDays: number;
      policyId: string;
      proofGuide?: string;
      proofMode?: string;
    }[] = [
      {
        label: "연차",
        deductAnnual: true,
        defaultDays: 1,
        policyId: primaryAnnualPolicy?.policy_id || "lv-annual",
      },
      {
        label: "오전 반차",
        deductAnnual: true,
        defaultDays: 0.5,
        policyId: primaryAnnualPolicy?.policy_id || "lv-annual",
      },
      {
        label: "오후 반차",
        deductAnnual: true,
        defaultDays: 0.5,
        policyId: primaryAnnualPolicy?.policy_id || "lv-annual",
      },
    ];

    if (primaryAnnualPolicy?.usage_unit_category === "시간") {
      const sub = primaryAnnualPolicy.hourly_sub_unit || "2시간";
      const subDays = sub === "1시간" ? 0.125 : 0.25;
      base.push({
        label: `시간차 연차 (${sub})`,
        deductAnnual: true,
        defaultDays: subDays,
        policyId: primaryAnnualPolicy.policy_id || "lv-annual",
      });
    }

    customLeaveList.forEach((cl) => {
      const daysVal =
        cl.grant_unit === "시간 단위 부여"
          ? Math.max(0.25, Math.round((cl.grant_amount / 8) * 100) / 100)
          : cl.grant_amount || 1;
      base.push({
        label: cl.name,
        deductAnnual: false,
        defaultDays: daysVal,
        policyId: cl.policy_id,
        proofMode: cl.proof_document_mode,
        proofGuide: cl.proof_document_guide,
      });
    });

    return base;
  }, [customLeaveList, primaryAnnualPolicy]);

  // 선택된 양식 및 상태
  const [selectedForm, setSelectedForm] = useState<HqWorkflowFormDef | null>(
    null
  );
  const [switchingForm, setSwitchingForm] = useState(false);

  const [docType, setDocType] = useState<HqApprovalDocType>(defaultDocType);
  const [urgent, setUrgent] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  // 커스텀 필드 입력값 & 참조문서 연결
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [refDocId, setRefDocId] = useState<string>("");

  // 날짜 및 휴가
  const [effectiveDate, setEffectiveDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0].label);
  const [leaveDays, setLeaveDays] = useState("1");
  const [handoverName, setHandoverName] = useState("");

  // 금액 · 지출 · 품의
  const [amountInput, setAmountInput] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>(
    EXPENSE_CATEGORIES[0]
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    PAYMENT_METHODS[0]
  );
  const [merchantName, setMerchantName] = useState("");
  const [cardLast4, setCardLast4] = useState("");

  // 첨부 파일 목록
  const [attachments, setAttachments] = useState<HqWorkflowDocAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  // 구매 품의 품목 리스트
  const [items, setItems] = useState<PurchaseLineItem[]>([
    { name: "", qty: 1, unitPrice: 0, amount: 0 },
  ]);

  // 승인선 & 참조자 (양식 정책 기준 — 직급별 자동전결 제거)
  const [allowLineEdit, setAllowLineEdit] = useState(true);
  const [zeroStepAllowed, setZeroStepAllowed] = useState(false);
  const [steps, setSteps] = useState<ResolvedWorkflowStep[]>([]);
  const [ccMembers, setCcMembers] = useState<
    { id: string; name: string; dept: string }[]
  >([]);
  const [addingCc, setAddingCc] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const applyWorkflowForm = (form: HqWorkflowFormDef) => {
    setSelectedForm(form);
    setSwitchingForm(false);
    setDocType(form.mapped_doc_type || "GENERAL");
    setTitle("");
    setContent(form.use_body !== false ? form.body_template || "" : "");

    const initialFieldVals: Record<string, string> = {};
    (form.fields || []).forEach((f) => {
      if (isAutoLinkedMemberField(f.type)) {
        initialFieldVals[f.id] = resolveAutoMemberFieldValue(f.type, me);
      } else {
        initialFieldVals[f.id] = "";
      }
    });
    setFieldValues(initialFieldVals);

    const resolved = resolvePolicyApprovalLine({
      policy: {
        id: form.id,
        allow_edit: form.allow_edit,
        per_requester: form.per_requester,
        cc_list: form.cc_list || [],
        steps: form.steps || [],
        requester_rules: form.requester_rules,
      },
      me,
      members,
      substituteRules:
        shell?.companySettings?.extra_settings?.substitute_approvals || [],
    });

    setSteps(resolved.steps);
    setCcMembers(resolved.ccMembers);
    setAllowLineEdit(resolved.allowEdit);
    setZeroStepAllowed(resolved.zeroStepConfigured);
  };

  const applyWorkOrLeavePolicy = (
    pol: HqApprovalPolicyItem,
    forcedDocType: HqApprovalDocType
  ) => {
    const pseudoForm: HqWorkflowFormDef = {
      id: pol.id,
      category_name: pol.category === "leave" ? "인사 · 근태" : "근무 승인",
      title: pol.title,
      description: pol.description || "",
      icon: pol.icon || "📋",
      mapped_doc_type: forcedDocType,
      fields: [],
      body_template: pol.description || "",
      attachment_mode: "OPTIONAL",
      use_body: true,
      allow_doc_edit: true,
      allow_edit: pol.allow_edit,
      per_requester: pol.per_requester,
      cc_list: pol.cc_list || [],
      steps: pol.steps || [],
      requester_rules: pol.requester_rules,
    };
    applyWorkflowForm(pseudoForm);
    setTitle(`[${pol.title}] ${me?.name || ""} 신청`);
  };

  useEffect(() => {
    if (!isOpen || !me) return;
    const today = new Date().toISOString().slice(0, 10);
    setUrgent(false);
    setEffectiveDate(today);
    setEndDate(today);
    setLeaveType(LEAVE_TYPES[0].label);
    setLeaveDays("1");
    setHandoverName("");
    setAmountInput("");
    setExpenseCategory(EXPENSE_CATEGORIES[0]);
    setPaymentMethod(PAYMENT_METHODS[0]);
    setMerchantName("");
    setCardLast4("");
    setAttachments([]);
    setItems([{ name: "", qty: 1, unitPrice: 0, amount: 0 }]);
    setRefDocId("");
    setAddingCc(false);

    // 1) 지정된 양식/정책 ID가 있는 경우 우선 적용
    if (defaultPolicyId) {
      const wfMatch = effectiveForms.find((f) => f.id === defaultPolicyId);
      if (wfMatch) {
        applyWorkflowForm(wfMatch);
      } else {
        const polMatch = allApprovalPolicies.find(
          (p) => p.id === defaultPolicyId
        );
        if (polMatch) {
          applyWorkOrLeavePolicy(
            polMatch,
            polMatch.mapped_doc_type || defaultDocType
          );
        }
      }
    } else if (defaultDocType === "LEAVE") {
      const lvPol =
        allApprovalPolicies.find((p) => p.id === "lv-annual") ||
        effectiveForms.find((f) => f.mapped_doc_type === "LEAVE");
      if (lvPol && "category" in lvPol) {
        applyWorkOrLeavePolicy(lvPol, "LEAVE");
      } else if (lvPol) {
        applyWorkflowForm(lvPol);
      }
    } else {
      const firstMatch =
        effectiveForms.find((f) => f.mapped_doc_type === defaultDocType) ||
        effectiveForms[0];
      if (firstMatch) applyWorkflowForm(firstMatch);
    }

    // 2) 사전 지출계획서 → 사후 지출품의서 원클릭 연결 프리셋
    if (presetRefDoc) {
      const postForm =
        effectiveForms.find((f) => f.id === "wf-expense-post") ||
        effectiveForms.find((f) => f.mapped_doc_type === "EXPENSE");
      if (postForm) {
        applyWorkflowForm(postForm);
        const refField = postForm.fields.find((f) => f.type === "REF_DOC");
        if (refField) {
          setFieldValues((prev) => ({
            ...prev,
            [refField.id]: presetRefDoc.approval_id,
          }));
        }
      }
      setRefDocId(presetRefDoc.approval_id);
      setTitle(
        presetRefDoc.title.replace(/^\[.*?\]\s*/, "") || presetRefDoc.title
      );
      if (presetRefDoc.amount > 0) {
        setAmountInput(String(presetRefDoc.amount));
      }
      if (presetRefDoc.merchant_name) {
        setMerchantName(presetRefDoc.merchant_name);
      }
      setContent(
        `[사전 승인 문서 연결] ${presetRefDoc.doc_no} (${presetRefDoc.title})\n\n1. 실제 결제 내역:\n- 결제 금액: ${presetRefDoc.amount.toLocaleString()}원\n- 거래처: ${presetRefDoc.merchant_name || ""}\n\n2. 증빙 영수증 첨부 확인:`
      );
    }

    // 3) 기존 문서 복제(재기안) 프리셋
    if (cloneSourceDoc) {
      const srcFormId = cloneSourceDoc.workflow_meta?.form_id;
      const matchedForm = srcFormId
        ? effectiveForms.find((f) => f.id === srcFormId)
        : effectiveForms.find(
            (f) => f.mapped_doc_type === cloneSourceDoc.doc_type
          );
      if (matchedForm) applyWorkflowForm(matchedForm);
      setTitle(cloneSourceDoc.title);
      setContent(cloneSourceDoc.content || "");
      if (cloneSourceDoc.amount > 0) {
        setAmountInput(String(cloneSourceDoc.amount));
      }
      if (cloneSourceDoc.merchant_name) {
        setMerchantName(cloneSourceDoc.merchant_name);
      }
      if (cloneSourceDoc.items_json && cloneSourceDoc.items_json.length > 0) {
        setItems(cloneSourceDoc.items_json);
      }
      if (cloneSourceDoc.workflow_meta?.field_values) {
        setFieldValues((prev) => ({
          ...prev,
          ...cloneSourceDoc.workflow_meta!.field_values,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    me?.instructor_id,
    defaultDocType,
    defaultPolicyId,
    presetRefDoc?.approval_id,
    cloneSourceDoc?.approval_id,
  ]);

  // 휴가 일수 자동 계산
  useEffect(() => {
    if (docType !== "LEAVE") return;
    const matchedOpt = selectableLeaveOptions.find(
      (o) => o.label === leaveType
    );
    if (matchedOpt && matchedOpt.defaultDays < 1) {
      setLeaveDays(String(matchedOpt.defaultDays));
      if (effectiveDate) setEndDate(effectiveDate);
      return;
    }
    if (effectiveDate && endDate) {
      const s = new Date(effectiveDate);
      const e = new Date(endDate);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
        if (
          s.getTime() === e.getTime() &&
          matchedOpt &&
          matchedOpt.defaultDays > 1
        ) {
          setLeaveDays(String(matchedOpt.defaultDays));
          return;
        }
        let workDays = 0;
        const cur = new Date(s);
        while (cur <= e) {
          const day = cur.getDay();
          if (day !== 0 && day !== 6) workDays += 1;
          cur.setDate(cur.getDate() + 1);
        }
        setLeaveDays(String(Math.max(1, workDays)));
      }
    }
  }, [docType, leaveType, effectiveDate, endDate, selectableLeaveOptions]);

  const purchaseTotal = useMemo(
    () =>
      items.reduce(
        (sum, it) =>
          sum + Math.max(0, Number(it.qty || 0) * Number(it.unitPrice || 0)),
        0
      ),
    [items]
  );

  // 커스텀 필드 중 KRW 금액이 입력되었을 경우 보조 합산 지원
  const customKrwSum = useMemo(() => {
    if (!selectedForm) return 0;
    return selectedForm.fields
      .filter((f) => f.type === "KRW")
      .reduce((acc, f) => {
        const num = Number(
          String(fieldValues[f.id] || "").replace(/[^0-9]/g, "")
        );
        return acc + (Number.isFinite(num) ? num : 0);
      }, 0);
  }, [selectedForm, fieldValues]);

  const effectiveAmount = useMemo(() => {
    if (docType === "PURCHASE") return purchaseTotal || customKrwSum;
    if (docType === "LEAVE") return 0;
    const manual = Math.max(
      0,
      Math.round(Number(amountInput.replace(/[^0-9]/g, "") || 0))
    );
    return manual > 0 ? manual : customKrwSum;
  }, [docType, purchaseTotal, amountInput, customKrwSum]);

  if (!isOpen || !me) return null;

  const eligibleApprovers = members
    .filter(
      (m) => m.work_status === "재직" && m.instructor_id !== me.instructor_id
    )
    .sort((a, b) => {
      const diff = getRankLevel(b.rank_code) - getRankLevel(a.rank_code);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "ko");
    });

  // 실제 재직 구성원 + 승인 정책 관리 프리셋(더미) 구성원 통합 후보 목록
  const selectableApproverOptions = (() => {
    const list: {
      id: string;
      name: string;
      dept: string;
      rank_code: string;
      job_title: string;
    }[] = eligibleApprovers.map((m) => ({
      id: m.instructor_id,
      name: m.name,
      dept: m.department,
      rank_code: m.rank_code,
      job_title: m.job_title,
    }));
    const existingNames = new Set(
      members.filter((m) => m.work_status === "재직").map((m) => m.name.trim())
    );
    [
      PRESET_ASSIGNEES.CHUN,
      PRESET_ASSIGNEES.KIM_GS,
      PRESET_ASSIGNEES.JO_WH,
      PRESET_ASSIGNEES.KIM_MS,
    ].forEach((p) => {
      if (existingNames.has(p.name.trim()) || p.name.trim() === me.name.trim()) {
        return;
      }
      list.push({
        id: `preset:${p.name}`,
        name: p.name,
        dept: p.sub_label || "본부",
        rank_code: p.sub_label?.includes("대표") ? "CEO" : "TEAM_LEAD",
        job_title: p.sub_label || "",
      });
    });
    return list;
  })();

  const approvedRefCandidates = availableRefDocs.filter(
    (d) =>
      d.status === "APPROVED" ||
      d.drafter_id === me.instructor_id
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_approval_receipts");
      setAttachments((prev) => [...prev, { name: file.name, url: path }]);
    } catch (err: any) {
      alert(err?.message || "첨부파일 업로드 실패");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  const handleAddStep = () => {
    if (!allowLineEdit || selectableApproverOptions.length === 0) return;
    const used = new Set(steps.map((s) => s.approver_id));
    const candidate =
      selectableApproverOptions.find((m) => !used.has(m.id)) ||
      selectableApproverOptions[0];
    setSteps((prev) => {
      const next = [
        ...prev,
        {
          step_order: prev.length + 1,
          step_role: "FINAL_APPROVER" as const,
          role_label: `${prev.length + 1}단계 승인`,
          approver_id: candidate.id,
          approver_name: candidate.name,
          approver_dept: candidate.dept,
          approver_rank: candidate.rank_code,
          approver_title: candidate.job_title,
        },
      ];
      return next.map((s, idx) => ({
        ...s,
        step_order: idx + 1,
        step_role:
          idx === next.length - 1
            ? ("FINAL_APPROVER" as const)
            : ("REVIEWER" as const),
        role_label: `${idx + 1}단계 승인`,
      }));
    });
  };

  const handleStepMemberChange = (idx: number, memberId: string) => {
    if (!allowLineEdit) return;
    const found = selectableApproverOptions.find((m) => m.id === memberId);
    if (!found) return;
    setSteps((prev) =>
      prev.map((s, i) =>
        i === idx
          ? {
              ...s,
              approver_id: found.id,
              approver_name: found.name,
              approver_dept: found.dept,
              approver_rank: found.rank_code,
              approver_title: found.job_title,
            }
          : s
      )
    );
  };

  const handleRemoveStep = (idx: number) => {
    if (!allowLineEdit) return;
    setSteps((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      return filtered.map((s, i) => ({
        ...s,
        step_order: i + 1,
        step_role:
          i === filtered.length - 1
            ? ("FINAL_APPROVER" as const)
            : ("REVIEWER" as const),
        role_label: `${i + 1}단계 승인`,
      }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert("문서 제목을 입력해 주세요.");
      return;
    }

    // 필수 커스텀 필드 검증
    if (selectedForm) {
      for (const fld of selectedForm.fields) {
        if (
          fld.required &&
          !isAutoLinkedMemberField(fld.type) &&
          !String(fieldValues[fld.id] || "").trim()
        ) {
          alert(`[${fld.label}] 항목은 필수 입력입니다.`);
          return;
        }
      }
      if (
        selectedForm.attachment_mode === "REQUIRED" &&
        attachments.length === 0
      ) {
        alert("이 양식은 증빙·첨부 파일이 필수입니다. 파일을 첨부해 주세요.");
        return;
      }
    }

    if (docType === "EXPENSE" && effectiveAmount <= 0) {
      alert("지출 품의 문서는 지출 금액(0원 초과)을 입력해야 합니다.");
      return;
    }
    if (docType === "PURCHASE" && effectiveAmount <= 0) {
      alert("품목 단가 또는 예상 지출 금액을 입력해 주세요.");
      return;
    }
    if (steps.length === 0 && !zeroStepAllowed && me.rank_level < 5) {
      alert("최소 1명 이상의 승인자를 지정해 주세요.");
      return;
    }

    const cleanedItems =
      docType === "PURCHASE"
        ? items
            .filter((it) => it.name.trim() !== "")
            .map((it) => ({
              name: it.name.trim(),
              qty: Number(it.qty || 1),
              unitPrice: Number(it.unitPrice || 0),
              amount: Number(it.qty || 1) * Number(it.unitPrice || 0),
            }))
        : [];

    // 참조 문서 정보 조합
    let resolvedRefId = refDocId;
    if (!resolvedRefId && selectedForm) {
      const refFld = selectedForm.fields.find((f) => f.type === "REF_DOC");
      if (refFld && fieldValues[refFld.id]) {
        resolvedRefId = fieldValues[refFld.id];
      }
    }
    const linkedDoc =
      availableRefDocs.find((d) => d.approval_id === resolvedRefId) ||
      (presetRefDoc?.approval_id === resolvedRefId ? presetRefDoc : null);

    const fieldLabels: Record<string, string> = {};
    (selectedForm?.fields || []).forEach((f) => {
      fieldLabels[f.id] = f.label;
    });

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: docType,
          urgent,
          title: title.trim(),
          content: content.trim(),
          amount: effectiveAmount,
          effective_date: effectiveDate || null,
          end_date: docType === "LEAVE" ? endDate || effectiveDate : null,
          leave_type: docType === "LEAVE" ? leaveType : null,
          leave_days: docType === "LEAVE" ? Number(leaveDays || 0) : 0,
          handover_name: docType === "LEAVE" ? handoverName.trim() || null : null,
          expense_category: docType === "EXPENSE" ? expenseCategory : null,
          payment_method: docType === "EXPENSE" ? paymentMethod : null,
          merchant_name:
            docType === "EXPENSE" || docType === "PURCHASE"
              ? merchantName.trim() || null
              : null,
          card_last4:
            docType === "EXPENSE" && cardLast4.trim() ? cardLast4.trim() : null,
          receipt_url: attachments[0]?.url || null,
          items_json: cleanedItems,
          allow_zero_steps: zeroStepAllowed,
          steps,
          workflow_meta: {
            form_id: selectedForm?.id || null,
            form_title: selectedForm?.title || "워크플로우 문서",
            form_icon: selectedForm?.icon || "📋",
            cc_member_ids: ccMembers.map((c) => c.id).filter(Boolean),
            cc_member_names: ccMembers.map((c) => c.name),
            field_values: fieldValues,
            field_labels: fieldLabels,
            ref_doc_id: linkedDoc?.approval_id || null,
            ref_doc_no: linkedDoc?.doc_no || null,
            ref_doc_title: linkedDoc?.title || null,
            attachments,
          },
        },
      });

      window.dispatchEvent(new Event("hq:approval-updated"));
      onCreated();
      onClose();
    } catch (err: any) {
      alert(err?.message || "문서 상신 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const policyInfo = EXPENSE_CATEGORY_POLICY[expenseCategory];
  const guidePublicUrl = resolveStoragePublicUrl(selectedForm?.ref_file_url);

  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-[2px] z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white w-full max-w-[1000px] h-[88vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col lg:flex-row overflow-hidden">
        {/* ================= 좌측: 워크플로우 문서 작성 영역 ================= */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col h-full min-w-0"
        >
          {/* 상단 바 */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                style={{
                  backgroundColor: selectedForm?.icon_bg || "#f1f5f9",
                }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
              >
                {selectedForm?.icon || "📋"}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold text-slate-900 truncate">
                    {selectedForm?.title || "워크플로우 작성"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSwitchingForm((v) => !v)}
                    className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-600 shrink-0"
                  >
                    양식 변경 ▾
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  작성자: {me.name} {me.job_title} ({me.department})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                  className="accent-rose-600 rounded"
                />
                <span className="text-[11px] font-extrabold text-rose-600">
                  긴급
                </span>
              </label>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-extrabold"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 양식 빠른 전환 바 */}
          {switchingForm && (
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
              <div className="text-[11px] font-bold text-slate-500">
                사내 워크플로우 양식 선택
              </div>
              <div className="flex flex-wrap gap-1.5">
                {effectiveForms.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => applyWorkflowForm(f)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${
                      selectedForm?.id === f.id
                        ? "bg-emerald-50 border-[#00c458] text-emerald-900"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span>{f.icon}</span>
                    <span>{f.title}</span>
                  </button>
                ))}
              </div>
              {workPolicies.length > 0 && (
                <div className="pt-1.5 border-t border-slate-200/70">
                  <div className="text-[10px] font-bold text-slate-400 mb-1">
                    근무 · 출장 · 초과근무 승인 신청
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {workPolicies.map((wp) => (
                      <button
                        key={wp.id}
                        type="button"
                        onClick={() => applyWorkOrLeavePolicy(wp, "GENERAL")}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                      >
                        {wp.icon} {wp.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 작성 본문 스크롤 */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-[13px] custom-scroll">
            {/* 양식 안내문 & 참고 파일 */}
            {(selectedForm?.description || guidePublicUrl) && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>💡 {selectedForm?.description}</span>
                {guidePublicUrl && (
                  <a
                    href={guidePublicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-blue-600 font-bold hover:underline shrink-0"
                  >
                    📄 참고 파일 ({selectedForm?.ref_file_name || "열람"})
                  </a>
                )}
              </div>
            )}

            {/* 문서 제목 */}
            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                제목 <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="문서 제목을 입력해 주세요."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-[#00c458] focus:outline-none font-bold text-slate-900"
              />
            </div>

            {/* 양식별 커스텀 필드 렌더링 */}
            {selectedForm && selectedForm.fields.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80">
                {selectedForm.fields.map((fld) => {
                  const val = fieldValues[fld.id] ?? "";
                  const autoLinked = isAutoLinkedMemberField(fld.type);

                  if (fld.type === "REF_DOC") {
                    return (
                      <div key={fld.id} className="sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          🔗 {fld.label}{" "}
                          {fld.required && (
                            <span className="text-rose-500">*</span>
                          )}
                        </label>
                        <select
                          value={val}
                          onChange={(e) => {
                            const pickedId = e.target.value;
                            setFieldValues((prev) => ({
                              ...prev,
                              [fld.id]: pickedId,
                            }));
                            setRefDocId(pickedId);
                            const pickedDoc = approvedRefCandidates.find(
                              (d) => d.approval_id === pickedId
                            );
                            if (pickedDoc && pickedDoc.amount > 0 && !amountInput) {
                              setAmountInput(String(pickedDoc.amount));
                            }
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                        >
                          <option value="">참조할 승인 문서를 선택하세요 (선택사항)</option>
                          {approvedRefCandidates.map((d) => (
                            <option key={d.approval_id} value={d.approval_id}>
                              [{d.workflow_meta?.form_title || d.doc_no}] {d.title} (
                              {d.drafter_name}
                              {d.amount > 0
                                ? ` · ${d.amount.toLocaleString()}원`
                                : ""}
                              )
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  if (fld.type === "SELECT") {
                    return (
                      <div key={fld.id}>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          {fld.label}{" "}
                          {fld.required && (
                            <span className="text-rose-500">*</span>
                          )}
                        </label>
                        <select
                          value={val}
                          onChange={(e) =>
                            setFieldValues((prev) => ({
                              ...prev,
                              [fld.id]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                        >
                          <option value="">선택해 주세요</option>
                          {(fld.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  if (fld.type === "MULTI_SELECT") {
                    const selectedSet = new Set(
                      val
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    );
                    return (
                      <div key={fld.id} className="sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          {fld.label}{" "}
                          {fld.required && (
                            <span className="text-rose-500">*</span>
                          )}
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {(fld.options || []).map((opt) => {
                            const active = selectedSet.has(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  const next = new Set(selectedSet);
                                  if (next.has(opt)) next.delete(opt);
                                  else next.add(opt);
                                  setFieldValues((prev) => ({
                                    ...prev,
                                    [fld.id]: Array.from(next).join(", "),
                                  }));
                                }}
                                className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors ${
                                  active
                                    ? "bg-emerald-50 border-[#00c458] text-emerald-800"
                                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                {active ? "✓ " : ""}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const isCurrency =
                    fld.type === "KRW" ||
                    fld.type === "USD" ||
                    fld.type === "JPY";
                  const currencySuffix =
                    fld.type === "KRW"
                      ? "원"
                      : fld.type === "USD"
                        ? "USD"
                        : fld.type === "JPY"
                          ? "JPY"
                          : "";

                  return (
                    <div key={fld.id}>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {fld.label}{" "}
                        {fld.required && (
                          <span className="text-rose-500">*</span>
                        )}
                        {autoLinked && (
                          <span className="ml-1 text-[10px] text-emerald-600 font-semibold">
                            (자동연동)
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type={
                            fld.type === "DATE"
                              ? "date"
                              : fld.type === "NUMBER"
                                ? "number"
                                : "text"
                          }
                          readOnly={autoLinked}
                          value={
                            isCurrency && val
                              ? Number(
                                  val.replace(/[^0-9]/g, "") || 0
                                ).toLocaleString()
                              : val
                          }
                          onChange={(e) =>
                            setFieldValues((prev) => ({
                              ...prev,
                              [fld.id]: isCurrency
                                ? e.target.value.replace(/[^0-9]/g, "")
                                : e.target.value,
                            }))
                          }
                          placeholder={fld.placeholder || ""}
                          className={`w-full px-3 py-2 rounded-xl border text-xs font-bold ${
                            autoLinked
                              ? "bg-slate-100 border-slate-200 text-slate-600"
                              : "bg-white border-slate-200 text-slate-800 focus:border-[#00c458] focus:outline-none"
                          } ${isCurrency ? "pr-10 text-right" : ""}`}
                        />
                        {isCurrency && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                            {currencySuffix}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 연동 모듈별 상세 블록 (휴가 / 구매발주 / 지출정산) */}
            {docType === "LEAVE" && (
              <section className="rounded-2xl bg-emerald-50/40 border border-emerald-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-emerald-900">
                    🌴 휴가 · 연차 상세 정보
                  </h4>
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 text-[11px] font-extrabold">
                    잔여 연차: {me.annual_leave_remain}일 사용 가능
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      휴가 구분
                    </label>
                    <select
                      value={leaveType}
                      onChange={(e) => {
                        const nextLabel = e.target.value;
                        setLeaveType(nextLabel);
                        const opt = selectableLeaveOptions.find(
                          (o) => o.label === nextLabel
                        );
                        if (opt) {
                          setLeaveDays(String(opt.defaultDays));
                          const linkedPol = allApprovalPolicies.find(
                            (p) => p.id === opt.policyId
                          );
                          if (linkedPol) {
                            applyWorkOrLeavePolicy(linkedPol, "LEAVE");
                          }
                          setTitle(`[${nextLabel}] ${me.name} 휴가 신청`);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    >
                      {selectableLeaveOptions.map((lt) => (
                        <option key={lt.label} value={lt.label}>
                          {lt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      시작일
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      종료일
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      min={effectiveDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      사용 일수
                    </label>
                    <input
                      type="number"
                      step="0.125"
                      min="0.125"
                      value={leaveDays}
                      onChange={(e) => setLeaveDays(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-extrabold text-emerald-700"
                    />
                  </div>
                </div>
              </section>
            )}

            {docType === "PURCHASE" && (
              <section className="rounded-2xl bg-sky-50/40 border border-sky-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-sky-900">
                    🛒 사전 지출 · 발주 품목 명세
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      setItems((prev) => [
                        ...prev,
                        { name: "", qty: 1, unitPrice: 0, amount: 0 },
                      ])
                    }
                    className="px-2.5 py-1 rounded-lg bg-white border border-sky-300 text-sky-700 text-xs font-bold hover:bg-sky-100"
                  >
                    + 품목 추가
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      거래처 · 공급업체명
                    </label>
                    <input
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      placeholder="예: 프린트피아, Google Cloud, 교보문고"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      기준(예정) 일자
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-slate-200"
                    >
                      <input
                        value={it.name}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, name: e.target.value } : r
                            )
                          )
                        }
                        placeholder="품목 · 내역명"
                        className="col-span-5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800"
                      />
                      <input
                        type="number"
                        min={1}
                        value={it.qty}
                        onChange={(e) => {
                          const qty = Math.max(1, Number(e.target.value || 1));
                          setItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, qty, amount: qty * r.unitPrice }
                                : r
                            )
                          );
                        }}
                        className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-right text-xs font-bold"
                      />
                      <input
                        value={it.unitPrice ? it.unitPrice.toLocaleString() : ""}
                        onChange={(e) => {
                          const unitPrice = Math.max(
                            0,
                            Number(e.target.value.replace(/[^0-9]/g, "") || 0)
                          );
                          setItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, unitPrice, amount: r.qty * unitPrice }
                                : r
                            )
                          );
                        }}
                        placeholder="단가(원)"
                        className="col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 text-right text-xs font-bold"
                      />
                      <div className="col-span-2 flex items-center justify-end gap-1">
                        <span className="text-[11px] font-extrabold text-slate-700 truncate">
                          {(it.qty * it.unitPrice).toLocaleString()}원
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setItems((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-slate-400 hover:text-rose-500 font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-right text-xs font-extrabold text-slate-800">
                  합계 예상액:{" "}
                  <span className="text-sm text-sky-700">
                    {effectiveAmount.toLocaleString()}원
                  </span>
                </div>
              </section>
            )}

            {docType === "EXPENSE" && (
              <section className="rounded-2xl bg-amber-50/40 border border-amber-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-extrabold text-amber-900">
                    💳 지출 정산 내역 (승인 완료 시 비용·경비 정산 장부 자동 반영)
                  </h4>
                  {policyInfo && (
                    <span className="text-[11px] font-bold text-amber-800">
                      {policyInfo.limitText}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      비용 항목
                    </label>
                    <select
                      value={expenseCategory}
                      onChange={(e) => setExpenseCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      결제 수단
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    >
                      {PAYMENT_METHODS.map((pm) => (
                        <option key={pm} value={pm}>
                          {pm}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      지출 일자
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      거래처 · 가맹점명 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      required
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      placeholder="예: 교보문고, AWS, 스타벅스"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      지출 금액 (원) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      required
                      value={
                        amountInput
                          ? Number(
                              amountInput.replace(/[^0-9]/g, "")
                            ).toLocaleString()
                          : ""
                      }
                      onChange={(e) =>
                        setAmountInput(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-extrabold text-amber-900 text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      카드 끝 4자리 (선택)
                    </label>
                    <input
                      maxLength={4}
                      value={cardLast4}
                      onChange={(e) =>
                        setCardLast4(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      placeholder="4821"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* 본문 내용 에디터 */}
            {selectedForm?.use_body !== false && (
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  상세 내용
                </label>
                <textarea
                  rows={6}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="상세 내용을 입력해 주세요."
                  className="w-full p-3.5 rounded-2xl border border-slate-200 focus:border-[#00c458] focus:outline-none text-xs font-medium text-slate-800 leading-relaxed"
                />
              </div>
            )}

            {/* 첨부 파일 업로더 */}
            {selectedForm?.attachment_mode !== "NONE" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700">
                    📎 첨부 파일{" "}
                    {selectedForm?.attachment_mode === "REQUIRED" && (
                      <span className="text-rose-500">(필수 첨부 *)</span>
                    )}
                  </span>
                  <label className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer">
                    {uploadingFile ? "업로드 중..." : "+ 파일 첨부"}
                    <input
                      type="file"
                      accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.hwp,.zip"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att, idx) => (
                      <div
                        key={`${att.url}-${idx}`}
                        className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs font-semibold text-slate-700"
                      >
                        <span className="truncate max-w-[200px]">
                          📄 {att.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          className="text-slate-400 hover:text-rose-500 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 하단 제출 바 */}
          <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingFile}
              className="px-6 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-sm transition-colors"
            >
              {submitting ? "작성 요청 중..." : "문서 작성 완료 (승인 요청)"}
            </button>
          </div>
        </form>

        {/* ================= 우측: 양식 기반 승인 단계 & 참조자 패널 ================= */}
        <aside className="lg:w-[320px] border-t lg:border-t-0 lg:border-l border-slate-100 bg-slate-50/50 p-5 overflow-y-auto space-y-5 shrink-0 custom-scroll">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-900">
              승인 및 참조 대상
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                allowLineEdit
                  ? "bg-blue-50 text-blue-700"
                  : "bg-slate-200/70 text-slate-600"
              }`}
            >
              {allowLineEdit ? "변경 허용" : "양식 고정"}
            </span>
          </div>

          {/* 참조자 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500">참조</span>
              {allowLineEdit && (
                <button
                  type="button"
                  onClick={() => setAddingCc((v) => !v)}
                  className="text-[11px] font-bold text-[#00a84b] hover:underline"
                >
                  + 참조 추가
                </button>
              )}
            </div>

            {addingCc && allowLineEdit && (
              <select
                defaultValue=""
                onChange={(e) => {
                  const m = selectableApproverOptions.find(
                    (item) => item.id === e.target.value
                  );
                  if (m && !ccMembers.some((c) => c.name === m.name)) {
                    setCcMembers((prev) => [
                      ...prev,
                      {
                        id: m.id.startsWith("preset:") ? "" : m.id,
                        name: m.name,
                        dept: m.dept,
                      },
                    ]);
                  }
                  setAddingCc(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
              >
                <option value="" disabled>
                  참조할 구성원 선택...
                </option>
                {selectableApproverOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.dept})
                  </option>
                ))}
              </select>
            )}

            {ccMembers.length === 0 ? (
              <div className="text-xs text-slate-400">지정된 참조자 없음</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ccMembers.map((cc, idx) => (
                  <span
                    key={`${cc.name}-${idx}`}
                    className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5"
                  >
                    <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                      {cc.name.slice(-2)}
                    </span>
                    <span>{cc.name}</span>
                    {allowLineEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setCcMembers((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="text-slate-400 hover:text-rose-500 text-[10px]"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 승인 단계 */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500">
                승인 단계 ({steps.length})
              </span>
              {allowLineEdit && steps.length < 5 && (
                <button
                  type="button"
                  onClick={handleAddStep}
                  className="text-[11px] font-bold text-[#00a84b] hover:underline"
                >
                  + 단계 추가
                </button>
              )}
            </div>

            {steps.length === 0 ? (
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 font-semibold leading-relaxed">
                {zeroStepAllowed
                  ? "✅ 별도 승인 단계가 없는 양식입니다. 작성 즉시 완료 처리됩니다."
                  : "승인자를 추가해 주세요."}
              </div>
            ) : (
              <div className="space-y-2">
                {steps.map((st, idx) => (
                  <div
                    key={`${st.step_order}-${idx}`}
                    className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold text-slate-700">
                        {idx + 1}단계 승인
                      </span>
                      {allowLineEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStep(idx)}
                          className="text-[10px] font-bold text-slate-400 hover:text-rose-500"
                        >
                          제외
                        </button>
                      )}
                    </div>

                    {allowLineEdit ? (
                      <select
                        value={st.approver_id}
                        onChange={(e) =>
                          handleStepMemberChange(idx, e.target.value)
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800"
                      >
                        {!selectableApproverOptions.some(
                          (m) => m.id === st.approver_id
                        ) && (
                          <option value={st.approver_id}>
                            {st.approver_name}
                            {st.approver_title &&
                            st.approver_title !== st.approver_dept
                              ? ` ${st.approver_title}`
                              : ""}{" "}
                            ({st.approver_dept || "본부"})
                          </option>
                        )}
                        {selectableApproverOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.job_title && m.job_title !== m.dept
                              ? ` ${m.job_title}`
                              : ""}{" "}
                            ({m.dept})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-indigo-500 text-white text-[10px] font-extrabold flex items-center justify-center">
                          {st.approver_name.slice(-2)}
                        </span>
                        <div>
                          <div className="text-xs font-bold text-slate-800">
                            {st.approver_name} {st.approver_title}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {st.approver_dept}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
