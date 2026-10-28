// src/app/exam/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { normalizeMasterCategoryRow } from "@/lib/normalize";
import { supabase } from "@/lib/supabase";
import { getISOWeekKST, getKSTDateString } from "@/lib/classRound";

import ViewerHeader from "@/components/exam/ViewerHeader";
import ViewerSidebar from "@/components/exam/ViewerSidebar";
import ViewerToolbar from "@/components/exam/ViewerToolbar";

import {
  ADMISSION_HEADER_URL, LOGO_FOOTER_LEFT_URL, LOGO_FOOTER_RIGHT_URL,
  formatExamDate, getCleanUrl, formatQText, buildHeaderHtml, buildFooterHtml
} from "@/utils/examRenderUtils";

import { processGroupText, compareSubQuestions, getDiagnosticMainScore, buildMergedQuestionGroups, isSubNumberOnlyText, splitTrailingSubNumberText, getDiffLabelByRate, getDepth5Name, getDepth6Name } from "../step2/examUtils";

const COLUMN_GAP_PX = 15 * (96 / 25.4);
const SAFETY_MARGIN_PX = 8 * (96 / 25.4);

const getColGapMm = (col: number, split: number): number => {
  if (col === 1) {
    if (split >= 6) return 4;
    if (split >= 4) return 6;
    if (split === 2) return 12;
    return 0;
  }
  return 15;
};

const getColGapPx = (col: number, split: number): number => getColGapMm(col, split) * (96 / 25.4);
const PALETTE_STORAGE_KEY = 'examViewerColorPalette';
const DEFAULT_PALETTE = ['#2563eb', '#002864', '#14532d'];

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    return [];
  }
  return [];
};

const getRealId = (id: string) => String(id).replace(/_added_\d+$/, '');
const normalizeHiddenImgKey = (raw: any): string => {
  const s = String(raw || '');
  const m = s.match(/^(.*?)__img([12])$/);
  if (m) return `${getRealId(m[1])}__img${m[2]}`;
  return getRealId(s);
};

// 🌟 진단평가 문항/제목에서 학년·학기(예: "초등 5-2", "중등 1-1") 자동 추출 헬퍼
const extractDiagnosticBadge = (questionsList: any[], fallbackTitle: string = ""): string => {
  const sources: string[] = [];
  if (fallbackTitle) sources.push(fallbackTitle);
  (questionsList || []).forEach((q: any) => {
    if (!q) return;
    if (q.pdf_source) sources.push(String(q.pdf_source));
    if (q.source_book_name) sources.push(String(q.source_book_name));
    if (q.book_name) sources.push(String(q.book_name));
  });
  for (const s of sources) {
    const mMid = s.match(/중(?:등)?\s*([1-3]-[1-2])/);
    if (mMid) return `중등 ${mMid[1]}`;
    const mMidCompact = s.match(/중(?:등)?\s*([1-3])([1-2])(?:[^0-9]|$)/);
    if (mMidCompact) return `중등 ${mMidCompact[1]}-${mMidCompact[2]}`;
    const mMid7 = s.match(/(?:^|[^0-9])7-([1-2])(?:[^0-9]|$)/);
    if (mMid7) return `중등 1-${mMid7[1]}`;
    const mElem = s.match(/([1-6]-[1-2])/);
    if (mElem) return `초등 ${mElem[1]}`;
    const mLevelCompact = s.match(/(?:^|[^0-9A-Za-z])(?:[UMATHumath]|초(?:등)?)\s*([1-6])([1-2])(?:[^0-9]|$)/);
    if (mLevelCompact) return `초등 ${mLevelCompact[1]}-${mLevelCompact[2]}`;
  }
  return "";
};

// 🌟 시험지 저장 시 모든 문항의 taxonomy_id를 기반으로 주요 학년·학기(major_grade)와
// 순서상 첫 taxonomy_id의 depth6 ~ 마지막 taxonomy_id의 depth6 범위(scope_start, scope_end)를 계산하는 헬퍼
const computeExamSummaryMeta = async (
  groups: any[],
  displayBadge: string,
  examTitle: string,
  weeklyTargetGrade: string
) => {
  const gradeCount: Record<string, number> = {};
  const diffCount: Record<string, number> = {};
  const allQuestions: any[] = [];

  (groups || []).forEach((g: any) => {
    const qList = g?.questions || g?.items || (g?.repQ ? [g.repQ] : []);
    (qList || []).forEach((q: any) => {
      if (q) allQuestions.push(q);
    });
  });

  // 1) taxonomy_id -> master_item / master_category 조회로 depth6 및 학년·학기 확보
  const rawTaxIds = Array.from(
    new Set(
      allQuestions
        .flatMap((q: any) => [q?.taxonomy_id, q?.item_id])
        .map((id: any) => (id ? String(id).trim().toUpperCase() : ""))
        .filter((id: string) => id && id !== "NULL" && id !== "UNDEFINED" && id !== "미분류")
    )
  );

  const d6ByTaxId: Record<string, string> = {};
  const gradeByTaxId: Record<string, string> = {};

  if (rawTaxIds.length > 0) {
    try {
      const catIdByTaxId = new Map<string, string>();
      const catIdsToFetch = new Set<string>();

      for (let i = 0; i < rawTaxIds.length; i += 100) {
        const chunk = rawTaxIds.slice(i, i + 100);
        const { data: mItems } = await supabase
          .from("master_item")
          .select("item_id, category_id")
          .in("item_id", chunk);
        if (mItems) {
          mItems.forEach((row: any) => {
            const iId = String(row.item_id || "").trim().toUpperCase();
            if (row.category_id) {
              const cId = String(row.category_id).trim().toUpperCase();
              catIdByTaxId.set(iId, cId);
              catIdsToFetch.add(cId);
            }
          });
        }
        chunk.forEach((tid) => {
          if (!catIdByTaxId.has(tid)) {
            const parts = tid.split("-");
            if (parts.length >= 6) {
              const parentCat = parts.slice(0, -1).join("-");
              catIdByTaxId.set(tid, parentCat);
              catIdsToFetch.add(parentCat);
            }
            catIdsToFetch.add(tid);
          }
        });
      }

      const catIdsArr = Array.from(catIdsToFetch);
      const catMap = new Map<string, any>();
      for (let i = 0; i < catIdsArr.length; i += 100) {
        const chunk = catIdsArr.slice(i, i + 100);
        const { data: mCats } = await supabase
          .from("master_category")
          .select("category_id, depth1, depth2, depth3, depth4, depth5, depth6, depth7")
          .in("category_id", chunk);
        if (mCats) {
          mCats.forEach((rawC: any) => {
            const c = normalizeMasterCategoryRow(rawC);
            catMap.set(String(c.category_id || "").trim().toUpperCase(), c);
          });
        }
      }

      rawTaxIds.forEach((tid) => {
        const cId = catIdByTaxId.get(tid) || tid;
        const cat = catMap.get(cId) || catMap.get(tid);
        if (cat) {
          const d6 = cat.depth6 || cat.depth5 || "";
          if (d6) d6ByTaxId[tid] = d6;
          const d23 = `${cat.depth2 || ""} ${cat.depth3 || ""}`;
          const gExtracted = extractDiagnosticBadge([], d23);
          if (gExtracted) gradeByTaxId[tid] = gExtracted;
        }
      });
    } catch (e) {}
  }

  allQuestions.forEach((q: any) => {
    const taxId = String(q.taxonomy_id || q.item_id || "").trim().toUpperCase();
    let gradeStr = "";
    if (taxId.length >= 3) {
      const schoolType = taxId[0];
      const grade = taxId[1];
      const semester = taxId[2];
      let schoolName = "";
      if (schoolType === "E") schoolName = "초등";
      else if (schoolType === "M") schoolName = "중등";
      else if (schoolType === "H") schoolName = "고등";
      if (schoolName && !isNaN(Number(grade)) && !isNaN(Number(semester))) {
        gradeStr = `${schoolName} ${grade}-${semester}`;
      }
    }
    if (!gradeStr && taxId && gradeByTaxId[taxId]) {
      gradeStr = gradeByTaxId[taxId];
    }
    if (!gradeStr) {
      gradeStr = extractDiagnosticBadge([q], "");
    }
    if (gradeStr) {
      gradeCount[gradeStr] = (gradeCount[gradeStr] || 0) + 1;
    }

    const diff = String(q.difficulty || getDiffLabelByRate(q.solving_probability) || "중").trim();
    if (diff) {
      diffCount[diff] = (diffCount[diff] || 0) + 1;
    }
  });

  // 1) major_grade 결정: 1순위 문항 taxonomy_id 다수 학년·학기 -> 2순위 displayBadge/examTitle 학년 추출 -> 3순위 sessionStorage.majorGrade -> 4순위 weeklyTargetGrade
  let majorGrade = "";
  let maxGradeCnt = 0;
  for (const [gr, cnt] of Object.entries(gradeCount)) {
    if (cnt > maxGradeCnt) {
      maxGradeCnt = cnt;
      majorGrade = gr;
    }
  }
  if (!majorGrade) {
    const badgeExtracted = extractDiagnosticBadge([], `${displayBadge || ""} ${examTitle || ""}`);
    if (badgeExtracted) {
      majorGrade = badgeExtracted;
    }
  }
  if (!majorGrade) {
    const sessionGrade = typeof window !== "undefined" ? (sessionStorage.getItem("majorGrade") || "") : "";
    if (sessionGrade && sessionGrade !== "공통 과정") {
      majorGrade = sessionGrade;
    }
  }
  if (!majorGrade && weeklyTargetGrade && weeklyTargetGrade.trim()) {
    const wExtracted = extractDiagnosticBadge([], weeklyTargetGrade.trim());
    majorGrade = wExtracted || weeklyTargetGrade.trim();
  }
  if (!majorGrade) majorGrade = "공통 과정";

  // 2) avg_difficulty 결정
  let avgDifficulty = "";
  let maxDiffCnt = 0;
  for (const [df, cnt] of Object.entries(diffCount)) {
    if (cnt > maxDiffCnt) {
      maxDiffCnt = cnt;
      avgDifficulty = df;
    }
  }
  if (!avgDifficulty) {
    avgDifficulty = (typeof window !== "undefined" ? sessionStorage.getItem("avgDifficulty") : "") || "중";
  }

  // 3) scope_start, scope_end 결정: 모든 문항의 taxonomy_id를 순서대로 정렬하여 제일 앞 taxonomy_id의 depth6 ~ 제일 뒤 taxonomy_id의 depth6 산출
  let scopeStart = "";
  let scopeEnd = "";
  const questionsWithTax = allQuestions.filter((q: any) => q && (q.taxonomy_id || q.item_id || q.taxonomy_name));
  if (questionsWithTax.length > 0) {
    const sortedByTaxId = [...questionsWithTax].sort((a, b) => {
      const t1 = String(a.taxonomy_id || a.item_id || a.taxonomy_name || "").trim().toUpperCase();
      const t2 = String(b.taxonomy_id || b.item_id || b.taxonomy_name || "").trim().toUpperCase();
      return t1.localeCompare(t2, "ko", { numeric: true });
    });

    const resolveD6 = (q: any): string => {
      const tid = String(q?.taxonomy_id || q?.item_id || "").trim().toUpperCase();
      if (tid && d6ByTaxId[tid]) return d6ByTaxId[tid];
      const d6 = getDepth6Name(q, d6ByTaxId);
      if (d6 && d6 !== "유형 분류 없음") return d6;
      return "";
    };

    const d6List = sortedByTaxId.map(resolveD6).filter(Boolean);
    if (d6List.length > 0) {
      scopeStart = d6List[0];
      scopeEnd = d6List[d6List.length - 1];
    }
  }

  if (!scopeStart) {
    const sStart = typeof window !== "undefined" ? (sessionStorage.getItem("scopeStart") || "") : "";
    const sEnd = typeof window !== "undefined" ? (sessionStorage.getItem("scopeEnd") || "") : "";
    if (sStart && sStart !== "분류 없음" && sStart !== "유형 분류 없음") scopeStart = sStart;
    if (sEnd && sEnd !== "분류 없음" && sEnd !== "유형 분류 없음") scopeEnd = sEnd;
  }

  return {
    major_grade: majorGrade,
    avg_difficulty: avgDifficulty,
    scope_start: scopeStart || null,
    scope_end: scopeEnd || null,
  };
};

