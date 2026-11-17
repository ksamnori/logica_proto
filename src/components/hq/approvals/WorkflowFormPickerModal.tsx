// src/components/hq/approvals/WorkflowFormPickerModal.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { HqWorkflowFormDef } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  forms: HqWorkflowFormDef[];
  categories: string[];
  onClose: () => void;
  onSelectForm: (form: HqWorkflowFormDef) => void;
}

export default function WorkflowFormPickerModal({
  isOpen,
  forms,
  categories,
  onClose,
  onSelectForm,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("ALL");

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return forms.filter((f) => {
      if (activeCategory !== "ALL" && f.category_name !== activeCategory) {
        return false;
      }
      if (q) {
        const hay = `${f.title} ${f.description} ${f.category_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [forms, keyword, activeCategory]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 플로팅 캡슐 (Screenshot 10) */}
        <div className="self-start px-3.5 py-1.5 rounded-xl bg-white shadow-md border border-slate-200/80 text-xs font-extrabold text-slate-800">
          워크플로우 작성
        </div>

        {/* 메인 양식 선택 카드 */}
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[76vh]">
          {/* 검색 입력 바 */}
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-sm font-bold shrink-0"
              title="닫기"
            >
              ‹
            </button>
            <input
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색어 입력"
              className="flex-1 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* 카테고리 필터 칩 */}
          <div className="px-5 pt-4 pb-2">
            <div className="text-[11px] font-bold text-slate-400 mb-2">
              워크플로우 양식 선택
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveCategory("ALL")}
                className={`px-3 py-1 rounded-full text-xs font-extrabold transition-colors ${
                  activeCategory === "ALL"
                    ? "bg-[#00c458] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                전체
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    activeCategory === cat
                      ? "bg-[#00c458] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* 양식 목록 */}
          <div className="px-3 pb-4 pt-1 overflow-y-auto flex-1 space-y-0.5 custom-scroll">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 font-semibold">
                일치하는 워크플로우 양식이 없습니다.
              </div>
            ) : (
              filtered.map((form) => (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => onSelectForm(form)}
                  className="w-full px-3 py-2.5 rounded-xl hover:bg-slate-100/90 transition-colors flex items-center justify-between gap-3 text-left group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      style={{ backgroundColor: form.icon_bg || "#f1f5f9" }}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
                    >
                      {form.icon || "📋"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-slate-800 truncate">
                          {form.title}
                        </span>
                        {form.is_smart_form && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-extrabold shrink-0">
                            출판전용
                          </span>
                        )}
                      </div>
                      {form.description && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {form.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-slate-300 group-hover:text-slate-500 text-sm font-bold shrink-0">
                    ›
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
