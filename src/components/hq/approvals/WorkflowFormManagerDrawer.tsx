// src/components/hq/approvals/WorkflowFormManagerDrawer.tsx
"use client";

import React, { useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import type { HqWorkflowFormDef } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  forms: HqWorkflowFormDef[];
  categories: string[];
  canManageForms: boolean;
  onClose: () => void;
  onOpenBuilder: (form: HqWorkflowFormDef | null) => void;
  onQuickDraft: (form: HqWorkflowFormDef) => void;
  onFormsMutated: (nextCategories: string[], nextForms: HqWorkflowFormDef[]) => void;
}

export default function WorkflowFormManagerDrawer({
  isOpen,
  forms,
  categories,
  canManageForms,
  onClose,
  onOpenBuilder,
  onQuickDraft,
  onFormsMutated,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>("ALL");
  const [openMenuFormId, setOpenMenuFormId] = useState<string | null>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [busy, setBusy] = useState(false);

  const smartCount = useMemo(
    () => forms.filter((f) => f.is_smart_form).length,
    [forms]
  );

  const filteredForms = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return forms.filter((f) => {
      if (selectedCat === "SMART" && !f.is_smart_form) return false;
      if (
        selectedCat !== "ALL" &&
        selectedCat !== "SMART" &&
        f.category_name !== selectedCat
      ) {
        return false;
      }
      if (q && !f.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [forms, keyword, selectedCat]);

  if (!isOpen) return null;

  const openCategoryEditor = () => {
    setDraftCategories([...categories]);
    setNewCategoryName("");
    setEditingCategories(true);
  };

  const handleSaveCategories = async () => {
    const cleaned = draftCategories.map((c) => c.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      alert("최소 1개 이상의 양식 분류가 필요합니다.");
      return;
    }
    setBusy(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { categories: string[]; forms: HqWorkflowFormDef[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: {
          action: "SAVE_CATEGORIES",
          categories: cleaned,
        },
      });
      onFormsMutated(res.data.categories, res.data.forms);
      setEditingCategories(false);
    } catch (e: any) {
      alert(e?.message || "분류 저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async (formId: string) => {
    setOpenMenuFormId(null);
    setBusy(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { categories: string[]; forms: HqWorkflowFormDef[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: { action: "DUPLICATE_FORM", form_id: formId },
      });
      onFormsMutated(res.data.categories, res.data.forms);
    } catch (e: any) {
      alert(e?.message || "양식 복제 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (form: HqWorkflowFormDef) => {
    setOpenMenuFormId(null);
    if (
      !confirm(
        `[${form.title}] 양식을 삭제하시겠습니까?\n기존에 작성된 문서는 그대로 유지됩니다.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { categories: string[]; forms: HqWorkflowFormDef[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: { action: "DELETE_FORM", form_id: form.id },
      });
      onFormsMutated(res.data.categories, res.data.forms);
    } catch (e: any) {
      alert(e?.message || "양식 삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/25 flex justify-end"
      onClick={() => {
        setOpenMenuFormId(null);
        onClose();
      }}
    >
      <aside
        className="w-full max-w-[440px] bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col"
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuFormId(null);
        }}
      >
        {/* 상단 헤더 (Screenshot 5) */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-extrabold text-slate-900">문서 양식 관리</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-extrabold"
          >
            ✕
          </button>
        </div>

        {/* 검색창 */}
        <div className="px-6 pb-4 shrink-0">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              🔍
            </span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="양식 제목 검색"
              className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-100/90 border border-transparent focus:bg-white focus:border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none"
            />
          </div>
        </div>

        {/* 양식분류 헤더 & 분류 수정 */}
        <div className="px-6 pb-3 shrink-0 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <span>양식분류</span>
              <span
                className="text-slate-400 cursor-help"
                title="문서 양식을 부서·업무 목적별로 분류하여 관리할 수 있습니다."
              >
                ⓘ
              </span>
            </span>
            {canManageForms && (
              <button
                type="button"
                onClick={openCategoryEditor}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <span>🏷️</span>
                <span>분류 수정</span>
              </button>
            )}
          </div>

          {editingCategories && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="text-[11px] font-extrabold text-slate-700">
                양식 분류 편집
              </div>
              <div className="space-y-1.5">
                {draftCategories.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      value={c}
                      onChange={(e) =>
                        setDraftCategories((prev) =>
                          prev.map((item, i) => (i === idx ? e.target.value : item))
                        )
                      }
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                    />
                    {draftCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraftCategories((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="px-2 py-1 text-xs font-bold text-rose-500 hover:bg-rose-50 rounded-lg"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="새 분류 이름 추가"
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = newCategoryName.trim();
                    if (!v || draftCategories.includes(v)) return;
                    setDraftCategories((prev) => [...prev, v]);
                    setNewCategoryName("");
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold"
                >
                  + 추가
                </button>
              </div>
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingCategories(false)}
                  className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveCategories}
                  className="px-3 py-1 rounded-lg bg-[#00c458] text-white text-xs font-extrabold"
                >
                  저장
                </button>
              </div>
            </div>
          )}

          {/* 분류 탭 칩 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCat("ALL")}
              className={`px-3 py-1 rounded-full text-xs font-extrabold transition-colors ${
                selectedCat === "ALL"
                  ? "bg-[#00c458] text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              전체 {forms.length}
            </button>
            <button
              type="button"
              onClick={() => setSelectedCat("SMART")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                selectedCat === "SMART"
                  ? "bg-[#00c458] text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              스마트 양식 {smartCount}
            </button>
            {categories.map((cat) => {
              const cnt = forms.filter((f) => f.category_name === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCat(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    selectedCat === cat
                      ? "bg-[#00c458] text-white"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {cat} {cnt}
                </button>
              );
            })}
          </div>
        </div>

        {/* 양식 리스트 */}
        <div className="flex-1 overflow-y-auto px-6 divide-y divide-slate-100 custom-scroll">
          {filteredForms.map((form) => {
            const stepCount = form.steps?.length || 0;
            const ccCount = form.cc_list?.length || 0;
            const menuOpen = openMenuFormId === form.id;

            return (
              <div
                key={form.id}
                className="py-3.5 flex items-center justify-between gap-3 relative group"
              >
                <div
                  onClick={() =>
                    canManageForms ? onOpenBuilder(form) : onQuickDraft(form)
                  }
                  className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer"
                >
                  <span
                    style={{ backgroundColor: form.icon_bg || "#f1f5f9" }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  >
                    {form.icon || "📋"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-slate-800 truncate group-hover:text-[#00a84b] transition-colors">
                        {form.title}
                      </span>
                      {form.is_smart_form && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-extrabold">
                          스마트
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {form.category_name} ·{" "}
                      {stepCount > 0 ? `${stepCount}단계 승인` : "승인 단계 없음"}
                      {ccCount > 0 ? ` · 참조 ${ccCount}` : ""}
                      {form.fields.length > 0
                        ? ` · 커스텀 필드 ${form.fields.length}개`
                        : ""}
                    </div>
                  </div>
                </div>

                {/* 우측 ⋯ 더보기 메뉴 */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuFormId(menuOpen ? null : form.id);
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center font-extrabold"
                  >
                    ⋯
                  </button>

                  {menuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-9 z-30 w-40 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 text-xs font-bold text-slate-700"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuFormId(null);
                          onQuickDraft(form);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                      >
                        <span>✍️</span>
                        <span>이 양식으로 작성</span>
                      </button>
                      {canManageForms && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuFormId(null);
                              onOpenBuilder(form);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                          >
                            <span>⚙️</span>
                            <span>양식 및 결재선 수정</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(form.id)}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                          >
                            <span>📋</span>
                            <span>양식 복제</span>
                          </button>
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            onClick={() => handleDelete(form)}
                            className="w-full px-3.5 py-2 text-left hover:bg-rose-50 text-rose-600 flex items-center gap-2"
                          >
                            <span>🗑️</span>
                            <span>양식 삭제</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 하단 [+ 새로운 양식 추가] 버튼 (Screenshot 5) */}
        {canManageForms && (
          <div className="p-5 border-t border-slate-100 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenBuilder(null)}
              className="w-full py-3 rounded-xl border border-slate-200 hover:border-[#00c458] hover:bg-emerald-50/40 transition-colors flex items-center justify-center gap-2 text-xs font-extrabold text-slate-800"
            >
              <span className="w-4 h-4 rounded bg-[#00c458] text-white flex items-center justify-center text-[11px] leading-none">
                +
              </span>
              <span>새로운 양식 추가</span>
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
