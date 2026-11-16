// src/components/hq/settings/HqCustomInfoDocBoxSection.tsx
"use client";

import React, { useState } from "react";
import { DEFAULT_DOC_FOLDERS } from "@/lib/hq/defaultApprovalPolicies";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqCustomInfoCategory,
  HqCustomInfoField,
  HqDocFolderItem,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================================
// 1. 커스텀 정보 오버레이 모달 (Image 1 — 인사·계약 > 커스텀 정보 ↗)
// ============================================================================
interface CustomInfoModalProps {
  isOpen: boolean;
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onClose: () => void;
}

export function HqCustomInfoModal({
  isOpen,
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onClose,
}: CustomInfoModalProps) {
  const ex = settings.extra_settings || {};
  const categories = ex.custom_info_categories || [];
  const fields = ex.custom_info_fields || [];

  const [selectedCatId, setSelectedCatId] = useState<string>("ALL");
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<HqCustomInfoField | null>(
    null
  );
  const [fieldForm, setFieldForm] = useState<{
    name: string;
    field_type: HqCustomInfoField["field_type"];
    category_id: string;
    description: string;
    required: boolean;
  }>({
    name: "",
    field_type: "텍스트",
    category_id: "",
    description: "",
    required: false,
  });

  if (!isOpen) return null;

  const visibleFields =
    selectedCatId === "ALL"
      ? fields
      : fields.filter((f) => f.category_id === selectedCatId);

  const selectedCatLabel =
    selectedCatId === "ALL"
      ? "모든 커스텀 정보"
      : categories.find((c) => c.id === selectedCatId)?.name || "모든 커스텀 정보";

  const openCreateField = () => {
    setEditingField(null);
    setFieldForm({
      name: "",
      field_type: "텍스트",
      category_id: selectedCatId === "ALL" ? "" : selectedCatId,
      description: "",
      required: false,
    });
    setFieldModalOpen(true);
  };

  const openEditField = (f: HqCustomInfoField) => {
    setEditingField(f);
    setFieldForm({
      name: f.name,
      field_type: f.field_type,
      category_id: f.category_id || "",
      description: f.description || "",
      required: Boolean(f.required),
    });
    setFieldModalOpen(true);
  };

  const handleAddCategory = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setAddingCat(false);
      return;
    }
    const nextCat: HqCustomInfoCategory = { id: `cat-${uid()}`, name: trimmed };
    await onSaveExtra(
      { custom_info_categories: [...categories, nextCat] },
      "커스텀 정보 카테고리가 추가되었습니다."
    );
    setNewCatName("");
    setAddingCat(false);
  };

  const handleSaveField = async () => {
    if (!fieldForm.name.trim()) {
      alert("커스텀 정보 항목 이름을 입력해주세요.");
      return;
    }
    const nextItem: HqCustomInfoField = {
      id: editingField ? editingField.id : `cf-${uid()}`,
      name: fieldForm.name.trim(),
      field_type: fieldForm.field_type,
      category_id: fieldForm.category_id || null,
      description: fieldForm.description.trim(),
      required: fieldForm.required,
    };
    const nextList = editingField
      ? fields.map((f) => (f.id === editingField.id ? nextItem : f))
      : [...fields, nextItem];

    await onSaveExtra(
      { custom_info_fields: nextList },
      editingField
        ? "커스텀 정보 항목이 수정되었습니다."
        : "새 커스텀 정보가 추가되었습니다."
    );
    setFieldModalOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[1060px] h-[82vh] max-h-[800px] rounded-2xl shadow-2xl border border-slate-200 flex overflow-hidden">
        {/* 좌측 카테고리 사이드바 */}
        <aside className="w-[225px] bg-[#f8f9fa] border-r border-slate-200/80 p-4 flex flex-col shrink-0 select-none">
          <div className="px-2 py-1 flex items-center gap-1.5 mb-3">
            <span className="text-[14px] font-extrabold text-slate-900">
              커스텀 정보
            </span>
            <span
              className="text-slate-400 text-xs cursor-help"
              title="기본 인사 항목 외에 회사에 필요한 추가 구성원 필드를 직접 정의해 관리합니다."
            >
              ⓘ
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCatId("ALL")}
            className={`w-full px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${
              selectedCatId === "ALL"
                ? "bg-[#eceef1] text-slate-900 font-extrabold"
                : "text-slate-600 hover:bg-slate-200/50 font-semibold"
            }`}
          >
            <span className="text-slate-500">⊞</span>
            <span>모든 커스텀 정보</span>
          </button>

          <div className="mt-6 px-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400">
              카테고리
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingCat(true)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold leading-none"
                title="카테고리 추가"
              >
                +
              </button>
            )}
          </div>

          {addingCat && (
            <div className="mt-2 px-1 flex items-center gap-1">
              <input
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                  if (e.key === "Escape") setAddingCat(false);
                }}
                placeholder="카테고리명"
                className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-2 py-1 rounded bg-slate-900 text-white text-[11px] font-bold"
              >
                추가
              </button>
            </div>
          )}

          <div className="mt-2 flex-1 overflow-y-auto space-y-0.5 custom-scroll">
            {categories.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-slate-400">
                커스텀 정보 카테고리 없음
              </div>
            ) : (
              categories.map((cat) => (
                <div
                  key={cat.id}
                  className={`group px-3 py-2 rounded-lg text-xs flex items-center justify-between cursor-pointer ${
                    selectedCatId === cat.id
                      ? "bg-[#eceef1] text-slate-900 font-bold"
                      : "text-slate-600 hover:bg-slate-200/50"
                  }`}
                  onClick={() => setSelectedCatId(cat.id)}
                >
                  <span className="truncate">{cat.name}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`'${cat.name}' 카테고리를 삭제할까요?`))
                          return;
                        onSaveExtra(
                          {
                            custom_info_categories: categories.filter(
                              (c) => c.id !== cat.id
                            ),
                            custom_info_fields: fields.map((f) =>
                              f.category_id === cat.id
                                ? { ...f, category_id: null }
                                : f
                            ),
                          },
                          "카테고리가 삭제되었습니다."
                        );
                        if (selectedCatId === cat.id) setSelectedCatId("ALL");
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 text-[11px]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* 우측 본문 */}
        <div className="flex-1 flex flex-col bg-white min-w-0">
          <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <h3 className="text-[13px] font-extrabold text-slate-900">
              {selectedCatLabel}
            </h3>

            <div className="flex items-center gap-3">
              {canEdit && (
                <button
                  type="button"
                  onClick={openCreateField}
                  className="px-3.5 py-2 rounded-lg bg-[#00c458] hover:bg-[#00ad4d] text-white text-xs font-extrabold flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <span>+</span>
                  <span>커스텀 정보 추가</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-base leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col custom-scroll">
            {visibleFields.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-3.5">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div className="text-[13px] font-extrabold text-slate-700">
                  커스텀 정보 없음
                </div>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  기본 항목 외에 회사에 필요한 구성원 정보를 직접 추가해
                  <br />
                  관리할 수 있어요.
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={openCreateField}
                    className="mt-4 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs"
                  >
                    커스텀 정보 추가
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 max-w-2xl">
                {visibleFields.map((f) => {
                  const catName =
                    categories.find((c) => c.id === f.category_id)?.name ||
                    "미분류";
                  return (
                    <div
                      key={f.id}
                      className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-slate-900">
                            {f.name}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                            {f.field_type}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-semibold">
                            {catName}
                          </span>
                          {f.required && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 text-[11px] font-bold">
                              필수
                            </span>
                          )}
                        </div>
                        {f.description && (
                          <div className="text-slate-400 mt-1">
                            {f.description}
                          </div>
                        )}
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditField(f)}
                            className="px-2.5 py-1 rounded-lg hover:bg-slate-100 text-slate-600 font-semibold"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                !confirm(
                                  `'${f.name}' 커스텀 정보 항목을 삭제하시겠습니까?`
                                )
                              )
                                return;
                              onSaveExtra(
                                {
                                  custom_info_fields: fields.filter(
                                    (x) => x.id !== f.id
                                  ),
                                },
                                "커스텀 정보가 삭제되었습니다."
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg hover:bg-rose-50 text-rose-500 font-semibold"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 커스텀 정보 항목 추가/수정 서브 모달 */}
      {fieldModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[80] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                {editingField ? "커스텀 정보 수정" : "커스텀 정보 추가"}
              </h4>
              <button
                type="button"
                onClick={() => setFieldModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  항목 이름
                </label>
                <input
                  autoFocus
                  value={fieldForm.name}
                  onChange={(e) =>
                    setFieldForm({ ...fieldForm, name: e.target.value })
                  }
                  placeholder="예: 사물함 번호, 노트북 자산번호, 자격증명"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    입력 형식
                  </label>
                  <select
                    value={fieldForm.field_type}
                    onChange={(e) =>
                      setFieldForm({
                        ...fieldForm,
                        field_type:
                          e.target.value as HqCustomInfoField["field_type"],
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value="텍스트">텍스트</option>
                    <option value="숫자">숫자</option>
                    <option value="날짜">날짜</option>
                    <option value="선택형">선택형</option>
                    <option value="파일">파일 첨부</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    카테고리
                  </label>
                  <select
                    value={fieldForm.category_id}
                    onChange={(e) =>
                      setFieldForm({
                        ...fieldForm,
                        category_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  >
                    <option value="">선택 안함 (기본)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  안내 설명 (선택)
                </label>
                <input
                  value={fieldForm.description}
                  onChange={(e) =>
                    setFieldForm({ ...fieldForm, description: e.target.value })
                  }
                  placeholder="구성원 입력 시 표시될 안내 문구"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fieldForm.required}
                  onChange={(e) =>
                    setFieldForm({ ...fieldForm, required: e.target.checked })
                  }
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span>필수 입력 항목으로 지정</span>
              </label>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFieldModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveField}
                className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white font-extrabold"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. 문서함 설정 섹션 (Image 2 — 인사·계약 > 문서함 설정)
// ============================================================================
interface DocBoxSectionProps {
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export function HqDocBoxSettingsSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: DocBoxSectionProps) {
  const ex = settings.extra_settings || {};
  const docFolders = (
    ex.doc_folders && ex.doc_folders.length > 0
      ? ex.doc_folders
      : DEFAULT_DOC_FOLDERS
  )
    .slice()
    .sort((a, b) => a.order - b.order);

  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<HqDocFolderItem | null>(
    null
  );
  const [folderName, setFolderName] = useState("");
  const [folderDesc, setFolderDesc] = useState("");
  const [folderRequired, setFolderRequired] = useState(false);
  const [showPrefixAdvanced, setShowPrefixAdvanced] = useState(false);
  const [certPrefix, setCertPrefix] = useState(ex.doc_prefix_cert || "CERT");
  const [aprPrefix, setAprPrefix] = useState(ex.doc_prefix_approval || "APR");

  const openCreateFolder = (presetName = "") => {
    setAddDropdownOpen(false);
    setEditingFolder(null);
    setFolderName(presetName);
    setFolderDesc("");
    setFolderRequired(false);
    setFolderModalOpen(true);
  };

  const openEditFolder = (item: HqDocFolderItem) => {
    setOpenMenuId(null);
    setEditingFolder(item);
    setFolderName(item.name);
    setFolderDesc(item.description || "");
    setFolderRequired(Boolean(item.is_required));
    setFolderModalOpen(true);
  };

  const handleSaveFolder = async () => {
    if (!folderName.trim()) {
      alert("문서함 이름을 입력해주세요.");
      return;
    }
    const maxOrder = docFolders.reduce((m, f) => Math.max(m, f.order), 0);
    const nextItem: HqDocFolderItem = {
      id: editingFolder ? editingFolder.id : `doc-${uid()}`,
      name: folderName.trim(),
      description: folderDesc.trim(),
      is_required: folderRequired,
      order: editingFolder ? editingFolder.order : maxOrder + 1,
    };
    const nextList = editingFolder
      ? docFolders.map((f) => (f.id === editingFolder.id ? nextItem : f))
      : [...docFolders, nextItem];

    await onSaveExtra(
      { doc_folders: nextList },
      editingFolder
        ? "문서함 정보가 수정되었습니다."
        : "새 구성원 문서함이 추가되었습니다."
    );
    setFolderModalOpen(false);
  };

  const handleMoveFolder = async (idx: number, dir: -1 | 1) => {
    setOpenMenuId(null);
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= docFolders.length) return;
    const copy = [...docFolders];
    const [picked] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, picked);
    const reordered = copy.map((item, i) => ({ ...item, order: i + 1 }));
    await onSaveExtra(
      { doc_folders: reordered },
      "문서함 순서가 변경되었습니다."
    );
  };

  const handleDeleteFolder = async (item: HqDocFolderItem) => {
    setOpenMenuId(null);
    if (!confirm(`'${item.name}' 문서함을 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      { doc_folders: docFolders.filter((f) => f.id !== item.id) },
      `'${item.name}' 문서함이 삭제되었습니다.`
    );
  };

  return (
    <>
      <div className="space-y-8">
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            문서함 설정
          </h2>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            문서함을 만들어 구성원에게 수집할 서류를 요청해보세요.
            <br />
            설정한 문서함은 구성원 프로필과 초대 템플릿에 노출되며, 파일을 업로드하고 관리할 수 있어요.
          </p>
        </div>

        {/* 구성원 문서함 리스트 */}
        <section className="space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              구성원 문서함
            </h3>

            {canEdit && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddDropdownOpen((p) => !p)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
                >
                  <span className="text-emerald-500 font-extrabold text-sm leading-none">
                    +
                  </span>
                  <span>문서함 추가</span>
                  <span className="text-slate-400 text-[10px]">▾</span>
                </button>

                {addDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => openCreateFolder("")}
                      className="w-full px-3.5 py-2 text-left font-bold text-slate-800 hover:bg-slate-50"
                    >
                      ✏️ 직접 문서함 만들기
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                      자주 쓰는 서류 빠른 추가
                    </div>
                    {[
                      "통장사본",
                      "최종학력 졸업증명서",
                      "경력증명서",
                      "비밀유지서약서(NDA)",
                      "개인정보 수집·이용 동의서",
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => openCreateFolder(preset)}
                        className="w-full px-3.5 py-1.5 text-left font-medium text-slate-600 hover:bg-slate-50"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {docFolders.map((folder, idx) => (
              <div
                key={folder.id}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex items-center justify-between gap-3 shadow-2xs relative"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
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
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-800 truncate">
                        {folder.name}
                      </span>
                      {folder.is_required && (
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                          필수 제출
                        </span>
                      )}
                    </div>
                    {folder.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {folder.description}
                      </div>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenuId((p) =>
                          p === folder.id ? null : folder.id
                        )
                      }
                      className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold"
                    >
                      ⋯
                    </button>

                    {openMenuId === folder.id && (
                      <div className="absolute right-0 mt-1 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                        <button
                          type="button"
                          onClick={() => openEditFolder(folder)}
                          className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          수정하기
                        </button>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveFolder(idx, -1)}
                          className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-35"
                        >
                          위로 이동
                        </button>
                        <button
                          type="button"
                          disabled={idx === docFolders.length - 1}
                          onClick={() => handleMoveFolder(idx, 1)}
                          className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-35"
                        >
                          아래로 이동
                        </button>
                        <div className="my-1 border-t border-slate-100" />
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder)}
                          className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
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

        {/* 문서번호 채번 접두어 보조 설정 (접기/펼치기) */}
        <section className="pt-2">
          <button
            type="button"
            onClick={() => setShowPrefixAdvanced((p) => !p)}
            className="text-xs font-bold text-slate-400 hover:text-slate-700 flex items-center gap-1"
          >
            <span>{showPrefixAdvanced ? "▾" : "▸"}</span>
            <span>증명서 · 전자결재 문서번호 접두어 설정</span>
          </button>

          {showPrefixAdvanced && (
            <div className="mt-3 p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    증명서 문서번호 접두어
                  </label>
                  <input
                    disabled={!canEdit}
                    value={certPrefix}
                    onChange={(e) =>
                      setCertPrefix(e.target.value.toUpperCase())
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    전자결재 문서번호 접두어
                  </label>
                  <input
                    disabled={!canEdit}
                    value={aprPrefix}
                    onChange={(e) => setAprPrefix(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-mono font-bold"
                  />
                </div>
              </div>
              {canEdit && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      onSaveExtra(
                        {
                          doc_prefix_cert: certPrefix || "CERT",
                          doc_prefix_approval: aprPrefix || "APR",
                        },
                        "문서번호 채번 접두어가 저장되었습니다."
                      )
                    }
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold"
                  >
                    접두어 저장
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 하단 이전/다음 카드 (Image 2 동일: 인사·구성원 정보 ← / → 승인 정책 관리) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("hr-info")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                인사 · 구성원 정보
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("approval-policy")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                승인 정책 관리
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* 문서함 추가/수정 모달 */}
      {folderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                {editingFolder ? "구성원 문서함 수정" : "구성원 문서함 추가"}
              </h4>
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  문서함 이름
                </label>
                <input
                  autoFocus
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="예: 주민등록등본, 통장사본, 근로계약서"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  수집 안내 문구 (선택)
                </label>
                <input
                  value={folderDesc}
                  onChange={(e) => setFolderDesc(e.target.value)}
                  placeholder="예: 최근 3개월 이내 발급본, 주민번호 뒷자리 마스킹"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={folderRequired}
                  onChange={(e) => setFolderRequired(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span>신규 입사자 필수 제출 서류로 표시</span>
              </label>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveFolder}
                className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white font-extrabold"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