// 🌟 1페이지 헤더 표시용: 시험지 내 모든 문항의 Depth 5(소단원) 범위를 자동 추출하는 헬퍼
const computeHeaderDepth5Scope = async (groups: any[]): Promise<string> => {
  const allQuestions: any[] = [];
  (groups || []).forEach((g: any) => {
    const qList = g?.questions || g?.items || (g?.repQ ? [g.repQ] : []);
    (qList || []).forEach((q: any) => {
      if (q) allQuestions.push(q);
    });
  });
  if (allQuestions.length === 0) return "";

  const rawTaxIds = Array.from(
    new Set(
      allQuestions
        .flatMap((q: any) => [q?.taxonomy_id, q?.sub_taxonomy_id, q?.item_id])
        .map((id: any) => (id ? String(id).trim().toUpperCase() : ""))
        .filter((id: string) => id && id !== "NULL" && id !== "UNDEFINED" && id !== "NONE" && id !== "미분류")
    )
  );

  const d5ByTaxId: Record<string, string> = {};
  if (rawTaxIds.length > 0) {
    try {
      const catIdByTaxId = new Map<string, string>();
      const catIdsToFetch = new Set<string>();

      for (let i = 0; i < rawTaxIds.length; i += 100) {
        const chunk = rawTaxIds.slice(i, i + 100);
        const { data: mItems } = await supabase
          .from("master_item")
          .select("item_id, category_id")
          .in("item_id", chunk);
        if (mItems) {
          mItems.forEach((row: any) => {
            const iId = String(row.item_id || "").trim().toUpperCase();
            if (row.category_id) {
              const cId = String(row.category_id).trim().toUpperCase();
              catIdByTaxId.set(iId, cId);
              catIdsToFetch.add(cId);
            }
          });
        }
        chunk.forEach((tid) => {
          if (!catIdByTaxId.has(tid)) {
            const parts = tid.split("-");
            if (parts.length >= 6) {
              const parentCat = parts.slice(0, -1).join("-");
              catIdByTaxId.set(tid, parentCat);
              catIdsToFetch.add(parentCat);
            }
            catIdsToFetch.add(tid);
          }
        });
      }

      const catIdsArr = Array.from(catIdsToFetch);
      const catMap = new Map<string, any>();
      for (let i = 0; i < catIdsArr.length; i += 100) {
        const chunk = catIdsArr.slice(i, i + 100);
        const { data: mCats } = await supabase
          .from("master_category")
          .select("category_id, depth1, depth2, depth3, depth4, depth5, depth6, depth7")
          .in("category_id", chunk);
        if (mCats) {
          mCats.forEach((rawC: any) => {
            const c = normalizeMasterCategoryRow(rawC);
            catMap.set(String(c.category_id || "").trim().toUpperCase(), c);
          });
        }
      }

      rawTaxIds.forEach((tid) => {
        const cId = catIdByTaxId.get(tid) || tid;
        const cat = catMap.get(cId) || catMap.get(tid);
        if (cat) {
          const d5 = cat.depth5 || cat.depth4 || cat.depth6 || "";
          if (d5) d5ByTaxId[tid] = d5;
        }
      });
    } catch (e) {}
  }

  const sortedQs = [...allQuestions].sort((a, b) => {
    const t1 = String(a?.taxonomy_id || a?.sub_taxonomy_id || a?.item_id || "").trim().toUpperCase();
    const t2 = String(b?.taxonomy_id || b?.sub_taxonomy_id || b?.item_id || "").trim().toUpperCase();
    return t1.localeCompare(t2, "ko", { numeric: true });
  });

  const uniqueD5: string[] = [];
  sortedQs.forEach((q: any) => {
    const tid = String(q?.taxonomy_id || q?.item_id || "").trim().toUpperCase();
    const subTid = String(q?.sub_taxonomy_id || "").trim().toUpperCase();
    let d5 = (tid && d5ByTaxId[tid]) || (subTid && d5ByTaxId[subTid]) || getDepth5Name(q, d5ByTaxId);
    if (d5 && d5 !== "분류 없음" && !uniqueD5.includes(d5)) {
      uniqueD5.push(d5);
    }
  });

  if (uniqueD5.length === 0) return "";
  if (uniqueD5.length === 1) return uniqueD5[0];
  if (uniqueD5.length === 2) return `${uniqueD5[0]} · ${uniqueD5[1]}`;
  if (uniqueD5.length === 3) return `${uniqueD5[0]} · ${uniqueD5[1]} · ${uniqueD5[2]}`;
  return `${uniqueD5[0]} ~ ${uniqueD5[uniqueD5.length - 1]} (외 ${uniqueD5.length - 2}개 소단원)`;
};

// 🌟 문항(또는 서브문항) 1개의 HTML 블록 생성
// - 이미지 숨김 여부 반영
// - 텍스트 뒤에 서브문항 번호((1), (2) 등)가 오고 그 뒤에 다른 텍스트가 없으면 이미지를 번호 우측에 나란히 배치
// - 진단평가(isAdmissionMode=true)일 때는 상하 폭 제한(max-height: 250px)을 해제하고 좌우 폭에 맞춰 출력
const buildSubQuestionItemHtml = (
  q: any,
  sIdx: number,
  textToRender: string,
  hiddenImgSet?: Set<string>,
  isAdmissionMode: boolean = false,
  col: number = 2,
  split: number = 4
) => {
  const realQId = getRealId(String(q.question_id || ""));
  const isImg1Hidden = Boolean(hiddenImgSet && (hiddenImgSet.has(`${realQId}__img1`) || hiddenImgSet.has(realQId)));
  const isImg2Hidden = Boolean(hiddenImgSet && (hiddenImgSet.has(`${realQId}__img2`) || hiddenImgSet.has(realQId)));

  const safeImgUrl = !isImg1Hidden ? String(q.image_url || "").trim() : "";
  const safeImg2Url = !isImg2Hidden ? String(q.image_2_url || "").trim() : "";
  const validImg1 = Boolean(safeImgUrl && safeImgUrl !== "undefined" && safeImgUrl !== "null");
  const validImg2 = Boolean(safeImg2Url && safeImg2Url !== "undefined" && safeImg2Url !== "null");
  const hasAnyImg = validImg1 || validImg2;

  const splitSub = hasAnyImg
    ? splitTrailingSubNumberText(textToRender)
    : { isTrailingSubNum: false, introText: textToRender, subMarkerText: "" };

  const isTrailingSubNum = splitSub.isTrailingSubNum;
  const isCompactSingleCol = col === 1 && split >= 4;
  const topMarginClass = sIdx > 0 ? (isCompactSingleCol ? "mt-3" : isTrailingSubNum ? "mt-8" : "mt-16") : "";
  let maxHeightStyle = " max-height: 250px;";
  if (isAdmissionMode) {
    maxHeightStyle = "";
  } else if (col === 1) {
    if (split >= 6) maxHeightStyle = " max-height: 95px;";
    else if (split >= 4) maxHeightStyle = " max-height: 150px;";
    else if (split === 2) maxHeightStyle = " max-height: 240px;";
    else maxHeightStyle = " max-height: 340px;";
  }
  const imgMarginClass = isCompactSingleCol ? "mt-1.5 mb-1" : "mt-4 mb-3";

  if (isTrailingSubNum) {
    const introHtml = splitSub.introText
      ? `<div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify ${isCompactSingleCol ? 'mb-1.5' : 'mb-3'}">${formatQText(splitSub.introText)}</div>`
      : "";

    // 🌟 이미지 1과 이미지 2가 모두 있는 서브문항이면:
    // 이미지 1은 공통 그림이므로 상단 중앙에 먼저 배치하고, 서브문항 번호((1))는 이미지 2의 좌측에 나란히 배치!
    if (validImg1 && validImg2) {
      const w1 = getBoxWidth(q.image_box, col, split);
      const w2 = getBoxWidth(q.image_2_box, col, split);
      const commonImg1Html = `<div class="w-full flex justify-center ${isCompactSingleCol ? 'mt-1 mb-2' : 'mt-2 mb-4'}"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w1};${maxHeightStyle}"></div>`;
      const inlineImg2Html = `<div class="w-full flex justify-start"><img src="${getCleanUrl(safeImg2Url)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w2};${maxHeightStyle}"></div>`;
      return `<div class="w-full min-w-0 math-protect ${topMarginClass}">${introHtml}${commonImg1Html}<div class="flex items-start gap-3"><div class="text-[17px] leading-[1.6] text-black tracking-wide font-semibold shrink-0 pt-0.5">${formatQText(splitSub.subMarkerText)}</div><div class="flex-1 min-w-0 flex flex-col gap-2 items-start">${inlineImg2Html}</div></div></div>`;
    }

    let inlineImgs = "";
    if (validImg1) {
      const w = getBoxWidth(q.image_box, col, split);
      inlineImgs += `<div class="w-full flex justify-start"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w};${maxHeightStyle}"></div>`;
    }
    if (validImg2) {
      const w = getBoxWidth(q.image_2_box, col, split);
      inlineImgs += `<div class="w-full flex justify-start"><img src="${getCleanUrl(safeImg2Url)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w};${maxHeightStyle}"></div>`;
    }
    return `<div class="w-full min-w-0 math-protect ${topMarginClass}">${introHtml}<div class="flex items-start gap-3"><div class="text-[17px] leading-[1.6] text-black tracking-wide font-semibold shrink-0 pt-0.5">${formatQText(splitSub.subMarkerText)}</div><div class="flex-1 min-w-0 flex flex-col gap-2 items-start">${inlineImgs}</div></div></div>`;
  }

  let imgHtml = "";
  if (validImg1) {
    const w = getBoxWidth(q.image_box, col, split);
    imgHtml += `<div class="w-full flex justify-center ${imgMarginClass}"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w};${maxHeightStyle}"></div>`;
  }
  if (validImg2) {
    const w = getBoxWidth(q.image_2_box, col, split);
    imgHtml += `<div class="w-full flex justify-center ${imgMarginClass}"><img src="${getCleanUrl(safeImg2Url)}" class="max-w-full object-contain mix-blend-multiply" style="width: ${w};${maxHeightStyle}"></div>`;
  }

  return `<div class="w-full min-w-0 math-protect ${topMarginClass}"><div class="flex items-start"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(textToRender)}</div></div>${imgHtml}</div>`;
};

// 🌟 [핵심 변경] 이중/삼중으로 꼬인 JSON 문자열도 끝까지 파고들어 width(%)를 기필코 찾아내는 초강력 파서
const getBoxWidth = (box: any, col: number = 2, split: number = 4) => {
  if (!box || box === 'null' || box === 'undefined') return 'auto';
  let parsed = box;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch(e) { break; }
    } else {
      break;
    }
  }
  if (parsed && typeof parsed === 'object' && parsed.width) {
    const rawPct = Number(parsed.width);
    if (!isNaN(rawPct) && rawPct > 0) {
      // 1단(전체 폭)일 때는 2단(반폭) 기준으로 저장된 width(%)가 2배로 커지지 않도록 비율 보정
      if (col === 1) {
        const scale = split === 1 ? 0.55 : 0.48;
        return `${Math.round(rawPct * scale * 10) / 10}%`;
      }
      return `${rawPct}%`;
    }
    return `${parsed.width}%`;
  }
  return 'auto';
};

