// src/components/hq/editorial/ImageReverseClassifierView.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  AnalyzedCaptureProblem,
  CategoryNodeSummary,
  Depth8ItemSummary,
  EditorialUnitDetailPayload,
  TargetContextInfo,
  ThinkingNodeSummary,
} from "@/lib/hq/editorialTypes";
import {
  COMPETENCY_STYLE,
  DIFF_ORDER,
  PROBLEM_TYPE_LABEL,
  renderEditorialMathHtml,
  sortNaturalKo,
  sortSchoolLevel,
  typesetEditorialElement,
} from "./editorialUiUtils";

interface ImageReverseClassifierViewProps {
  categories: CategoryNodeSummary[];
  thinkingCategories: ThinkingNodeSummary[];
  knownBooks: string[];
  onOpenInExplorer: (categoryId: string, itemId?: string | null) => void;
  onOpenThinkingInExplorer: (thkId: string) => void;
  onSavedToDb: () => void;
}

async function compressImageFileToDataUrl(
  file: File
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.onload = () => {
      const rawUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const maxDim = 1800;
        let w = img.width;
        let h = img.height;
        if (w <= maxDim && h <= maxDim && file.size < 2.5 * 1024 * 1024) {
          resolve({ dataUrl: rawUrl, mimeType: file.type || "image/png" });
          return;
        }
        const ratio = Math.min(maxDim / w, maxDim / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUrl: rawUrl, mimeType: file.type || "image/png" });
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const outUrl = canvas.toDataURL("image/jpeg", 0.9);
        resolve({ dataUrl: outUrl, mimeType: "image/jpeg" });
      };
      img.onerror = () =>
        resolve({ dataUrl: rawUrl, mimeType: file.type || "image/png" });
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageReverseClassifierView({
  categories,
  thinkingCategories,
  knownBooks,
  onOpenInExplorer,
  onOpenThinkingInExplorer,
  onSavedToDb,
}: ImageReverseClassifierViewProps) {
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 입력 상태
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");
  const [imageMimeType, setImageMimeType] = useState<string>("image/png");
  const [imageName, setImageName] = useState<string>("");
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [gradeHint, setGradeHint] = useState<string>("ALL");
  const [applyThinking, setApplyThinking] = useState<boolean>(true);
  const [bookName, setBookName] = useState<string>("");
  const [pageNumber, setPageNumber] = useState<string>("");

  // 분석 및 저장 상태
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [problems, setProblems] = useState<AnalyzedCaptureProblem[]>([]);
  const [solvingId, setSolvingId] = useState<string | null>(null);

  const [generateSolutionOnSave, setGenerateSolutionOnSave] = useState<boolean>(false);
  const [attachImageOnSave, setAttachImageOnSave] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 수동 단원 변경 검색 팝오버 상태
  const [manualSearchOpenFor, setManualSearchOpenFor] = useState<string | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState<string>("");
  const [manualPickedCatItems, setManualPickedCatItems] = useState<
    Record<string, Depth8ItemSummary[]>
  >({});

  // 학년·학기 힌트 옵션 목록
  const gradeOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { value: string; label: string; d1: string; d2: string }[] = [];
    for (const c of categories) {
      if (!c.depth1 || !c.depth2) continue;
      const val = `${c.depth1}||${c.depth2}`;
      if (seen.has(val)) continue;
      seen.add(val);
      list.push({
        value: val,
        label: `${c.depth1} · ${c.depth2}`,
        d1: c.depth1,
        d2: c.depth2,
      });
    }
    list.sort(
      (a, b) => sortSchoolLevel(a.d1, b.d1) || sortNaturalKo(a.d2, b.d2)
    );
    return list;
  }, [categories]);

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setAnalyzeError("이미지 파일(PNG, JPG, WEBP 등)만 업로드할 수 있습니다.");
      return;
    }
    setAnalyzeError(null);
    setSaveSuccessMsg(null);
    try {
      const { dataUrl, mimeType } = await compressImageFileToDataUrl(file);
      setImagePreviewUrl(dataUrl);
      setImageMimeType(mimeType);
      setImageName(file.name || "클립보드 캡처 이미지");
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "이미지 처리에 실패했습니다.");
    }
  }, []);

  // 화면 어디서나 Ctrl+V 클립보드 캡처 붙여넣기 지원
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
        // 입력칸 포커스 중에도 이미지 클립보드면 허용하되 텍스트면 기본 동작 유지
        const items = e.clipboardData?.items;
        if (!items) return;
        const imgItem = Array.from(items).find((it) => it.type.startsWith("image/"));
        if (!imgItem) return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleImageFile(f);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleImageFile]);

  // 추출된 문항 수식 렌더링
  useEffect(() => {
    if (resultsContainerRef.current && problems.length > 0) {
      typesetEditorialElement(resultsContainerRef.current);
    }
  }, [problems]);

  const runAnalyze = async () => {
    if (!imagePreviewUrl) {
      setAnalyzeError("먼저 문제 캡처 이미지를 붙여넣거나(Ctrl+V) 업로드해 주세요.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    setSaveSuccessMsg(null);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { detectedPage: string | null; problems: AnalyzedCaptureProblem[] };
      }>("/api/hq/editorial", {
        method: "POST",
        body: {
          action: "analyze_image",
          imageBase64: imagePreviewUrl,
          mimeType: imageMimeType,
          gradeHint,
          applyThinking,
        },
      });

      const list = res.data.problems || [];
      setProblems(list);
      if (res.data.detectedPage && !pageNumber.trim()) {
        setPageNumber(res.data.detectedPage);
      }
      if (list.length === 0) {
        setAnalyzeError("이미지에서 수학 문항을 찾지 못했습니다. 문항이 잘 보이도록 다시 캡처해 주세요.");
      }
    } catch (e: unknown) {
      setAnalyzeError(
        e instanceof Error ? e.message : "AI 이미지 분석 및 분류 중 오류가 발생했습니다."
      );
    } finally {
      setAnalyzing(false);
    }
  };

  // 특정 문항의 분류 코드(taxonomy_id 또는 thk_taxonomy_id) 변경 시 서버에서 8단계 타겟팅 컨텍스트 재조회
  const refreshProblemTargetContext = async (
    tempId: string,
    nextTaxId: string,
    nextThkId: string | null
  ) => {
    try {
      const qs = new URLSearchParams({
        action: "target_context",
        taxonomyId: nextTaxId,
        thkTaxonomyId: nextThkId || "",
      });
      const res = await hqFetch<{ success: boolean; data: TargetContextInfo }>(
        `/api/hq/editorial?${qs.toString()}`
      );
      setProblems((prev) =>
        prev.map((p) => {
          if (p.temp_id !== tempId) return p;
          return {
            ...p,
            taxonomy_id: nextTaxId,
            taxonomy_name: res.data.full_path || p.taxonomy_name,
            category_id: res.data.category_id || p.category_id,
            thk_taxonomy_id: nextThkId,
            thk_taxonomy_name: res.data.thinkingInfo?.full_path || null,
            targetContext: res.data,
          };
        })
      );
    } catch {
      // ignore transient error
    }
  };

  const updateProblemField = (
    tempId: string,
    patch: Partial<AnalyzedCaptureProblem>
  ) => {
    setProblems((prev) =>
      prev.map((p) => (p.temp_id === tempId ? { ...p, ...patch } : p))
    );
  };

  const handleGenerateSingleSolution = async (prob: AnalyzedCaptureProblem) => {
    setSolvingId(prob.temp_id);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          solutions: Record<
            string,
            {
              answer: string;
              step_1_concept: string;
              step_2_approach: string;
              step_3_process: string;
              step_4_conclusion: string;
            }
          >;
        };
      }>("/api/hq/editorial", {
        method: "POST",
        body: {
          action: "generate_solution",
          imageBase64: imagePreviewUrl || null,
          mimeType: imageMimeType,
          problems: [
            {
              temp_id: prob.temp_id,
              question_number: prob.question_number,
              question: prob.question,
            },
          ],
        },
      });
      const sol = res.data.solutions?.[prob.temp_id];
      if (sol) {
        updateProblemField(prob.temp_id, {
          answer: sol.answer,
          step_1_concept: sol.step_1_concept,
          step_2_approach: sol.step_2_approach,
          step_3_process: sol.step_3_process,
          step_4_conclusion: sol.step_4_conclusion,
        });
      }
    } catch (e: unknown) {
      alert(`해설 생성 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSolvingId(null);
    }
  };

  const handleSaveSelectedToDb = async () => {
    const selected = problems.filter((p) => p.selectedForSave);
    if (selected.length === 0) {
      alert("DB에 저장할 문항을 최소 1개 이상 체크해 주세요.");
      return;
    }
    if (!bookName.trim()) {
      const ok = window.confirm(
        "교재 이름(book_name)이 비어 있어 '집필팀 캡처 등록 문항'으로 저장됩니다. 계속하시겠습니까?"
      );
      if (!ok) return;
    }

    setSaving(true);
    setSaveSuccessMsg(null);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { savedCount: number; bookName: string };
      }>("/api/hq/editorial", {
        method: "POST",
        body: {
          action: "save_questions",
          problems: selected,
          bookName: bookName.trim() || "집필팀 캡처 등록 문항",
          pageNumber: pageNumber.trim(),
          attachImage: attachImageOnSave,
          generateSolution: generateSolutionOnSave,
          imageBase64: attachImageOnSave || generateSolutionOnSave ? imagePreviewUrl : null,
          mimeType: imageMimeType,
        },
      });

      setSaveSuccessMsg(
        `✅ 총 ${res.data.savedCount}개 문항이 question_db('${res.data.bookName}')에 저장되었으며, 단원별 보유 문항 집계에도 즉시 반영되었습니다!`
      );
      onSavedToDb();
    } catch (e: unknown) {
      alert(`DB 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const manualCategoryHits = useMemo(() => {
    const q = manualSearchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: CategoryNodeSummary[] = [];
    for (const c of categories) {
      const hay = `${c.category_id} ${c.depth1} ${c.depth2} ${c.depth3} ${c.depth4} ${c.depth5} ${c.depth6} ${c.depth7}`.toLowerCase();
      if (hay.includes(q)) {
        out.push(c);
        if (out.length >= 15) break;
      }
    }
    return out;
  }, [categories, manualSearchQuery]);

  const loadItemsForManualCat = async (catId: string) => {
    if (manualPickedCatItems[catId]) return;
    try {
      const qs = new URLSearchParams({
        action: "unit_detail",
        categoryIds: catId,
      });
      const res = await hqFetch<{ success: boolean; data: EditorialUnitDetailPayload }>(
        `/api/hq/editorial?${qs.toString()}`
      );
      setManualPickedCatItems((prev) => ({
        ...prev,
        [catId]: res.data.items || [],
      }));
    } catch {
      // ignore
    }
  };

  const selectedCount = problems.filter((p) => p.selectedForSave).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* 좌측(4칸): 초간편 캡처 업로드 & 교재명/페이지 설정 패널 */}
      <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4 lg:sticky lg:top-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <span>📸</span>
            <span>문항 캡처 업로드 · 8단계 역분류</span>
          </h3>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            교재·원고·PDF에서 문제를 캡처한 뒤 바로{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono text-[10px] font-bold text-slate-800">
              Ctrl + V
            </kbd>{" "}
            로 붙여넣거나 파일을 끌어다 놓으세요.
          </p>
        </div>

        {/* 드롭존 & 미리보기 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleImageFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-4 text-center cursor-pointer transition-all ${
            isDragging
              ? "border-indigo-500 bg-indigo-50/70"
              : imagePreviewUrl
                ? "border-indigo-300 bg-slate-50/60"
                : "border-slate-300 hover:border-indigo-400 bg-slate-50/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageFile(f);
            }}
          />

          {imagePreviewUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="업로드된 문항 캡처"
                className="max-h-60 mx-auto object-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xs"
              />
              <div className="text-[11px] font-bold text-slate-600 truncate">
                {imageName} · 클릭하거나 Ctrl+V로 다른 캡처 교체
              </div>
            </div>
          ) : (
            <div className="py-8 space-y-2">
              <div className="text-3xl">📋</div>
              <div className="text-xs font-extrabold text-slate-800">
                여기를 클릭하거나 캡처 이미지를 Ctrl+V 붙여넣기
              </div>
              <div className="text-[11px] text-slate-400">
                단일 문항 캡처 및 여러 문항이 함께 찍힌 페이지 캡처 모두 자동 분리됩니다.
              </div>
            </div>
          )}
        </div>

        {/* 분류 옵션 */}
        <div className="space-y-3 pt-1 border-t border-slate-100">
          <div>
            <label className="block text-xs font-extrabold text-slate-700 mb-1">
              대상 학년·학기 힌트 (선택사항)
            </label>
            <select
              value={gradeHint}
              onChange={(e) => setGradeHint(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">✨ 전체 학년 자동 탐색 (AI 2단계 깔때기)</option>
              {gradeOptions.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label} 내에서 우선 찾기
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyThinking}
              onChange={(e) => setApplyThinking(e.target.checked)}
              className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <div className="text-xs">
              <div className="font-extrabold text-amber-950">
                🧠 사고력 분류(thk_taxonomy_id)도 함께 찾기
              </div>
              <div className="text-[10.5px] text-amber-700">
                퍼즐·추리·심화 문장제일 때 98개 THK 분류 코드까지 동시 매칭합니다.
              </div>
            </div>
          </label>
        </div>

        {/* DB 저장 대비용 교재명 · 페이지 번호 입력 필드 */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          <div className="text-xs font-extrabold text-slate-800">
            📚 출전 정보 (DB 저장 시 함께 기록)
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                교재 이름 (book_name)
              </label>
              <input
                type="text"
                list="editorial-known-books"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                placeholder="예: 초등로지카 MAX 5-2 신간원고"
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <datalist id="editorial-known-books">
                {knownBooks.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                페이지 번호
              </label>
              <input
                type="text"
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
                placeholder="예: 42"
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 실행 버튼 */}
        <button
          type="button"
          disabled={analyzing || !imagePreviewUrl}
          onClick={runAnalyze}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-sm transition-all flex items-center justify-center gap-2"
        >
          {analyzing ? (
            <span>⏳ 번호·문제 추출 및 38,894개 세부유형 중 타겟 분석 중...</span>
          ) : (
            <span>🔍 번호·문제 추출 및 8단계 자동 분류 실행</span>
          )}
        </button>

        {analyzeError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
            {analyzeError}
          </div>
        )}
      </div>

      {/* 우측(8칸): 추출된 문항 + 8단계 계통 타겟팅 도식화 + DB 저장 */}
      <div ref={resultsContainerRef} className="lg:col-span-8 space-y-4">
        {problems.length === 0 && !analyzing && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3 shadow-xs">
            <div className="text-4xl">🎯</div>
            <h4 className="text-base font-extrabold text-slate-900">
              문항 이미지를 올리면 8단계 분류 코드와 교육과정 내 정확한 위치를 도식화해 드립니다
            </h4>
            <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
              38,894개 세부유형(Depth 8) 전체를 2단계 계층형 AI 깔때기로 자동 압축 탐색하여,
              해당 문제가 어느 학년·단원·유형에 위치하는지, 같은 유형에 기존 보유 문제가 몇 문제 있는지 한눈에 보여줍니다.
            </p>
          </div>
        )}

        {problems.length > 0 && (
          <>
            {/* 상단 일괄 DB 저장 컨트롤 바 */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-extrabold text-slate-900">
                  추출 · 분류 결과 총 {problems.length}문항 (저장 선택: {selectedCount}문항)
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none font-semibold">
                    <input
                      type="checkbox"
                      checked={attachImageOnSave}
                      onChange={(e) => setAttachImageOnSave(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span>캡처 이미지를 문항 이미지로 Storage 첨부</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none font-semibold">
                    <input
                      type="checkbox"
                      checked={generateSolutionOnSave}
                      onChange={(e) => setGenerateSolutionOnSave(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span>저장 시 AI 정답·4단계 해설 자동 생성 포함</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                disabled={saving || selectedCount === 0}
                onClick={handleSaveSelectedToDb}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-xs transition-all"
              >
                {saving
                  ? "⏳ question_db에 저장 중..."
                  : `💾 선택 문항(${selectedCount}개) question_db에 저장`}
              </button>
            </div>

            {saveSuccessMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-extrabold text-emerald-800">
                {saveSuccessMsg}
              </div>
            )}

            {/* 개별 문항 분석 & 8단계 타겟팅 도식 카드 */}
            {problems.map((prob, idx) => {
              const ctx = prob.targetContext;
              const compPrimary = ctx.competency?.primary;

              return (
                <div
                  key={prob.temp_id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-0"
                >
                  {/* 1. 상단 문항 번호 / 메타 / 탐색기 점프 바 */}
                  <div className="px-4 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-extrabold">
                        <input
                          type="checkbox"
                          checked={prob.selectedForSave}
                          onChange={(e) =>
                            updateProblemField(prob.temp_id, {
                              selectedForSave: e.target.checked,
                            })
                          }
                          className="rounded border-slate-500 text-emerald-500"
                        />
                        <span>문항 #{idx + 1}</span>
                      </label>

                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400">번호:</span>
                        <input
                          type="text"
                          value={prob.question_number}
                          onChange={(e) =>
                            updateProblemField(prob.temp_id, {
                              question_number: e.target.value,
                            })
                          }
                          className="w-14 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-white text-xs font-bold text-center"
                        />
                        {prob.sub_num > 0 && (
                          <span className="text-slate-300 font-bold">
                            -({prob.sub_num})
                          </span>
                        )}
                      </div>

                      <select
                        value={prob.difficulty}
                        onChange={(e) =>
                          updateProblemField(prob.temp_id, {
                            difficulty: e.target.value,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-amber-300"
                      >
                        {DIFF_ORDER.filter((d) => d !== "미지정").map((d) => (
                          <option key={d} value={d}>
                            난이도 {d}
                          </option>
                        ))}
                      </select>

                      <select
                        value={prob.cognitive_level}
                        onChange={(e) =>
                          updateProblemField(prob.temp_id, {
                            cognitive_level: e.target.value,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-sky-300"
                      >
                        {["이해 및 연산", "적용 및 응용", "추론 및 문제 해결"].map(
                          (c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          )
                        )}
                      </select>

                      <span className="text-[11px] text-slate-400 font-semibold">
                        {PROBLEM_TYPE_LABEL[prob.problem_type] || prob.problem_type}
                      </span>
                    </div>

                    {ctx.category_id && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenInExplorer(ctx.category_id!, ctx.item_id)
                        }
                        className="px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-extrabold transition-colors"
                      >
                        🔭 탐색기에서 이 위치 &amp; 주변 문항 열기
                      </button>
                    )}
                  </div>

                  <div className="p-4 space-y-4">
                    {/* 2. 추출된 문제 원문 편집 + 실시간 수식 렌더링 미리보기 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="text-[11px] font-extrabold text-slate-500">
                          ✏️ 추출된 문제 텍스트 (수정 가능)
                        </div>
                        <textarea
                          rows={4}
                          value={prob.question}
                          onChange={(e) =>
                            updateProblemField(prob.temp_id, {
                              question: e.target.value,
                            })
                          }
                          className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-extrabold text-slate-500">
                          👁️ 수식 렌더링 미리보기
                        </div>
                        <div
                          className="min-h-[96px] p-3 rounded-xl border border-slate-200 bg-white text-[13px] leading-relaxed text-slate-900"
                          dangerouslySetInnerHTML={{
                            __html: renderEditorialMathHtml(prob.question),
                          }}
                        />
                      </div>
                    </div>

                    {/* 3. 🎯 8단계 분류 위치 도식화 타겟팅 보드 */}
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-black font-mono">
                            🎯 {prob.taxonomy_id || "미분류"}
                          </span>
                          {compPrimary && (
                            <span
                              className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${COMPETENCY_STYLE[compPrimary].badge}`}
                            >
                              핵심역량: {compPrimary}
                            </span>
                          )}
                          {ctx.curriculum_version && (
                            <span className="text-[11px] font-bold text-slate-500">
                              ({ctx.curriculum_version} 개정 교육과정)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {prob.candidate_2_id && (
                            <button
                              type="button"
                              onClick={() => {
                                const prevId = prob.taxonomy_id;
                                const prevName = prob.taxonomy_name;
                                const nextId = prob.candidate_2_id!;
                                updateProblemField(prob.temp_id, {
                                  candidate_2_id: prevId,
                                  candidate_2_name: prevName,
                                });
                                refreshProblemTargetContext(
                                  prob.temp_id,
                                  nextId,
                                  prob.thk_taxonomy_id
                                );
                              }}
                              title={prob.candidate_2_name || prob.candidate_2_id}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-100 border border-indigo-300 text-[11px] font-bold text-indigo-700"
                            >
                              ⇄ 2순위 후보({prob.candidate_2_id})로 전환
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setManualSearchOpenFor((cur) =>
                                cur === prob.temp_id ? null : prob.temp_id
                              );
                              setManualSearchQuery("");
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-700"
                          >
                            🔎 다른 단원 직접 지정
                          </button>
                        </div>
                      </div>

                      {prob.ai_reason && (
                        <div className="text-xs text-indigo-950 bg-white/80 px-3 py-2 rounded-xl border border-indigo-100">
                          <span className="font-extrabold text-indigo-700 mr-1.5">
                            [AI 분류 근거]
                          </span>
                          {prob.ai_reason}
                        </div>
                      )}

                      {/* 수동 단원 검색 변경기 */}
                      {manualSearchOpenFor === prob.temp_id && (
                        <div className="p-3 rounded-xl bg-white border border-slate-300 space-y-2 shadow-sm">
                          <input
                            type="text"
                            value={manualSearchQuery}
                            onChange={(e) => setManualSearchQuery(e.target.value)}
                            placeholder="변경할 단원명·유형명·분류코드 검색 (예: 분수의 나눗셈, 직육면체)..."
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                          />
                          {manualCategoryHits.length > 0 && (
                            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                              {manualCategoryHits.map((mc) => {
                                const loadedItems = manualPickedCatItems[mc.category_id];
                                return (
                                  <div key={mc.category_id} className="p-2 space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-xs">
                                        <span className="text-indigo-600 font-bold">
                                          {mc.depth1} &gt; {mc.depth2} &gt; {mc.depth3}
                                        </span>{" "}
                                        <span className="font-extrabold text-slate-900">
                                          ▸ {mc.depth7 || mc.depth6}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => loadItemsForManualCat(mc.category_id)}
                                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 text-[11px] font-bold text-slate-700 shrink-0"
                                      >
                                        세부유형(Depth8) 선택 ▾
                                      </button>
                                    </div>
                                    {loadedItems && (
                                      <div className="flex flex-wrap gap-1 pt-1">
                                        {loadedItems.map((li) => (
                                          <button
                                            key={li.item_id}
                                            type="button"
                                            onClick={() => {
                                              refreshProblemTargetContext(
                                                prob.temp_id,
                                                li.item_id,
                                                prob.thk_taxonomy_id
                                              );
                                              setManualSearchOpenFor(null);
                                            }}
                                            className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-600 hover:text-white text-[11px] font-semibold text-indigo-900 border border-indigo-200"
                                          >
                                            {li.depth8} ({li.count}제)
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 8단계 계층 사다리 도식 (Depth 1 -> Depth 8 + 각 단계별 DB 보유 문항 수) */}
                      {ctx.hierarchy.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-extrabold text-slate-600">
                            🗺️ 전체 교육과정 8단계 내 타겟 위치 및 단계별 보유 문항 수
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {ctx.hierarchy.map((step) => {
                              const isLeafTarget = step.depth === 8;
                              return (
                                <div
                                  key={`${step.depth}_${step.name}`}
                                  className={`p-2.5 rounded-xl border flex flex-col justify-between gap-1 ${
                                    isLeafTarget
                                      ? "bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-300 shadow-xs"
                                      : "bg-white text-slate-800 border-slate-200"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span
                                      className={`text-[10px] font-extrabold ${
                                        isLeafTarget
                                          ? "text-indigo-100"
                                          : "text-slate-400"
                                      }`}
                                    >
                                      {step.stageLabel}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold ${
                                        isLeafTarget
                                          ? step.questionCount === 0
                                            ? "bg-rose-400 text-white"
                                            : "bg-white text-indigo-700"
                                          : "bg-slate-100 text-slate-600"
                                      }`}
                                    >
                                      {step.questionCount === 0
                                        ? "🆕 0제 공백"
                                        : `${step.questionCount.toLocaleString()}제`}
                                    </span>
                                  </div>
                                  <div className="text-xs font-extrabold leading-snug line-clamp-2">
                                    {step.name}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 같은 7단계 대표유형 안의 이웃 8단계 세부유형 비교 & 원클릭 미세 조정 */}
                      {ctx.siblingItems.length > 1 && (
                        <div className="space-y-1.5 pt-1">
                          <div className="text-[11px] font-extrabold text-slate-600">
                            📍 같은 대표유형(Depth 7) 안의 이웃 세부유형(Depth 8) 비교 — 클릭 시 즉시 변경
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {ctx.siblingItems.map((sib) => (
                              <button
                                key={sib.item_id}
                                type="button"
                                onClick={() =>
                                  refreshProblemTargetContext(
                                    prob.temp_id,
                                    sib.item_id,
                                    prob.thk_taxonomy_id
                                  )
                                }
                                className={`px-2.5 py-1.5 rounded-lg border text-left text-[11.5px] transition-all flex items-center gap-1.5 ${
                                  sib.isTarget
                                    ? "bg-indigo-600 text-white border-indigo-600 font-extrabold shadow-2xs"
                                    : "bg-white hover:bg-indigo-50 text-slate-700 border-slate-200 font-medium"
                                }`}
                              >
                                <span>{sib.isTarget ? "🎯 " : ""}{sib.depth8}</span>
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                    sib.isTarget
                                      ? "bg-white/20 text-white"
                                      : sib.count === 0
                                        ? "bg-rose-100 text-rose-700"
                                        : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {sib.count}제
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 사고력(THK) 분류 선택 및 점프 + 선수/후속 단원 미니 연계 */}
                      <div className="pt-2 border-t border-indigo-200/60 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-extrabold text-amber-800">
                            🧠 사고력 분류 (thinking_category · 선택사항)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={prob.thk_taxonomy_id || ""}
                              onChange={(e) => {
                                const nextThk = e.target.value || null;
                                refreshProblemTargetContext(
                                  prob.temp_id,
                                  prob.taxonomy_id,
                                  nextThk
                                );
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-bold text-slate-800"
                            >
                              <option value="">(해당 없음 — 일반 교과 문항)</option>
                              {thinkingCategories.map((t) => (
                                <option key={t.category_id} value={t.category_id}>
                                  [{t.category_id}] {t.full_path} ({t.count}제)
                                </option>
                              ))}
                            </select>
                            {prob.thk_taxonomy_id && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenThinkingInExplorer(prob.thk_taxonomy_id!)
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold shrink-0"
                              >
                                THK 열람
                              </button>
                            )}
                          </div>
                        </div>

                        {(ctx.prerequisites.length > 0 || ctx.followups.length > 0) && (
                          <div className="flex flex-col justify-center gap-1 bg-white/80 rounded-xl p-2.5 border border-indigo-100 text-[11px]">
                            {ctx.prerequisites[0] && (
                              <div className="truncate text-slate-700">
                                <span className="font-extrabold text-amber-700 mr-1">
                                  ⏪ 선수:
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenInExplorer(ctx.prerequisites[0].category_id)
                                  }
                                  className="hover:underline font-semibold"
                                >
                                  {ctx.prerequisites[0].label} (
                                  {ctx.prerequisites[0].questionCount}제)
                                </button>
                              </div>
                            )}
                            {ctx.followups[0] && (
                              <div className="truncate text-slate-700">
                                <span className="font-extrabold text-emerald-700 mr-1">
                                  ⏩ 후속:
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenInExplorer(ctx.followups[0].category_id)
                                  }
                                  className="hover:underline font-semibold"
                                >
                                  {ctx.followups[0].label} (
                                  {ctx.followups[0].questionCount}제)
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 4. 선택적 정답 · 4단계 해설 생성/확인 영역 */}
                    <div className="pt-1 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-600">
                          {prob.answer
                            ? "✅ 정답 · 4단계 해설 준비 완료"
                            : "💡 필요 시 저장 전 정답·해설을 미리 생성해 검수할 수 있습니다."}
                        </span>
                        <button
                          type="button"
                          disabled={solvingId === prob.temp_id}
                          onClick={() => handleGenerateSingleSolution(prob)}
                          className="px-3 py-1 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold"
                        >
                          {solvingId === prob.temp_id
                            ? "⏳ 정답·해설 생성 중..."
                            : prob.answer
                              ? "🔄 AI 정답·해설 다시 생성"
                              : "✨ 이 문항 AI 정답·4단계 해설 생성"}
                        </button>
                      </div>

                      {prob.answer && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-indigo-700 shrink-0">
                              정답:
                            </span>
                            <input
                              type="text"
                              value={prob.answer}
                              onChange={(e) =>
                                updateProblemField(prob.temp_id, {
                                  answer: e.target.value,
                                })
                              }
                              className="flex-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-bold text-slate-900"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(
                              [
                                ["step_1_concept", "1. 핵심 개념"],
                                ["step_2_approach", "2. 풀이 전략"],
                                ["step_3_process", "3. 풀이 과정"],
                                ["step_4_conclusion", "4. 최종 결론"],
                              ] as const
                            ).map(([field, label]) => (
                              <div key={field}>
                                <div className="text-[10.5px] font-bold text-slate-500 mb-0.5">
                                  {label}
                                </div>
                                <textarea
                                  rows={2}
                                  value={prob[field] || ""}
                                  onChange={(e) =>
                                    updateProblemField(prob.temp_id, {
                                      [field]: e.target.value,
                                    })
                                  }
                                  className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-800"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
