// src/app/(hq)/hq/publishing/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import { CONTRACT_CATEGORIES, PUB_PROOF_ROUNDS, PUB_STAGES } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";
import {
  ADDON_FORM_OPTIONS,
  ADDON_KDC_PRESETS,
  ADDON_READER_OPTIONS,
  addDaysIso,
  buildColophonText,
  completeOrFormatIsbn13,
  contractMatchesBook,
  describeAddOnCode,
  formatEditionLabel,
  getLegalDepositInfo,
  getPrintHistory,
  getStageGateIssues,
  isInHouseAuthor,
  LEGAL_DEPOSIT_DAYS,
  stageIndex,
  sumPrintedCopies,
  validateIsbn13,
} from "@/lib/hq/publishingRights";
import type {
  HqContract,
  HqIsbnStatus,
  HqLegalDepositStatus,
  HqPublication,
  HqPublicationMeta,
  HqPubPriority,
  HqPubStage,
} from "@/lib/hq/types";

function getDDayBadge(dateStr?: string | null): {
  text: string;
  urgent: boolean;
} | null {
  if (!dateStr) return null;
  const [ty, tm, td] = dateStr.slice(0, 10).split("-").map(Number);
  if (!ty || !tm || !td) return null;

  const target = new Date(ty, tm - 1, td).getTime();
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  if (Number.isNaN(target)) return null;
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `하판 D+${Math.abs(diff)} 지연`, urgent: true };
  if (diff === 0) return { text: "오늘 하판 마감!", urgent: true };
  if (diff <= 7) return { text: `하판 D-${diff}`, urgent: true };
  return { text: `하판 D-${diff}`, urgent: false };
}

const ISBN_STATUS_LABEL: Record<HqIsbnStatus, string> = {
  NONE: "미신청",
  APPLIED: "발행번호 신청중",
  ISSUED: "발급 완료",
};

const DEPOSIT_STATUS_LABEL: Record<HqLegalDepositStatus, string> = {
  NONE: "미납본",
  SUBMITTED: "납본 발송(수령 대기)",
  DONE: "납본 완료",
};

function effectiveIsbnStatus(b: HqPublication): HqIsbnStatus {
  const s = b.pub_meta?.isbn_status;
  if (s) return s;
  return validateIsbn13(b.isbn).ok ? "ISSUED" : "NONE";
}

