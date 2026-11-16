// src/components/hq/contracts/ContractTemplateStudioSection.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { CONTRACT_CATEGORIES, CONTRACT_TAX_LABELS } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  CONTRACT_PLACEHOLDER_GROUPS,
  resolveContractTemplatePlaceholders,
  STARTER_TEMPLATE_PRESETS,
} from "@/lib/hq/contractTemplateEngine";
import { DEFAULT_WORK_RULES } from "@/lib/hq/defaultWorkRules";
import type {
  HqCompanySettings,
  HqContractCategory,
  HqContractCustomField,
  HqContractTemplateItem,
  HqMember,
  HqWorkRuleItem,
} from "@/lib/hq/types";

interface Props {
  categories: string[];
  customFields: HqContractCustomField[];
  templates: HqContractTemplateItem[];
  activeMembers: HqMember[];
  companySettings: HqCompanySettings;
  activeCompanySealUrl: string | null;
  canManage: boolean;
  isHrManager: boolean;
  onReloadTemplates: () => Promise<void>;
  onUseTemplateSingle: (tpl: HqContractTemplateItem) => void;
  onAfterBatchDispatched: () => Promise<void>;
}

export default function ContractTemplateStudioSection({
  categories,
  customFields,
  templates,
  activeMembers,
  companySettings,
  activeCompanySealUrl,
  canManage,
  isHrManager,
  onReloadTemplates,
  onUseTemplateSingle,
  onAfterBatchDispatched,
}: Props) {
  const [selectedNav, setSelectedNav] = useState<
    { kind: "ALL" } | { kind: "ARCHIVED" } | { kind: "CAT"; name: string }
  >({ kind: "ALL" });
  const [searchKeyword, setSearchKeyword] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  // 풀스크린 서식 추가/편집 스튜디오 모달 상태
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<"EDIT" | "PREVIEW">("EDIT");
  const [editingId, setEditingId] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplCatName, setTplCatName] = useState("자동계약서");
  const [tplMappedCat, setTplMappedCat] =
    useState<HqContractCategory>("SALARY");
  const [tplTagsText, setTplTagsText] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [hideLegalBanner, setHideLegalBanner] = useState(false);
  const [showAllStarters, setShowAllStarters] = useState(false);
  const [placeholderSearch, setPlaceholderSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [previewMemberId, setPreviewMemberId] = useState<string>("");
  const [newCustomFieldOpen, setNewCustomFieldOpen] = useState(false);
  const [newCfLabel, setNewCfLabel] = useState("");
  const [newCfDefault, setNewCfDefault] = useState("");
  const [saving, setSaving] = useState(false);

  // 다수 구성원 일괄 발송 모달 상태
  const [batchTpl, setBatchTpl] = useState<HqContractTemplateItem | null>(null);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchStartDate, setBatchStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [batchEndDate, setBatchEndDate] = useState(
    () => `${new Date().getFullYear()}-12-31`
  );
  const [batchAmounts, setBatchAmounts] = useState<Record<string, string>>({});

  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const workRules: HqWorkRuleItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.work_rules;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_WORK_RULES;
  }, [companySettings]);

  const resolveMemberRule = (memberName?: string) =>
    workRules.find((r) =>
      (r.assigned_members || []).some(
        (am) => am.name === memberName && am.status === "ACTIVE"
      )
    ) ||
    workRules.find((r) => r.id === "wr-basic-9") ||
    DEFAULT_WORK_RULES[3] ||
    DEFAULT_WORK_RULES[0];

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (selectedNav.kind === "ARCHIVED") {
        if (!t.is_archived) return false;
      } else {
        if (t.is_archived) return false;
        if (
          selectedNav.kind === "CAT" &&
          t.category_name !== selectedNav.name
        ) {
          return false;
        }
      }
      if (searchKeyword.trim()) {
        const q = searchKeyword.trim().toLowerCase();
        const hay = `${t.name} ${t.description} ${t.category_name} ${t.tags.join(
          " "
        )}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, selectedNav, searchKeyword]);

  const openCreateStudio = () => {
    setEditingId("");
    setTplName("");
    setTplDesc("");
    setTplCatName(
      selectedNav.kind === "CAT" ? selectedNav.name : categories[0] || "자동계약서"
    );
    setTplMappedCat("SALARY");
    setTplTagsText("");
    setTplBody("");
    setStudioTab("EDIT");
    setHideLegalBanner(false);
    setPreviewMemberId(activeMembers[0]?.instructor_id || "");
    setStudioOpen(true);
  };

  const openEditStudio = (item: HqContractTemplateItem) => {
    setEditingId(item.id);
    setTplName(item.name);
    setTplDesc(item.description);
    setTplCatName(item.category_name);
    setTplMappedCat(item.mapped_category);
    setTplTagsText((item.tags || []).join(", "));
    setTplBody(item.body_text);
    setStudioTab("EDIT");
    setHideLegalBanner(false);
    setPreviewMemberId(activeMembers[0]?.instructor_id || "");
    setStudioOpen(true);
  };

  const insertAtCursor = (snippet: string) => {
    const el = bodyTextareaRef.current;
    if (!el) {
      setTplBody((prev) => (prev ? `${prev}\n${snippet}` : snippet));
      return;
    }
    const start = el.selectionStart ?? tplBody.length;
    const end = el.selectionEnd ?? tplBody.length;
    const next = tplBody.slice(0, start) + snippet + tplBody.slice(end);
    setTplBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const hasLegalRequiredFields = useMemo(() => {
    const hasDate = tplBody.includes("{{계약일}}");
    const hasSign =
      tplBody.includes("{{구성원 직인}}") ||
      tplBody.includes("{{구성원 직인(서명란 포함)}}");
    return hasDate && hasSign;
  }, [tplBody]);

  const handleSaveTemplate = async () => {
    if (!tplName.trim()) {
      alert("서식 이름을 입력해 주세요.");
      return;
    }
    if (!tplBody.trim()) {
      alert("서식 본문 내용을 입력하거나 아래 표준 템플릿을 선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      await hqFetch("/api/hq/contract-templates", {
        method: "POST",
        body: {
          action: "SAVE_TEMPLATE",
          id: editingId || undefined,
          name: tplName.trim(),
          description: tplDesc.trim(),
          category_name: tplCatName,
          mapped_category: tplMappedCat,
          tags: tplTagsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          body_text: tplBody,
        },
      });
      await onReloadTemplates();
      setStudioOpen(false);
    } catch (err: any) {
      alert(err?.message || "서식 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateAction = async (
    action:
      | "ARCHIVE_TEMPLATE"
      | "RESTORE_TEMPLATE"
      | "DUPLICATE_TEMPLATE"
      | "DELETE_TEMPLATE",
    id: string
  ) => {
    if (
      action === "DELETE_TEMPLATE" &&
      !confirm("이 계약 서식을 영구 삭제하시겠습니까?")
    ) {
      return;
    }
    setMenuOpenId(null);
    try {
      await hqFetch("/api/hq/contract-templates", {
        method: "POST",
        body: { action, id },
      });
      await onReloadTemplates();
    } catch (err: any) {
      alert(err?.message || "처리 실패");
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await hqFetch("/api/hq/contract-templates", {
        method: "POST",
        body: { action: "ADD_CATEGORY", name: newCatName.trim() },
      });
      setNewCatName("");
      setNewCatOpen(false);
      await onReloadTemplates();
    } catch (err: any) {
      alert(err?.message || "카테고리 추가 실패");
    }
  };

  const handleAddCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCfLabel.trim()) return;
    try {
      await hqFetch("/api/hq/contract-templates", {
        method: "POST",
        body: {
          action: "ADD_CUSTOM_FIELD",
          label: newCfLabel.trim(),
          default_value: newCfDefault.trim(),
        },
      });
      setNewCfLabel("");
      setNewCfDefault("");
      setNewCustomFieldOpen(false);
      await onReloadTemplates();
    } catch (err: any) {
      alert(err?.message || "커스텀 필드 추가 실패");
    }
  };

  // 일괄 발송 모달 열기
  const openBatchModal = (tpl: HqContractTemplateItem) => {
    if ((tpl.mapped_category === "LABOR" || tpl.mapped_category === "SALARY") && !isHrManager) {
      alert("근로·연봉계약서 일괄 발송은 인사관리자만 가능합니다.");
      return;
    }
    const initAmounts: Record<string, string> = {};
    activeMembers.forEach((m) => {
      const annual =
        m.profile_extra?.wage_contract?.annual_salary ||
        (m.profile_extra?.wage_contract?.monthly_base
          ? m.profile_extra.wage_contract.monthly_base * 12
          : 42000000);
      initAmounts[m.instructor_id] =
        tpl.mapped_category === "NDA" ? "0" : String(annual);
    });
    setBatchAmounts(initAmounts);
    setBatchSelectedIds(activeMembers.map((m) => m.instructor_id));
    setBatchTpl(tpl);
  };

  const handleSubmitBatchDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchTpl || batchSelectedIds.length === 0) return;
    const targets = activeMembers.filter((m) =>
      batchSelectedIds.includes(m.instructor_id)
    );
    if (
      !confirm(
        `선택한 ${targets.length}명에게 「${batchTpl.name}」 전자계약을 직인 날인하여 동시 발송하시겠습니까?`
      )
    )
      return;

    setSaving(true);
    try {
      const customMap: Record<string, string> = {};
      customFields.forEach((cf) => {
        customMap[cf.token] = cf.default_value || "";
      });

      const catMeta = CONTRACT_CATEGORIES[batchTpl.mapped_category];
      const signer = `${
        companySettings?.company_name || "(주)천종현수학연구소"
      } 대표이사 ${companySettings?.ceo_names?.[0] || "천종현"}`;

      const items = targets.map((m) => {
        const amt = Number(batchAmounts[m.instructor_id] || 0);
        const resolvedBody = resolveContractTemplatePlaceholders({
          templateBody: batchTpl.body_text,
          companySettings,
          member: m,
          workRule: resolveMemberRule(m.name),
          counterpartyName: m.name,
          counterpartyRole: m.job_title,
          counterpartyPhone: m.phone,
          department: m.department,
          startDate: batchStartDate,
          endDate: batchEndDate,
          contractAmount: amt,
          taxLabel: CONTRACT_TAX_LABELS[catMeta.taxDefault],
          customValues: customMap,
        });

        return {
          category: batchTpl.mapped_category,
          target_type: "INTERNAL",
          target_member_id: m.instructor_id,
          counterparty_name: m.name,
          counterparty_role: m.job_title,
          counterparty_phone: m.phone,
          counterparty_email: m.email,
          department: m.department,
          title: `[${batchTpl.name}] ${batchStartDate.slice(0, 4)}년 ${m.name}`,
          start_date: batchStartDate,
          end_date: batchEndDate || null,
          contract_amount: amt,
          tax_type: catMeta.taxDefault,
          body_text: resolvedBody,
          company_signer_name: signer,
          status: "SENT",
        };
      });

      const res = await hqFetch<{ success: boolean; data: { count: number } }>(
        "/api/hq/contracts",
        {
          method: "POST",
          body: { action: "BATCH_CREATE", items },
        }
      );

      setBatchTpl(null);
      await onAfterBatchDispatched();
      alert(
        `총 ${res.data?.count || targets.length}건의 전자계약서가 성공적으로 일괄 발송되었습니다.`
      );
    } catch (err: any) {
      alert(err?.message || "일괄 발송 실패");
    } finally {
      setSaving(false);
    }
  };

  // 미리보기 렌더링 본문 계산
  const previewRenderedBody = useMemo(() => {
    const sampleMember =
      activeMembers.find((m) => m.instructor_id === previewMemberId) ||
      activeMembers[0] ||
      null;
    const customMap: Record<string, string> = {};
    customFields.forEach((cf) => {
      customMap[cf.token] = cf.default_value || `(예시: ${cf.label})`;
    });
    return resolveContractTemplatePlaceholders({
      templateBody: tplBody || "(서식 편집 탭에서 내용을 입력해 주세요.)",
      companySettings,
      member: sampleMember,
      workRule: resolveMemberRule(sampleMember?.name),
      customValues: customMap,
    });
  }, [
    tplBody,
    activeMembers,
    previewMemberId,
    customFields,
    companySettings,
    workRules,
  ]);

  const currentFolderTitle =
    selectedNav.kind === "ALL"
      ? "모든 서식"
      : selectedNav.kind === "ARCHIVED"
      ? "보관한 서식"
      : selectedNav.name;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden flex flex-col lg:flex-row min-h-[580px]">
      {/* 좌측 서식 관리 사이드바 (플렉스 스크린샷 6~8 1:1 재현) */}
      <aside className="w-full lg:w-56 border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-5 bg-slate-50/40 shrink-0">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-extrabold text-slate-900">서식 관리</h3>
          {canManage && (
            <button
              type="button"
              onClick={openCreateStudio}
              className="text-xs font-bold text-slate-600 hover:text-slate-900"
            >
              + 새 서식
            </button>
          )}
        </div>

        <div className="space-y-1">
          <div className="px-2.5 text-[11px] font-bold text-slate-400">서식</div>
          <button
            type="button"
            onClick={() => setSelectedNav({ kind: "ALL" })}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
              selectedNav.kind === "ALL"
                ? "bg-slate-200/70 text-slate-900"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            모든 서식
          </button>
        </div>

        <div className="space-y-1">
          <div className="px-2.5 flex items-center justify-between text-[11px] font-bold text-slate-400">
            <span>카테고리</span>
            {canManage && (
              <button
                type="button"
                onClick={() => setNewCatOpen((v) => !v)}
                className="text-slate-500 hover:text-slate-900 text-sm leading-none"
                title="새 카테고리 추가"
              >
                +
              </button>
            )}
          </div>

          {newCatOpen && (
            <form onSubmit={handleAddCategory} className="px-1 py-1 flex gap-1">
              <input
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="카테고리명"
                className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-bold"
              >
                추가
              </button>
            </form>
          )}

          {categories.map((cat) => {
            const active =
              selectedNav.kind === "CAT" && selectedNav.name === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedNav({ kind: "CAT", name: cat })}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                  active
                    ? "bg-white border border-emerald-500 text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="space-y-1">
          <div className="px-2.5 text-[11px] font-bold text-slate-400">
            보관함
          </div>
          <button
            type="button"
            onClick={() => setSelectedNav({ kind: "ARCHIVED" })}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
              selectedNav.kind === "ARCHIVED"
                ? "bg-slate-200/70 text-slate-900"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            보관한 서식
          </button>
        </div>
      </aside>

      {/* 우측 서식 목록 본문 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-extrabold text-slate-900">
            {currentFolderTitle}
          </h4>

          <div className="flex items-center gap-2">
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="서식명, 태그 검색..."
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold w-48"
            />
            {canManage && selectedNav.kind !== "ARCHIVED" && (
              <button
                type="button"
                onClick={openCreateStudio}
                className="px-3.5 py-1.5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-2xs"
              >
                + 새 서식
              </button>
            )}
          </div>
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="flex-1 py-24 flex flex-col items-center justify-center text-slate-500">
            <div className="text-2xl mb-2 opacity-60">📄</div>
            <div className="text-xs font-bold">
              {selectedNav.kind === "ARCHIVED"
                ? "보관한 서식 없음"
                : "등록된 계약 서식이 없습니다."}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-3 px-6">서식 이름</th>
                  <th className="py-3 px-4">카테고리</th>
                  <th className="py-3 px-4">태그</th>
                  <th className="py-3 px-4">마지막 편집자</th>
                  <th className="py-3 px-4">설명</th>
                  <th className="py-3 px-4">마지막 편집 일시</th>
                  <th className="py-3 px-6 text-right">계약 발송 · 관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTemplates.map((tpl) => {
                  const catMeta = CONTRACT_CATEGORIES[tpl.mapped_category];
                  return (
                    <tr key={tpl.id} className="hover:bg-slate-50/70">
                      <td
                        onClick={() => openEditStudio(tpl)}
                        className="py-3.5 px-6 font-bold text-slate-900 cursor-pointer hover:text-brand"
                      >
                        <span className="mr-2 text-slate-400">📄</span>
                        <span>{tpl.name}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                          {tpl.category_name}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {tpl.tags && tpl.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {tpl.tags.map((tg) => (
                              <span
                                key={tg}
                                className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold"
                              >
                                #{tg}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">없음</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-700">
                        {tpl.updated_by}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate">
                        {tpl.description || "-"}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 tabular-nums">
                        {tpl.updated_at ? tpl.updated_at.slice(0, 10) : "정보 없음"}
                      </td>
                      <td className="py-3.5 px-6 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 relative">
                          {!tpl.is_archived && canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => onUseTemplateSingle(tpl)}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 font-bold text-slate-700"
                              >
                                {catMeta?.icon} 단건 발송
                              </button>
                              {catMeta?.targetDefault === "INTERNAL" &&
                                isHrManager && (
                                  <button
                                    type="button"
                                    onClick={() => openBatchModal(tpl)}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 font-extrabold text-indigo-700"
                                    title="여러 임직원에게 개인별 연봉·정보를 자동 치환해 동시 발송합니다."
                                  >
                                    ⚡ 일괄 발송
                                  </button>
                                )}
                            </>
                          )}

                          {canManage && (
                            <button
                              type="button"
                              onClick={() =>
                                setMenuOpenId((prev) =>
                                  prev === tpl.id ? null : tpl.id
                                )
                              }
                              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
                            >
                              ⋯
                            </button>
                          )}

                          {menuOpenId === tpl.id && (
                            <div className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-left">
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  openEditStudio(tpl);
                                }}
                                className="w-full px-3.5 py-1.5 hover:bg-slate-50 font-semibold text-slate-700"
                              >
                                서식 편집
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleTemplateAction(
                                    "DUPLICATE_TEMPLATE",
                                    tpl.id
                                  )
                                }
                                className="w-full px-3.5 py-1.5 hover:bg-slate-50 font-semibold text-slate-700"
                              >
                                사본 복제
                              </button>
                              {tpl.is_archived ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleTemplateAction(
                                      "RESTORE_TEMPLATE",
                                      tpl.id
                                    )
                                  }
                                  className="w-full px-3.5 py-1.5 hover:bg-slate-50 font-semibold text-emerald-700"
                                >
                                  보관 해제(복원)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleTemplateAction(
                                      "ARCHIVE_TEMPLATE",
                                      tpl.id
                                    )
                                  }
                                  className="w-full px-3.5 py-1.5 hover:bg-slate-50 font-semibold text-slate-600"
                                >
                                  보관함으로 이동
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleTemplateAction(
                                    "DELETE_TEMPLATE",
                                    tpl.id
                                  )
                                }
                                className="w-full px-3.5 py-1.5 hover:bg-rose-50 font-semibold text-rose-600"
                              >
                                삭제
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="px-6 py-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
              <span>
                1-{filteredTemplates.length}개 / 총 {filteredTemplates.length}개
              </span>
              <span>자동입력 필드(플레이스홀더) 치환 지원</span>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          풀스크린 서식 추가/편집 스튜디오 (스크린샷 1, 9~13 100% 재현)
         ===================================================================== */}
      {studioOpen && (
        <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col">
          {/* 상단 바 */}
          <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStudioOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
              <span className="h-4 w-px bg-slate-200" />
              <span className="text-sm font-extrabold text-slate-900">
                {editingId ? "서식 편집" : "서식 추가"}
              </span>
            </div>

            {/* 중앙: [서식 편집 | 미리보기 예시] 세그먼트 */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setStudioTab("EDIT")}
                className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  studioTab === "EDIT"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                서식 편집
              </button>
              <button
                type="button"
                onClick={() => setStudioTab("PREVIEW")}
                className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                  studioTab === "PREVIEW"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <span>미리보기</span>
                <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 text-[10px]">
                  예시
                </span>
              </button>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={handleSaveTemplate}
              className="px-4 py-2 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs disabled:opacity-50"
            >
              {saving ? "저장 중..." : "✓ 저장하기"}
            </button>
          </header>

          {studioTab === "EDIT" ? (
            <div className="flex-1 flex overflow-hidden">
              {/* 중앙 문서 편집 캔버스 */}
              <div className="flex-1 overflow-y-auto bg-white p-8 lg:px-16">
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* 법적 효력 필수 필드 배너 */}
                  {!hideLegalBanner && (
                    <div
                      className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-bold ${
                        hasLegalRequiredFields
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-sky-50/80 border-sky-200 text-slate-800"
                      }`}
                    >
                      <span>
                        {hasLegalRequiredFields
                          ? "✅ 법적 효력 필수 필드('계약일' 및 '구성원 직인')가 본문에 포함되어 있습니다."
                          : "법적 효력을 위해 '계약일'과 '구성원 직인' 필드를 추가하세요."}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {!hasLegalRequiredFields && (
                          <button
                            type="button"
                            onClick={() =>
                              insertAtCursor(
                                "\n\n계약일: {{계약일}}\n[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}\n[을] 성명: {{구성원 이름}} {{구성원 직인}}"
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-white border border-sky-300 text-sky-700 hover:bg-sky-100 text-[11px] font-extrabold"
                          >
                            + 필수 서명란 자동삽입
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setHideLegalBanner(true)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 서식 제목 & 설명 */}
                  <div className="space-y-2 pb-4 border-b border-slate-200">
                    <input
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="서식 이름을 입력하세요 ✎"
                      className="w-full text-2xl font-extrabold text-slate-900 placeholder:text-slate-300 outline-none"
                    />
                    <input
                      value={tplDesc}
                      onChange={(e) => setTplDesc(e.target.value)}
                      placeholder="계약서식에 대한 설명을 입력해 주세요."
                      className="w-full text-xs font-medium text-slate-600 placeholder:text-slate-400 outline-none"
                    />

                    <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <select
                        value={tplCatName}
                        onChange={(e) => setTplCatName(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-bold text-slate-700 bg-slate-50"
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            카테고리: {c}
                          </option>
                        ))}
                      </select>

                      <select
                        value={tplMappedCat}
                        onChange={(e) =>
                          setTplMappedCat(e.target.value as HqContractCategory)
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-bold text-slate-700 bg-slate-50"
                      >
                        {(
                          Object.keys(
                            CONTRACT_CATEGORIES
                          ) as HqContractCategory[]
                        ).map((k) => (
                          <option key={k} value={k}>
                            연동 유형: {CONTRACT_CATEGORIES[k].shortLabel}
                          </option>
                        ))}
                      </select>

                      <input
                        value={tplTagsText}
                        onChange={(e) => setTplTagsText(e.target.value)}
                        placeholder="태그 (쉼표 구분, 예: 정규직, 포괄)"
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* 조항 빠른 포맷팅 툴바 */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100 text-xs">
                    <button
                      type="button"
                      onClick={() => insertAtCursor("\n제 조 [조항 제목]\n")}
                      className="px-2.5 py-1 rounded-lg hover:bg-slate-100 font-extrabold text-slate-700 border border-slate-200"
                    >
                      B 조항 제목 추가
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        insertAtCursor(
                          "\n------------------------------------------------------------\n"
                        )
                      }
                      className="px-2.5 py-1 rounded-lg hover:bg-slate-100 font-semibold text-slate-600 border border-slate-200"
                    >
                      ― 구분선
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        insertAtCursor(
                          "\n• 항목 1: \n• 항목 2: \n• 항목 3: \n"
                        )
                      }
                      className="px-2.5 py-1 rounded-lg hover:bg-slate-100 font-semibold text-slate-600 border border-slate-200"
                    >
                      ☰ 목록 삽입
                    </button>
                    <span className="text-[11px] text-slate-400 ml-auto">
                      우측 자동입력 필드를 클릭하면 커서 위치에 삽입됩니다.
                    </span>
                  </div>

                  {/* 본문 에디터 */}
                  <textarea
                    ref={bodyTextareaRef}
                    rows={14}
                    value={tplBody}
                    onChange={(e) => setTplBody(e.target.value)}
                    placeholder="서식의 내용을 입력해 주세요. 우측 패널에서 {{회사명}}, {{구성원 이름}}, {{계약금액}} 등 자동입력 필드를 클릭해 넣을 수 있습니다."
                    className="w-full p-4 rounded-2xl border border-slate-200 focus:border-emerald-500 outline-none text-[13px] leading-7 font-medium text-slate-800 bg-slate-50/30"
                  />

                  {/* 하단: 표준 서식 템플릿 12종 라이브러리 */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-extrabold text-slate-800">
                        서식 템플릿
                      </span>
                      <span className="text-[11px] text-slate-400">
                        템플릿을 선택하고 회사에 맞게 수정해서 사용하세요.
                      </span>
                    </div>

                    <div className="space-y-1">
                      {(showAllStarters
                        ? STARTER_TEMPLATE_PRESETS
                        : STARTER_TEMPLATE_PRESETS.slice(0, 6)
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            if (
                              tplBody.trim() &&
                              !confirm(
                                `현재 본문을 「${st.title}」 표준 양식으로 교체하시겠습니까?`
                              )
                            ) {
                              return;
                            }
                            if (!tplName.trim()) setTplName(st.title);
                            setTplDesc(st.description);
                            setTplCatName(st.categoryName);
                            setTplMappedCat(st.mappedCategory);
                            setTplBody(st.bodyText);
                          }}
                          className="w-full px-3.5 py-2.5 rounded-xl hover:bg-slate-50 text-left flex items-center justify-between group transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-slate-400">📄</span>
                            <span className="text-xs font-bold text-slate-800 group-hover:text-brand">
                              {st.title}
                            </span>
                            <span className="text-[11px] text-slate-400 hidden sm:inline">
                              — {st.description}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-slate-400 group-hover:text-brand">
                            불러오기 ›
                          </span>
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAllStarters((v) => !v)}
                      className="w-full py-2 text-center text-xs font-bold text-slate-600 hover:text-slate-900 border-t border-slate-100"
                    >
                      {showAllStarters
                        ? "템플릿 접기 ▴"
                        : `템플릿 더보기 (${STARTER_TEMPLATE_PRESETS.length}종 전체) ▾`}
                    </button>
                  </div>
                </div>
              </div>

              {/* 우측 자동입력 필드(플레이스홀더) 패널 */}
              <aside className="w-80 border-l border-slate-200 bg-white overflow-y-auto p-5 space-y-4 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900">
                    자동입력 필드
                  </span>
                  <span
                    title="계약 발송 시 대상 구성원·회사의 실제 인사/연봉/근무 데이터로 자동 치환됩니다."
                    className="text-xs text-slate-400 cursor-help"
                  >
                    ⓘ
                  </span>
                </div>

                <input
                  value={placeholderSearch}
                  onChange={(e) => setPlaceholderSearch(e.target.value)}
                  placeholder="필드 검색 🔍"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-slate-400"
                />

                {/* 커스텀 필드 그룹 */}
                <div className="border-b border-slate-100 pb-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                    <span>커스텀 필드</span>
                    <button
                      type="button"
                      onClick={() => setNewCustomFieldOpen((v) => !v)}
                      className="text-slate-700 hover:text-brand font-extrabold"
                    >
                      + 추가
                    </button>
                  </div>

                  {newCustomFieldOpen && (
                    <form
                      onSubmit={handleAddCustomField}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs"
                    >
                      <input
                        value={newCfLabel}
                        onChange={(e) => setNewCfLabel(e.target.value)}
                        placeholder="필드명 (예: 원고매수)"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                      />
                      <input
                        value={newCfDefault}
                        onChange={(e) => setNewCfDefault(e.target.value)}
                        placeholder="기본 예시값 (예: 240쪽)"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                      />
                      <button
                        type="submit"
                        className="w-full py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                      >
                        필드 등록
                      </button>
                    </form>
                  )}

                  <div className="space-y-0.5">
                    {customFields.map((cf) => (
                      <button
                        key={cf.id}
                        type="button"
                        onClick={() => insertAtCursor(cf.token)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center justify-between"
                      >
                        <span>{cf.label}</span>
                        <code className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          {cf.token}
                        </code>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 표준 플레이스홀더 그룹들 */}
                {CONTRACT_PLACEHOLDER_GROUPS.map((grp) => {
                  const q = placeholderSearch.trim().toLowerCase();
                  const visibleItems = q
                    ? grp.items.filter(
                        (it) =>
                          it.label.toLowerCase().includes(q) ||
                          it.token.toLowerCase().includes(q)
                      )
                    : grp.items;
                  if (visibleItems.length === 0) return null;

                  const collapsed = Boolean(collapsedGroups[grp.groupTitle]);
                  return (
                    <div
                      key={grp.groupTitle}
                      className="border-b border-slate-100 pb-3 space-y-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [grp.groupTitle]: !prev[grp.groupTitle],
                          }))
                        }
                        className="w-full flex items-center justify-between text-[11px] font-bold text-amber-700/90 hover:text-amber-900"
                      >
                        <span>{grp.groupTitle}</span>
                        <span>{collapsed ? "▸" : "▾"}</span>
                      </button>

                      {!collapsed && (
                        <div className="space-y-0.5">
                          {visibleItems.map((it) => (
                            <button
                              key={it.label}
                              type="button"
                              onClick={() =>
                                insertAtCursor(it.insertText || it.token)
                              }
                              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-xs font-medium text-slate-700 flex items-center justify-between group"
                            >
                              <span>{it.label}</span>
                              <span className="text-[10px] text-slate-400 group-hover:text-brand font-bold">
                                + 삽입
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </aside>
            </div>
          ) : (
            /* [미리보기 예시] 탭 — A4 시트 위에 실제 구성원 데이터 치환 & 회사 직인 미리보기 */
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-slate-200 shadow-2xs text-xs">
                <span className="font-bold text-slate-600">
                  👤 미리보기 치환 대상 구성원 선택:
                </span>
                <select
                  value={previewMemberId}
                  onChange={(e) => setPreviewMemberId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white"
                >
                  {activeMembers.map((m) => (
                    <option key={m.instructor_id} value={m.instructor_id}>
                      {m.name} ({m.department} · {m.job_title})
                    </option>
                  ))}
                </select>
              </div>

              <div className="max-w-3xl mx-auto bg-white shadow-lg border border-slate-200 p-12 min-h-[760px] space-y-6">
                <div className="text-center border-b-2 border-slate-900 pb-5">
                  <div className="text-xs font-bold text-slate-400">
                    서식 미리보기 (실제 발송 시 플레이스홀더 자동 치환 예시)
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 mt-1">
                    {tplName || "제목 없는 계약 서식"}
                  </h2>
                </div>

                <div className="whitespace-pre-wrap text-[13px] leading-7 text-slate-800">
                  {previewRenderedBody}
                </div>

                <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    <div className="font-bold text-slate-900">
                      {companySettings?.company_name || "(주)천종현수학연구소"}{" "}
                      대표이사 {companySettings?.ceo_names?.[0] || "천종현"}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      회사 공식 직인 자동 날인 미리보기
                    </div>
                  </div>
                  {activeCompanySealUrl ? (
                    <img
                      src={activeCompanySealUrl}
                      alt="회사 직인"
                      className="w-16 h-16 object-contain"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full border-2 border-rose-600 text-rose-600 flex flex-col items-center justify-center font-black text-[11px] leading-tight rotate-[-6deg]">
                      <span>천종현수학</span>
                      <span>연구소인</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          다수 구성원 일괄 계약 발송 모달 (연봉계약/NDA 전사 동시 발송)
         ===================================================================== */}
      {batchTpl && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  ⚡ 「{batchTpl.name}」 다수 구성원 일괄 발송
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  구성원별 인사·근무유형·계약금액이 서식의 자동입력 필드에 개별 치환되어 동시 발송됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchTpl(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSubmitBatchDispatch}
              className="p-6 overflow-y-auto space-y-4 text-xs"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 적용 시작일
                  </label>
                  <input
                    type="date"
                    required
                    value={batchStartDate}
                    onChange={(e) => setBatchStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 종료일 (선택)
                  </label>
                  <input
                    type="date"
                    value={batchEndDate}
                    onChange={(e) => setBatchEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-800">
                  발송 대상 선택 ({batchSelectedIds.length}명 / 전체{" "}
                  {activeMembers.length}명)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setBatchSelectedIds(
                        activeMembers.map((m) => m.instructor_id)
                      )
                    }
                    className="text-brand font-bold hover:underline"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchSelectedIds([])}
                    className="text-slate-400 font-bold hover:underline"
                  >
                    전체 해제
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 max-h-64 overflow-y-auto divide-y divide-slate-100">
                {activeMembers.map((m) => {
                  const checked = batchSelectedIds.includes(m.instructor_id);
                  return (
                    <div
                      key={m.instructor_id}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setBatchSelectedIds((prev) =>
                              checked
                                ? prev.filter((x) => x !== m.instructor_id)
                                : [...prev, m.instructor_id]
                            )
                          }
                        />
                        <span className="font-bold text-slate-900">
                          {m.name}
                        </span>
                        <span className="text-slate-400">
                          ({m.department} · {m.job_title})
                        </span>
                      </label>

                      {batchTpl.mapped_category !== "NDA" && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">
                            연봉(원):
                          </span>
                          <input
                            type="number"
                            step={100000}
                            value={batchAmounts[m.instructor_id] || "0"}
                            onChange={(e) =>
                              setBatchAmounts((prev) => ({
                                ...prev,
                                [m.instructor_id]: e.target.value,
                              }))
                            }
                            className="w-32 px-2.5 py-1 rounded-lg border border-slate-300 text-right font-bold tabular-nums"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBatchTpl(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving || batchSelectedIds.length === 0}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold shadow-xs disabled:opacity-40"
                >
                  {saving
                    ? "일괄 발송 중..."
                    : `✍️ ${batchSelectedIds.length}명 직인 날인 일괄 발송`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
