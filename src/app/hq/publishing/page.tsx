// src/app/hq/publishing/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import { PUB_PROOF_ROUNDS, PUB_STAGES } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqPublication,
  HqPubPriority,
  HqPubStage,
} from "@/lib/hq/types";

function getDDayBadge(dateStr?: string | null): {
  text: string;
  urgent: boolean;
} | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  const today = new Date(
    `${new Date().toISOString().slice(0, 10)}T00:00:00`
  ).getTime();
  if (Number.isNaN(target)) return null;
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `하판 D+${Math.abs(diff)} 지연`, urgent: true };
  if (diff === 0) return { text: "오늘 하판 마감!", urgent: true };
  if (diff <= 7) return { text: `하판 D-${diff}`, urgent: true };
  return { text: `하판 D-${diff}`, urgent: false };
}

export default function HqPublishingPage() {
  const router = useRouter();
  const { me, members } = useHqShell();

  const [books, setBooks] = useState<HqPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [keyword, setKeyword] = useState("");

  // 등록/수정 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<HqPublication | null>(null);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [seriesName, setSeriesName] = useState("사고력 수학");
  const [targetGrade, setTargetGrade] = useState("초등 3~4학년");
  const [stage, setStage] = useState<HqPubStage>("EDITING");
  const [proofRound, setProofRound] = useState<string>("초교");
  const [progressPct, setProgressPct] = useState("50");
  const [authorName, setAuthorName] = useState("");
  const [editorId, setEditorId] = useState("");
  const [editorName, setEditorName] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [isbn, setIsbn] = useState("");
  const [editionInfo, setEditionInfo] = useState("초판 1쇄");
  const [listPrice, setListPrice] = useState("15000");
  const [printRun, setPrintRun] = useState("2000");
  const [printVendor, setPrintVendor] = useState("");
  const [pressDeadline, setPressDeadline] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [priority, setPriority] = useState<HqPubPriority>("NORMAL");
  const [memo, setMemo] = useState("");

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { books: HqPublication[] };
      }>("/api/hq/publishing");
      setBooks(res.data?.books || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const openNewModal = (presetStage: HqPubStage = "PLANNING") => {
    const stMeta =
      PUB_STAGES.find((s) => s.code === presetStage) || PUB_STAGES[0];
    setEditing(null);
    setTitle("");
    setSubtitle("");
    setSeriesName("");
    setTargetGrade("");
    setStage(presetStage);
    setProofRound(presetStage === "EDITING" ? "초교" : "기획안");
    setProgressPct(String(stMeta.defaultPct));
    setAuthorName("천종현수학연구소");
    setEditorId(me?.instructor_id || "");
    setEditorName(me?.name || "");
    setDesignerName("");
    setIsbn("");
    setEditionInfo("초판 1쇄");
    setListPrice("15000");
    setPrintRun("2000");
    setPrintVendor("");
    setPressDeadline("");
    setPublishDate("");
    setPriority("NORMAL");
    setMemo("");
    setModalOpen(true);
  };

  const openEditModal = (b: HqPublication) => {
    setEditing(b);
    setTitle(b.title);
    setSubtitle(b.subtitle || "");
    setSeriesName(b.series_name || "");
    setTargetGrade(b.target_grade || "");
    setStage(b.stage);
    setProofRound(b.proof_round || "초교");
    setProgressPct(String(b.progress_pct));
    setAuthorName(b.author_name || "");
    setEditorId(b.editor_id || "");
    setEditorName(b.editor_name || "");
    setDesignerName(b.designer_name || "");
    setIsbn(b.isbn || "");
    setEditionInfo(b.edition_info || "초판 1쇄");
    setListPrice(String(b.list_price || 0));
    setPrintRun(String(b.print_run || 0));
    setPrintVendor(b.print_vendor || "");
    setPressDeadline(b.press_deadline || "");
    setPublishDate(b.publish_date || "");
    setPriority(b.priority);
    setMemo(b.memo || "");
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        pub_id: editing?.pub_id,
        title,
        subtitle,
        series_name: seriesName,
        target_grade: targetGrade,
        stage,
        proof_round: proofRound,
        progress_pct: Number(progressPct || 0),
        author_name: authorName,
        editor_id: editorId || null,
        editor_name: editorName,
        designer_name: designerName,
        isbn,
        edition_info: editionInfo,
        list_price: Number(listPrice || 0),
        print_run: Number(printRun || 0),
        print_vendor: printVendor,
        press_deadline: pressDeadline || null,
        publish_date: publishDate || null,
        priority,
        memo,
      };

      await hqFetch("/api/hq/publishing", {
        method: editing ? "PATCH" : "POST",
        body: payload,
      });
      setModalOpen(false);
      await loadBooks();
    } catch (err: any) {
      alert(err?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleAdvanceStage = async (
    e: React.MouseEvent,
    book: HqPublication
  ) => {
    e.stopPropagation();
    const idx = PUB_STAGES.findIndex((s) => s.code === book.stage);
    if (idx < 0 || idx >= PUB_STAGES.length - 1) return;
    const nextStage = PUB_STAGES[idx + 1];
    try {
      await hqFetch("/api/hq/publishing", {
        method: "PATCH",
        body: {
          pub_id: book.pub_id,
          quick_stage: nextStage.code,
        },
      });
      await loadBooks();
    } catch (err: any) {
      alert(err?.message || "단계 이동 실패");
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`「${editing.title}」 공정 항목을 삭제하시겠습니까?`)) return;
    try {
      await hqFetch(`/api/hq/publishing?id=${editing.pub_id}`, {
        method: "DELETE",
      });
      setModalOpen(false);
      await loadBooks();
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    }
  };

  const filteredBooks = useMemo(() => {
    if (!keyword.trim()) return books;
    const q = keyword.trim().toLowerCase();
    return books.filter((b) =>
      `${b.title} ${b.series_name || ""} ${b.author_name || ""} ${
        b.editor_name || ""
      } ${b.isbn || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [books, keyword]);

  const stats = useMemo(() => {
    const inProgress = books.filter((b) => b.stage !== "PUBLISHED").length;
    const editingOrProof = books.filter(
      (b) => b.stage === "EDITING" || b.stage === "PROOF_FINAL"
    ).length;
    const urgentDeadlines = books.filter((b) => {
      if (b.stage === "PUBLISHED") return false;
      const d = getDDayBadge(b.press_deadline);
      return Boolean(d?.urgent);
    }).length;
    const published = books.filter((b) => b.stage === "PUBLISHED").length;
    return { inProgress, editingOrProof, urgentDeadlines, published };
  }, [books]);

  return (
    <div className="p-6 max-w-[1480px] mx-auto w-full space-y-6">
      {/* 상단 KPI & 컨트롤 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold text-slate-500">제작 진행중 도서</div>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {stats.inProgress}종
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            기획 · 집필 · 교정 · 디자인 · 인쇄 공정 합계
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold text-slate-500">
            교정 · ISBN 검수 집중 단계
          </div>
          <div className="text-2xl font-black text-indigo-600 mt-1">
            {stats.editingOrProof}종
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            초교 · 재교 · 삼교 · 최종교열 진행중
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold text-slate-500">
            7일 이내 하판(인쇄) 마감 임박
          </div>
          <div className="text-2xl font-black text-rose-600 mt-1">
            {stats.urgentDeadlines}종
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            인쇄 발주 품의 및 감리 외근 일정 연동 권장
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold text-slate-500">
            출간 · 입고 완료 (ISBN 마스터)
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1">
            {stats.published}종
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            중쇄 발주 및 저자 인세 정산 기준 데이터
          </div>
        </div>
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("board")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold ${
              viewMode === "board"
                ? "bg-brand text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            🗂️ 7단계 공정 칸반 보드
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold ${
              viewMode === "table"
                ? "bg-brand text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            📋 ISBN · 판권 마스터 대장
          </button>

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="도서명, 시리즈, 담당편집자, ISBN 검색..."
            className="ml-2 px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold w-64"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/hq/contracts")}
            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
          >
            📑 저자·외주 전자계약
          </button>
          <button
            type="button"
            onClick={() => router.push("/hq/approvals?new=1&type=PURCHASE")}
            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
          >
            🛒 인쇄 발주 품의
          </button>
          <button
            type="button"
            onClick={() => openNewModal("PLANNING")}
            className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-sm"
          >
            + 신간 · 중쇄 공정 등록
          </button>
        </div>
      </div>

      {/* 뷰 1: 7단계 칸반 보드 */}
      {viewMode === "board" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3 items-start">
          {PUB_STAGES.map((st) => {
            const colBooks = filteredBooks.filter((b) => b.stage === st.code);
            return (
              <div
                key={st.code}
                className={`rounded-2xl bg-slate-100/80 border border-slate-200 border-t-4 ${st.headerClass} p-3 space-y-2.5`}
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-extrabold text-slate-800">
                    {st.shortLabel}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-slate-700 text-[11px] font-extrabold border border-slate-200">
                    {colBooks.length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[120px]">
                  {colBooks.map((b) => {
                    const dday = getDDayBadge(b.press_deadline);
                    return (
                      <div
                        key={b.pub_id}
                        onClick={() => openEditModal(b)}
                        className="p-3 rounded-xl bg-white border border-slate-200 hover:border-brand shadow-xs cursor-pointer transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {b.edition_info || "초판"} · {b.proof_round || "진행"}
                          </span>
                          {b.priority === "HIGH" && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                              긴급
                            </span>
                          )}
                        </div>

                        <div>
                          {b.series_name && (
                            <div className="text-[10px] font-bold text-brand">
                              {b.series_name}
                            </div>
                          )}
                          <div className="text-xs font-extrabold text-slate-900 leading-snug">
                            {b.title}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500 space-y-0.5">
                          <div>편집: {b.editor_name || "미지정"}</div>
                          {b.designer_name && (
                            <div>디자인: {b.designer_name}</div>
                          )}
                        </div>

                        {dday && b.stage !== "PUBLISHED" && (
                          <div
                            className={`px-2 py-1 rounded-lg text-[10px] font-extrabold text-center ${
                              dday.urgent
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-slate-50 text-slate-600"
                            }`}
                          >
                            ⏰ {dday.text} ({b.press_deadline})
                          </div>
                        )}

                        {st.code !== "PUBLISHED" && (
                          <button
                            type="button"
                            onClick={(e) => handleAdvanceStage(e, b)}
                            className="w-full py-1 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-brand text-[11px] font-bold border border-slate-200 transition-colors"
                          >
                            다음 공정으로 이동 ▶
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => openNewModal(st.code)}
                    className="w-full py-2 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:text-slate-600 hover:border-slate-400 text-[11px] font-bold"
                  >
                    + 추가
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* 뷰 2: ISBN · 판권 마스터 대장 */
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase">
                  <th className="py-3 px-4">코드 / 공정단계</th>
                  <th className="py-3 px-4">도서명 · 시리즈</th>
                  <th className="py-3 px-4">쇄수 / 교정차수</th>
                  <th className="py-3 px-4">ISBN / 정가 / 부수</th>
                  <th className="py-3 px-4">담당 편집 · 디자인 · 저자</th>
                  <th className="py-3 px-4">하판 마감일 / 출간일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      도서 목록을 불러오는 중입니다...
                    </td>
                  </tr>
                ) : filteredBooks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      등록된 도서 공정이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredBooks.map((b) => {
                    const stMeta = PUB_STAGES.find((s) => s.code === b.stage);
                    return (
                      <tr
                        key={b.pub_id}
                        onClick={() => openEditModal(b)}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono text-[11px] text-slate-400">
                            {b.book_code}
                          </div>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded border text-[10px] font-bold ${stMeta?.badgeClass}`}
                          >
                            {stMeta?.shortLabel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-slate-900">
                            {b.title}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {[b.series_name, b.target_grade]
                              .filter(Boolean)
                              .join(" · ") || "-"}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-700">
                          {b.edition_info || "초판 1쇄"} · {b.proof_round || "-"}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono text-[11px] font-bold text-slate-800">
                            {b.isbn || "ISBN 미발급"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            정가 {b.list_price.toLocaleString()}원 ·{" "}
                            {b.print_run.toLocaleString()}부
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-700">
                          편집 {b.editor_name || "-"} / 디자인{" "}
                          {b.designer_name || "-"} / 저자 {b.author_name || "-"}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-rose-600">
                            하판: {b.press_deadline || "-"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            출간: {b.publish_date || "-"}
                          </div>
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

      {/* 도서 등록 · 수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto custom-scroll p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-extrabold text-slate-900">
                {editing ? "도서 제작 공정 · 판권 정보 수정" : "새 도서 공정 등록"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    도서명 (또는 신간 가제) *
                  </label>
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예: 천종현 사고력 수학 플라토 P3 개정판"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    우선순위
                  </label>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as HqPubPriority)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    <option value="NORMAL">일반 진행</option>
                    <option value="HIGH">🔥 긴급 마감</option>
                    <option value="LOW">장기 기획</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    시리즈명
                  </label>
                  <input
                    value={seriesName}
                    onChange={(e) => setSeriesName(e.target.value)}
                    placeholder="예: 플라토 / 소마셈"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    대상 학년/독자
                  </label>
                  <input
                    value={targetGrade}
                    onChange={(e) => setTargetGrade(e.target.value)}
                    placeholder="예: 초등 2~3학년"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    판수 · 쇄수
                  </label>
                  <input
                    value={editionInfo}
                    onChange={(e) => setEditionInfo(e.target.value)}
                    placeholder="예: 초판 1쇄 / 개정판 3쇄"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    현재 공정 단계
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => {
                      const next = e.target.value as HqPubStage;
                      setStage(next);
                      const st = PUB_STAGES.find((s) => s.code === next);
                      if (st) setProgressPct(String(st.defaultPct));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    {PUB_STAGES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    세부 교정 차수
                  </label>
                  <select
                    value={proofRound}
                    onChange={(e) => setProofRound(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    {PUB_PROOF_ROUNDS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    공정 진행률 (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={progressPct}
                    onChange={(e) => setProgressPct(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    담당 편집자 (본부 구성원)
                  </label>
                  <select
                    value={editorId}
                    onChange={(e) => {
                      setEditorId(e.target.value);
                      const m = activeMembers.find(
                        (x) => x.instructor_id === e.target.value
                      );
                      if (m) setEditorName(m.name);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    <option value="">직접 입력 / 미지정</option>
                    {activeMembers.map((m) => (
                      <option key={m.instructor_id} value={m.instructor_id}>
                        {m.name} ({m.department})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    표지·내지 디자이너
                  </label>
                  <input
                    value={designerName}
                    onChange={(e) => setDesignerName(e.target.value)}
                    placeholder="내부 또는 외주 디자이너명"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    대표 저자 / 연구진
                  </label>
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    ISBN-13 번호
                  </label>
                  <input
                    value={isbn}
                    onChange={(e) => setIsbn(e.target.value)}
                    placeholder="979-11-XXXX-XXX-X"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    정가 (원)
                  </label>
                  <input
                    type="number"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    인쇄 부수 (부)
                  </label>
                  <input
                    type="number"
                    value={printRun}
                    onChange={(e) => setPrintRun(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    하판(인쇄 넘김) 마감일
                  </label>
                  <input
                    type="date"
                    value={pressDeadline}
                    onChange={(e) => setPressDeadline(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-rose-300 bg-rose-50/30 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    출간 · 입고 예정일
                  </label>
                  <input
                    type="date"
                    value={publishDate}
                    onChange={(e) => setPublishDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    거래 인쇄소 · 제본소
                  </label>
                  <input
                    value={printVendor}
                    onChange={(e) => setPrintVendor(e.target.value)}
                    placeholder="예: 파주 OO프린팅"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  편집 · 제작 특이사항 메모
                </label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="예: 표지 무광코팅 + 별책 정답지 32p 합본 제본"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                {editing ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-bold"
                  >
                    삭제
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold disabled:opacity-50"
                  >
                    저장하기
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
