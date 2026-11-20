// src/lib/questionDuplicateAnalyzer.ts
import { isConfidentialExamText, isConfidentialQuestionObj } from "./confidentialExamGuard";

export interface WorkbookDuplicateSummary {
  count: number;
  inQuestionDb: boolean;
  internalDupCount: number;
  internalDupGroups: number;
  aliasBook?: string;
  aliasSharedPct?: number;
  crossDupBook?: string;
  crossDupPct?: number;
}

export interface QuestionDuplicateFlag {
  groupKey: string;
  dupCount: number;
  dupOrder: number;
  reason: "동일 지문·정답" | "동일 번호·정답";
}

export const hasAnyDuplicateSuspect = (meta?: WorkbookDuplicateSummary | null): boolean => {
  if (!meta) return false;
  return Boolean(
    meta.internalDupCount > 0 ||
      (meta.aliasBook && (meta.aliasSharedPct || 0) >= 70) ||
      (meta.crossDupBook && (meta.crossDupPct || 0) >= 60)
  );
};

export const normalizeMathTextForDup = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .normalize("NFC")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
};

const fnv1aHash32 = (str: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const isHiddenRow = (q: any): boolean =>
  Boolean(q && (q.is_hidden === true || q.is_hidden === "Y" || q.is_hidden === "true"));

const getVariantRoleKey = (q: any): { roleKey: string; isDerived: boolean } => {
  const qNum = String(q?.question_number || "").trim();
  const varMatch = qNum.match(/-((?:T|S)\d+)$/i);
  if (varMatch) {
    return { roleKey: `VAR_${varMatch[1].toUpperCase()}`, isDerived: true };
  }
  const deriv = String(q?.derivation_type || "").trim().toUpperCase();
  const pid = String(q?.parent_question_id || "").trim();
  const hasParent = Boolean(pid && pid.toLowerCase() !== "null" && pid.toLowerCase() !== "undefined");
  if (deriv === "TWIN" || deriv === "쌍둥이" || deriv === "유사" || deriv === "SIMILAR" || hasParent) {
    return {
      roleKey: `DERIV_${deriv || "TWIN"}_${hasParent ? pid.toLowerCase() : ""}`,
      isDerived: true,
    };
  }
  return { roleKey: "ORIG", isDerived: false };
};

const getQuestionDupFingerprints = (
  q: any,
  bundleName: string
): {
  textKey: string | null;
  slotKey: string | null;
  crossHash: number | null;
} => {
  const { roleKey, isDerived } = getVariantRoleKey(q);
  const rawQNum = String(q?.question_number || "")
    .normalize("NFC")
    .trim()
    .replace(/번$/g, "")
    .trim();
  const parenMatch = rawQNum.match(/\((\d+)\)/);
  const parenNum = parenMatch ? parseInt(parenMatch[1], 10) || 0 : 0;
  const subNum = parseInt(String(q?.sub_num ?? "0"), 10) || 0;
  const subSlot = `${subNum}_${parenNum}`;

  const normQ1 = normalizeMathTextForDup(q?.question);
  const normQ2 = normalizeMathTextForDup(q?.question_2);
  const combinedStem = `${normQ1}${normQ2 ? `||${normQ2}` : ""}`;
  const stemLen = normQ1.length + normQ2.length;
  const normAns = normalizeMathTextForDup(q?.answer);

  let textKey: string | null = null;
  // 본문 지문이 충분히 구체적(공백 제외 18자 이상)이고 서브번호·정답까지 완전히 동일한 경우 -> 페이지 오인식과 무관하게 확실한 중복
  if (stemLen >= 18 && (normAns.length > 0 || rawQNum !== "")) {
    textKey = `TXT::${roleKey}::${subSlot}::${combinedStem}::${normAns}`;
  }

  let slotKey: string | null = null;
  const pageNum =
    parseInt(String(q?.final_printed_page || q?.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;
  const isSequentialExam = /(?:분기\s*(?:평가|테스트)|중간\s*(?:평가|테스트)|단원\s*(?:평가|테스트))/i.test(
    bundleName
  );
  if (
    rawQNum &&
    rawQNum.toUpperCase() !== "NEW" &&
    (pageNum > 0 || isSequentialExam) &&
    (normAns.length > 0 || stemLen >= 6)
  ) {
    const effectivePage = isSequentialExam ? 0 : pageNum;
    slotKey = `SLOT::${roleKey}::${effectivePage}::${rawQNum.toLowerCase()}::${subSlot}::${combinedStem}::${normAns}`;
  }

  let crossHash: number | null = null;
  if (!isDerived) {
    if (stemLen >= 16) {
      crossHash = fnv1aHash32(`${subSlot}||${combinedStem}||${normAns}`);
    } else if (
      rawQNum &&
      rawQNum.toUpperCase() !== "NEW" &&
      normAns.length > 0 &&
      (pageNum > 0 || isSequentialExam || q?.taxonomy_id)
    ) {
      const effectivePage = isSequentialExam ? 0 : pageNum;
      const taxCode = String(q?.taxonomy_id || "").trim().toUpperCase();
      crossHash = fnv1aHash32(
        `SLOT_HASH::${effectivePage}::${rawQNum.toLowerCase()}::${subSlot}::${normAns}::${taxCode}`
      );
    }
  }

  return { textKey, slotKey, crossHash };
};

/**
 * 선택된 단일 교재(묶음) 내부에서 2중 이상 중복 적재된 문항들을 탐지하여 question_id별 배지 정보를 반환합니다.
 */
export function analyzeBookInternalDuplicates(
  rows: any[],
  targetBook?: string
): Map<string, QuestionDuplicateFlag> {
  const result = new Map<string, QuestionDuplicateFlag>();
  if (!Array.isArray(rows) || rows.length < 2) return result;

  const trimmedTarget = targetBook ? String(targetBook).normalize("NFC").trim() : "";
  const candidates = rows.filter((q) => {
    if (!q || !q.question_id || isHiddenRow(q)) return false;
    if (!trimmedTarget) return true;
    if (q._linkedToSelectedBook) return true;
    const sb = String(q.source_book_name || "").normalize("NFC").trim();
    const bn = String(q.book_name || "").normalize("NFC").trim();
    return sb === trimmedTarget || bn === trimmedTarget;
  });

  if (candidates.length < 2) return result;

  const byTextKey = new Map<string, any[]>();
  const bySlotKey = new Map<string, any[]>();

  for (const q of candidates) {
    const { textKey, slotKey } = getQuestionDupFingerprints(q, trimmedTarget);
    if (textKey) {
      const arr = byTextKey.get(textKey);
      if (arr) arr.push(q);
      else byTextKey.set(textKey, [q]);
    }
    if (slotKey) {
      const arr = bySlotKey.get(slotKey);
      if (arr) arr.push(q);
      else bySlotKey.set(slotKey, [q]);
    }
  }

  // 1차: 지문·정답 완전 일치 그룹
  byTextKey.forEach((group, key) => {
    if (group.length < 2) return;
    group.forEach((q, idx) => {
      const qid = String(q.question_id).trim();
      result.set(qid, {
        groupKey: key,
        dupCount: group.length,
        dupOrder: idx + 1,
        reason: "동일 지문·정답",
      });
    });
  });

  // 2차: 슬롯(페이지+번호+서브번호)+지문·정답 일치 그룹 (짧은 발문 문항 보완)
  bySlotKey.forEach((group, key) => {
    if (group.length < 2) return;
    if (group.every((q) => result.has(String(q.question_id).trim()))) return;
    group.forEach((q, idx) => {
      const qid = String(q.question_id).trim();
      if (!result.has(qid)) {
        result.set(qid, {
          groupKey: key,
          dupCount: group.length,
          dupOrder: idx + 1,
          reason: "동일 번호·정답",
        });
      }
    });
  });

  return result;
}

const taxSortLocal = (a: string, b: string) => {
  const order: Record<string, number> = { 초등학교: 1, 중학교: 2, 고등학교: 3 };
  if (order[a] && order[b] && order[a] !== order[b]) return order[a] - order[b];
  return String(a).localeCompare(String(b), "ko", { numeric: true });
};

/**
 * 전체 question_db 요약 행 + textbook 제목으로부터:
 * 1) 대외비(진단평가/입학테스트) 완전 배제된 교재 목록
 * 2) question_db 실제 존재 묶음 목록
 * 3) 묶음 내부 2중 적재 / 별칭 이중 노출(book_name ≠ source_book_name) / 타 묶음 복제 적재 통계
 * 를 고속 산출합니다.
 */
export function buildWorkbookIndexAndDuplicates(
  qbRows: any[],
  tbRowsOrTitles: Array<string | { book_id?: any; title?: any }>,
  tqRows?: Array<{ book_id?: any; question_id?: any }>
): {
  workbooks: string[];
  questionDbBooks: string[];
  metaByBook: Record<string, WorkbookDuplicateSummary>;
} {
  const bookIdToTitle = new Map<string, string>();
  const cleanTitles: string[] = [];

  for (const item of tbRowsOrTitles || []) {
    if (typeof item === "string") {
      const t = item.normalize("NFC").trim();
      if (t && !isConfidentialExamText(t)) cleanTitles.push(t);
    } else if (item && typeof item === "object") {
      const t = String(item.title || "").normalize("NFC").trim();
      if (t && !isConfidentialExamText(t)) {
        cleanTitles.push(t);
        const bid = String(item.book_id ?? "").trim();
        if (bid) bookIdToTitle.set(bid, t);
      }
    }
  }

  // bundleName -> Map<qid, row>
  const bundleRowsMap = new Map<string, Map<string, any>>();
  // question_db의 source_book_name 또는 book_name에 직접 등장한 묶음 집합
  const directQdbBookSet = new Set<string>();
  // qid -> row (비대외비 유효 문항 전체 맵)
  const validRowByQid = new Map<string, any>();
  // qid -> string[] (bundleNames)
  const qidToBundles = new Map<string, string[]>();

  const registerRowToBundle = (bName: string, qid: string, q: any) => {
    let bMap = bundleRowsMap.get(bName);
    if (!bMap) {
      bMap = new Map<string, any>();
      bundleRowsMap.set(bName, bMap);
    }
    if (!bMap.has(qid)) {
      bMap.set(qid, q);
      if (!isHiddenRow(q)) {
        let bList = qidToBundles.get(qid);
        if (!bList) {
          bList = [];
          qidToBundles.set(qid, bList);
        }
        bList.push(bName);
      }
    }
  };

  for (let i = 0; i < (qbRows || []).length; i++) {
    const q = qbRows[i];
    if (!q || isConfidentialQuestionObj(q)) continue;
    const qid = String(q.question_id || "").trim();
    if (!qid) continue;

    validRowByQid.set(qid, q);
    validRowByQid.set(qid.toLowerCase(), q);

    const sb = String(q.source_book_name || "").normalize("NFC").trim();
    const bn = String(q.book_name || "").normalize("NFC").trim();

    const names: string[] = [];
    if (sb && !isConfidentialExamText(sb)) names.push(sb);
    if (bn && bn !== sb && !isConfidentialExamText(bn)) names.push(bn);
    if (names.length === 0) continue;

    for (const bName of names) {
      directQdbBookSet.add(bName);
      registerRowToBundle(bName, qid, q);
    }
  }

  // textbook_question 매핑으로 연결된 문항도 해당 교재 묶음 수량·중복 분석에 빠짐없이 편입
  if (Array.isArray(tqRows) && tqRows.length > 0 && bookIdToTitle.size > 0) {
    for (let i = 0; i < tqRows.length; i++) {
      const tq = tqRows[i];
      if (!tq) continue;
      const bid = String(tq.book_id ?? "").trim();
      const rawQid = String(tq.question_id ?? "").trim();
      if (!bid || !rawQid) continue;
      const bTitle = bookIdToTitle.get(bid);
      if (!bTitle) continue;
      const qRow = validRowByQid.get(rawQid) || validRowByQid.get(rawQid.toLowerCase());
      if (!qRow) continue;
      const canonicalQid = String(qRow.question_id || rawQid).trim();
      registerRowToBundle(bTitle, canonicalQid, qRow);
    }
  }

  const questionDbBooks = Array.from(directQdbBookSet).sort(taxSortLocal);
  const allBundleKeys = Array.from(bundleRowsMap.keys());
  const workbooks = Array.from(new Set([...cleanTitles, ...allBundleKeys]))
    .filter((b) => b && !isConfidentialExamText(b))
    .sort(taxSortLocal);

  const metaByBook: Record<string, WorkbookDuplicateSummary> = {};
  for (const w of workbooks) {
    metaByBook[w] = {
      count: 0,
      inQuestionDb: directQdbBookSet.has(w),
      internalDupCount: 0,
      internalDupGroups: 0,
    };
  }

  // 묶음별 지문 해시 맵 (타 묶음 복제 탐지용): hash -> Array<{ book: string; qids: Set<string> }>
  const hashToBooks = new Map<number, Map<string, string>>();
  const bundleHashSetMap = new Map<string, Map<number, string>>();

  // 1) 각 묶음의 활성 문항 수 및 내부 2중 중복(internalDupCount) 계산
  bundleRowsMap.forEach((qMap, bName) => {
    const activeRows: any[] = [];
    qMap.forEach((row) => {
      if (!isHiddenRow(row)) activeRows.push(row);
    });

    const summary = metaByBook[bName];
    if (!summary) return;
    summary.count = activeRows.length;

    const textSeen = new Map<string, number>();
    const slotSeen = new Map<string, number>();
    const countedDupQids = new Set<string>();
    const countedGroupKeys = new Set<string>();
    const myHashes = new Map<number, string>();

    for (const q of activeRows) {
      const qid = String(q.question_id).trim();
      const { textKey, slotKey, crossHash } = getQuestionDupFingerprints(q, bName);

      if (textKey) {
        const prev = textSeen.get(textKey) || 0;
        textSeen.set(textKey, prev + 1);
        if (prev >= 1) {
          countedDupQids.add(qid);
          countedGroupKeys.add(textKey);
        }
      }
      if (slotKey) {
        const prev = slotSeen.get(slotKey) || 0;
        slotSeen.set(slotKey, prev + 1);
        if (prev >= 1 && !countedDupQids.has(qid)) {
          countedDupQids.add(qid);
          countedGroupKeys.add(slotKey);
        }
      }

      if (crossHash !== null && !myHashes.has(crossHash)) {
        myHashes.set(crossHash, qid);
        let bDict = hashToBooks.get(crossHash);
        if (!bDict) {
          bDict = new Map<string, string>();
          hashToBooks.set(crossHash, bDict);
        }
        bDict.set(bName, qid);
      }
    }

    summary.internalDupCount = countedDupQids.size;
    summary.internalDupGroups = countedGroupKeys.size;
    if (myHashes.size >= 5) {
      bundleHashSetMap.set(bName, myHashes);
    }
  });

  // 2) 동일 question_id 별칭/이중노출 묶음 탐지 (book_name ≠ source_book_name 등)
  const sharedQidPairCounts = new Map<string, Map<string, number>>();
  qidToBundles.forEach((bList) => {
    if (bList.length < 2) return;
    for (let i = 0; i < bList.length; i++) {
      for (let j = i + 1; j < bList.length; j++) {
        const a = bList[i];
        const b = bList[j];
        let mapA = sharedQidPairCounts.get(a);
        if (!mapA) {
          mapA = new Map<string, number>();
          sharedQidPairCounts.set(a, mapA);
        }
        mapA.set(b, (mapA.get(b) || 0) + 1);

        let mapB = sharedQidPairCounts.get(b);
        if (!mapB) {
          mapB = new Map<string, number>();
          sharedQidPairCounts.set(b, mapB);
        }
        mapB.set(a, (mapB.get(a) || 0) + 1);
      }
    }
  });

  sharedQidPairCounts.forEach((otherMap, bName) => {
    const summary = metaByBook[bName];
    if (!summary || summary.count < 3) return;
    let bestOther = "";
    let bestShared = 0;
    otherMap.forEach((cnt, otherName) => {
      if (cnt > bestShared) {
        bestShared = cnt;
        bestOther = otherName;
      }
    });
    const pct = Math.round((bestShared / summary.count) * 100);
    if (bestOther && bestShared >= 3 && pct >= 70) {
      summary.aliasBook = bestOther;
      summary.aliasSharedPct = Math.min(100, pct);
    }
  });

  // 3) 서로 다른 question_id로 2중 파싱/적재된 타 묶음 복제 중복 탐지
  bundleHashSetMap.forEach((myHashes, bName) => {
    const summary = metaByBook[bName];
    if (!summary || myHashes.size < 5) return;

    const overlapCounts = new Map<string, number>();
    myHashes.forEach((myQid, h) => {
      const others = hashToBooks.get(h);
      if (!others || others.size < 2) return;
      others.forEach((otherQid, otherBook) => {
        if (otherBook === bName) return;
        // 동일 question_id는 이미 aliasBook에서 다루므로, 서로 다른 question_id로 2중 생성된 경우만 카운트
        if (otherQid === myQid) return;
        overlapCounts.set(otherBook, (overlapCounts.get(otherBook) || 0) + 1);
      });
    });

    let bestOther = "";
    let bestOverlap = 0;
    overlapCounts.forEach((cnt, otherBook) => {
      if (cnt > bestOverlap) {
        bestOverlap = cnt;
        bestOther = otherBook;
      }
    });

    const pct = Math.round((bestOverlap / myHashes.size) * 100);
    if (bestOther && bestOverlap >= 5 && pct >= 60) {
      summary.crossDupBook = bestOther;
      summary.crossDupPct = Math.min(100, pct);
    }
  });

  return {
    workbooks,
    questionDbBooks,
    metaByBook,
  };
}
