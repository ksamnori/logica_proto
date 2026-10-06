// src/app/(dashboard)/learning/components/LearningRow.tsx
// 학습 관리 목록(GlobalList)과 학생 타임라인(StudentTimeline)이 함께 쓰는 두 줄짜리 목록 행
// 1줄: 학생 이름 + 학습지 제목 (제목이 줄 전체 폭을 씀) / 오른쪽 상태
// 2줄: 종류, 반, 날짜, 문항 수, 정답·오답
// 오른쪽: [완료처리] [주 버튼] [⋯ 메뉴: 이름 변경, 수정, 출력, 삭제]
"use client";

import React, { useState } from "react";

export type RowTone = "success" | "warn" | "danger" | "neutral";

export type RowMenuItem = {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  hidden?: boolean;
};

type Props = {
  selected: boolean;
  completed: boolean;
  onToggle: () => void;

  title: string;
  leadName?: string;          // 학생 이름 (전체 목록에서만)
  typeLabel?: string;         // 종류 (섞여 있을 때만)
  typeClass?: string;         // 종류 배지 색 (구분용 파스텔)
  classCode?: string;         // 반 이름
  subTitle?: string;          // 부제 (타임라인)
  date?: string;              // ISO 또는 YYYY-MM-DD
  totalQ?: number;
  oCount?: number;
  xCount?: number;

  status: string;
  statusTone: RowTone;

  onComplete?: (e: React.MouseEvent) => void;
  primary: { label: string; onClick: (e: React.MouseEvent) => void; tone?: "brand" | "danger" };
  menu: RowMenuItem[];
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 올해면 "9/18(금) 07:58", 다른 해면 "2025 9/18(금)"
export const shortDate = (raw?: string) => {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const md = `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
  const hasTime = /T\d{2}:\d{2}/.test(raw) || / \d{2}:\d{2}/.test(raw);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.getFullYear() !== new Date().getFullYear()) return `${d.getFullYear()} ${md}`;
  return hasTime ? `${md} ${hm}` : md;
};

// 상태 문자열 → 색 (상태 색 규칙)
export const statusToneOf = (status: string, completed: boolean, overdueContext = false): RowTone => {
  if (completed) return "success";
  if (["미응시", "응시전", "미제출"].includes(status)) return overdueContext ? "danger" : "neutral";
  return "warn";
};

const TONE_CLASS: Record<RowTone, string> = {
  success: "bg-success-soft text-success-ink",
  warn: "bg-warn-soft text-warn-ink",
  danger: "bg-danger-soft text-danger-ink",
  neutral: "bg-slate-100 text-slate-600",
};

export default function LearningRow(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scored = (p.oCount || 0) + (p.xCount || 0) > 0;
  const visibleMenu = p.menu.filter(m => !m.hidden);
  const normalItems = visibleMenu.filter(m => !m.danger);
  const dangerItems = visibleMenu.filter(m => m.danger);

  const rowCls = p.selected
    ? "border-rose-300 bg-rose-50"
    : p.completed
      ? "border-slate-200 bg-slate-50"
      : "border-slate-200 bg-white hover:border-brand/40";

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={p.onToggle}
      className={`relative border rounded-xl px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-colors ${rowCls}`}
    >
      <input
        type="checkbox"
        checked={p.selected}
        readOnly
        aria-label={`${p.leadName ? p.leadName + " " : ""}${p.title} 선택`}
        className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0"
      />

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* 1줄: 이름 + 제목 */}
        <div className="flex items-baseline gap-2 min-w-0">
          {p.leadName && <span className="shrink-0 text-[15px] font-bold text-ink">{p.leadName}</span>}
          <span className={`truncate text-[15px] ${p.completed ? "text-slate-500" : "text-ink"} font-semibold`} title={p.title}>{p.title}</span>
        </div>
        {/* 2줄: 정보 */}
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[13px] text-muted">
          {p.typeLabel && <span className={`px-1.5 py-0.5 rounded text-xs font-semibold border ${p.typeClass || "bg-slate-100 text-slate-600 border-slate-200"}`}>{p.typeLabel}</span>}
          {p.classCode && <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">{p.classCode}</span>}
          {p.subTitle && <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">{p.subTitle}</span>}
          {p.date && <span className="tabular-nums">{shortDate(p.date)}</span>}
          {typeof p.totalQ === "number" && <span>{p.totalQ || 0}문항</span>}
          {scored && (
            <span className="tabular-nums">
              정답 <b className="font-semibold text-emerald-600">{p.oCount || 0}</b>
              <span className="mx-1 text-slate-300">/</span>
              오답 <b className="font-semibold text-rose-600">{p.xCount || 0}</b>
            </span>
          )}
        </div>
      </div>

      {/* 오른쪽 */}
      <div className="flex items-center gap-2 shrink-0" onClick={stop}>
        <span className={`min-w-[52px] text-center px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${TONE_CLASS[p.statusTone]}`}>{p.status}</span>

        {!p.completed && p.onComplete && (
          <button
            type="button"
            onClick={(e) => { stop(e); p.onComplete?.(e); }}
            className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-[13px] font-semibold text-body hover:bg-slate-50 whitespace-nowrap"
          >
            완료처리
          </button>
        )}

        <button
          type="button"
          onClick={(e) => { stop(e); p.primary.onClick(e); }}
          className={`h-8 px-3 rounded-lg text-[13px] font-semibold text-white whitespace-nowrap ${p.primary.tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand hover:bg-brand-hover"}`}
        >
          {p.primary.label}
        </button>

        {visibleMenu.length > 0 && (
          <div className="relative">
            <button
              type="button"
              aria-label="더 보기"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { stop(e); setMenuOpen(o => !o); }}
              className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-body hover:bg-slate-50 flex items-center justify-center"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={(e) => { stop(e); setMenuOpen(false); }} />
                <div role="menu" className="absolute right-0 top-full mt-1 z-40 min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                  {normalItems.map((m, i) => (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      onClick={(e) => { stop(e); setMenuOpen(false); m.onClick(e); }}
                      className="w-full text-left px-3 py-2 text-[14px] text-ink hover:bg-slate-50"
                    >
                      {m.label}
                    </button>
                  ))}
                  {dangerItems.length > 0 && normalItems.length > 0 && <div className="my-1 border-t border-slate-100" />}
                  {dangerItems.map((m, i) => (
                    <button
                      key={`d${i}`}
                      type="button"
                      role="menuitem"
                      onClick={(e) => { stop(e); setMenuOpen(false); m.onClick(e); }}
                      className="w-full text-left px-3 py-2 text-[14px] text-danger-ink hover:bg-danger-soft"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
