// src/components/hq/approvals/WorkflowFormBuilderModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { hqFetch, uploadHqReceiptFile } from "@/lib/hq/clientApi";
import { PRESET_ASSIGNEES } from "@/lib/hq/defaultApprovalPolicies";
import {
  isAutoLinkedMemberField,
  WORKFLOW_FIELD_CATALOG,
} from "@/lib/hq/defaultWorkflowForms";
import type {
  HqApprovalDocType,
  HqApprovalTemplate,
  HqMember,
  HqPolicyAssignee,
  HqPolicyStep,
  HqWorkflowFieldDef,
  HqWorkflowFieldType,
  HqWorkflowFormDef,
} from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  editingForm: HqWorkflowFormDef | null;
  categories: string[];
  members: HqMember[];
  approvalTemplates: HqApprovalTemplate[];
  onClose: () => void;
  onSaved: (nextCategories: string[], nextForms: HqWorkflowFormDef[]) => void;
}

const ICON_PRESETS = [
  { icon: "📋", bg: "#dbeafe" },
  { icon: "💳", bg: "#fef3c7" },
  { icon: "🛒", bg: "#e0f2fe" },
  { icon: "🍔", bg: "#ffedd5" },
  { icon: "🔑", bg: "#dcfce7" },
  { icon: "📚", bg: "#e0e7ff" },
  { icon: "🖋️", bg: "#fae8ff" },
  { icon: "🏖️", bg: "#fce7f3" },
  { icon: "✈️", bg: "#f1f5f9" },
  { icon: "📄", bg: "#ede9fe" },
];