export default function HqPublishingPage() {
  const router = useRouter();
  const hqHref = useHqHref();
  const { me, members, companySettings, isHrManager } = useHqShell();

  const [books, setBooks] = useState<HqPublication[]>([]);
  const [contracts, setContracts] = useState<HqContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [extSchemaMissing, setExtSchemaMissing] = useState(false);
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

  // ISBN · CIP · 납본 · 판권면
  const [isbnStatus, setIsbnStatus] = useState<HqIsbnStatus>("NONE");
  const [isbnAppliedAt, setIsbnAppliedAt] = useState("");
  const [addOnCode, setAddOnCode] = useState("");
  const [setIsbnVal, setSetIsbnVal] = useState("");
  const [ebookIsbnVal, setEbookIsbnVal] = useState("");
  const [cipNo, setCipNo] = useState("");
  const [colophonChecked, setColophonChecked] = useState(false);
  const [barcodeReady, setBarcodeReady] = useState(false);
  const [depositStatus, setDepositStatus] = useState<HqLegalDepositStatus>("NONE");
  const [depositDate, setDepositDate] = useState("");
  const [colophonPreviewOpen, setColophonPreviewOpen] = useState(false);
  const [colophonCopied, setColophonCopied] = useState(false);

  // 중쇄 · 개정판 등록
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintKind, setReprintKind] = useState<"REPRINT" | "NEW_EDITION">("REPRINT");
  const [reprintCopies, setReprintCopies] = useState("1000");
  const [reprintDate, setReprintDate] = useState("");
  const [reprintVendor, setReprintVendor] = useState("");
  const [reprintIsbn, setReprintIsbn] = useState("");
  const [reprintMemo, setReprintMemo] = useState("");

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await hqFetch<{
        success: boolean;
        schemaMissing?: boolean;
        data: { books: HqPublication[]; extSchemaMissing?: boolean };
      }>("/api/hq/publishing");
      setSchemaMissing(Boolean(res.schemaMissing));
      setExtSchemaMissing(Boolean(res.data?.extSchemaMissing));
      setBooks(res.data?.books || []);
    } catch (err: any) {
      setLoadError(err?.message || "출판 공정 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContracts = useCallback(async () => {
    try {
      const res = await hqFetch<{ success: boolean; data: { contracts: HqContract[] } }>(
        "/api/hq/contracts"
      );
      setContracts(
        (res.data?.contracts || []).filter(
          (c) => c.category === "ROYALTY" || c.category === "OUTSOURCING"
        )
      );
    } catch {
      // 계약 열람 권한이 없으면 계약 연동 정보만 비어 보임
    }
  }, []);

  useEffect(() => {
    loadBooks();
    loadContracts();
  }, [loadBooks, loadContracts]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const contractsOf = useCallback(
    (b: HqPublication) => contracts.filter((c) => contractMatchesBook(c, b)),
    [contracts]
  );

  const canCreateContract = Boolean(isHrManager || (me && me.rank_level >= 3));

  const resetMetaForm = (meta?: HqPublicationMeta | null, bookIsbn?: string | null) => {
    const m = meta || {};
    setIsbnStatus(m.isbn_status || (validateIsbn13(bookIsbn).ok ? "ISSUED" : "NONE"));
    setIsbnAppliedAt(m.isbn_applied_at || "");
    setAddOnCode(m.add_on_code || "");
    setSetIsbnVal(m.set_isbn || "");
    setEbookIsbnVal(m.ebook_isbn || "");
    setCipNo(m.cip_no || "");
    setColophonChecked(Boolean(m.colophon_checked));
    setBarcodeReady(Boolean(m.barcode_ready));
    setDepositStatus(m.legal_deposit_status || "NONE");
    setDepositDate(m.legal_deposit_date || "");
    setColophonPreviewOpen(false);
    setColophonCopied(false);
  };

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
    resetMetaForm(null, null);
    setAddOnCode("63410"); // 초등 학습참고서 · 단행본 · 수학 (기본 제안)
    setReprintOpen(false);
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
    setProgressPct(String(b.progress_pct ?? 0));
    setAuthorName(b.author_name || "");
    setEditorId(b.editor_id || "");
    setEditorName(b.editor_name || "");
    setDesignerName(b.designer_name || "");
    setIsbn(b.isbn || "");
    setEditionInfo(b.edition_info || "초판 1쇄");
    setListPrice(String(b.list_price ?? 0));
    setPrintRun(String(b.print_run ?? 0));
    setPrintVendor(b.print_vendor || "");
    setPressDeadline(b.press_deadline || "");
    setPublishDate(b.publish_date || "");
    setPriority(b.priority || "NORMAL");
    setMemo(b.memo || "");
    resetMetaForm(b.pub_meta, b.isbn);
    setReprintOpen(false);
    setReprintKind("REPRINT");
    setReprintCopies(String(b.print_run || 1000));
    setReprintDate(new Date().toISOString().slice(0, 10));
    setReprintVendor(b.print_vendor || "");
    setReprintIsbn("");
    setReprintMemo("");
    setModalOpen(true);
  };

  const isbnCheck = useMemo(() => validateIsbn13(isbn), [isbn]);
  const setIsbnCheck = useMemo(() => validateIsbn13(setIsbnVal), [setIsbnVal]);
  const ebookIsbnCheck = useMemo(() => validateIsbn13(ebookIsbnVal), [ebookIsbnVal]);
  const addOnInfo = useMemo(() => describeAddOnCode(addOnCode), [addOnCode]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isbn.trim() && !isbnCheck.ok) {
      alert(`ISBN을 확인해 주세요: ${isbnCheck.message}`);
      return;
    }
    if (setIsbnVal.trim() && !setIsbnCheck.ok) {
      alert(`세트 ISBN을 확인해 주세요: ${setIsbnCheck.message}`);
      return;
    }
    if (ebookIsbnVal.trim() && !ebookIsbnCheck.ok) {
      alert(`전자책 ISBN을 확인해 주세요: ${ebookIsbnCheck.message}`);
      return;
    }
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
        editor_name: editorName.trim() || null,
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
        pub_meta: {
          isbn_status: isbnCheck.ok ? "ISSUED" : isbnStatus,
          isbn_applied_at: isbnAppliedAt || undefined,
          add_on_code: addOnCode,
          set_isbn: setIsbnVal.trim() || undefined,
          ebook_isbn: ebookIsbnVal.trim() || undefined,
          cip_no: cipNo,
          colophon_checked: colophonChecked,
          barcode_ready: barcodeReady,
          legal_deposit_status: depositStatus,
          legal_deposit_date:
            depositStatus === "NONE" ? undefined : depositDate || undefined,
        },
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

  const handleReprint = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await hqFetch("/api/hq/publishing", {
        method: "PATCH",
        body: {
          action: "REPRINT",
          pub_id: editing.pub_id,
          kind: reprintKind,
          copies: Number(reprintCopies || 0),
          print_date: reprintDate,
          vendor: reprintVendor,
          isbn: reprintKind === "NEW_EDITION" ? reprintIsbn : undefined,
          memo: reprintMemo,
        },
      });
      setModalOpen(false);
      await loadBooks();
      const linked = contractsOf(editing).filter(
        (c) => c.category === "ROYALTY" && c.status === "SIGNED"
      );
      alert(
        `${reprintKind === "NEW_EDITION" ? "개정판" : "중쇄"} 발행 이력이 등록되었습니다.` +
          (linked.length > 0
            ? `\n\n발행부수 기준 인세 계약 ${linked.length}건이 있다면 [전자계약 > 저작권·인세 대장]에 '미정산 쇄'로 표시됩니다.`
            : "") +
          (reprintKind === "NEW_EDITION"
            ? "\n\n개정판은 판권면 검수·바코드·납본을 새로 진행해야 합니다."
            : "")
      );
    } catch (err: any) {
      alert(err?.message || "쇄 이력 등록 실패");
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

    // Stage Gate: 다음 공정 진입 전 누락 항목 점검
    const issues = getStageGateIssues(book, nextStage.code, contractsOf(book));
    if (issues.length > 0) {
      const blocks = issues.filter((i) => i.level === "BLOCK");
      const msg =
        `「${book.title}」 → ${nextStage.label} 이동 전 점검 결과\n\n` +
        issues.map((i) => `${i.level === "BLOCK" ? "⛔" : "⚠️"} ${i.text}`).join("\n") +
        (blocks.length > 0
          ? "\n\n⛔ 항목은 인쇄 사고·저작권 분쟁으로 이어질 수 있습니다. 그래도 이동하시겠습니까?"
          : "\n\n그대로 다음 공정으로 이동하시겠습니까?");
      if (!confirm(msg)) return;
    }

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
    // ISBN 미발급인데 최종교열 이후 / 납본 미완료 출간 도서
    const isbnPending = books.filter(
      (b) =>
        stageIndex(b.stage) >= stageIndex("PROOF_FINAL") &&
        b.stage !== "PUBLISHED" &&
        effectiveIsbnStatus(b) !== "ISSUED"
    ).length;
    const depositPending = books.filter((b) => {
      const d = getLegalDepositInfo(b);
      return d.required && !d.done;
    }).length;
    return { inProgress, editingOrProof, urgentDeadlines, published, isbnPending, depositPending };
  }, [books]);

  const exportIsbnLedgerCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "도서코드",
      "도서명",
      "부제",
      "시리즈",
      "저자",
      "낱권 ISBN",
      "부가기호",
      "세트 ISBN",
      "전자책 ISBN",
      "CIP",
      "정가",
      "현재 판쇄",
      "누적 발행부수",
      "최초 발행일",
      "납본 상태",
      "납본일",
      "공정 단계",
    ];
    const rows = books.map((b) => {
      const meta = b.pub_meta || {};
      const hist = getPrintHistory(b);
      return [
        b.book_code,
        b.title,
        b.subtitle || "",
        b.series_name || "",
        b.author_name || "",
        b.isbn || "",
        meta.add_on_code || "",
        meta.set_isbn || "",
        meta.ebook_isbn || "",
        meta.cip_no || "",
        b.list_price,
        b.edition_info || "",
        sumPrintedCopies(b),
        hist[0]?.print_date || b.publish_date || "",
        DEPOSIT_STATUS_LABEL[meta.legal_deposit_status || "NONE"],
        meta.legal_deposit_date || "",
        PUB_STAGES.find((s) => s.code === b.stage)?.shortLabel || b.stage,
      ]
        .map(esc)
        .join(",");
    });
    const blob = new Blob(["\uFEFF" + [header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ISBN_판권_마스터대장_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const editingContracts = editing ? contractsOf(editing) : [];
  const editingHistory = editing ? getPrintHistory(editing) : [];
  const editingDeposit = editing
    ? getLegalDepositInfo({
        stage: editing.stage,
        publish_date: publishDate || editing.publish_date,
        pub_meta: { ...(editing.pub_meta || {}), legal_deposit_status: depositStatus },
      })
    : null;

  return (
    <div className="p-6 max-w-[1480px] mx-auto w-full space-y-6">
      {(schemaMissing || loadError) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900 flex items-center justify-between gap-3">
          <span>
            {schemaMissing
              ? "hq_publication 테이블이 아직 생성되지 않았습니다. Supabase SQL 패치를 먼저 실행해 주세요."
              : `데이터 조회 오류: ${loadError}`}
          </span>
          <button
            type="button"
            onClick={loadBooks}
            className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0"
          >
            다시 시도
          </button>
        </div>
      )}
      {!schemaMissing && extSchemaMissing && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
          ⚠️ ISBN 상태 · 부가기호 · 납본 · 쇄 이력을 저장하려면 Supabase SQL Editor에서{" "}
          <code className="px-1 bg-white rounded">supabase/hq_patch_publishing_rights.sql</code>을 1회 실행해 주세요.
          (실행 전에는 기본 공정 정보만 저장됩니다)
        </div>
      )}

      {/* 상단 KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
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
            교정 집중 단계
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

        <div className="rounded-2xl bg-white border border-amber-200 p-5 shadow-xs">
          <div className="text-xs font-bold text-slate-500">
            ISBN 미발급 · 납본 미완료
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {stats.isbnPending} / {stats.depositPending}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            최종교열 이후 ISBN 미발급 / 출간 후 {LEGAL_DEPOSIT_DAYS}일 내 납본 대상
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
          {viewMode === "table" && (
            <button
              type="button"
              onClick={exportIsbnLedgerCsv}
              className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
            >
              ⤓ ISBN 대장 CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push(hqHref("/hq/contracts?view=RIGHTS"))}
            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
          >
            📜 저작권 · 인세 대장
          </button>
          <button
            type="button"
            onClick={() => router.push(hqHref("/hq/approvals?new=1&type=PURCHASE"))}
            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
          >
            🛒 인쇄 발주 품의
          </button>
          <button
            type="button"
            onClick={() => openNewModal("PLANNING")}
            className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-sm"
          >
            + 신간 공정 등록
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
                    const isbnSt = effectiveIsbnStatus(b);
                    const deposit = getLegalDepositInfo(b);
                    const linked = contractsOf(b);
                    const needsContract =
                      !isInHouseAuthor(b.author_name) &&
                      stageIndex(b.stage) >= stageIndex("EDITING") &&
                      !linked.some((c) => c.category === "ROYALTY" && c.status === "SIGNED");
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

                        <div className="flex flex-wrap gap-1">
                          {stageIndex(b.stage) >= stageIndex("DESIGN") && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isbnSt === "ISSUED"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : isbnSt === "APPLIED"
                                  ? "bg-sky-50 text-sky-700"
                                  : "bg-amber-50 text-amber-800"
                              }`}
                            >
                              ISBN {ISBN_STATUS_LABEL[isbnSt]}
                            </span>
                          )}
                          {needsContract && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold">
                              저자계약 미체결
                            </span>
                          )}
                          {linked.some((c) => c.status === "SENT") && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">
                              계약 서명대기
                            </span>
                          )}
                          {deposit.required && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                deposit.done
                                  ? "bg-emerald-50 text-emerald-700"
                                  : (deposit.daysLeft ?? 99) <= 7
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {deposit.label}
                            </span>
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
                  <th className="py-3 px-4">판쇄 / 누적 발행</th>
                  <th className="py-3 px-4">ISBN · 부가기호 / 정가</th>
                  <th className="py-3 px-4">담당 편집 · 저자 · 계약</th>
                  <th className="py-3 px-4">하판 / 발행일 / 납본</th>
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
                    const v = validateIsbn13(b.isbn);
                    const deposit = getLegalDepositInfo(b);
                    const linked = contractsOf(b);
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
                            className={`inline-block mt-1 px-2 py-0.5 rounded border text-[10px] font-bold ${stMeta?.badgeClass || ""}`}
                          >
                            {stMeta?.shortLabel || b.stage}
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
                          <div className="text-[11px] text-slate-500 font-semibold">
                            누적 {sumPrintedCopies(b).toLocaleString()}부 · 쇄 이력{" "}
                            {getPrintHistory(b).length}건
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div
                            className={`font-mono text-[11px] font-bold ${
                              b.isbn && !v.ok ? "text-rose-600" : "text-slate-800"
                            }`}
                          >
                            {b.isbn || `ISBN ${ISBN_STATUS_LABEL[effectiveIsbnStatus(b)]}`}
                            {b.isbn && !v.ok && " ⚠"}
                            {b.pub_meta?.add_on_code ? ` · ${b.pub_meta.add_on_code}` : ""}
                          </div>
                          {b.pub_meta?.set_isbn && (
                            <div className="font-mono text-[10px] text-slate-500">
                              세트 {b.pub_meta.set_isbn}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500">
                            정가 {(b.list_price ?? 0).toLocaleString()}원 ·{" "}
                            {(b.print_run ?? 0).toLocaleString()}부
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-700">
                          편집 {b.editor_name || "-"} / 저자 {b.author_name || "-"}
                          <div className="text-[11px] text-slate-500">
                            계약 {linked.filter((c) => c.status === "SIGNED").length}건 체결
                            {linked.some((c) => c.status === "SENT") && " · 서명대기 있음"}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-rose-600">
                            하판: {b.press_deadline || "-"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            발행: {b.publish_date || "-"}
                          </div>
                          {deposit.required && (
                            <div
                              className={`text-[11px] font-bold ${
                                deposit.done ? "text-emerald-700" : "text-amber-700"
                              }`}
                            >
                              {deposit.label}
                            </div>
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

      {/* 도서 등록 · 수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto custom-scroll p-6 shadow-2xl border border-slate-200">
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
                    placeholder="예: 초판 1쇄 / 2판 3쇄"
                    disabled={Boolean(editing && editingHistory.length > 0)}
                    title={
                      editing && editingHistory.length > 0
                        ? "쇄 이력이 있는 도서는 아래 [중쇄 · 개정판 등록]으로만 변경됩니다"
                        : undefined
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold disabled:bg-slate-50"
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
                      const nextId = e.target.value;
                      setEditorId(nextId);
                      if (!nextId) {
                        setEditorName("");
                      } else {
                        const m = activeMembers.find(
                          (x) => x.instructor_id === nextId
                        );
                        if (m) setEditorName(m.name);
                      }
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
                  {!editorId && (
                    <input
                      value={editorName}
                      onChange={(e) => setEditorName(e.target.value)}
                      placeholder="편집자명 직접 입력 (비우면 미지정)"
                      className="mt-1.5 w-full px-3 py-2 rounded-xl border border-slate-300"
                    />
                  )}
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
                    placeholder="예: 천종현수학연구소"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    사내 연구진 외 외부 저자명이면 인쇄 전 출판권 계약 체결 여부를 점검합니다.
                  </p>
                </div>
              </div>

              {/* ISBN · 판권 · 납본 */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold text-slate-800">
                    🏷️ ISBN · 판권면 · 납본 (국립중앙도서관 서지정보유통지원시스템 기준)
                  </span>
                  <button
                    type="button"
                    onClick={() => setColophonPreviewOpen((v) => !v)}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-700"
                  >
                    {colophonPreviewOpen
                      ? "판권면 문안 접기"
                      : "🖨️ 판권면(인디자인용) 문안 자동생성"}
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700">
                        낱권 ISBN-13
                      </label>
                      {isbn.replace(/\D/g, "").length >= 12 && (
                        <button
                          type="button"
                          onClick={() => setIsbn(completeOrFormatIsbn13(isbn))}
                          className="text-[10.5px] font-extrabold text-brand hover:underline"
                        >
                          체크기호·하이픈 자동보정
                        </button>
                      )}
                    </div>
                    <input
                      value={isbn}
                      onChange={(e) => setIsbn(e.target.value)}
                      placeholder="979-11-XXXX-XXX-X (12자리 입력 후 자동보정 가능)"
                      className={`w-full px-3 py-2 rounded-xl border font-mono bg-white ${
                        isbn.trim() && !isbnCheck.ok
                          ? "border-rose-400"
                          : isbnCheck.ok
                          ? "border-emerald-400"
                          : "border-slate-300"
                      }`}
                    />
                    {isbn.trim() && (
                      <p
                        className={`text-[10.5px] mt-1 font-bold ${
                          isbnCheck.ok ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {isbnCheck.ok ? "✓ " : "⚠ "}
                        {isbnCheck.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      발급 상태
                    </label>
                    <select
                      value={isbnCheck.ok ? "ISSUED" : isbnStatus}
                      disabled={isbnCheck.ok}
                      onChange={(e) => {
                        const v = e.target.value as HqIsbnStatus;
                        setIsbnStatus(v);
                        if (v === "APPLIED" && !isbnAppliedAt) {
                          setIsbnAppliedAt(new Date().toISOString().slice(0, 10));
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white disabled:bg-slate-50"
                    >
                      {(Object.keys(ISBN_STATUS_LABEL) as HqIsbnStatus[]).map((k) => (
                        <option key={k} value={k}>
                          {ISBN_STATUS_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      신청일
                    </label>
                    <input
                      type="date"
                      value={isbnAppliedAt}
                      onChange={(e) => setIsbnAppliedAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                    />
                  </div>
                </div>

                {/* 세트 ISBN (시리즈·전집) · 전자책 ISBN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700">
                        세트 ISBN-13 (시리즈·전집일 때 선택)
                      </label>
                      {setIsbnVal.replace(/\D/g, "").length >= 12 && (
                        <button
                          type="button"
                          onClick={() => setSetIsbnVal(completeOrFormatIsbn13(setIsbnVal))}
                          className="text-[10.5px] font-extrabold text-brand hover:underline"
                        >
                          자동보정
                        </button>
                      )}
                    </div>
                    <input
                      value={setIsbnVal}
                      onChange={(e) => setSetIsbnVal(e.target.value)}
                      placeholder="전집·시리즈 공통 세트 ISBN (부가기호 발행형태 4 권장)"
                      className={`w-full px-3 py-2 rounded-xl border font-mono bg-white ${
                        setIsbnVal.trim() && !setIsbnCheck.ok
                          ? "border-rose-400"
                          : setIsbnCheck.ok
                          ? "border-emerald-400"
                          : "border-slate-300"
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700">
                        전자책(eBook/PDF) ISBN-13 (선택)
                      </label>
                      {ebookIsbnVal.replace(/\D/g, "").length >= 12 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEbookIsbnVal(completeOrFormatIsbn13(ebookIsbnVal))
                          }
                          className="text-[10.5px] font-extrabold text-brand hover:underline"
                        >
                          자동보정
                        </button>
                      )}
                    </div>
                    <input
                      value={ebookIsbnVal}
                      onChange={(e) => setEbookIsbnVal(e.target.value)}
                      placeholder="전자출판물 별도 발급 시 입력 (발행형태 5)"
                      className={`w-full px-3 py-2 rounded-xl border font-mono bg-white ${
                        ebookIsbnVal.trim() && !ebookIsbnCheck.ok
                          ? "border-rose-400"
                          : ebookIsbnCheck.ok
                          ? "border-emerald-400"
                          : "border-slate-300"
                      }`}
                    />
                  </div>
                </div>

                {/* 부가기호 5자리 빠른 조합기 + 직접 입력 */}
                <div className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold text-slate-700">
                      부가기호(5자리) 조합기 — 독자대상(1) + 발행형태(1) + KDC분류(3)
                    </span>
                    {addOnInfo.text && (
                      <span
                        className={`text-[11px] font-bold ${
                          addOnInfo.ok ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {addOnInfo.ok ? `✓ ${addOnInfo.text}` : `⚠ ${addOnInfo.text}`}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={addOnCode[0] || "6"}
                      onChange={(e) => {
                        const r = e.target.value;
                        const f = addOnCode[1] || "3";
                        const k = addOnCode.slice(2).padEnd(3, "0") || "410";
                        setAddOnCode(`${r}${f}${k}`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 font-semibold text-[11px]"
                    >
                      {ADDON_READER_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          독자: {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={addOnCode[1] || "3"}
                      onChange={(e) => {
                        const r = addOnCode[0] || "6";
                        const f = e.target.value;
                        const k = addOnCode.slice(2).padEnd(3, "0") || "410";
                        setAddOnCode(`${r}${f}${k}`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 font-semibold text-[11px]"
                    >
                      {ADDON_FORM_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          형태: {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={
                        ADDON_KDC_PRESETS.some((p) => p.code === addOnCode.slice(2))
                          ? addOnCode.slice(2)
                          : ""
                      }
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const r = addOnCode[0] || "6";
                        const f = addOnCode[1] || "3";
                        setAddOnCode(`${r}${f}${e.target.value}`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 font-semibold text-[11px]"
                    >
                      <option value="">KDC 분류 직접입력</option>
                      {ADDON_KDC_PRESETS.map((o) => (
                        <option key={o.code} value={o.code}>
                          KDC: {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      부가기호 (5자리)
                    </label>
                    <input
                      value={addOnCode}
                      onChange={(e) => setAddOnCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                      placeholder="63410"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      CIP 제어번호
                    </label>
                    <input
                      value={cipNo}
                      onChange={(e) => setCipNo(e.target.value)}
                      placeholder="CIP2026XXXXXX (선택)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      정가 (원)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={listPrice}
                      onChange={(e) => setListPrice(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      {editing && editingHistory.length > 0 ? "최근 쇄 부수" : "인쇄 부수 (부)"}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={printRun}
                      onChange={(e) => setPrintRun(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={colophonChecked}
                      onChange={(e) => setColophonChecked(e.target.checked)}
                    />
                    판권면 검수 완료 (발행일·판쇄·ISBN·정가·발행처)
                  </label>
                  <label className="flex items-center gap-1.5 font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={barcodeReady}
                      onChange={(e) => setBarcodeReady(e.target.checked)}
                    />
                    표지 ISBN 바코드(부가기호 포함) 반영
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      납본 상태
                    </label>
                    <select
                      value={depositStatus}
                      onChange={(e) => {
                        const v = e.target.value as HqLegalDepositStatus;
                        setDepositStatus(v);
                        if (v !== "NONE" && !depositDate) {
                          setDepositDate(new Date().toISOString().slice(0, 10));
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    >
                      {(Object.keys(DEPOSIT_STATUS_LABEL) as HqLegalDepositStatus[]).map((k) => (
                        <option key={k} value={k}>
                          {DEPOSIT_STATUS_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      납본일
                    </label>
                    <input
                      type="date"
                      value={depositDate}
                      disabled={depositStatus === "NONE"}
                      onChange={(e) => setDepositDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white disabled:bg-slate-50"
                    />
                  </div>
                  <div className="col-span-2 text-[11px] text-slate-500 leading-relaxed">
                    발행일로부터 {LEGAL_DEPOSIT_DAYS}일 이내 국립중앙도서관에 납본(2부)해야 합니다.
                    {publishDate &&
                      ` · 기한: ${addDaysIso(publishDate, LEGAL_DEPOSIT_DAYS)}`}
                    {editingDeposit?.required && !editingDeposit.done && (
                      <span className="ml-1 font-bold text-amber-700">({editingDeposit.label})</span>
                    )}
                  </div>
                </div>

                {colophonPreviewOpen && (
                  <div className="p-3 rounded-xl bg-slate-900 text-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">
                        판권면(판권지) 표준 문안 — 인디자인(InDesign) 붙여넣기 및 하판 전 대조용
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const txt = buildColophonText({
                            title,
                            subtitle,
                            editionInfo,
                            publishDate,
                            authorName,
                            editorName,
                            designerName,
                            printVendor,
                            isbn,
                            addOnCode,
                            setIsbn: setIsbnVal,
                            ebookIsbn: ebookIsbnVal,
                            cipNo,
                            listPrice: Number(listPrice || 0),
                            printHistory: editingHistory,
                            company: companySettings,
                          });
                          await navigator.clipboard.writeText(txt);
                          setColophonCopied(true);
                          setTimeout(() => setColophonCopied(false), 2000);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-brand hover:bg-brand-hover text-white text-[11px] font-bold"
                      >
                        {colophonCopied ? "✓ 복사 완료!" : "📋 문안 전체 복사"}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      {buildColophonText({
                        title,
                        subtitle,
                        editionInfo,
                        publishDate,
                        authorName,
                        editorName,
                        designerName,
                        printVendor,
                        isbn,
                        addOnCode,
                        setIsbn: setIsbnVal,
                        ebookIsbn: ebookIsbnVal,
                        cipNo,
                        listPrice: Number(listPrice || 0),
                        printHistory: editingHistory,
                        company: companySettings,
                      })}
                    </pre>
                  </div>
                )}
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
                    발행일 (판권면 기준)
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

              {/* 쇄 이력 · 중쇄/개정판 */}
              {editing && (
                <div className="p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-800">
                      🖨️ 판 · 쇄 발행 이력 (누적 {sumPrintedCopies(editing).toLocaleString()}부)
                    </span>
                    {!extSchemaMissing && (
                      <button
                        type="button"
                        onClick={() => setReprintOpen((v) => !v)}
                        className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold"
                      >
                        {reprintOpen ? "닫기" : "+ 중쇄 · 개정판 등록"}
                      </button>
                    )}
                  </div>
                  {editingHistory.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      아직 쇄 이력이 없습니다. [출간완료]로 이동하면 현재 판쇄·부수로 초쇄 이력이 자동 생성됩니다.
                    </p>
                  ) : (
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500">
                          <th className="py-1.5 px-2 text-left">판쇄</th>
                          <th className="py-1.5 px-2 text-left">발행일</th>
                          <th className="py-1.5 px-2 text-right">부수</th>
                          <th className="py-1.5 px-2 text-left">ISBN</th>
                          <th className="py-1.5 px-2 text-left">인쇄소 / 메모</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {editingHistory.map((h) => (
                          <tr key={h.id}>
                            <td className="py-1.5 px-2 font-bold">
                              {formatEditionLabel(h.edition_no, h.printing_no)}
                            </td>
                            <td className="py-1.5 px-2">{h.print_date}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">
                              {h.copies.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 font-mono">{h.isbn || "-"}</td>
                            <td className="py-1.5 px-2 text-slate-500">
                              {[h.vendor, h.memo].filter(Boolean).join(" · ") || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {reprintOpen && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                      <div className="flex gap-1.5">
                        {(
                          [
                            ["REPRINT", "중쇄 (내용 동일 · 같은 ISBN)"],
                            ["NEW_EDITION", "개정판 (내용 변경 · 새 ISBN)"],
                          ] as const
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setReprintKind(k)}
                            className={`px-3 py-1.5 rounded-lg font-bold border ${
                              reprintKind === k
                                ? "bg-brand border-brand text-white"
                                : "bg-white border-slate-300 text-slate-700"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">발행일</label>
                          <input
                            type="date"
                            value={reprintDate}
                            onChange={(e) => setReprintDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">부수</label>
                          <input
                            type="number"
                            min={1}
                            value={reprintCopies}
                            onChange={(e) => setReprintCopies(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">인쇄소</label>
                          <input
                            value={reprintVendor}
                            onChange={(e) => setReprintVendor(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>
                        {reprintKind === "NEW_EDITION" ? (
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">새 ISBN</label>
                            <input
                              value={reprintIsbn}
                              onChange={(e) => setReprintIsbn(e.target.value)}
                              placeholder="979-11-..."
                              className={`w-full px-2.5 py-1.5 rounded-lg border bg-white font-mono ${
                                reprintIsbn && !validateIsbn13(reprintIsbn).ok
                                  ? "border-rose-400"
                                  : "border-slate-300"
                              }`}
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">메모</label>
                            <input
                              value={reprintMemo}
                              onChange={(e) => setReprintMemo(e.target.value)}
                              placeholder="오탈자 정정 반영 등"
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10.5px] text-slate-500">
                          중쇄는 판권면의 쇄·발행일만 바뀌고 ISBN은 유지됩니다. 내용이 바뀌는 개정판은 ISBN을 새로 신청해야 합니다.
                        </p>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleReprint}
                          className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-extrabold disabled:opacity-50 shrink-0"
                        >
                          발행 이력 등록
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 계약 연동 */}
              {editing && (
                <div className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-800">
                      📑 연결된 저자 · 외주 계약 ({editingContracts.length})
                    </span>
                    {canCreateContract && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              hqHref(`/hq/contracts?new=ROYALTY&pub_id=${editing.pub_id}`)
                            )
                          }
                          className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold"
                        >
                          + 저자 출판권 계약
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              hqHref(`/hq/contracts?new=OUTSOURCING&pub_id=${editing.pub_id}`)
                            )
                          }
                          className="px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold"
                        >
                          + 외주 용역 계약
                        </button>
                      </div>
                    )}
                  </div>
                  {editingContracts.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      {isInHouseAuthor(authorName)
                        ? "사내 연구진 저작(업무상저작물)으로 분류됩니다. 외주 디자인·조판·일러스트가 있다면 외주 계약을 연결하세요."
                        : "⚠️ 외부 저자 도서인데 연결된 출판권 계약이 없습니다. 인쇄(하판) 전에 계약을 체결해 주세요."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {editingContracts.map((c) => (
                        <div
                          key={c.contract_id}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 text-[11px]"
                        >
                          <span>
                            <b>{CONTRACT_CATEGORIES[c.category]?.shortLabel}</b> · {c.counterparty_name} (
                            {c.counterparty_role}){c.royalty_rate ? ` · 인세 ${c.royalty_rate}%` : ""}
                          </span>
                          <span
                            className={`font-bold ${
                              c.status === "SIGNED"
                                ? "text-emerald-700"
                                : c.status === "SENT"
                                ? "text-amber-700"
                                : "text-slate-500"
                            }`}
                          >
                            {c.status === "SIGNED"
                              ? "체결"
                              : c.status === "SENT"
                              ? "서명대기"
                              : c.status === "DRAFT"
                              ? "임시저장"
                              : "회수·만료"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