export default function ExamViewerPage() {
  const router = useRouter();

  const examContainerRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const mathJaxRef = useRef(false);

  const zoomStateRef = useRef({ active: false, direction: 1, speed: 0.002 });
  const zoomRafRef = useRef<number | null>(null);
  const zoomDelayTimerRef = useRef<any>(null);

  const examStateRef = useRef<any>(null);
  const hiddenImageSetRef = useRef<Set<string>>(new Set());
  const currentScaleRef = useRef(1);
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const isNewExamRef = useRef<boolean>(false);
  const rebuildExamIdRef = useRef<string | null>(null);
  const currentExamIdRef = useRef<string | null>(null);
  
  const [savedExamId, setSavedExamId] = useState<string | null>(null);
  const [isExamDistributed, setIsExamDistributed] = useState<boolean>(false);

  const [layoutType, setLayoutType] = useState("선택없음"); 
  const [testWeek, setTestWeek] = useState<number>(getISOWeekKST());
  const [testDate, setTestDate] = useState<string>(getKSTDateString());
  const [isWeekPopupOpen, setIsWeekPopupOpen] = useState(false);
  const [weeklyTargetGrade, setWeeklyTargetGrade] = useState("");
  const [template, setTemplate] = useState("basic1");
  const [titleMode, setTitleMode] = useState("all");
  const [columns, setColumns] = useState(2);
  const [splits, setSplits] = useState(4);
  const [examDate, setExamDate] = useState("");
  const [examTitle, setExamTitle] = useState("시험지");
  const [displayBadge, setDisplayBadge] = useState("");
  
  const [colorNum, setColorNum] = useState("#175b6a");
  const [colorTitle, setColorTitle] = useState("#002864");
  const [colorLine, setColorLine] = useState("#94a3b8");
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  const [fontSize, setFontSize] = useState(16);

  const [zoomFactor, setZoomFactor] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState('1');
  const movingToTargetRef = useRef(false);
  const moveSettleTimerRef = useRef<any>(null);
  const buttonPageTimerRef = useRef<any>(null);
  const pendingButtonPageRef = useRef<number | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [isAdmissionLock, setIsAdmissionLock] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const [isSidebarFolded, setIsSidebarFolded] = useState(false);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);

  const [isBulkPrintMode, setIsBulkPrintMode] = useState(false);

  useEffect(() => {
    sessionStorage.setItem("restoreExamQuestions", "1");

    try {
      const saved = JSON.parse(localStorage.getItem(PALETTE_STORAGE_KEY) || "[]");
      if (Array.isArray(saved) && saved.length === 3) setPalette(saved);
    } catch (e) {}

    loadMathJax();
    initExamData();

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current && !isBulkPrintMode) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    window.onafterprint = () => {
      if (isBulkPrintMode) window.close();
    };

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.onafterprint = null;
      if (zoomDelayTimerRef.current) clearTimeout(zoomDelayTimerRef.current);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    };
  }, [isBulkPrintMode]);

  useEffect(() => {
    if (!movingToTargetRef.current && !buttonPageTimerRef.current) setPageInputValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const handleResize = () => { if (examStateRef.current) updatePreviewViewport(); };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [zoomFactor]);

  useEffect(() => {
    const timer = setTimeout(() => { if (examStateRef.current) updatePreviewViewport(); }, 350); 
    return () => clearTimeout(timer);
  }, [isSidebarFolded]);

  useEffect(() => {
    const wrapper = previewWrapperRef.current;
    if (!wrapper) return;

    let zoomRafPending = false;
    const handleWheel = (e: WheelEvent) => {
      if (!examStateRef.current) return;
      if (!(e.ctrlKey || e.metaKey)) return; 
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;

      const prevScale = currentScaleRef.current || 1;
      const w = previewWrapperRef.current;
      const anchorX = w ? (w.scrollLeft + w.clientWidth / 2) / prevScale : 0;
      const anchorY = w ? (w.scrollTop + w.clientHeight / 2) / prevScale : 0;

      setZoomFactor(prev => {
        const next = Math.min(2, Math.max(0.3, prev + direction * 0.1));
        if (!zoomRafPending) {
          zoomRafPending = true;
          requestAnimationFrame(() => {
            zoomRafPending = false;
            updatePreviewViewport(next);
            const wrap = previewWrapperRef.current;
            if (wrap) {
              const newScale = currentScaleRef.current || 1;
              wrap.scrollLeft = anchorX * newScale - wrap.clientWidth / 2;
              wrap.scrollTop = anchorY * newScale - wrap.clientHeight / 2;
            }
          });
        }
        return next;
      });
    };

    let scrollTrackTimer: any = null;
    const handleScroll = () => {
      if (scrollTrackTimer) return;
      scrollTrackTimer = setTimeout(() => {
        scrollTrackTimer = null;
        updateCurrentPageFromScroll();
      }, 100);
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    wrapper.addEventListener('scroll', handleScroll);
    return () => {
      wrapper.removeEventListener('wheel', handleWheel);
      wrapper.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] }, svg: { fontCache: 'global' } };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const nextFrame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  const buildBulkExamData = async (bulkItems: any[]) => {
    try {
      let finalBulkHtml = '';
      let totalPageCount = 0;
      const allQids = new Set<string>();

      for (const item of bulkItems) {
        if (item.type === 'hw') {
          item.examQuestions.forEach((id: string) => allQids.add(getRealId(id)));
        } else if (item.exam_id) {
          const { data: examItems } = await supabase.from('exam_item').select('question_id').eq('exam_id', item.exam_id);
          examItems?.forEach((i: any) => allQids.add(String(i.question_id)));
        }
      }

      const flatQIds = Array.from(allQids);
      const { data: questions } = await supabase.from('question_db').select('*').in('question_id', flatQIds);
      const qMap = new Map();
      questions?.forEach(q => qMap.set(String(q.question_id), q));

      for (let index = 0; index < bulkItems.length; index++) {
        const item = bulkItems[index];
        let orderedQuestions: any[] = [];
        let title = "시험지", badge = "", lType = "과제프린트";
        let initialCol = 2, initialSplit = 4, initialTitleMode = 'all', initialTmpl = 'basic1';
        let cNum = '#175b6a', cTit = '#002864', cLin = '#94a3b8', eDate = '';
        let userMergedTextQuestions: any[][] = [];

        if (item.type === 'hw') {
          title = item.examTitle || '과제 프린트';
          badge = item.examSubTitle || '';
          lType = item.examType || '과제프린트';
          
          item.examQuestions.forEach((qid: string, idx: number) => {
             const realId = getRealId(qid);
             const q = qMap.get(realId);
             if (q) orderedQuestions.push({ ...q, question_id: qid, sort_order: idx + 1 });
          });
        } else {
          const { data: examData } = await supabase.from('exam_master').select('*').eq('exam_id', item.exam_id).single();
          if (!examData) continue;
          
          badge = [examData.target_grade || examData.grade, examData.course || examData.course_name].filter(Boolean).join(' ');
          if (!badge) badge = examData.sub_title || '';
          title = examData.title || '시험지';
          lType = examData.exam_type || '선택없음';

          const dbLayoutSettings = examData.layout_settings || null;
          if (dbLayoutSettings) {
            const s = typeof dbLayoutSettings === 'string' ? JSON.parse(dbLayoutSettings) : dbLayoutSettings;
            if (s.column) initialCol = parseInt(s.column);
            if (s.split) initialSplit = parseInt(s.split);
            if (s.titleMode) initialTitleMode = s.titleMode;
            if (s.template) initialTmpl = s.template;
            if (s.numberColor) cNum = s.numberColor;
            if (s.titleColor) cTit = s.titleColor;
            if (s.lineColor) cLin = s.lineColor;
            if (s.examDate) eDate = s.examDate;
            if (s.userMergedTextQuestions) userMergedTextQuestions = s.userMergedTextQuestions;
            if (Array.isArray(s.hiddenImageQuestions)) {
              hiddenImageSetRef.current = new Set(s.hiddenImageQuestions.map(normalizeHiddenImgKey));
            } else {
              hiddenImageSetRef.current = new Set();
            }
          } else {
            hiddenImageSetRef.current = new Set();
          }

          const { data: examItems } = await supabase.from('exam_item').select('*').eq('exam_id', item.exam_id).order('sort_order');
          examItems?.forEach((i: any) => {
            const q = qMap.get(String(i.question_id));
            if (q) orderedQuestions.push({ ...q, sort_order: i.sort_order });
          });
        }

        const customGroupMap = new Map<string, string>();
        userMergedTextQuestions.forEach((arr: any[], idx: number) => {
            const gId = `custom_group_${idx}`;
            arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const groupMap = new Map<string, any>();
        orderedQuestions.forEach((q: any) => {
           let gId = customGroupMap.get(getRealId(q.question_id));
           if (!gId) gId = `single_${q.question_id}_${Math.random()}`;
           if (!groupMap.has(gId)) {
              groupMap.set(gId, { id: gId, questions: [], repQ: q, is_merged_text: !!customGroupMap.get(getRealId(q.question_id)) });
           }
           groupMap.get(gId).questions.push(q);
        });

        const groups = Array.from(groupMap.values());
        groups.forEach((g: any, idx: number) => {
          if (g.questions && g.questions.length > 1) {
            g.questions.sort(compareSubQuestions);
            g.repQ = g.questions[0];
          }
          g.sort_order = idx + 1;
          g.displayNum = idx + 1;
        });

        await Promise.all([
          document.fonts.load("400 17px 'NanumSquare'"),
          document.fonts.load("700 17px 'NanumSquare'"),
          document.fonts.load("normal 42px 'CJU_Medium'")
        ]).catch(() => {});

        const bulkDepth5Scope = await computeHeaderDepth5Scope(groups);
        const isBulkSingleColumn = initialCol === 1;
        const bulkGridClass = isBulkSingleColumn ? 'exam-grid-single' : 'exam-grid-admission';

        const probeHeaderFirst = buildHeaderHtml(badge, title, true, initialTmpl, eDate, {
          isFirstPage: true,
          depth5Scope: bulkDepth5Scope,
          questionCount: groups.length,
        });
        const probeHeaderOther = buildHeaderHtml(badge, title, false, initialTmpl, eDate, {
          isFirstPage: false,
          depth5Scope: bulkDepth5Scope,
          questionCount: groups.length,
        });
        const probeFooter = buildFooterHtml(badge, 0, 1, title, initialTmpl, eDate);

        const probe = document.createElement('div');
        probe.className = 'a3-page';
        probe.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
        probe.innerHTML = probeHeaderFirst + `<div class="${bulkGridClass} pt-6 pb-6"></div>` + probeFooter;
        document.body.appendChild(probe);
        await nextFrame();
        const grid = probe.querySelector(`.${bulkGridClass}`) as HTMLElement;
        const availableHeightFirst = grid.clientHeight;
        const columnWidth = isBulkSingleColumn ? grid.clientWidth : grid.clientWidth / 2;
        document.body.removeChild(probe);

        const probe2 = document.createElement('div');
        probe2.className = 'a3-page';
        probe2.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
        probe2.innerHTML = probeHeaderOther + `<div class="${bulkGridClass} pt-6 pb-6"></div>` + probeFooter;
        document.body.appendChild(probe2);
        await nextFrame();
        const grid2 = probe2.querySelector(`.${bulkGridClass}`) as HTMLElement;
        const availableHeightOther = grid2.clientHeight;
        document.body.removeChild(probe2);

        await measureGroupHeights(groups, columnWidth, initialCol, initialSplit);

        const maxPerColumn = initialCol === 1 ? Math.max(1, initialSplit) : (initialSplit === 1 ? 1 : Math.max(1, Math.floor(initialSplit / 2)));
        const bulkColGapPx = getColGapPx(initialCol, initialSplit);
        const usesSpecialFirstPageHeader = initialTitleMode === 'first' || ['academy_standard', 'summary_bar', 'clinic_note'].includes(initialTmpl);
        let targetCols = [];
        if (usesSpecialFirstPageHeader) {
          const pass1 = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn, bulkColGapPx, initialCol);
          const firstCols = pass1.slice(0, initialCol);
          const consumed = firstCols.reduce((sum, c) => sum + c.length, 0);
          const rem = groups.slice(consumed);
          const pass2 = rem.length > 0 ? chunkColumnsByHeight(rem, availableHeightOther - SAFETY_MARGIN_PX, maxPerColumn, bulkColGapPx, initialCol) : [];
          targetCols = firstCols.concat(pass2);
        } else {
          targetCols = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn, bulkColGapPx, initialCol);
        }

        const pages = [];
        if (initialCol === 1) {
          targetCols.forEach(c => pages.push({ left: c, right: null }));
        } else {
          for (let j = 0; j < targetCols.length; j += 2) pages.push({ left: targetCols[j], right: targetCols[j+1] || [] });
        }

        const isBulkDiag = lType === '입학테스트' || lType === '진단평가';
        if (isBulkDiag && (!badge || badge === '공통 과정')) {
          badge = extractDiagnosticBadge(orderedQuestions, title) || badge;
        }

        pages.forEach((pageCols, pIdx) => {
          const showTitle = !(initialTitleMode === 'first' && pIdx > 0);
          const hHtml = isBulkDiag ? `
            <div class="flex justify-between items-end border-b-[2px] border-slate-400 pb-3 shrink-0 w-full relative z-10 bg-white">
                <img src="${ADMISSION_HEADER_URL}" class="h-[104px] object-contain -mt-5" onerror="this.outerHTML='<h1 class=\\'text-4xl font-bold text-brand -mt-2\\'>진단평가</h1>'">
                <div class="mb-1"><div class="flex flex-col items-end gap-1">${eDate ? `<div class="text-[13px] font-bold text-slate-500">${formatExamDate(eDate)}</div>` : ''}${badge ? `<div class="text-slate-700 font-bold text-[14px] px-3 py-1 rounded-[4px] border border-slate-400 bg-white leading-tight">${badge}</div>` : ''}</div></div>
            </div>` : buildHeaderHtml(badge, title, showTitle, initialTmpl, eDate, {
              isFirstPage: pIdx === 0,
              depth5Scope: bulkDepth5Scope,
              questionCount: groups.length,
            });
          const fHtml = isBulkDiag ? `
            <div class="border-t-[2px] border-slate-400 pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20">
                <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
                <div class="absolute left-0 right-0 bottom-0 flex justify-center items-baseline gap-6 pb-[1px] pointer-events-none">
                    <div class="w-[150px] text-right text-[14px] font-semibold text-slate-800 whitespace-nowrap">${badge}</div>
                    <div class="text-[18px] text-slate-900 font-semibold whitespace-nowrap text-center tracking-wide">${pIdx + 1} / ${pages.length}</div>
                    <div class="w-[150px] text-left text-[14px] font-semibold text-slate-800 whitespace-nowrap">진단평가</div>
                </div>
                <img src="${LOGO_FOOTER_RIGHT_URL}" class="h-[22px] object-contain absolute right-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-bold text-[#006699] text-sm absolute right-0 bottom-0\\'>천종현수학연구소</span>'">
            </div>` : buildFooterHtml(badge, pIdx, pages.length, title, initialTmpl, eDate);
          
          const pageAvailH = (pIdx === 0 ? availableHeightFirst : availableHeightOther) - SAFETY_MARGIN_PX;
          let rHtml = '';
          if (isBulkSingleColumn) {
            rHtml = '';
          } else if (pageCols.right === null) {
            const h = showTitle ? availableHeightFirst : availableHeightOther;
            const lines = Array.from({ length: Math.ceil((h || 1587)/28) + 1 }).map(() => `<div style="height: 28px; border-bottom: 1px solid #e2e8f0; box-sizing: border-box;"></div>`).join('');
            rHtml = `<div class="w-full h-full min-w-0 flex flex-col pl-6" style="border-left: 1px dashed #cbd5e1; overflow: hidden;"><div class="text-[13px] font-bold text-slate-400 mb-2 tracking-widest">풀 이</div><div class="flex-1" style="overflow: hidden;">${lines}</div></div>`;
          } else {
            rHtml = generateLocalColHtml(pageCols.right, cNum, isBulkDiag, initialCol, initialSplit, pageAvailH);
          }
          finalBulkHtml += `<div class="a3-page" style="--color-num:${cNum}; --color-title:${cTit}; --color-line:${cLin};">${hHtml}<div class="${bulkGridClass} pt-6 pb-6">${generateLocalColHtml(pageCols.left, cNum, isBulkDiag, initialCol, initialSplit, pageAvailH)}${rHtml}</div>${fHtml}</div>`;
        });

        if (pages.length % 2 !== 0) {
          finalBulkHtml += `
            <div class="a3-page flex flex-col items-center justify-center bg-slate-50/20">
              <div class="text-slate-300 font-extrabold text-4xl tracking-[1em] opacity-40">여백</div>
              <div class="text-slate-300 font-bold text-sm mt-4 opacity-50">양면 인쇄 구분을 위한 빈 페이지입니다.</div>
            </div>`;
          totalPageCount += (pages.length + 1);
        } else {
          totalPageCount += pages.length;
        }
      }

      if (examContainerRef.current) {
        examContainerRef.current.innerHTML = finalBulkHtml;
        if ((window as any).MathJax?.typesetPromise) {
          (window as any).MathJax.typesetClear();
          try { await (window as any).MathJax.typesetPromise([examContainerRef.current]); } catch(e){}
        }
        shrinkOverflowingMath(examContainerRef.current);
        
        setIsSidebarFolded(true); 
        setTotalPages(totalPageCount);
        updatePreviewViewport();
        (window as any).__examRenderReady = true;

        setTimeout(() => {
          window.print();
        }, 500);
      }

    } catch (e: any) {
      if (examContainerRef.current) examContainerRef.current.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">에러: ${e.message}</div>`;
    }
  };

  const initExamData = async () => {
    const params = new URLSearchParams(window.location.search);
    const sourceParam = params.get('source');
    
    if (sourceParam === 'bulk') {
      setIsBulkPrintMode(true);
      const bulkDataStr = sessionStorage.getItem('bulkPrintData');
      if (bulkDataStr) {
        const bulkItems = JSON.parse(bulkDataStr);
        await buildBulkExamData(bulkItems);
      } else {
        if (examContainerRef.current) examContainerRef.current.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">출력할 데이터가 없습니다.</div>`;
      }
      return;
    }

    const urlExamId = params.get('exam_id') || params.get('id');

    let isNew = false;
    let title = "시험지";
    let badge = "";
    let lType = "선택없음";
    let dbLayoutSettings: any = null;
    let orderedQuestions: any[] = [];
    let wWeek: number | null = null;
    let wGrade = "";

    try {
      if (urlExamId) {
        currentExamIdRef.current = urlExamId;
        setSavedExamId(urlExamId);

        const { data: examData } = await supabase.from('exam_master').select('*').eq('exam_id', urlExamId).single();
        if (!examData) throw new Error("시험지를 찾을 수 없습니다.");
        
        badge = [examData.target_grade || examData.grade, examData.course || examData.course_name].filter(Boolean).join(' ');
        if (!badge) badge = examData.sub_title || '';
        title = examData.title || '시험지';
        lType = examData.exam_type || '선택없음';
        dbLayoutSettings = examData.layout_settings || null;
        wWeek = examData.test_week || null;
        wGrade = examData.target_grade || "";

        const { data: assignmentCheck } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', urlExamId).limit(1);
        setIsExamDistributed(!!(assignmentCheck && assignmentCheck.length > 0));

        const { data: examItems } = await supabase.from('exam_item').select('*').eq('exam_id', urlExamId).order('sort_order');
        const qIds = examItems?.map((i: any) => i.question_id) || [];
        const { data: questions } = await supabase.from('question_db').select('*').in('question_id', qIds);
        
        orderedQuestions = examItems?.map((item: any) => {
            const q = questions?.find(qu => qu.question_id === item.question_id);
            return q ? { ...q, sort_order: item.sort_order } : null;
        }).filter(Boolean) || [];

        let userMergedTextQuestions: any[][] = [];
        if (dbLayoutSettings && dbLayoutSettings.userMergedTextQuestions) {
           userMergedTextQuestions = dbLayoutSettings.userMergedTextQuestions;
        }

        const customGroupMap = new Map<string, string>();
        userMergedTextQuestions.forEach((arr: any[], idx: number) => {
            const gId = `custom_group_${idx}`;
            arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const groupMap = new Map<string, any>();
        orderedQuestions.forEach((q: any) => {
           let gId = customGroupMap.get(String(q.question_id));
           if (!gId) {
               gId = `single_${q.question_id}_${Math.random()}`;
           }

           if (!groupMap.has(gId)) {
              groupMap.set(gId, {
                 id: gId,
                 questions: [],
                 repQ: q,
                 is_merged_text: !!customGroupMap.get(String(q.question_id))
              });
           }
           groupMap.get(gId).questions.push(q);
        });

        let groups = Array.from(groupMap.values());
        const isDiag = lType === "입학테스트" || lType === "진단평가";
        if (isDiag && userMergedTextQuestions.length === 0 && orderedQuestions.length > 0) {
          const mergedBuilt = buildMergedQuestionGroups(orderedQuestions, true, true);
          groups = mergedBuilt.map((mg: any, idx: number) => ({
            id: mg.id,
            questions: mg.items,
            repQ: mg.items[0],
            is_merged_text: mg.is_merged_text,
            sort_order: idx + 1,
            displayNum: idx + 1,
          }));
        } else {
          groups.forEach((g: any, idx: number) => {
             if (g.questions && g.questions.length > 1) {
               g.questions.sort(compareSubQuestions);
               g.repQ = g.questions[0];
               g.is_merged_text = true;
             }
             g.sort_order = idx + 1;
             g.displayNum = idx + 1;
          });
        }

        let initialCol = 2, initialSplit = 4, initialTitleMode = 'all', initialTmpl = 'basic1';
        let cNum = '#175b6a', cTit = '#002864', cLin = '#94a3b8', eDate = '';

        if (dbLayoutSettings) {
          const s = typeof dbLayoutSettings === 'string' ? JSON.parse(dbLayoutSettings) : dbLayoutSettings;
          if (s.column) initialCol = parseInt(s.column);
          if (s.split) initialSplit = parseInt(s.split);
          if (s.titleMode) initialTitleMode = s.titleMode;
          if (s.template) initialTmpl = s.template;
          if (s.numberColor) cNum = s.numberColor;
          if (s.titleColor) cTit = s.titleColor;
          if (s.lineColor) cLin = s.lineColor;
          if (s.examDate) eDate = s.examDate;
          if (Array.isArray(s.hiddenImageQuestions)) {
            hiddenImageSetRef.current = new Set(s.hiddenImageQuestions.map(normalizeHiddenImgKey));
          } else {
            hiddenImageSetRef.current = new Set();
          }
        } else {
          hiddenImageSetRef.current = new Set();
        }

        const isDiagExam = lType === '입학테스트' || lType === '진단평가';
        if (isDiagExam) {
          lType = '입학테스트';
          if (!badge || badge === '공통 과정') {
            badge = extractDiagnosticBadge(orderedQuestions, title) || badge;
          }
        }

        setExamTitle(title);
        setDisplayBadge(badge);
        setLayoutType(lType);
        setIsAdmissionLock(isDiagExam);
        if (wWeek) setTestWeek(wWeek);
        if (wGrade) setWeeklyTargetGrade(wGrade);

        setColumns(initialCol); setSplits(initialSplit); setTitleMode(initialTitleMode); setTemplate(initialTmpl);
        setColorNum(cNum); setColorTitle(cTit); setColorLine(cLin); setExamDate(eDate);

        hasUnsavedChangesRef.current = false; 

        const depth5Scope = await computeHeaderDepth5Scope(groups);
        examStateRef.current = { groups, examTitle: title, displayBadge: badge, depth5Scope };

        Promise.all([
          document.fonts.load("400 17px 'NanumSquare'"),
          document.fonts.load("700 17px 'NanumSquare'"),
          document.fonts.load("normal 42px 'CJU_Medium'")
        ]).catch(() => {}).finally(() => {
          if (isDiagExam) renderAdmissionTestPages();
          else remeasureAndRender(initialCol, initialSplit, initialTitleMode, initialTmpl, eDate, title, badge);
        });

        return; 

      } else if (sessionStorage.getItem('examQuestions')) {
        isNew = true;
        isNewExamRef.current = true;
        
        const editOriginalType = sessionStorage.getItem('editOriginalType');
        const editOriginalId = sessionStorage.getItem('editOriginalId');
        const editMasterId = sessionStorage.getItem('editMasterId'); 
        const editExamId = sessionStorage.getItem('editExamId'); 

        let loadExamId = null;
        if (editOriginalType === 'exam') {
            loadExamId = editMasterId; 
            rebuildExamIdRef.current = editMasterId; 
        } else if (editExamId) {
            loadExamId = editExamId;
            rebuildExamIdRef.current = editExamId;
            isNew = false;
            isNewExamRef.current = false;
        } else {
            rebuildExamIdRef.current = null;
        }

        title = sessionStorage.getItem('examTitle') || '새로운 테스트';
        badge = sessionStorage.getItem('examSubTitle') || '';

        if (loadExamId) {
            const { data: origExam } = await supabase.from('exam_master').select('*').eq('exam_id', loadExamId).single();
            if (origExam) {
                title = origExam.title;
                badge = origExam.sub_title || '';
                lType = origExam.exam_type || '선택없음';
                dbLayoutSettings = origExam.layout_settings || null;
                wWeek = origExam.test_week || null;
                wGrade = origExam.target_grade || "";
            }
        } else {
            const sessionExamType = sessionStorage.getItem('examType');
            const sessionExamMode = sessionStorage.getItem('examMode');
            const sessionTestCategory = sessionStorage.getItem('testCategory');
            const isClinic = sessionStorage.getItem('isClinicMode') === 'true';
            
            if (sessionExamType === '오답유사' || isClinic) {
                lType = '오답유사';
                if (title === '새로운 테스트' || !title) title = '오답 유사 클리닉';
            } else if (sessionExamType) {
                lType = sessionExamType;
            } else if (sessionExamMode === 'test' && sessionTestCategory) {
                if (sessionTestCategory === '주간테스트') lType = '주간테스트';
                else if (sessionTestCategory === '중간테스트' || sessionTestCategory === '중간평가') lType = '중간평가';
                else if (sessionTestCategory === '분기테스트' || sessionTestCategory === '분기평가') lType = '분기평가';
                else if (sessionTestCategory === '단원테스트' || sessionTestCategory === '단원평가') lType = '단원평가';
                else if (sessionTestCategory === '진단평가' || sessionTestCategory === '입학테스트') lType = '입학테스트';
                else lType = '선택없음';
            } else {
                lType = '선택없음';
                try {
                    const step1Data = JSON.parse(sessionStorage.getItem('exam_step1_data') || '{}');
                    if (step1Data.examType === 'print') lType = '오답프린트';
                    else if (step1Data.examType === 'homework') lType = '과제프린트';
                } catch(e) {}
            }

            if (lType === '주간테스트' && (title === '새로운 테스트' || !title)) {
                title = getISOWeekKST(new Date(testDate + 'T00:00:00Z')) + '주차 평가';
            } else if (['중간평가', '분기평가', '단원평가'].includes(lType) && (title === '새로운 테스트' || !title)) {
                title = lType;
            }
        }

        const parsedData = JSON.parse(sessionStorage.getItem('examQuestions') || "[]");
        const flatQIds = parsedData.reduce((acc: string[], val: any) => acc.concat(Array.isArray(val) ? val.map(String) : [String(val)]), []);

        const realQIds = flatQIds.map((id: string) => getRealId(id));

        const { data: questions } = await supabase.from('question_db').select('*').in('question_id', realQIds);
        
        let userMergedTextQuestions: any[][] = [];
        if (sessionStorage.getItem('examUserMergedTextQuestions')) {
           userMergedTextQuestions = JSON.parse(sessionStorage.getItem('examUserMergedTextQuestions') || '[]');
        }

        const customGroupMap = new Map<string, boolean>();
        userMergedTextQuestions.forEach((arr: any[]) => {
            if (arr.length > 0) customGroupMap.set(getRealId(String(arr[0])), true); 
        });

        const groups: any[] = [];
        parsedData.forEach((group: any, gIdx: number) => {
            const qids = Array.isArray(group) ? group.map(String) : [String(group)];
            const items = qids.map((qid: string) => {
                const realId = getRealId(qid);
                const dbQ = questions?.find(qu => String(qu.question_id) === realId);
                return dbQ ? { ...dbQ, question_id: qid } : null; 
            }).filter(Boolean);

            if (items.length > 0) {
                const isMergedGroup = items.some((it: any) => customGroupMap.get(getRealId(String(it.question_id)))) || items.length > 1;
                if (items.length > 1) {
                    items.sort(compareSubQuestions);
                }
                const firstQid = items[0].question_id;
                groups.push({
                    id: `group_${gIdx}_${firstQid}`,
                    questions: items,
                    repQ: items[0],
                    sort_order: gIdx + 1,
                    displayNum: gIdx + 1,
                    is_merged_text: isMergedGroup
                });
            }
        });

        let initialCol = 2, initialSplit = 4, initialTitleMode = 'all', initialTmpl = 'basic1';
        let cNum = '#175b6a', cTit = '#002864', cLin = '#94a3b8', eDate = '';

        if (dbLayoutSettings) {
          const s = typeof dbLayoutSettings === 'string' ? JSON.parse(dbLayoutSettings) : dbLayoutSettings;
          if (s.column) initialCol = parseInt(s.column);
          if (s.split) initialSplit = parseInt(s.split);
          if (s.titleMode) initialTitleMode = s.titleMode;
          if (s.template) initialTmpl = s.template;
          if (s.numberColor) cNum = s.numberColor;
          if (s.titleColor) cTit = s.titleColor;
          if (s.lineColor) cLin = s.lineColor;
          if (s.examDate) eDate = s.examDate;
          if (Array.isArray(s.hiddenImageQuestions)) {
            hiddenImageSetRef.current = new Set(s.hiddenImageQuestions.map(normalizeHiddenImgKey));
          }
        }
        if (sessionStorage.getItem('examHiddenImageQuestions')) {
          try {
            const parsedHidden = JSON.parse(sessionStorage.getItem('examHiddenImageQuestions') || '[]');
            if (Array.isArray(parsedHidden)) {
              hiddenImageSetRef.current = new Set(parsedHidden.map(normalizeHiddenImgKey));
            }
          } catch (e) {}
        }

        let isDiagExam = lType === '입학테스트' || lType === '진단평가';
        // 진단평가는 반드시 30문항일 때만 진단평가 전용 양식으로 잠금 처리하고, 문항 수가 다르면(이전 세션 잔여값 등) 선택없음으로 폴백
        if (isDiagExam && groups.length !== 30) {
          isDiagExam = false;
          lType = '선택없음';
          if (title === '진단평가' || title === '입학테스트') {
            title = '새로운 테스트';
          }
        }
        if (isDiagExam) {
          lType = '입학테스트';
          if (!title || title === '새로운 테스트' || title === '시험지') {
            title = '진단평가';
          }
          if (!badge || badge === '공통 과정') {
            const majorGradeSession = sessionStorage.getItem('majorGrade') || '';
            badge = (majorGradeSession && majorGradeSession !== '공통 과정')
              ? majorGradeSession
              : (extractDiagnosticBadge(questions || [], title) || badge);
          }
        }

        setExamTitle(title);
        setDisplayBadge(badge);
        setLayoutType(lType);
        setIsAdmissionLock(isDiagExam);
        if (wWeek) setTestWeek(wWeek);
        if (wGrade) setWeeklyTargetGrade(wGrade);

        setColumns(initialCol); setSplits(initialSplit); setTitleMode(initialTitleMode); setTemplate(initialTmpl);
        setColorNum(cNum); setColorTitle(cTit); setColorLine(cLin); setExamDate(eDate);

        hasUnsavedChangesRef.current = isNew;

        const depth5Scope = await computeHeaderDepth5Scope(groups);
        examStateRef.current = { groups, examTitle: title, displayBadge: badge, depth5Scope };

        Promise.all([
          document.fonts.load("400 17px 'NanumSquare'"),
          document.fonts.load("700 17px 'NanumSquare'"),
          document.fonts.load("normal 42px 'CJU_Medium'")
        ]).catch(() => {}).finally(() => {
          if (isDiagExam) renderAdmissionTestPages();
          else remeasureAndRender(initialCol, initialSplit, initialTitleMode, initialTmpl, eDate, title, badge);
        });

        return; 
      } else {
        throw new Error("시험지 정보가 없습니다.");
      }

    } catch (e: any) {
      if (examContainerRef.current) examContainerRef.current.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">에러: ${e.message}</div>`;
    }
  };

  const shrinkOverflowingMath = (scopeEl: HTMLElement) => {
    scopeEl.querySelectorAll('mjx-container').forEach((mjx: any) => {
        mjx.style.zoom = ''; 
        const parent = mjx.parentElement;
        if (!parent) return;
        const availW = parent.clientWidth;
        const mathW = mjx.scrollWidth;
        if (availW > 0 && mathW > availW + 1) {
            mjx.style.zoom = Math.max(0.4, availW / mathW); 
        }
    });
  };

  const measureGroupHeights = async (groups: any[], columnWidth: number, col: number = 2, split: number = 4) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute; left:-9999px; top:0; width:${columnWidth}px; visibility:hidden;`;
    document.body.appendChild(probe);

    const isCompactSingleCol = col === 1 && split >= 4;
    groups.forEach((g, idx) => {
        const wrap = document.createElement('div');
        wrap.id = `measure-${idx}`;
        
        const isGroupMerged = g.is_merged_text && g.questions.length > 1;
        const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
        
        let subHtml = '';
        if (isGroupMerged && common) {
            subHtml += `<div class="w-full min-w-0 math-protect ${isCompactSingleCol ? 'mb-1.5' : 'mb-3'}"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
        }

        g.questions.forEach((q: any, sIdx: number) => {
            const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
            subHtml += buildSubQuestionItemHtml(q, sIdx, textToRender, hiddenImageSetRef.current, isAdmissionLock, col, split);
        });

        wrap.innerHTML = `<div class="flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
          <div class="flex items-start w-full min-w-0">
              <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                  <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${g.displayNum}</span>
              </div>
              <div class="flex flex-col w-full min-w-0 pt-[2px]">
                ${subHtml}
              </div>
          </div>
      </div>`;
        probe.appendChild(wrap);
    });

    const imgs = Array.from(probe.querySelectorAll('img'));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; })));

    if ((window as any).MathJax?.typesetPromise) {
        await (window as any).MathJax.typesetPromise([probe]);
    }
    await new Promise(res => setTimeout(res, 200));
    shrinkOverflowingMath(probe);
    await new Promise(res => setTimeout(res, 100));

    groups.forEach((g, idx) => {
        const el = document.getElementById(`measure-${idx}`);
        if(el) g.measuredHeight = el.offsetHeight;
    });
    document.body.removeChild(probe);
  };

  const chunkColumnsByHeight = (
    groups: any[],
    maxColumnHeight: number,
    maxPerColumn: number,
    colGapPx: number = COLUMN_GAP_PX,
    col: number = 2
  ) => {
    const columns = [];
    let i = 0;
    while (i < groups.length) {
        let placed = false;
        const maxTry = Math.min(maxPerColumn, groups.length - i);
        for (let count = maxTry; count >= 1; count--) {
            const slice = groups.slice(i, i + count);
            const gapTotal = colGapPx * (count - 1);
            const shareEach = (maxColumnHeight - gapTotal) / count;
            const totalMeasured = slice.reduce((sum, g) => sum + (g.measuredHeight || 0), 0);
            const allFit =
              slice.every(g => g.measuredHeight <= shareEach) ||
              (col === 1 && totalMeasured + gapTotal <= maxColumnHeight * 0.94);
            if (allFit) {
                columns.push(slice);
                i += count;
                placed = true;
                break;
            }
        }
        if (!placed) { columns.push([groups[i]]); i += 1; }
    }
    return columns;
  };

  const generateLocalColHtml = (
    cGroups: any[],
    numColorStr: string = 'var(--color-num)',
    isAdmCol: boolean = isAdmissionLock,
    col: number = columns,
    split: number = splits,
    availColHeight: number = 0
  ) => {
    if (!cGroups || cGroups.length === 0) return `<div class="flex flex-col flex-1 w-full min-w-0"></div>`;
    const gapMm = isAdmCol ? 15 : getColGapMm(col, split);
    const isCompactSingleCol = !isAdmCol && col === 1 && split >= 4;
    let cHtml = `<div class="flex flex-col flex-1 w-full min-w-0" style="gap: ${gapMm}mm;">`;
    
    cGroups.forEach(g => {
        const isGroupMerged = g.is_merged_text && g.questions.length > 1;
        const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
        
        let subHtml = '';
        if (isGroupMerged && common) {
            subHtml += `<div class="w-full min-w-0 math-protect ${isCompactSingleCol ? 'mb-1.5' : 'mb-3'}"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
        }

        const finalScore = g.questions[0].assigned_score || (isAdmissionLock ? getDiagnosticMainScore(g.displayNum ? g.displayNum - 1 : 0) : null);
        g.questions.forEach((q: any, sIdx: number) => {
            const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
            subHtml += buildSubQuestionItemHtml(q, sIdx, textToRender, hiddenImageSetRef.current, isAdmCol, col, split);
        });
        const scoreTagHtml = finalScore ? `<div class="mt-2 bg-[#d5d8df] text-[#625c86] font-extrabold text-[12px] px-2 py-0.5 rounded-[5px] leading-none whitespace-nowrap tracking-tight shadow-sm">${finalScore}점</div>` : '';
        
        cHtml += `
            <div class="flex-1 flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
                <div class="flex items-start w-full min-w-0">
                    <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                        <span style="font-family: 'CJU_Medium', sans-serif !important; color: ${numColorStr};" class="text-[42px] leading-[0.85] tracking-tighter">${g.displayNum}</span>
                        ${scoreTagHtml}
                    </div>
                    <div class="flex flex-col w-full min-w-0 pt-[2px]">${subHtml}</div>
                </div>
            </div>`;
    });

    // 🌟 1단 구성일 때 마지막 페이지 등에 문항 수가 분할 수(1, 2, 4, 6)보다 적으면
    // 빈 슬롯(flex-1)을 하단에 채워 위에서부터 정확히 1/N 분할 위치에 배치되도록 보장
    if (col === 1 && !isAdmCol) {
      const maxPerCol = Math.max(1, split);
      if (cGroups.length < maxPerCol) {
        const gapPx = getColGapPx(col, split);
        const effH = availColHeight > 0 ? availColHeight : 1200;
        const shareEach = (effH - gapPx * (maxPerCol - 1)) / maxPerCol;
        const allWithinSlot = cGroups.every(g => (g.measuredHeight || 0) <= shareEach);
        const totalMeasured = cGroups.reduce((s, g) => s + (g.measuredHeight || 0), 0);
        const fillerCount = allWithinSlot
          ? (maxPerCol - cGroups.length)
          : Math.max(
              0,
              Math.min(
                maxPerCol - cGroups.length,
                Math.floor((effH - totalMeasured - gapPx * Math.max(0, cGroups.length - 1)) / Math.max(1, shareEach + gapPx))
              )
            );
        for (let f = 0; f < fillerCount; f++) {
          cHtml += `<div class="flex-1 w-full min-w-0 pointer-events-none" aria-hidden="true"></div>`;
        }
      }
    }

    cHtml += '</div>';
    return cHtml;
  };

  const waitForFonts = async (currentArgs: [number, number, string, string, string, string, string]) => {
    const timeout = (ms: number) => new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
    const checkOne = (label: string, spec: string) => document.fonts.load(spec).then(() => 'ok').catch(() => 'fail');

    const fontsReady = Promise.all([
      checkOne('NanumSquare-400', "400 17px 'NanumSquare'"),
      checkOne('NanumSquare-700', "700 17px 'NanumSquare'"),
      checkOne('CJU_Medium', "normal 42px 'CJU_Medium'"),
    ]).then(() => document.fonts.ready).then(() => 'ready').catch((e) => 'error');

    const result = await Promise.race([fontsReady, timeout(5000)]);

    if (result === 'timeout') {
      fontsReady.then((r) => {
        if (r === 'ready' && examStateRef.current) remeasureAndRender(...currentArgs);
      });
    }
  };

  const remeasureAndRender = async (col: number = columns, split: number = splits, tMode: string = titleMode, tmpl: string = template, eDate: string = examDate, tit: string = examTitle, badge: string = displayBadge) => {
    if (!examStateRef.current) return;
    (window as any).__examRenderReady = false;
    await waitForFonts([col, split, tMode, tmpl, eDate, tit, badge]);
    const { groups, depth5Scope } = examStateRef.current;
    const isSingleColumn = col === 1;
    const gridClass = isSingleColumn ? 'exam-grid-single' : 'exam-grid-admission';

    const probeHeaderFirst = buildHeaderHtml(badge, tit, true, tmpl, eDate, {
      isFirstPage: true,
      depth5Scope: depth5Scope || '',
      questionCount: groups.length,
    });
    const probeHeaderOther = buildHeaderHtml(badge, tit, false, tmpl, eDate, {
      isFirstPage: false,
      depth5Scope: depth5Scope || '',
      questionCount: groups.length,
    });
    const probeFooter = buildFooterHtml(badge, 0, 1, tit, tmpl, eDate);

    const probe = document.createElement('div');
    probe.className = 'a3-page';
    probe.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
    probe.innerHTML = probeHeaderFirst + `<div class="${gridClass} pt-6 pb-6"></div>` + probeFooter;
    document.body.appendChild(probe);
    await nextFrame();

    const grid = probe.querySelector(`.${gridClass}`) as HTMLElement;
    const availableHeightFirst = grid.clientHeight;
    const columnWidth = isSingleColumn ? grid.clientWidth : grid.clientWidth / 2;
    document.body.removeChild(probe);

    const probe2 = document.createElement('div');
    probe2.className = 'a3-page';
    probe2.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
    probe2.innerHTML = probeHeaderOther + `<div class="${gridClass} pt-6 pb-6"></div>` + probeFooter;
    document.body.appendChild(probe2);
    await nextFrame();
    const grid2 = probe2.querySelector(`.${gridClass}`) as HTMLElement;
    const availableHeightOther = grid2.clientHeight;
    document.body.removeChild(probe2);

    await measureGroupHeights(groups, columnWidth, col, split);

    examStateRef.current = { ...examStateRef.current, availableHeightFirst, availableHeightOther, columnWidth };
    await renderPages(col, split, tMode, tmpl, eDate, tit, badge);
  };

  const renderPages = async (col: number = columns, split: number = splits, tMode: string = titleMode, tmpl: string = template, eDate: string = examDate, tit: string = examTitle, badge: string = displayBadge) => {
    if (!examStateRef.current || !examContainerRef.current) return;

    const { groups, availableHeightFirst, availableHeightOther, depth5Scope } = examStateRef.current;
    const isSingleColumn = col === 1;
    const gridClass = isSingleColumn ? 'exam-grid-single' : 'exam-grid-admission';
    const maxPerColumn = col === 1 ? Math.max(1, split) : (split === 1 ? 1 : Math.max(1, Math.floor(split / 2)));
    const colGapPx = getColGapPx(col, split);
    
    let targetCols = [];
    const usesSpecialFirstPageHeader = tMode === 'first' || ['academy_standard', 'summary_bar', 'clinic_note'].includes(tmpl);
    if (usesSpecialFirstPageHeader) {
      const pass1 = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn, colGapPx, col);
      const firstCols = pass1.slice(0, col);
      const consumed = firstCols.reduce((sum, c) => sum + c.length, 0);
      const rem = groups.slice(consumed);
      const pass2 = rem.length > 0 ? chunkColumnsByHeight(rem, availableHeightOther - SAFETY_MARGIN_PX, maxPerColumn, colGapPx, col) : [];
      targetCols = firstCols.concat(pass2);
    } else {
      targetCols = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn, colGapPx, col);
    }

    const pages = [];
    if (col === 1) {
      targetCols.forEach(c => pages.push({ left: c, right: null }));
    } else {
      for (let j = 0; j < targetCols.length; j += 2) pages.push({ left: targetCols[j], right: targetCols[j+1] || [] });
    }

    let finalHtml = '';
    pages.forEach((pageCols, pIdx) => {
      const showTitle = !(tMode === 'first' && pIdx > 0);
      const hHtml = buildHeaderHtml(badge, tit, showTitle, tmpl, eDate, {
        isFirstPage: pIdx === 0,
        depth5Scope: depth5Scope || '',
        questionCount: groups.length,
      });
      const fHtml = buildFooterHtml(badge, pIdx, pages.length, tit, tmpl, eDate);
      const pageAvailH = (pIdx === 0 ? availableHeightFirst : availableHeightOther) - SAFETY_MARGIN_PX;
      
      let rHtml = '';
      if (isSingleColumn) {
        rHtml = '';
      } else if (pageCols.right === null) {
        const h = pIdx === 0 ? availableHeightFirst : availableHeightOther;
        const lines = Array.from({ length: Math.ceil((h || 1587)/28) + 1 }).map(() => `<div style="height: 28px; border-bottom: 1px solid #e2e8f0; box-sizing: border-box;"></div>`).join('');
        rHtml = `<div class="w-full h-full min-w-0 flex flex-col pl-6" style="border-left: 1px dashed #cbd5e1; overflow: hidden;"><div class="text-[13px] font-bold text-slate-400 mb-2 tracking-widest">풀 이</div><div class="flex-1" style="overflow: hidden;">${lines}</div></div>`;
      } else {
        rHtml = generateLocalColHtml(pageCols.right, 'var(--color-num)', isAdmissionLock, col, split, pageAvailH);
      }

      finalHtml += `<div class="a3-page">${hHtml}<div class="${gridClass} pt-6 pb-6">${generateLocalColHtml(pageCols.left, 'var(--color-num)', isAdmissionLock, col, split, pageAvailH)}${rHtml}</div>${fHtml}</div>`;
    });

    examContainerRef.current.innerHTML = finalHtml;
    
    if ((window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetClear();
      try { await (window as any).MathJax.typesetPromise([examContainerRef.current]); } catch(e){}
    }
    shrinkOverflowingMath(examContainerRef.current);
    
    setTotalPages(pages.length);
    updatePreviewViewport();
    (window as any).__examRenderReady = true;
  };

  const renderAdmissionTestPages = async (eDateOverride?: string) => {
    if (!examStateRef.current || !examContainerRef.current) return;
    (window as any).__examRenderReady = false;
    const { groups, examTitle, displayBadge } = examStateRef.current;
    
    const cols = [];
    let i = 0, qNum = 1;
    while (i < groups.length) {
        if ((qNum >= 1 && qNum <= 6) || (qNum >= 8 && qNum <= 9) || (qNum >= 22 && qNum <= 25)) {
            if (i + 1 < groups.length) { cols.push([groups[i], groups[i + 1]]); i += 2; qNum += 2; } 
            else { cols.push([groups[i]]); i += 1; qNum += 1; }
        } else {
            cols.push([groups[i]]); i += 1; qNum += 1;
        }
    }

    const pages = [];
    for (let j = 0; j < cols.length; j += 2) pages.push({ left: cols[j], right: cols[j + 1] || [] });

    let globalQNum = 1;
    let finalHtml = '';

    pages.forEach((pageCols, pIdx) => {
        const courseBadge = displayBadge ? `<div class="text-slate-700 font-bold text-[14px] px-3 py-1 rounded-[4px] border border-slate-400 bg-white leading-tight">${displayBadge}</div>` : '';
        const effectiveDate = eDateOverride !== undefined ? eDateOverride : examDate;
        const dateHtml = effectiveDate ? `<div class="text-[13px] font-bold text-slate-500">${formatExamDate(effectiveDate)}</div>` : '';
        const topRightStack = (dateHtml || courseBadge) ? `<div class="flex flex-col items-end gap-1">${dateHtml}${courseBadge}</div>` : '';
        const hHtml = `
            <div class="flex justify-between items-end border-b-[2px] border-slate-400 pb-3 shrink-0 w-full relative z-10 bg-white">
                <img src="${ADMISSION_HEADER_URL}" class="h-[104px] object-contain -mt-5" onerror="this.outerHTML='<h1 class=\\'text-4xl font-bold text-brand -mt-2\\'>진단평가</h1>'">
                <div class="mb-1">${topRightStack}</div>
            </div>`;

        const fHtml = `
            <div class="border-t-[2px] border-slate-400 pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20">
                <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
                <div class="absolute left-0 right-0 bottom-0 flex justify-center items-baseline gap-6 pb-[1px] pointer-events-none">
                    <div class="w-[150px] text-right text-[14px] font-semibold text-slate-800 whitespace-nowrap">${displayBadge}</div>
                    <div class="text-[18px] text-slate-900 font-semibold whitespace-nowrap text-center tracking-wide">${pIdx + 1} / ${pages.length}</div>
                    <div class="w-[150px] text-left text-[14px] font-semibold text-slate-800 whitespace-nowrap">진단평가</div>
                </div>
                <img src="${LOGO_FOOTER_RIGHT_URL}" class="h-[22px] object-contain absolute right-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-bold text-[#006699] text-sm absolute right-0 bottom-0\\'>천종현수학연구소</span>'">
            </div>`;

        const genCol = (cGroups: any[]) => {
            if (!cGroups || cGroups.length === 0) return `<div class="flex flex-col flex-1 w-full min-w-0"></div>`;
            let cHtml = '<div class="flex flex-col flex-1 w-full min-w-0 gap-[15mm]">';
            cGroups.forEach(g => {
                
                const isGroupMerged = g.is_merged_text && g.questions.length > 1;
                const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
                
                let subHtml = '';
                if (isGroupMerged && common) {
                    subHtml += `<div class="w-full min-w-0 math-protect mb-3"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
                }

                const finalScore = g.questions[0].assigned_score || (isAdmissionLock ? getDiagnosticMainScore(g.displayNum ? g.displayNum - 1 : 0) : null);
                g.questions.forEach((q: any, sIdx: number) => {
                    const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
                    subHtml += buildSubQuestionItemHtml(q, sIdx, textToRender, hiddenImageSetRef.current, true);
                });
                
                const scoreTagHtml = finalScore ? `<div class="mt-2 bg-[#d5d8df] text-[#625c86] font-extrabold text-[12px] px-2 py-0.5 rounded-[5px] leading-none whitespace-nowrap tracking-tight shadow-sm">${finalScore}점</div>` : '';
                cHtml += `
                    <div class="flex-1 flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
                        <div class="flex items-start w-full min-w-0">
                            <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                                <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${globalQNum}</span>
                                ${scoreTagHtml}
                            </div>
                            <div class="flex flex-col w-full min-w-0 pt-[2px]">${subHtml}</div>
                        </div>
                    </div>`;
                globalQNum++;
            });
            cHtml += '</div>';
            return cHtml;
        };

        finalHtml += `<div class="a3-page">${hHtml}<div class="exam-grid-admission pt-6 pb-6">${genCol(pageCols.left)}${genCol(pageCols.right)}</div>${fHtml}</div>`;
    });

    examContainerRef.current.innerHTML = finalHtml;
    if ((window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetClear();
      try { await (window as any).MathJax.typesetPromise([examContainerRef.current]); } catch(e){}
    }
    shrinkOverflowingMath(examContainerRef.current);
    
    setTotalPages(pages.length);
    updatePreviewViewport();
    (window as any).__examRenderReady = true;
  };

  const updatePreviewViewport = (zf: number = zoomFactor) => {
    if (!examContainerRef.current || !previewBoxRef.current || !previewWrapperRef.current) return;
    const pages = examContainerRef.current.querySelectorAll('.a3-page') as NodeListOf<HTMLElement>;
    if (pages.length === 0) return;

    let targetPage = currentPage;
    if (targetPage < 1) targetPage = 1;
    if (targetPage > pages.length) targetPage = pages.length;

    const page = pages[0];
    const pageW = page.offsetWidth; const pageH = page.offsetHeight;
    const pageGap = 24; 
    const availW = previewWrapperRef.current.clientWidth - 48;
    const availH = previewWrapperRef.current.clientHeight - 110; 
    
    const fitScale = Math.max(0.05, Math.min(availW / pageW, availH / pageH, 1));
    const scale = fitScale * zf;
    currentScaleRef.current = scale;

    examContainerRef.current.style.transform = `scale(${scale})`;
    examContainerRef.current.style.transformOrigin = 'top left';
    previewBoxRef.current.style.width = `${pageW * scale}px`;
    previewBoxRef.current.style.height = `${(pageH * pages.length + pageGap * (pages.length - 1)) * scale}px`;
  };

  const updateCurrentPageFromScroll = () => {
    if (movingToTargetRef.current) return; 
    if (!previewWrapperRef.current || !examContainerRef.current) return;
    const pages = examContainerRef.current.querySelectorAll('.a3-page');
    if (pages.length === 0) return;

    const wrapperRect = previewWrapperRef.current.getBoundingClientRect();
    const viewportCenterY = wrapperRect.top + wrapperRect.height / 2;
    let bestIdx = 0; let bestDist = Infinity;
    pages.forEach((p, i) => {
        const r = p.getBoundingClientRect();
        const pageCenterY = r.top + r.height / 2;
        const dist = Math.abs(pageCenterY - viewportCenterY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    setCurrentPage(bestIdx + 1);
  };

  const handlePageMove = (n: number): number | null => {
    if (isNaN(n)) return null;
    const pages = examContainerRef.current?.querySelectorAll('.a3-page') as NodeListOf<HTMLElement> | undefined;
    if (!pages || pages.length === 0) return null;
    const clamped = Math.max(1, Math.min(n, pages.length));
    setCurrentPage(clamped);
    setPageInputValue(String(clamped));
    movingToTargetRef.current = true;
    if (moveSettleTimerRef.current) clearInterval(moveSettleTimerRef.current);

    const wrap = previewWrapperRef.current;
    const container = examContainerRef.current;
    const box = previewBoxRef.current;
    if (wrap && container && box && pages[0]) {
      const scale = currentScaleRef.current || 1;
      const pageH = pages[0].offsetHeight;
      const pageGap = 24;
      const pageTopUnscaled = (clamped - 1) * (pageH + pageGap);
      const pageCenterUnscaled = pageTopUnscaled + pageH / 2;
      const targetTop = pageCenterUnscaled * scale - wrap.clientHeight / 2;
      const maxTop = Math.max(0, box.offsetHeight - wrap.clientHeight);
      wrap.scrollTo({ top: Math.max(0, Math.min(targetTop, maxTop)), behavior: 'smooth' });
    }
    
    if (wrap) {
      let lastTop: number | null = null;
      let stableCount = 0;
      const startedAt = Date.now();
      moveSettleTimerRef.current = setInterval(() => {
        const top = wrap.scrollTop;
        const stable = lastTop !== null && Math.abs(top - lastTop) < 0.5;
        stableCount = stable ? stableCount + 1 : 0;
        lastTop = top;
        if (stableCount >= 2 || Date.now() - startedAt > 2000) {
          clearInterval(moveSettleTimerRef.current);
          moveSettleTimerRef.current = null;
          movingToTargetRef.current = false;
          updateCurrentPageFromScroll();
        }
      }, 100);
    } else {
      movingToTargetRef.current = false;
    }
    return clamped;
  };

  const handlePageStep = (delta: number) => {
    const base = pendingButtonPageRef.current !== null ? pendingButtonPageRef.current : currentPage;
    const next = base + delta;
    pendingButtonPageRef.current = next;
    setPageInputValue(String(Math.max(1, next)));
    if (buttonPageTimerRef.current) clearTimeout(buttonPageTimerRef.current);
    buttonPageTimerRef.current = setTimeout(() => {
      buttonPageTimerRef.current = null;
      const target = pendingButtonPageRef.current;
      pendingButtonPageRef.current = null;
      if (target !== null) {
        const clamped = handlePageMove(target);
        if (clamped !== null) setPageInputValue(String(clamped));
      }
    }, 400);
  };

  const performZoomStep = useCallback(() => {
    if (!zoomStateRef.current.active) return;
    setZoomFactor(prev => {
      zoomStateRef.current.speed = Math.min(zoomStateRef.current.speed + 0.0004, 0.025);
      const step = zoomStateRef.current.direction * zoomStateRef.current.speed;
      const next = Math.min(2.0, Math.max(0.3, prev + step));
      requestAnimationFrame(() => updatePreviewViewport(next));
      return next;
    });
    zoomRafRef.current = requestAnimationFrame(performZoomStep);
  }, []);

  const handleZoom = (delta: number) => {
    setZoomFactor(prev => {
      const next = Math.min(2.0, Math.max(0.3, prev + delta));
      requestAnimationFrame(() => updatePreviewViewport(next));
      return next;
    });
  };

  const startZoom = (delta: number) => {
    if (zoomStateRef.current.active) return;
    const dir = delta > 0 ? 1 : -1;
    zoomStateRef.current = { active: true, direction: dir, speed: 0.002 }; 
    handleZoom(dir * 0.01);
    zoomDelayTimerRef.current = setTimeout(() => {
      if (zoomStateRef.current.active) zoomRafRef.current = requestAnimationFrame(performZoomStep);
    }, 150);
  };

  const stopZoom = () => {
    zoomStateRef.current.active = false;
    if (zoomDelayTimerRef.current) clearTimeout(zoomDelayTimerRef.current);
    if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
  };

  const handleSettingChange = (field: string, val: any) => {
    hasUnsavedChangesRef.current = true;
    
    if (field === 'colorNum') { setColorNum(val); return; }
    if (field === 'colorTitle') { setColorTitle(val); return; }
    if (field === 'colorLine') { setColorLine(val); return; }

    if (field === 'column') {
      const nextSplit = val === 2 && splits === 1 ? 4 : splits;
      setColumns(val);
      if (nextSplit !== splits) setSplits(nextSplit);
      remeasureAndRender(val, nextSplit, titleMode, template, examDate, examTitle, displayBadge);
    }
    if (field === 'split') {
      const nextCol = val === 1 ? 1 : columns;
      setSplits(val);
      if (nextCol !== columns) setColumns(nextCol);
      remeasureAndRender(nextCol, val, titleMode, template, examDate, examTitle, displayBadge);
    }
    if (field === 'titleMode') { setTitleMode(val); remeasureAndRender(columns, splits, val, template, examDate, examTitle, displayBadge); }
    if (field === 'template') { setTemplate(val); remeasureAndRender(columns, splits, titleMode, val, examDate, examTitle, displayBadge); }
    
    if (field === 'examTitle') {
      setExamTitle(val);
      if (examStateRef.current) examStateRef.current.examTitle = val;
      if (layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, examDate, val, displayBadge);
      else renderAdmissionTestPages();
    }
    if (field === 'displayBadge') {
      setDisplayBadge(val);
      if (examStateRef.current) examStateRef.current.displayBadge = val;
      if (layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, examDate, examTitle, val);
      else renderAdmissionTestPages();
    }
    if (field === 'examDate') {
      setExamDate(val);
      if (examStateRef.current) examStateRef.current.examDate = val;
      if (layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, val, examTitle, displayBadge);
      else renderAdmissionTestPages(val);
    }
    
    if (field === 'layoutType') {
      setLayoutType(val);
      setIsAdmissionLock(val === '입학테스트');

      let newExamTitle = examTitle;
      if (val === '주간테스트') {
        newExamTitle = getISOWeekKST(new Date(testDate + 'T00:00:00Z')) + "주차 평가";
        setExamTitle(newExamTitle);
      } else if (val === '오답유사') {
        newExamTitle = examTitle === '시험지' ? '오답 유사 클리닉' : examTitle;
        setExamTitle(newExamTitle);
      }

      if (val === '입학테스트') {
        if (examStateRef.current?.groups.length !== 30) {
          alert('입학테스트 문제는 30개로 고정되어 있습니다.');
          setLayoutType(layoutType); 
          setIsAdmissionLock(false);
          return;
        }
        renderAdmissionTestPages();
      } else {
        remeasureAndRender(columns, splits, titleMode, template, examDate, newExamTitle, displayBadge);
      }
    }
  };

  const savePalette = (hex: string, idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const newPal = [...palette];
    newPal[idx] = hex;
    setPalette(newPal);
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(newPal));
  };

  const handleWeeklyMetaChange = useCallback((grade: string) => {
    setWeeklyTargetGrade(grade);
  }, []);

  const handleWeekDateSelect = (d: string) => {
    setTestDate(d);
    setTestWeek(getISOWeekKST(new Date(d + 'T00:00:00Z')));
  };

  const saveExam = async (skipNav: boolean = false): Promise<boolean> => {
    setIsSaving(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const myTenantId = localStorage.getItem('logica_tenant_id'); 
      
      if (!instId) throw new Error("로그인 정보를 찾을 수 없습니다.");
      if (layoutType === '입학테스트' && examStateRef.current?.groups.length !== 30) throw new Error('입학테스트 문제는 30개로 고정되어 있습니다.');

      const flatQIds = examStateRef.current?.groups.reduce((acc: string[], g: any) => acc.concat(g.questions.map((q: any) => getRealId(q.question_id))), []) || [];
      
      let userMergedTextQuestions: string[][] = [];
      if (examStateRef.current?.groups) {
         userMergedTextQuestions = examStateRef.current.groups
            .filter((g: any) => (g.is_merged_text || (g.questions && g.questions.length > 1)) && g.questions && g.questions.length > 0)
            .map((g: any) => [...g.questions].sort(compareSubQuestions).map((q: any) => getRealId(q.question_id)));
      } else if (sessionStorage.getItem('examUserMergedTextQuestions')) {
         userMergedTextQuestions = JSON.parse(sessionStorage.getItem('examUserMergedTextQuestions') || '[]');
      }

      const hiddenImageQuestions = Array.from(hiddenImageSetRef.current || []);
      const finalLayoutSettings = { 
         column: columns, split: splits, titleMode, numberColor: colorNum, 
         titleColor: colorTitle, lineColor: colorLine, examDate: examDate || null, 
         template, userMergedTextQuestions, hiddenImageQuestions 
      };

      const isWeeklyTest = layoutType === '주간테스트';
      const weeklyFields = isWeeklyTest && weeklyTargetGrade 
        ? { test_week: testWeek, target_grade: weeklyTargetGrade } 
        : { test_week: null, target_grade: null };

      const summaryMetaFields = await computeExamSummaryMeta(
        examStateRef.current?.groups || [],
        displayBadge,
        examTitle,
        weeklyTargetGrade
      );

      const editOriginalType = sessionStorage.getItem('editOriginalType');
      const editOriginalId = sessionStorage.getItem('editOriginalId');

      const editExamId = sessionStorage.getItem('editExamId');

      let targetStudentId = editExamId ? null : (sessionStorage.getItem('clinicTargetStudentId') || sessionStorage.getItem('editStudentId'));
      let targetClassId = editExamId ? null : (sessionStorage.getItem('clinicTargetClassId') || sessionStorage.getItem('editClassId'));

      if (editOriginalType === 'hw' && editOriginalId) {
          const hwNum = Number(editOriginalId);
          const { data: origHw } = await supabase.from('homework_assignment').select('*').eq('homework_id', hwNum).single();
          if (origHw) {
              if (!targetStudentId) targetStudentId = origHw.target_student_id;
              if (!targetClassId) targetClassId = origHw.class_id;

              if (origHw.target_student_id) {
                 await supabase.from('student_homework_answer').delete().eq('homework_id', hwNum);
                 await supabase.from('student_homework_result').delete().eq('homework_id', hwNum);
                 await supabase.from('homework_assignment').delete().eq('homework_id', hwNum);
              } else {
                 await supabase.from('student_homework_answer').delete().eq('homework_id', hwNum).eq('student_id', targetStudentId);
                 await supabase.from('student_homework_result').delete().eq('homework_id', hwNum).eq('student_id', targetStudentId);
              }
          }
      }

      let examId = currentExamIdRef.current;

      const splitHwIdsStr = sessionStorage.getItem('splitHomeworkIds');
      
      const targetExamIdToRebuild = rebuildExamIdRef.current || editExamId;

      if (isNewExamRef.current || editOriginalId || splitHwIdsStr || targetExamIdToRebuild) {
        if (targetExamIdToRebuild) {
          const { error: rebuildErr } = await supabase.from('exam_master').update({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트',
            total_questions: flatQIds.length, instructor_id: instId,
            layout_settings: finalLayoutSettings, tenant_id: myTenantId, 
            ...weeklyFields,
            ...summaryMetaFields
          }).eq('exam_id', targetExamIdToRebuild);
          if (rebuildErr) throw new Error(`문제지 갱신 실패: ${rebuildErr.message}`);
          examId = targetExamIdToRebuild;
          await supabase.from('exam_item').delete().eq('exam_id', examId);
        } else {
          const { data, error: insertErr } = await supabase.from('exam_master').insert({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트',
            total_questions: flatQIds.length, instructor_id: instId,
            layout_settings: finalLayoutSettings, tenant_id: myTenantId, 
            ...weeklyFields,
            ...summaryMetaFields
          }).select().single();
          if (insertErr || !data) throw new Error(`새 문제지 생성 실패: ${insertErr?.message || '알 수 없는 오류'}`);
          examId = data.exam_id;
        }

        const items: any[] = []; let fIdx = 1;
        examStateRef.current?.groups.forEach((g: any, gIdx: number) => {
          const score = layoutType === '입학테스트' ? [2,3,4,5][(gIdx < 4 ? 0 : gIdx < 13 ? 1 : gIdx < 20 ? 2 : gIdx === 20 ? 3 : gIdx < 23 ? 0 : gIdx < 25 ? 1 : gIdx < 28 ? 2 : 3)] : null;
          g.questions.forEach((q: any) => items.push({ 
             exam_id: examId, 
             question_id: getRealId(q.question_id), 
             sort_order: fIdx++, 
             assigned_score: score 
          }));
        });
        const { error: itemsErr } = await supabase.from('exam_item').insert(items);
        if (itemsErr) throw new Error(`문항 저장 실패: ${itemsErr.message}`);
      } else {
        const { error: updateErr } = await supabase.from('exam_master').update({ title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트', layout_settings: finalLayoutSettings, ...weeklyFields, ...summaryMetaFields }).eq('exam_id', examId);
        if (updateErr) throw new Error(`레이아웃 설정 저장 실패: ${updateErr.message}`);
      }

      const splitCommonTqIdsStr = sessionStorage.getItem('splitCommonTqIds');
      if (splitHwIdsStr && splitCommonTqIdsStr) {
          const splitHwIds = JSON.parse(splitHwIdsStr);
          const splitCommonTqIds = JSON.parse(splitCommonTqIdsStr);
          
          const { data: hwData } = await supabase.from('homework_assignment').select('*').in('homework_id', splitHwIds);
          if (hwData) {
              for (const hw of hwData) {
                  const originalTqs = safeParseIds(hw.target_questions);
                  const remainderTqs = originalTqs.filter((id: number) => !splitCommonTqIds.includes(id));

                  if (remainderTqs.length === 0) {
                      await supabase.from('student_homework_answer').delete().eq('homework_id', hw.homework_id);
                      await supabase.from('student_homework_result').delete().eq('homework_id', hw.homework_id);
                      await supabase.from('homework_assignment').delete().eq('homework_id', hw.homework_id);
                  } else {
                      await supabase.from('homework_assignment').update({ target_questions: remainderTqs }).eq('homework_id', hw.homework_id);
                  }
              }
          }
      }

      const multiStudentsStr = sessionStorage.getItem('clinicTargetStudentIds');
      const targetStudents = (multiStudentsStr && !editExamId) ? JSON.parse(multiStudentsStr) : (targetStudentId ? [targetStudentId] : []);
      
      if (targetStudents.length > 0 && examId) {
          for (const stuId of targetStudents) {
              const { data: existAssign } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', examId).eq('student_id', stuId).maybeSingle();
              if (!existAssign) {
                  await supabase.from('exam_assignment').insert({
                      exam_id: examId,
                      student_id: stuId,
                      class_id: targetClassId || null,
                      status: '미응시'
                  });
              }
              const tasks: any[] = [];
              
              flatQIds.forEach((qId: string) => {
                  tasks.push({ student_id: stuId, task_type: '유형오답클리닉', question_id: qId, status: '대기' });
              });
              if (tasks.length > 0) await supabase.from('clinic_task').insert(tasks);
          }
      }

      hasUnsavedChangesRef.current = false;
      isNewExamRef.current = false; 
      currentExamIdRef.current = examId; 
      setSavedExamId(examId); 
      
      const keysToRemove = [
        'restoreExamQuestions', 'examQuestions', 'examTitle', 'examSubTitle', 'examType', 'examMode', 'testCategory', 'testSourceFilter', 'diagnosticQuestionIds', 'majorGrade', 'avgDifficulty', 'scopeStart', 'scopeEnd',
        'editOriginalType', 'editOriginalId', 'editStudentId', 'editClassId', 'editMasterId',
        'examUserMergedTextQuestions', 'examHiddenImageQuestions', 'clinicTargetStudentId', 'clinicTargetClassId', 'clinicTargetStudentIds',
        'editHomeworkId', 'editExamId', 'duplicateExamId', 'splitHomeworkIds', 'splitCommonTqIds', 'isClinicMode'
      ];
      keysToRemove.forEach(k => sessionStorage.removeItem(k));

      if (!skipNav) {
          if (targetStudents.length > 0) {
              alert('✅ 맞춤 문제지가 성공적으로 생성되어 학생 기기로 자동 배부되었습니다!\n(원본 과제들은 안전하게 분리/파기되었습니다.)');
              router.push('/learning');
          } else {
              alert('✅ 맞춤 문제지가 성공적으로 업데이트 되었습니다!\n문제지 관리 페이지로 이동합니다.');
              router.push('/exam-list');
          }
      }
      return true;
    } catch (e: any) {
      alert("저장 실패: " + e.message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!isBulkPrintMode) {
      await saveExam(true);
    }
    window.print();
  };

  const downloadPdfViaServer = async () => {
    setIsGeneratingPdf(true);
    try {
      if (!isBulkPrintMode) {
        const saved = await saveExam(true); 
        if (!saved) return; 
      }

      const examId = currentExamIdRef.current;
      if (!examId) throw new Error('저장된 시험지 ID를 찾을 수 없습니다.');

      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`/api/exam-pdf?exam_id=${examId}`, { 
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '서버 응답 오류');
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${examTitle || '시험지'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { 
      alert('PDF 생성 실패: ' + e.message); 
    } finally { 
      setIsGeneratingPdf(false); 
    }
  };

  const attemptLeave = (fn: () => void) => {
    if (hasUnsavedChangesRef.current && !isBulkPrintMode) { setPendingLeaveAction(() => fn); setUnsavedModalOpen(true); }
    else fn();
  };

  return (
    <div id="viewer-root" className="flex flex-col h-screen overflow-hidden bg-[#cbd5e1] font-pretendard">
      <style dangerouslySetInnerHTML={{__html: `
        @font-face { font-family: 'CJU_Medium'; src: local('청주대학교M'), local('CJU_Medium'), url('/CJU_Medium.ttf') format('truetype'); }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .a3-page { width: 297mm; height: 420mm; background: white; margin: 0; box-shadow: 0 10px 25px rgba(0,0,0,0.1); padding: 15mm 20mm; position: relative; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; will-change: transform; backface-visibility: hidden; transform: translateZ(0); }
        #exam-container { will-change: transform; backface-visibility: hidden; }
        .a3-page + .a3-page { margin-top: 24px; }
        
        .exam-grid-admission { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20mm; flex: 1; min-height: 0; width: 100%; position: relative; overflow: hidden; }
        .exam-grid-single { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; position: relative; overflow: hidden; }
        .exam-grid-admission::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background-color: var(--color-line); transform: translateX(-50%); }
        .math-protect { min-width: 0; max-width: 100%; word-break: keep-all; overflow-wrap: break-word; }
        mjx-container[display="true"] { max-width: 100% !important; overflow-x: auto !important; overflow-y: hidden !important; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
            html, body { width: 210mm; margin: 0 !important; padding: 0 !important; background: white; }
            .a3-page { width: 297mm; height: 420mm; zoom: 70.7071%; margin: 0 !important; padding: 15mm 20mm !important; box-shadow: none !important; border: none !important; page-break-after: auto !important; page-break-inside: avoid; display: flex !important; transform: none !important; }
            .no-print { display: none !important; }
            #exam-container { transform: none !important; }
            #preview-box { width: auto !important; height: auto !important; overflow: visible !important; box-shadow: none !important; margin: 0 !important; }
            body, .content-row, #preview-viewport, #preview-wrapper, #viewer-root { display: block !important; height: auto !important; overflow: visible !important; }
            .a3-page:last-child { page-break-after: auto !important; }
        }
      `}} />
      
      {isAdmissionLock && (
        <style dangerouslySetInnerHTML={{__html: `
          @page { size: A3 portrait; margin: 0; }
          @media print { html, body { width: 297mm !important; } .a3-page { width: 297mm !important; height: 419.5mm !important; zoom: 100% !important; } }
        `}} />
      )}

      {!isBulkPrintMode && (
        <ViewerHeader 
          isExamDistributed={isExamDistributed} 
          isNewExam={isNewExamRef.current} 
          currentExamId={currentExamIdRef.current} 
          onAttemptLeave={attemptLeave} 
        />
      )}

      <div className="content-row flex flex-1 min-h-0 relative">
        {!isBulkPrintMode && (
          <ViewerSidebar 
            isSidebarFolded={isSidebarFolded}
            setIsSidebarFolded={setIsSidebarFolded}
            isAdmissionLock={isAdmissionLock}
            titleMode={titleMode}
            template={template}
            colorNum={colorNum}
            colorTitle={colorTitle}
            colorLine={colorLine}
            palette={palette}
            columns={columns}
            splits={splits}
            examTitle={examTitle}
            displayBadge={displayBadge}
            examDate={examDate}
            layoutType={layoutType}
            testDate={testDate}
            isWeekPopupOpen={isWeekPopupOpen}
            setIsWeekPopupOpen={setIsWeekPopupOpen}
            savedExamId={savedExamId}
            weeklyTargetGrade={weeklyTargetGrade}
            isSaving={isSaving}
            isGeneratingPdf={isGeneratingPdf}
            handleSettingChange={handleSettingChange}
            savePalette={savePalette}
            handleWeekDateSelect={handleWeekDateSelect}
            handleWeeklyMetaChange={handleWeeklyMetaChange}
            setIsExamDistributed={setIsExamDistributed}
            saveExam={saveExam}
            handlePrint={handlePrint}
            downloadPdfViaServer={downloadPdfViaServer}
          />
        )}

        <main 
          id="preview-viewport" 
          className="flex-1 h-full flex flex-col overflow-hidden relative z-0" 
          style={{ 
            '--color-num': colorNum, 
            '--color-title': colorTitle, 
            '--color-line': colorLine, 
            '--q-font-size': `${fontSize}px` 
          } as React.CSSProperties}
        >
          {isSidebarFolded && !isBulkPrintMode && (
             <button onClick={() => setIsSidebarFolded(false)} className="absolute left-0 top-6 z-50 bg-white border border-slate-300 border-l-0 rounded-r-xl px-2.5 py-4 shadow-md hover:bg-slate-50 flex flex-col items-center gap-1.5 text-slate-500 hover:text-brand transition-colors">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                 <span className="text-[11px] font-black tracking-widest" style={{ writingMode: 'vertical-rl' }}>설정 펼치기</span>
             </button>
          )}

          <div ref={previewWrapperRef} id="preview-wrapper" className="flex-1 min-h-0 flex overflow-auto">
              <div ref={previewBoxRef} id="preview-box" className="bg-white" style={{ margin:'auto', overflow:'hidden', boxShadow:'0 10px 30px rgba(0,0,0,0.15)' }}>
                  <div ref={examContainerRef} id="exam-container"></div>
              </div>
          </div>

          <ViewerToolbar 
            currentPage={currentPage}
            totalPages={totalPages}
            pageInputValue={pageInputValue}
            setPageInputValue={setPageInputValue}
            handlePageMove={handlePageMove}
            handlePageStep={handlePageStep}
            zoomFactor={zoomFactor}
            startZoom={startZoom}
            stopZoom={stopZoom}
            resetZoom={() => {
              const prevScale = currentScaleRef.current || 1;
              const w = previewWrapperRef.current;
              const anchorX = w ? (w.scrollLeft + w.clientWidth / 2) / prevScale : 0;
              const anchorY = w ? (w.scrollTop + w.clientHeight / 2) / prevScale : 0;
              setZoomFactor(1);
              updatePreviewViewport(1);
              if (w) {
                const newScale = currentScaleRef.current || 1;
                w.scrollLeft = anchorX * newScale - w.clientWidth / 2;
                w.scrollTop = anchorY * newScale - w.clientHeight / 2;
              }
            }}
          />
        </main>
      </div>

      {unsavedModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-[70] no-print">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center">
                <p className="text-slate-700 font-bold mb-1">저장되지 않았습니다.</p>
                <p className="text-slate-500 text-sm mb-6">정말 나가시겠습니까?</p>
                <div className="flex flex-col gap-2">
                    <button onClick={async () => { await saveExam(true); setUnsavedModalOpen(false); if(pendingLeaveAction) pendingLeaveAction(); }} className="w-full bg-emerald-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 transition-colors">저장하고 나가기</button>
                    <button onClick={() => { setUnsavedModalOpen(false); hasUnsavedChangesRef.current = false; if(pendingLeaveAction) pendingLeaveAction(); }} className="w-full bg-white border border-slate-300 text-slate-600 px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors">저장하지 않고 나가기</button>
                    <button onClick={() => setUnsavedModalOpen(false)} className="w-full mt-2 text-slate-400 text-sm hover:underline">취소</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}