export default function WorkflowFormBuilderModal({
  isOpen,
  editingForm,
  categories,
  members,
  approvalTemplates,
  onClose,
  onSaved,
}: Props) {
  const [showRightPane, setShowRightPane] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📋");
  const [iconBg, setIconBg] = useState("#f1f5f9");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const [categoryName, setCategoryName] = useState(categories[0] || "일반 · 계정");
  const [localCategories, setLocalCategories] = useState<string[]>(categories);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");

  const [mappedDocType, setMappedDocType] = useState<HqApprovalDocType>("GENERAL");
  const [isSmartForm, setIsSmartForm] = useState(false);

  const [fields, setFields] = useState<HqWorkflowFieldDef[]>([]);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  const [bodyTemplate, setBodyTemplate] = useState("");
  const [refFileUrl, setRefFileUrl] = useState<string | null>(null);
  const [refFileName, setRefFileName] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);

  const [attachmentMode, setAttachmentMode] = useState<
    "NONE" | "OPTIONAL" | "REQUIRED"
  >("NONE");
  const [useBody, setUseBody] = useState(true);
  const [allowDocEdit, setAllowDocEdit] = useState(true);

  const [allowEdit, setAllowEdit] = useState(true);
  const [perRequester, setPerRequester] = useState(false);
  const [ccList, setCcList] = useState<HqPolicyAssignee[]>([]);
  const [steps, setSteps] = useState<HqPolicyStep[]>([
    { step_order: 1, assignees: [] },
  ]);

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [assigneePickerTarget, setAssigneePickerTarget] = useState<
    null | { kind: "CC" } | { kind: "STEP"; stepIndex: number }
  >(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const cats = categories.length > 0 ? categories : ["일반 · 계정"];
    setLocalCategories(cats);
    setFieldMenuOpen(false);
    setTemplateMenuOpen(false);
    setAssigneePickerTarget(null);
    setIconPickerOpen(false);

    if (editingForm) {
      setTitle(editingForm.title);
      setDescription(editingForm.description || "");
      setIcon(editingForm.icon || "📋");
      setIconBg(editingForm.icon_bg || "#f1f5f9");
      setCategoryName(editingForm.category_name || cats[0]);
      setMappedDocType(editingForm.mapped_doc_type || "GENERAL");
      setIsSmartForm(Boolean(editingForm.is_smart_form));
      setFields(editingForm.fields || []);
      setBodyTemplate(editingForm.body_template || "");
      setRefFileUrl(editingForm.ref_file_url || null);
      setRefFileName(editingForm.ref_file_name || null);
      setAttachmentMode(editingForm.attachment_mode || "OPTIONAL");
      setUseBody(editingForm.use_body !== false);
      setAllowDocEdit(editingForm.allow_doc_edit !== false);
      setAllowEdit(editingForm.allow_edit !== false);
      setPerRequester(Boolean(editingForm.per_requester));
      setCcList(editingForm.cc_list || []);
      setSteps(
        editingForm.steps && editingForm.steps.length > 0
          ? editingForm.steps
          : [{ step_order: 1, assignees: [] }]
      );
    } else {
      setTitle("");
      setDescription("");
      setIcon("📋");
      setIconBg("#f1f5f9");
      setCategoryName(cats[0]);
      setMappedDocType("GENERAL");
      setIsSmartForm(false);
      setFields([]);
      setBodyTemplate("");
      setRefFileUrl(null);
      setRefFileName(null);
      setAttachmentMode("NONE");
      setUseBody(true);
      setAllowDocEdit(true);
      setAllowEdit(true);
      setPerRequester(false);
      setCcList([]);
      setSteps([{ step_order: 1, assignees: [] }]);
    }
  }, [isOpen, editingForm, categories]);

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.work_status === "재직")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members]
  );

  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return approvalTemplates.filter(
      (t) => !q || t.name.toLowerCase().includes(q)
    );
  }, [approvalTemplates, templateQuery]);

  if (!isOpen) return null;

  const handleAddField = (type: HqWorkflowFieldType) => {
    const catalogItem = WORKFLOW_FIELD_CATALOG.find((c) => c.type === type);
    const defaultLabel = catalogItem?.label || "항목";
    const newField: HqWorkflowFieldDef = {
      id: `fld-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type,
      label: defaultLabel,
      required: false,
      options:
        type === "SELECT" || type === "MULTI_SELECT"
          ? ["옵션 1", "옵션 2"]
          : undefined,
    };
    setFields((prev) => [...prev, newField]);
    setFieldMenuOpen(false);
  };

  const insertBodySnippet = (snippet: string) => {
    setBodyTemplate((prev) => (prev ? `${prev}\n${snippet}` : snippet));
  };

  const handleRefFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingRef(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_workflow_guides");
      setRefFileUrl(path);
      setRefFileName(file.name);
    } catch (err: any) {
      alert(err?.message || "참고 파일 업로드 실패");
    } finally {
      setUploadingRef(false);
    }
  };

  const addAssigneeToTarget = (assignee: HqPolicyAssignee) => {
    if (!assigneePickerTarget) return;
    if (assigneePickerTarget.kind === "CC") {
      setCcList((prev) =>
        prev.some((a) => a.name === assignee.name) ? prev : [...prev, assignee]
      );
    } else {
      const idx = assigneePickerTarget.stepIndex;
      setSteps((prev) =>
        prev.map((st, i) => {
          if (i !== idx) return st;
          if (st.assignees.some((a) => a.name === assignee.name)) return st;
          return { ...st, assignees: [...st.assignees, assignee] };
        })
      );
    }
    setAssigneePickerTarget(null);
    setAssigneeSearch("");
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert("양식 이름을 입력해 주세요.");
      return;
    }
    const cleanedSteps = steps
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({
        step_order: idx + 1,
        assignees: s.assignees,
      }));

    setSaving(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { categories: string[]; forms: HqWorkflowFormDef[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: {
          action: "SAVE_FORM",
          form: {
            id: editingForm?.id,
            category_name: categoryName,
            title: title.trim(),
            description: description.trim(),
            icon,
            icon_bg: iconBg,
            mapped_doc_type: mappedDocType,
            is_smart_form: isSmartForm,
            fields,
            body_template: bodyTemplate,
            ref_file_url: refFileUrl,
            ref_file_name: refFileName,
            attachment_mode: attachmentMode,
            use_body: useBody,
            allow_doc_edit: allowDocEdit,
            allow_edit: allowEdit,
            per_requester: perRequester,
            cc_list: ccList,
            steps: cleanedSteps,
            requester_rules: editingForm?.requester_rules,
          },
        },
      });
      onSaved(res.data.categories, res.data.forms);
      onClose();
    } catch (e: any) {
      alert(e?.message || "양식 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const rolePresets: HqPolicyAssignee[] = [
    PRESET_ASSIGNEES.ORG_HEAD_1,
    PRESET_ASSIGNEES.ORG_HEAD_2,
    PRESET_ASSIGNEES.HR_MANAGER,
  ];

  const searchedMembers = activeMembers.filter((m) => {
    const q = assigneeSearch.trim().toLowerCase();
    if (!q) return true;
    return `${m.name} ${m.department} ${m.job_title}`
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6">
      <div
        className={`bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col lg:flex-row transition-all ${
          expanded
            ? "w-full max-w-[1280px] h-[92vh]"
            : "w-full max-w-[980px] h-[88vh]"
        }`}
      >
        {/* ================= 좌측: 양식 에디터 패널 (Screenshot 6 & 8) ================= */}
        <div
          className={`flex flex-col h-full min-w-0 ${
            showRightPane ? "lg:w-[62%]" : "w-full"
          }`}
        >
          {/* 상단 바 */}
          <div className="px-6 pt-5 pb-3 flex items-center justify-between shrink-0">
            <span className="px-3 py-1 rounded-full bg-violet-600 text-white text-[11px] font-extrabold">
              {editingForm ? "양식 수정" : "양식 만들기"}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowRightPane((v) => !v)}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold ${
                  showRightPane
                    ? "bg-slate-100 border-slate-200 text-slate-700"
                    : "bg-white border-slate-200 text-slate-400"
                }`}
                title="우측 결재선 설정 패널 토글"
              >
                ◧
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 flex items-center justify-center text-xs font-bold"
                title="화면 크기 전환"
              >
                ⛶
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-extrabold"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 스크롤 본문 */}
          <div className="flex-1 overflow-y-auto px-7 py-2 space-y-5 custom-scroll">
            {/* 아이콘 + 양식 이름 + 설명 */}
            <div className="space-y-2 relative">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIconPickerOpen((v) => !v)}
                  style={{ backgroundColor: iconBg }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xl border border-slate-200/80 hover:scale-105 transition-transform shrink-0"
                  title="아이콘 변경"
                >
                  {icon}
                </button>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="양식 이름을 입력해 주세요."
                  className="w-full text-2xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                />
              </div>

              {iconPickerOpen && (
                <div className="p-2.5 rounded-2xl bg-white shadow-xl border border-slate-200 flex flex-wrap gap-2 w-fit z-20">
                  {ICON_PRESETS.map((p) => (
                    <button
                      key={p.icon}
                      type="button"
                      onClick={() => {
                        setIcon(p.icon);
                        setIconBg(p.bg);
                        setIconPickerOpen(false);
                      }}
                      style={{ backgroundColor: p.bg }}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-lg hover:ring-2 hover:ring-[#00c458]"
                    >
                      {p.icon}
                    </button>
                  ))}
                </div>
              )}

              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="양식에 대한 설명을 입력해두면 작성자가 확인할 수 있어요."
                className="w-full text-xs font-medium text-slate-600 placeholder:text-slate-300 focus:outline-none"
              />
            </div>

            {/* 커스텀 필드 목록 + [+ 필드 추가하기] 메뉴 (Screenshot 8) */}
            <div className="space-y-2.5 relative">
              {fields.length > 0 && (
                <div className="space-y-2">
                  {fields.map((fld, idx) => {
                    const catMeta = WORKFLOW_FIELD_CATALOG.find(
                      (c) => c.type === fld.type
                    );
                    const autoLinked = isAutoLinkedMemberField(fld.type);
                    return (
                      <div
                        key={fld.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-extrabold text-slate-600 shrink-0">
                            {catMeta?.badge || "•"} {catMeta?.label || fld.type}
                          </span>
                          <input
                            value={fld.label}
                            onChange={(e) =>
                              setFields((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, label: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="필드 제목"
                            className="flex-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800"
                          />
                          {autoLinked ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold shrink-0">
                              구성원 자동연동
                            </span>
                          ) : (
                            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={Boolean(fld.required)}
                                onChange={(e) =>
                                  setFields((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, required: e.target.checked }
                                        : item
                                    )
                                  )
                                }
                                className="accent-[#00c458]"
                              />
                              <span>필수</span>
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setFields((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-slate-400 hover:text-rose-500 text-xs font-extrabold px-1"
                          >
                            ✕
                          </button>
                        </div>

                        {(fld.type === "SELECT" ||
                          fld.type === "MULTI_SELECT") && (
                          <input
                            value={(fld.options || []).join(", ")}
                            onChange={(e) =>
                              setFields((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        options: e.target.value
                                          .split(",")
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                      }
                                    : item
                                )
                              )
                            }
                            placeholder="선택 옵션을 쉼표(,)로 구분해 입력 (예: 도서 인쇄, AI 구독, 외주비)"
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-700"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ⊕ 필드 추가하기 버튼 */}
              <div>
                <button
                  type="button"
                  onClick={() => setFieldMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 py-1.5 text-xs font-extrabold text-slate-600 hover:text-slate-900"
                >
                  <span className="w-4 h-4 rounded-full bg-slate-500 text-white flex items-center justify-center text-[11px] leading-none">
                    +
                  </span>
                  <span>필드 추가하기</span>
                </button>

                {fieldMenuOpen && (
                  <div className="mt-1 w-60 max-h-[380px] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200 py-2 z-30 custom-scroll">
                    {/* 기본 입력 */}
                    {WORKFLOW_FIELD_CATALOG.filter(
                      (c) => c.group === "BASIC"
                    ).map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => handleAddField(item.type)}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2.5 text-xs font-semibold text-slate-800"
                      >
                        <span className="w-5 text-center text-[11px] font-extrabold text-slate-500">
                          {item.badge}
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}

                    {/* 구성원 정보 연동 */}
                    <div className="px-3.5 pt-2.5 pb-1 mt-1 border-t border-slate-100 text-[10px] font-extrabold text-slate-400">
                      구성원 정보 연동
                    </div>
                    {WORKFLOW_FIELD_CATALOG.filter(
                      (c) => c.group === "MEMBER"
                    ).map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => handleAddField(item.type)}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2.5 text-xs font-semibold text-slate-800"
                      >
                        <span className="w-5 text-center text-[11px] font-extrabold text-slate-500">
                          {item.badge}
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}

                    {/* 인사 정보 연동 */}
                    <div className="px-3.5 pt-2.5 pb-1 mt-1 border-t border-slate-100 text-[10px] font-extrabold text-slate-400">
                      인사 정보 연동
                    </div>
                    {WORKFLOW_FIELD_CATALOG.filter((c) => c.group === "HR").map(
                      (item) => (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => handleAddField(item.type)}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2.5 text-xs font-semibold text-slate-800"
                        >
                          <span className="w-5 text-center text-[11px] font-extrabold text-slate-500">
                            {item.badge}
                          </span>
                          <span>{item.label}</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 본문 템플릿 에디터 */}
            {useBody && (
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="px-3.5 py-2 border-b border-slate-100 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 bg-slate-50/50">
                  <button
                    type="button"
                    onClick={() => insertBodySnippet("**강조 제목**")}
                    className="px-2 py-1 rounded hover:bg-slate-200/60 font-black"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => insertBodySnippet("*기울임*")}
                    className="px-2 py-1 rounded hover:bg-slate-200/60 italic font-serif"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => insertBodySnippet("1. 항목:\n2. 세부 내용:")}
                    className="px-2 py-1 rounded hover:bg-slate-200/60 font-bold"
                  >
                    1. 목록
                  </button>
                  <button
                    type="button"
                    onClick={() => insertBodySnippet("- 항목 1\n- 항목 2")}
                    className="px-2 py-1 rounded hover:bg-slate-200/60 font-bold"
                  >
                    • 글머리
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      insertBodySnippet(
                        "[일자 / 거래처(내역) / 금액]\n- 2026-00-00 /  / 0원"
                      )
                    }
                    className="px-2 py-1 rounded hover:bg-slate-200/60 font-bold text-[11px]"
                  >
                    ⊞ 표 양식 삽입
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder="내용을 입력하세요 (작성자가 문서를 열었을 때 기본으로 채워질 안내 양식)"
                  className="w-full p-4 text-xs font-medium text-slate-800 leading-relaxed focus:outline-none resize-none"
                />
              </div>
            )}
          </div>

          {/* 하단 옵션 바 + [양식 저장하기] 그린 그라데이션 버튼 (Screenshot 6) */}
          <div className="px-7 pt-3 pb-5 border-t border-slate-100 space-y-3 shrink-0 bg-white">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-slate-500">
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-800">
                <span>📄 참고 파일</span>
                <span className="text-slate-800 font-extrabold">
                  {uploadingRef
                    ? "업로드중..."
                    : refFileName
                      ? refFileName.slice(0, 12)
                      : "없음"}
                </span>
                <input
                  type="file"
                  onChange={handleRefFileUpload}
                  className="hidden"
                />
              </label>

              <span className="text-slate-200">|</span>

              <div className="flex items-center gap-1">
                <span>☁️ 첨부 파일</span>
                <select
                  value={attachmentMode}
                  onChange={(e) =>
                    setAttachmentMode(
                      e.target.value as "NONE" | "OPTIONAL" | "REQUIRED"
                    )
                  }
                  className="font-extrabold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                >
                  <option value="NONE">사용 안함</option>
                  <option value="OPTIONAL">선택 첨부</option>
                  <option value="REQUIRED">필수 첨부</option>
                </select>
              </div>

              <span className="text-slate-200">|</span>

              <div className="flex items-center gap-1">
                <span>📝 내용</span>
                <select
                  value={useBody ? "USE" : "NONE"}
                  onChange={(e) => setUseBody(e.target.value === "USE")}
                  className="font-extrabold text-[#00a84b] bg-transparent focus:outline-none cursor-pointer"
                >
                  <option value="USE">사용</option>
                  <option value="NONE">사용 안함</option>
                </select>
              </div>

              <span className="text-slate-200">|</span>

              <div className="flex items-center gap-1">
                <span>✏️ 문서 수정</span>
                <select
                  value={allowDocEdit ? "ALLOW" : "DENY"}
                  onChange={(e) => setAllowDocEdit(e.target.value === "ALLOW")}
                  className="font-extrabold text-[#00a84b] bg-transparent focus:outline-none cursor-pointer"
                >
                  <option value="ALLOW">허용</option>
                  <option value="DENY">비허용</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00d436] to-[#00b894] hover:brightness-95 text-white text-sm font-extrabold shadow-md transition-all"
            >
              {saving ? "저장 중..." : "양식 저장하기"}
            </button>
          </div>
        </div>

        {/* ================= 우측: 양식 분류 & 승인선 설정 패널 (Screenshot 6 & 7) ================= */}
        {showRightPane && (
          <div className="lg:w-[38%] h-full border-t lg:border-t-0 lg:border-l border-slate-100 bg-slate-50/40 p-6 overflow-y-auto space-y-5 custom-scroll">
            {/* 1) 양식 분류 + 장부 연동 설정 */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800">
                  양식 분류
                </span>
                <button
                  type="button"
                  onClick={() => setAddingCategory((v) => !v)}
                  className="w-6 h-6 rounded-lg hover:bg-slate-200/70 text-slate-500 font-bold text-sm flex items-center justify-center"
                  title="새 분류 추가"
                >
                  +
                </button>
              </div>

              {addingCategory && (
                <div className="flex items-center gap-1.5">
                  <input
                    value={newCatInput}
                    onChange={(e) => setNewCatInput(e.target.value)}
                    placeholder="새 양식 분류명"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = newCatInput.trim();
                      if (!v) return;
                      if (!localCategories.includes(v)) {
                        setLocalCategories((prev) => [...prev, v]);
                      }
                      setCategoryName(v);
                      setNewCatInput("");
                      setAddingCategory(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold"
                  >
                    추가
                  </button>
                </div>
              )}

              <select
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
              >
                {localCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <div className="pt-1">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  승인 완료 시 자동 연동 모듈
                </label>
                <select
                  value={mappedDocType}
                  onChange={(e) =>
                    setMappedDocType(e.target.value as HqApprovalDocType)
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700"
                >
                  <option value="GENERAL">일반 워크플로우 (문서 보관)</option>
                  <option value="EXPENSE">
                    💳 지출·경비 정산 장부 자동 등록 (사후품의/식비/원고료)
                  </option>
                  <option value="PURCHASE">
                    🛒 구매·발주 품목 명세형 (사전계획/인쇄발주)
                  </option>
                  <option value="LEAVE">
                    🏖️ 휴가·연차 일수 및 근태표 자동 반영
                  </option>
                </select>
              </div>

              <label className="flex items-center gap-2 pt-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSmartForm}
                  onChange={(e) => setIsSmartForm(e.target.checked)}
                  className="accent-indigo-600 rounded"
                />
                <span className="text-[11px] font-bold text-slate-600">
                  출판·연구 본부 스마트 양식으로 표시
                </span>
              </label>
            </div>

            {/* 2) 요청자별 승인 / 변경 허용 / 템플릿 (Screenshot 7) */}
            <div className="pt-3 border-t border-slate-200/80 space-y-4 relative">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPerRequester((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                      perRequester
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-white border-slate-200 text-slate-500"
                    }`}
                  >
                    요청자별 승인
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowEdit((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold transition-colors ${
                      allowEdit
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-white border-slate-200 text-slate-500"
                    }`}
                  >
                    변경 허용
                  </button>
                </div>

                {/* 📄 템플릿 팝오버 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setTemplateMenuOpen((v) => !v)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 flex items-center gap-1"
                  >
                    <span>📄</span>
                    <span>템플릿</span>
                  </button>

                  {templateMenuOpen && (
                    <div className="absolute right-0 top-8 z-30 w-60 rounded-2xl bg-white shadow-xl border border-slate-200 p-2.5 space-y-2">
                      <input
                        value={templateQuery}
                        onChange={(e) => setTemplateQuery(e.target.value)}
                        placeholder="🔍 검색"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-medium focus:outline-none"
                      />
                      <div className="text-[10px] font-bold text-slate-400 px-1">
                        승인 템플릿 적용
                      </div>
                      {filteredTemplates.length === 0 ? (
                        <div className="px-1 py-2 text-xs font-bold text-slate-700">
                          사용할 수 있는 템플릿이 없어요.
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-44 overflow-y-auto">
                          {filteredTemplates.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => {
                                setCcList(tpl.cc_list || []);
                                setSteps(
                                  tpl.steps.length > 0
                                    ? tpl.steps
                                    : [{ step_order: 1, assignees: [] }]
                                );
                                setTemplateMenuOpen(false);
                              }}
                              className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left text-xs font-bold text-slate-800"
                            >
                              {tpl.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 3) 참조 (CC) 설정 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">참조</span>
                  <button
                    type="button"
                    onClick={() => setAssigneePickerTarget({ kind: "CC" })}
                    className="w-6 h-6 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center"
                  >
                    +
                  </button>
                </div>

                {ccList.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setAssigneePickerTarget({ kind: "CC" })}
                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white transition-colors text-left"
                  >
                    <span className="w-9 h-9 rounded-xl bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold">
                      +
                    </span>
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        추가하기
                      </div>
                      <div className="text-[11px] text-slate-400">
                        참조자를 추가해 주세요.
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    {ccList.map((asg, idx) => (
                      <div
                        key={`${asg.name}-${idx}`}
                        className="px-3 py-2 rounded-xl bg-white border border-slate-200 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            style={{
                              backgroundColor: asg.avatar_bg || "#64748b",
                            }}
                            className="w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center"
                          >
                            {asg.name.slice(-2)}
                          </span>
                          <div>
                            <div className="text-xs font-bold text-slate-800">
                              {asg.name}
                            </div>
                            {asg.sub_label && (
                              <div className="text-[10px] text-slate-400">
                                {asg.sub_label}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCcList((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          className="text-xs text-slate-400 hover:text-rose-500 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4) N단계 승인 설정 */}
              <div className="space-y-3">
                {steps.map((st, sIdx) => (
                  <div key={sIdx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">
                        {sIdx + 1} 단계 승인
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setAssigneePickerTarget({
                              kind: "STEP",
                              stepIndex: sIdx,
                            })
                          }
                          className="w-6 h-6 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center"
                        >
                          +
                        </button>
                        {steps.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setSteps((prev) =>
                                prev
                                  .filter((_, i) => i !== sIdx)
                                  .map((item, i) => ({
                                    ...item,
                                    step_order: i + 1,
                                  }))
                              )
                            }
                            className="w-6 h-6 rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-500 text-xs font-bold flex items-center justify-center"
                            title="단계 삭제"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {st.assignees.length === 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setAssigneePickerTarget({
                            kind: "STEP",
                            stepIndex: sIdx,
                          })
                        }
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white transition-colors text-left"
                      >
                        <span className="w-9 h-9 rounded-xl bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold">
                          +
                        </span>
                        <div>
                          <div className="text-xs font-bold text-slate-800">
                            추가하기
                          </div>
                          <div className="text-[11px] text-slate-400">
                            승인자를 추가해 주세요.
                          </div>
                        </div>
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        {st.assignees.map((asg, aIdx) => (
                          <div
                            key={`${asg.name}-${aIdx}`}
                            className="px-3 py-2 rounded-xl bg-white border border-slate-200 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                style={{
                                  backgroundColor: asg.avatar_bg || "#6366f1",
                                }}
                                className="w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center"
                              >
                                {asg.name.slice(-2)}
                              </span>
                              <div>
                                <div className="text-xs font-bold text-slate-800">
                                  {asg.name}
                                </div>
                                {asg.sub_label && (
                                  <div className="text-[10px] text-slate-400">
                                    {asg.sub_label}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setSteps((prev) =>
                                  prev.map((row, idx) =>
                                    idx === sIdx
                                      ? {
                                          ...row,
                                          assignees: row.assignees.filter(
                                            (_, k) => k !== aIdx
                                          ),
                                        }
                                      : row
                                  )
                                )
                              }
                              className="text-xs text-slate-400 hover:text-rose-500 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setSteps((prev) => [
                      ...prev,
                      { step_order: prev.length + 1, assignees: [] },
                    ])
                  }
                  className="w-full py-2.5 rounded-xl bg-slate-200/60 hover:bg-slate-200 text-xs font-extrabold text-slate-700 transition-colors"
                >
                  + 승인 단계 추가하기
                </button>
              </div>

              {/* 대상자(참조자 / 승인자) 선택 모달 팝오버 */}
              {assigneePickerTarget && (
                <div className="p-3 rounded-2xl bg-white shadow-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800">
                      {assigneePickerTarget.kind === "CC"
                        ? "참조자 선택"
                        : `${assigneePickerTarget.stepIndex + 1}단계 승인자 선택`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAssigneePickerTarget(null)}
                      className="text-xs font-bold text-slate-400 hover:text-slate-700"
                    >
                      닫기
                    </button>
                  </div>

                  <input
                    value={assigneeSearch}
                    onChange={(e) => setAssigneeSearch(e.target.value)}
                    placeholder="이름 또는 부서 검색"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-medium focus:outline-none"
                  />

                  <div className="space-y-1 max-h-48 overflow-y-auto custom-scroll">
                    <div className="text-[10px] font-extrabold text-slate-400 px-1">
                      조직 역할 자동 지정
                    </div>
                    {rolePresets.map((rp) => (
                      <button
                        key={rp.id}
                        type="button"
                        onClick={() => addAssigneeToTarget(rp)}
                        className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                      >
                        <span>{rp.name}</span>
                        <span className="text-[10px] text-slate-400">
                          {rp.sub_label}
                        </span>
                      </button>
                    ))}

                    <div className="text-[10px] font-extrabold text-slate-400 px-1 pt-1.5">
                      특정 구성원 지정
                    </div>
                    {searchedMembers.map((m) => (
                      <button
                        key={m.instructor_id}
                        type="button"
                        onClick={() =>
                          addAssigneeToTarget({
                            id: `mem-${m.instructor_id}`,
                            kind: "MEMBER",
                            member_id: m.instructor_id,
                            name: m.name,
                            sub_label: m.department,
                            avatar_bg: "#6366f1",
                            notify_mode: "BOTH",
                            step_action: "승인",
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                      >
                        <span>
                          {m.name}{" "}
                          <span className="font-normal text-slate-400">
                            {m.job_title}
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {m.department}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
