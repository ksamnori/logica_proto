// src/app/hq/notices/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import type { HqNoticeItem, HqNoticeStatus } from "@/lib/hq/types";

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "✅"];

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

function avatarColor(name: string): string {
  if (name === "천종현") return "#3898ec";
  if (name === "김근식") return "#2dd4bf";
  if (name === "이웅행") return "#fbbf24";
  const palette = ["#60a5fa", "#34d399", "#fb923c", "#a78bfa", "#f87171"];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return palette[sum % palette.length];
}

function formatKoreanFullDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const dow = days[d.getDay()];
  const hr24 = d.getHours();
  const ampm = hr24 < 12 ? "오전" : "오후";
  const hr12 = hr24 % 12 === 0 ? 12 : hr24 % 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd} (${dow}) ${ampm} ${hr12}:${min}`;
}

function formatRelativeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "방금 전";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

export default function HqNoticesPage() {
  const { me, members, isHrManager, isHqAdmin } = useHqShell();

  const [categories, setCategories] = useState<string[]>([
    "공지사항",
    "인사 · 복리후생",
    "출판 · 편집",
    "전사 안내",
  ]);
  const [notices, setNotices] = useState<HqNoticeItem[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  // 좌측 목록 필터 상태 (스크린샷 203508, 203520 동일)
  const [statusTab, setStatusTab] = useState<HqNoticeStatus>("PUBLISHED");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);

  // 체크박스 일괄 선택 및 현재 열람 공지
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [selectedNoticeId, setSelectedNoticeId] = useState<string>("");

  // 우측 상세 액션 상태
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // 공지 작성/수정 모달 & 공지 설정(카테고리 관리) 모달
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<{
    id?: string;
    category: string;
    title: string;
    content: string;
    target_scope: "ALL" | "DEPT";
    target_departments: string[];
    status: HqNoticeStatus;
    scheduled_at: string;
    expires_at: string;
    is_pinned: boolean;
  } | null>(null);

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catDrafts, setCatDrafts] = useState<string[]>([]);
  const [newCatInput, setNewCatInput] = useState("");

  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          members
            .filter((m) => m.work_status !== "퇴직")
            .map((m) => m.department)
            .filter(Boolean)
        )
      ),
    [members]
  );

  const loadNotices = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          canManage: boolean;
          categories: string[];
          notices: HqNoticeItem[];
        };
      }>("/api/hq/notices");
      if (res.data) {
        setCanManage(Boolean(res.data.canManage || isHrManager || isHqAdmin));
        setCategories(res.data.categories || []);
        const list = res.data.notices || [];
        setNotices(list);
        setSelectedNoticeId((prev) => {
          if (prev && list.some((x) => x.id === prev)) return prev;
          return list[0]?.id || "";
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [isHrManager, isHqAdmin]);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  const filteredNotices = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = notices.filter((n) => {
      if (n.status !== statusTab) return false;
      if (
        statusTab === "PUBLISHED" &&
        selectedCategory !== "ALL" &&
        n.category !== selectedCategory
      ) {
        return false;
      }
      if (pinnedOnly && !n.is_pinned) return false;
      if (kw) {
        const hay = `${n.title} ${n.content} ${n.author_name} ${n.category}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) {
        return a.is_pinned ? -1 : 1;
      }
      const diff =
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sortDesc ? diff : -diff;
    });
  }, [notices, statusTab, selectedCategory, pinnedOnly, keyword, sortDesc]);

  // 전체 공지 중 현재 선택된 공지 (탭을 바꿔도 우측 상세는 유지 — 203520 동일!)
  const activeNotice = useMemo(
    () =>
      notices.find((n) => n.id === selectedNoticeId) ||
      filteredNotices[0] ||
      notices[0] ||
      null,
    [notices, selectedNoticeId, filteredNotices]
  );

  const openCreateModal = () => {
    setEditorDraft({
      category: categories[0] || "공지사항",
      title: "",
      content: "",
      target_scope: "ALL",
      target_departments: [],
      status: "PUBLISHED",
      scheduled_at: "",
      expires_at: "",
      is_pinned: false,
    });
    setEditorOpen(true);
  };

  const openEditModal = (item: HqNoticeItem) => {
    setDetailMenuOpen(false);
    setEditorDraft({
      id: item.id,
      category: item.category,
      title: item.title,
      content: item.content,
      target_scope: item.target_scope,
      target_departments: item.target_departments || [],
      status: item.status,
      scheduled_at: item.scheduled_at ? item.scheduled_at.slice(0, 16) : "",
      expires_at: item.expires_at ? item.expires_at.slice(0, 10) : "",
      is_pinned: Boolean(item.is_pinned),
    });
    setEditorOpen(true);
  };

  const handleSaveNotice = async () => {
    if (!editorDraft) return;
    if (!editorDraft.content.trim() && !editorDraft.title.trim()) {
      alert("공지 제목 또는 본문 내용을 입력해주세요.");
      return;
    }
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { categories: string[]; notices: HqNoticeItem[] };
      }>("/api/hq/notices", {
        method: "POST",
        body: {
          action: "UPSERT",
          notice: {
            ...editorDraft,
            scheduled_at: editorDraft.scheduled_at
              ? new Date(editorDraft.scheduled_at).toISOString()
              : null,
            expires_at: editorDraft.expires_at
              ? `${editorDraft.expires_at}T23:59:59+09:00`
              : null,
          },
        },
      });
      if (res.data?.notices) {
        setNotices(res.data.notices);
        if (!editorDraft.id && res.data.notices[0]) {
          setSelectedNoticeId(res.data.notices[0].id);
        }
      }
      setEditorOpen(false);
    } catch (err: any) {
      alert(err?.message || "공지 저장 실패");
    }
  };

  const handleBulkOrSingleAction = async (
    ids: string[],
    subAction: "DELETE" | "HIDE" | "PUBLISH" | "PIN_TOGGLE"
  ) => {
    if (ids.length === 0) return;
    if (
      subAction === "DELETE" &&
      !confirm(`선택한 공지(${ids.length}건)를 삭제하시겠습니까?`)
    ) {
      return;
    }
    setDetailMenuOpen(false);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { notices: HqNoticeItem[] };
      }>("/api/hq/notices", {
        method: "POST",
        body: { action: "BULK_ACTION", ids, sub_action: subAction },
      });
      if (res.data?.notices) {
        setNotices(res.data.notices);
        setCheckedIds([]);
      }
    } catch (err: any) {
      alert(err?.message || "처리 실패");
    }
  };

  const handleToggleReaction = async (emoji: string) => {
    if (!activeNotice) return;
    setEmojiPopoverOpen(false);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { notices: HqNoticeItem[] };
      }>("/api/hq/notices", {
        method: "POST",
        body: {
          action: "TOGGLE_REACTION",
          notice_id: activeNotice.id,
          emoji,
        },
      });
      if (res.data?.notices) setNotices(res.data.notices);
    } catch {
      // ignore
    }
  };

  const handleSubmitComment = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeNotice || !commentText.trim()) return;
    const text = commentText.trim();
    setCommentText("");
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { notices: HqNoticeItem[] };
      }>("/api/hq/notices", {
        method: "POST",
        body: {
          action: "ADD_COMMENT",
          notice_id: activeNotice.id,
          content: text,
        },
      });
      if (res.data?.notices) setNotices(res.data.notices);
    } catch (err: any) {
      alert(err?.message || "댓글 등록 실패");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!activeNotice) return;
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { notices: HqNoticeItem[] };
      }>("/api/hq/notices", {
        method: "POST",
        body: {
          action: "DELETE_COMMENT",
          notice_id: activeNotice.id,
          comment_id: commentId,
        },
      });
      if (res.data?.notices) setNotices(res.data.notices);
    } catch {
      // ignore
    }
  };

  const emptyTabMeta: Record<
    HqNoticeStatus,
    { title: string; subtitle: string }
  > = {
    PUBLISHED: {
      title: "등록된 공지가 없어요.",
      subtitle: "회사의 주요 소식과 안내사항을 공지로 등록해 보세요.",
    },
    SCHEDULED: {
      title: "예약 중인 공지가 없어요.",
      subtitle: "게시 예정인 공지를 미리 확인할 수 있는 공간이에요.",
    },
    HIDDEN: {
      title: "숨김 처리된 공지가 없어요.",
      subtitle: "노출을 일시 중단한 공지를 모아볼 수 있어요.",
    },
    EXPIRED: {
      title: "만료된 공지가 없어요.",
      subtitle: "게시 기간이 종료된 지난 공지를 확인할 수 있어요.",
    },
  };

  const curIdxInFiltered = filteredNotices.findIndex(
    (n) => n.id === activeNotice?.id
  );

  return (
    <div
      onClick={() => {
        if (catDropdownOpen) setCatDropdownOpen(false);
        if (emojiPopoverOpen) setEmojiPopoverOpen(false);
        if (detailMenuOpen) setDetailMenuOpen(false);
      }}
      className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden"
    >
      {/* 상단 서브 헤더 바 (스크린샷 203508 동일) */}
      <div className="h-12 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
          <span>📢</span>
          <span>공지</span>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setCatDrafts([...categories]);
                  setNewCatInput("");
                  setCatModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1"
              >
                <span>공지 설정</span>
                <span className="text-[10px] text-slate-400">⌄</span>
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="px-3.5 py-1.5 rounded-lg bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold shadow-2xs"
              >
                공지 추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* 본문 좌·우 마스터-디테일 분할 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* =============================================================== */}
        {/* 좌측 공지 목록 패널 (w-[340px])                                 */}
        {/* =============================================================== */}
        <aside className="w-[330px] sm:w-[350px] border-r border-slate-200 flex flex-col shrink-0 bg-white">
          {/* 상태 탭 + 우측 검색/필터/정렬 아이콘 */}
          <div className="h-11 px-4 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4 text-xs">
              <div
                className="relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (statusTab !== "PUBLISHED") {
                      setStatusTab("PUBLISHED");
                    } else {
                      setCatDropdownOpen((p) => !p);
                    }
                  }}
                  className={`py-3 border-b-2 flex items-center gap-1 transition-colors ${
                    statusTab === "PUBLISHED"
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  <span>
                    {selectedCategory === "ALL" ? "전체" : selectedCategory}
                  </span>
                  <span className="text-[10px]">⌄</span>
                </button>

                {catDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 w-[150px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory("ALL");
                        setCatDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left ${
                        selectedCategory === "ALL"
                          ? "bg-slate-100 font-bold text-slate-900"
                          : "hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      전체 카테고리
                    </button>
                    {categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setSelectedCategory(c);
                          setCatDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left ${
                          selectedCategory === c
                            ? "bg-slate-100 font-bold text-slate-900"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(
                [
                  { key: "SCHEDULED", label: "게시 예약" },
                  { key: "HIDDEN", label: "숨김" },
                  { key: "EXPIRED", label: "만료" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatusTab(t.key)}
                  className={`py-3 border-b-2 transition-colors ${
                    statusTab === t.key
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <button
                type="button"
                onClick={() => setSearchOpen((p) => !p)}
                className={`w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-xs ${
                  searchOpen ? "text-slate-900 bg-slate-100" : ""
                }`}
                title="검색"
              >
                🔍
              </button>
              <button
                type="button"
                onClick={() => setPinnedOnly((p) => !p)}
                className={`w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-xs ${
                  pinnedOnly ? "text-blue-600 bg-blue-50" : ""
                }`}
                title="상단 고정 공지만 보기"
              >
                ≡
              </button>
              <button
                type="button"
                onClick={() => setSortDesc((p) => !p)}
                className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-xs"
                title={sortDesc ? "최신순" : "오래된순"}
              >
                ⇅
              </button>
            </div>
          </div>

          {/* 검색 바 (열렸을 때) */}
          {searchOpen && (
            <div className="px-4 py-2 border-b border-slate-100">
              <input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="공지 제목·내용·작성자 검색"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-100 text-xs focus:outline-none"
              />
            </div>
          )}

          {/* 목록 본문 */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
              불러오는 중...
            </div>
          ) : filteredNotices.length === 0 ? (
            /* 빈 상태 화면 (스크린샷 203520 동일) */
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-2">
              <div className="w-9 h-9 rounded-xl border border-dashed border-slate-300 text-slate-300 flex items-center justify-center text-base">
                📄
              </div>
              <div className="text-xs font-bold text-slate-600">
                {emptyTabMeta[statusTab].title}
              </div>
              <p className="text-[11px] text-slate-400">
                {emptyTabMeta[statusTab].subtitle}
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scroll">
              {/* 전체 선택 헤더 */}
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      filteredNotices.length > 0 &&
                      checkedIds.length === filteredNotices.length
                    }
                    onChange={(e) =>
                      setCheckedIds(
                        e.target.checked
                          ? filteredNotices.map((x) => x.id)
                          : []
                      )
                    }
                    className="rounded border-slate-300"
                  />
                  <span className="font-semibold">공지 목록</span>
                </label>

                {canManage && checkedIds.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        handleBulkOrSingleAction(
                          checkedIds,
                          statusTab === "HIDDEN" ? "PUBLISH" : "HIDE"
                        )
                      }
                      className="font-bold text-slate-600 hover:text-slate-900"
                    >
                      {statusTab === "HIDDEN" ? "게시 전환" : "숨김"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleBulkOrSingleAction(checkedIds, "DELETE")
                      }
                      className="font-bold text-rose-500 hover:text-rose-700"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>

              {/* 공지 카드 리스트 */}
              <div className="divide-y divide-slate-100">
                {filteredNotices.map((item) => {
                  const selected = activeNotice?.id === item.id;
                  const checked = checkedIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedNoticeId(item.id)}
                      className={`px-4 py-3.5 flex items-start gap-2.5 cursor-pointer transition-colors ${
                        selected ? "bg-[#f5f6f8]" : "hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setCheckedIds(
                            checked
                              ? checkedIds.filter((id) => id !== item.id)
                              : [...checkedIds, item.id]
                          )
                        }
                        className="mt-1 rounded border-slate-300 shrink-0"
                      />

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          {item.is_pinned && (
                            <span className="text-[11px]" title="상단 고정">
                              📌
                            </span>
                          )}
                          <span className="text-[13px] font-extrabold text-slate-900 truncate">
                            {item.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span
                            style={{
                              backgroundColor: avatarColor(item.author_name),
                            }}
                            className="w-4 h-4 rounded-full text-white text-[8px] font-extrabold flex items-center justify-center shrink-0"
                          >
                            {shortAvatarText(item.author_name)}
                          </span>
                          <span className="font-semibold text-slate-700">
                            {item.author_name}
                          </span>
                          <span>·</span>
                          <span>{item.category}</span>
                          <span>·</span>
                          <span className="text-slate-400">
                            {formatRelativeAgo(item.created_at)}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                          {item.content}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* =============================================================== */}
        {/* 우측 공지 상세 뷰어 & 댓글 영역                                 */}
        {/* =============================================================== */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {activeNotice ? (
            <>
              {/* 우측 상단 이동·공유·더보기 바 */}
              <div className="h-11 px-5 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    disabled={curIdxInFiltered <= 0}
                    onClick={() => {
                      if (curIdxInFiltered > 0) {
                        setSelectedNoticeId(
                          filteredNotices[curIdxInFiltered - 1].id
                        );
                      }
                    }}
                    className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 disabled:opacity-30 flex items-center justify-center text-xs"
                  >
                    ⌃
                  </button>
                  <button
                    type="button"
                    disabled={
                      curIdxInFiltered < 0 ||
                      curIdxInFiltered >= filteredNotices.length - 1
                    }
                    onClick={() => {
                      if (
                        curIdxInFiltered >= 0 &&
                        curIdxInFiltered < filteredNotices.length - 1
                      ) {
                        setSelectedNoticeId(
                          filteredNotices[curIdxInFiltered + 1].id
                        );
                      }
                    }}
                    className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 disabled:opacity-30 flex items-center justify-center text-xs"
                  >
                    ⌄
                  </button>
                  <span className="text-xs font-bold text-slate-800 truncate ml-1">
                    {activeNotice.title}
                  </span>
                </div>

                <div
                  className="flex items-center gap-1.5 relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/hq/notices?id=${activeNotice.id}`
                        );
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 1600);
                      } catch {
                        // ignore
                      }
                    }}
                    className="px-2 py-1 rounded hover:bg-slate-100 text-xs text-slate-500"
                    title="공지 링크 복사"
                  >
                    {copiedLink ? "✓ 복사됨" : "🔗"}
                  </button>

                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => setDetailMenuOpen((p) => !p)}
                        className="w-7 h-7 rounded hover:bg-slate-100 text-slate-500 flex items-center justify-center font-extrabold"
                      >
                        ⋯
                      </button>

                      {detailMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-[140px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30 text-xs">
                          <button
                            type="button"
                            onClick={() => openEditModal(activeNotice)}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                          >
                            공지 수정
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkOrSingleAction(
                                [activeNotice.id],
                                "PIN_TOGGLE"
                              )
                            }
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                          >
                            {activeNotice.is_pinned
                              ? "상단 고정 해제"
                              : "상단 고정"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkOrSingleAction(
                                [activeNotice.id],
                                activeNotice.status === "HIDDEN"
                                  ? "PUBLISH"
                                  : "HIDE"
                              )
                            }
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                          >
                            {activeNotice.status === "HIDDEN"
                              ? "숨김 해제(게시)"
                              : "숨김 처리"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkOrSingleAction(
                                [activeNotice.id],
                                "DELETE"
                              )
                            }
                            className="w-full px-3.5 py-2 text-left hover:bg-rose-50 font-semibold text-rose-600"
                          >
                            삭제하기
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 본문 스크롤 영역 */}
              <div className="flex-1 overflow-y-auto custom-scroll px-8 sm:px-16 py-10">
                <div className="max-w-[700px] mx-auto space-y-8">
                  {/* 제목 · 메타데이터 */}
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded bg-[#eef4ff] text-[#2b6de9] text-[11px] font-bold">
                      {activeNotice.category}
                    </span>

                    <h1 className="text-[24px] font-extrabold text-slate-900 tracking-tight mt-2">
                      {activeNotice.title}
                    </h1>

                    <div className="mt-5 flex flex-wrap items-start gap-8 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-400">작성자</div>
                        <div className="mt-1.5 flex items-center gap-1.5 font-semibold text-slate-800">
                          <span
                            style={{
                              backgroundColor: avatarColor(
                                activeNotice.author_name
                              ),
                            }}
                            className="w-5 h-5 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center"
                          >
                            {shortAvatarText(activeNotice.author_name)}
                          </span>
                          <span>{activeNotice.author_name}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">
                          공지 대상
                        </div>
                        <div className="mt-1.5 font-semibold text-slate-800">
                          {activeNotice.target_label}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400">게시일</div>
                        <div className="mt-1.5 font-semibold text-slate-800">
                          {formatKoreanFullDateTime(activeNotice.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-7">
                    <div className="text-[13.5px] text-slate-800 whitespace-pre-wrap leading-7">
                      {activeNotice.content}
                    </div>

                    {/* 이모지 리액션 바 */}
                    <div
                      className="mt-8 flex flex-wrap items-center gap-2 relative"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Object.entries(activeNotice.reactions || {}).map(
                        ([emoji, users]) => {
                          const iReacted =
                            me?.name && users.includes(me.name);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              title={users.join(", ")}
                              onClick={() => handleToggleReaction(emoji)}
                              className={`px-2.5 py-1 rounded-full border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                                iReacted
                                  ? "border-blue-300 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <span>{emoji}</span>
                              <span>{users.length}</span>
                            </button>
                          );
                        }
                      )}

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setEmojiPopoverOpen((p) => !p)}
                          className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold"
                          title="공감 남기기"
                        >
                          😊+
                        </button>

                        {emojiPopoverOpen && (
                          <div className="absolute left-0 bottom-full mb-1.5 px-2.5 py-1.5 rounded-full bg-white shadow-xl border border-slate-200 flex items-center gap-1.5 z-20">
                            {REACTION_EMOJIS.map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => handleToggleReaction(em)}
                                className="w-7 h-7 rounded-full hover:bg-slate-100 text-sm flex items-center justify-center"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 댓글 섹션 (스크린샷 203508 하단 동일) */}
                  <div className="border-t border-slate-100 pt-6 space-y-5">
                    <div className="text-xs font-bold text-slate-700">
                      댓글{" "}
                      <span className="text-slate-400">
                        {(activeNotice.comments || []).length}
                      </span>
                    </div>

                    {(activeNotice.comments || []).length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400">
                        첫 번째로 댓글을 남겨보세요!
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        {activeNotice.comments.map((cmt) => (
                          <div
                            key={cmt.id}
                            className="flex items-start justify-between gap-3 p-3.5 rounded-2xl bg-slate-50/80"
                          >
                            <div className="flex items-start gap-2.5">
                              <span
                                style={{
                                  backgroundColor: avatarColor(cmt.author_name),
                                }}
                                className="w-6 h-6 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center shrink-0 mt-0.5"
                              >
                                {shortAvatarText(cmt.author_name)}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-extrabold text-slate-800">
                                    {cmt.author_name}
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {formatKoreanFullDateTime(cmt.created_at)}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">
                                  {cmt.content}
                                </p>
                              </div>
                            </div>

                            {(canManage || cmt.author_name === me?.name) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(cmt.id)}
                                className="text-[11px] text-slate-400 hover:text-rose-500"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 댓글 입력창 */}
                    <form
                      onSubmit={handleSubmitComment}
                      className="rounded-xl bg-[#f7f8fa] border border-slate-200/70 p-3 flex items-end justify-between gap-2"
                    >
                      <textarea
                        rows={2}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmitComment();
                          }
                        }}
                        placeholder="댓글 남기기..."
                        className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                      />
                      <button
                        type="submit"
                        disabled={!commentText.trim()}
                        className="w-6 h-6 rounded-full bg-[#00c458] disabled:bg-emerald-200 text-white text-xs font-extrabold flex items-center justify-center shrink-0"
                        title="댓글 등록"
                      >
                        ↑
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
              좌측 목록에서 열람할 공지를 선택해주세요.
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 공지 작성 / 수정 모달                                     */}
      {/* ================================================================= */}
      {editorOpen && editorDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[640px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {editorDraft.id ? "공지 수정" : "새 공지 작성"}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    카테고리
                  </label>
                  <select
                    value={editorDraft.category}
                    onChange={(e) =>
                      setEditorDraft({
                        ...editorDraft,
                        category: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    공지 대상
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={editorDraft.target_scope}
                      onChange={(e) =>
                        setEditorDraft({
                          ...editorDraft,
                          target_scope: e.target.value as "ALL" | "DEPT",
                        })
                      }
                      className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
                    >
                      <option value="ALL">전사 구성원</option>
                      <option value="DEPT">특정 부서 선택</option>
                    </select>

                    <label className="flex items-center gap-1.5 ml-2 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editorDraft.is_pinned}
                        onChange={(e) =>
                          setEditorDraft({
                            ...editorDraft,
                            is_pinned: e.target.checked,
                          })
                        }
                        className="rounded border-slate-300"
                      />
                      <span>📌 상단 고정</span>
                    </label>
                  </div>
                </div>
              </div>

              {editorDraft.target_scope === "DEPT" && (
                <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  {departments.map((d) => {
                    const checked = editorDraft.target_departments.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setEditorDraft({
                            ...editorDraft,
                            target_departments: checked
                              ? editorDraft.target_departments.filter(
                                  (x) => x !== d
                                )
                              : [...editorDraft.target_departments, d],
                          })
                        }
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          checked
                            ? "border-[#00c458] bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  공지 제목
                </label>
                <input
                  value={editorDraft.title}
                  onChange={(e) =>
                    setEditorDraft({ ...editorDraft, title: e.target.value })
                  }
                  placeholder="공지 제목을 입력하세요"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] text-sm font-extrabold focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  본문 내용
                </label>
                <textarea
                  rows={9}
                  value={editorDraft.content}
                  onChange={(e) =>
                    setEditorDraft({ ...editorDraft, content: e.target.value })
                  }
                  placeholder="구성원들에게 안내할 내용을 입력하세요."
                  className="w-full p-3.5 rounded-xl bg-[#f5f6f8] leading-relaxed focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    게시 예약 일시 (비워두면 즉시 게시)
                  </label>
                  <input
                    type="datetime-local"
                    value={editorDraft.scheduled_at}
                    onChange={(e) =>
                      setEditorDraft({
                        ...editorDraft,
                        scheduled_at: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    게시 만료일 (선택)
                  </label>
                  <input
                    type="date"
                    value={editorDraft.expires_at}
                    onChange={(e) =>
                      setEditorDraft({
                        ...editorDraft,
                        expires_at: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveNotice}
                className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
              >
                {editorDraft.scheduled_at ? "예약 / 저장하기" : "게시하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: 공지 설정 (카테고리 관리)                                 */}
      {/* ================================================================= */}
      {catModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[400px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900">
                공지 카테고리 설정
              </h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newCatInput}
                  onChange={(e) => setNewCatInput(e.target.value)}
                  placeholder="새 카테고리명 입력"
                  className="flex-1 px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none font-semibold"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newCatInput.trim();
                    if (clean && !catDrafts.includes(clean)) {
                      setCatDrafts([...catDrafts, clean]);
                      setNewCatInput("");
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold"
                >
                  추가
                </button>
              </div>

              <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scroll">
                {catDrafts.map((c) => (
                  <div
                    key={c}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 flex items-center justify-between"
                  >
                    <span className="font-bold text-slate-800">{c}</span>
                    {catDrafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setCatDrafts(catDrafts.filter((x) => x !== c))
                        }
                        className="text-slate-400 hover:text-rose-500 font-bold"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await hqFetch<{
                    success: boolean;
                    data: { categories: string[] };
                  }>("/api/hq/notices", {
                    method: "POST",
                    body: { action: "SAVE_CATEGORIES", categories: catDrafts },
                  });
                  if (res.data?.categories) setCategories(res.data.categories);
                  setCatModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-[#00c458] text-white font-extrabold"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
