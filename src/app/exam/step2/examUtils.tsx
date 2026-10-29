// src/app/exam/step2/examUtils.tsx
import React from "react";

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null' || url === 'undefined') return '';
  let validUrl = String(url).trim();
  if (validUrl.startsWith('[')) { 
    try {
      const parsed = JSON.parse(validUrl);
      if (Array.isArray(parsed) && parsed.length > 0) validUrl = String(parsed[0] || '').trim();
    } catch(e) {} 
  }
  validUrl = validUrl.replace(/^["']|["']$/g, '').trim();
  const lower = validUrl.toLowerCase();
  if (!validUrl || lower === 'null' || lower === 'undefined') return '';
  if (!lower.startsWith('http') && !lower.startsWith('data:image') && !lower.startsWith('blob:')) {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfwlmbwornivkrvoeqdh.supabase.co';
    const cleanPath = validUrl.replace(/^\/+/, '').replace(/^question_images\/+/, '');
    validUrl = `${SUPABASE_URL}/storage/v1/object/public/question_images/${cleanPath}`;
  }
  return validUrl;
};

// 🌟 주교재(본교재) 및 워크북 판별·제외용 캐시 및 헬퍼 함수 (/lesson 교재 구분 연동)
export interface TextbookExclusionInfo {
  timestamp: number;
  mainBookTitles: Set<string>;
  mainQuestionIds: Set<string>;
  workbookBookTitles: Set<string>;
  workbookQuestionIds: Set<string>;
}

let cachedMainExclusion: TextbookExclusionInfo | null = null;

const NON_MAIN_BOOK_KEYWORDS_REGEX = /(?:추가\s*문제|추가\s*문항|_추가|추가_|추가|쌍둥이|TWIN|유사|SIMILAR|워크북|WORKBOOK|부교재|연산|주간\s*테스트|중간\s*테스트|분기\s*테스트|단원\s*테스트|단원\s*평가|입학\s*테스트|진단\s*평가|테스트|평가|보충|클리닉|프린트|모의고사|기출)/i;
const DERIVATIVE_OR_EXTRA_KEYWORDS_REGEX = /(?:추가\s*문제|추가\s*문항|_추가|추가_|추가|쌍둥이|TWIN|유사|SIMILAR)/i;

export const fetchMainTextbookExclusionSet = async (supabaseClient: any): Promise<TextbookExclusionInfo> => {
  if (cachedMainExclusion && Date.now() - cachedMainExclusion.timestamp < 60000) {
    return cachedMainExclusion;
  }
  const mainBookTitles = new Set<string>();
  const mainQuestionIds = new Set<string>();
  const workbookBookTitles = new Set<string>();
  const workbookQuestionIds = new Set<string>();

  try {
    let tbRows: any[] = [];
    let tbFrom = 0;
    while (true) {
      const { data, error } = await supabaseClient
        .from('textbook')
        .select('book_id, title, book_type')
        .range(tbFrom, tbFrom + 999);
      if (error || !data || data.length === 0) break;
      tbRows = tbRows.concat(data);
      if (data.length < 1000) break;
      tbFrom += 1000;
    }

    const mainBookIds: string[] = [];
    const workbookBookIds: string[] = [];

    if (Array.isArray(tbRows)) {
      tbRows.forEach((tb: any) => {
        const bType = String(tb.book_type || '').trim();
        const bTitle = String(tb.title || '').trim();
        if (!bTitle) return;

        // 1) 워크북: textbook.book_type 이 '워크북'(또는 '과제')이거나 제목에 워크북이 포함된 교재
        if (
          (bType === '워크북' || bType === '과제' || /(?:워크북|WORKBOOK)/i.test(bTitle)) &&
          !DERIVATIVE_OR_EXTRA_KEYWORDS_REGEX.test(bTitle)
        ) {
          workbookBookTitles.add(bTitle);
          if (tb.book_id) workbookBookIds.push(String(tb.book_id).trim());
          return;
        }

        // 2) 주교재: textbook.book_type 이 '주교재'/'본교재'이거나 비-메인 키워드가 없는 교재
        if (
          (bType === '주교재' || bType === '본교재' || !bType) &&
          !NON_MAIN_BOOK_KEYWORDS_REGEX.test(bTitle)
        ) {
          mainBookTitles.add(bTitle);
          if (tb.book_id) mainBookIds.push(String(tb.book_id).trim());
        }
      });
    }

    const mainBookIdSet = new Set(mainBookIds);
    const workbookBookIdSet = new Set(workbookBookIds);
    const allTargetBookIds = Array.from(new Set([...mainBookIds, ...workbookBookIds]));

    if (allTargetBookIds.length > 0) {
      let from = 0;
      const step = 1000;
      while (true) {
        const { data: tqRows, error } = await supabaseClient
          .from('textbook_question')
          .select('book_id, question_id')
          .in('book_id', allTargetBookIds)
          .range(from, from + step - 1);
        if (error || !tqRows || tqRows.length === 0) break;
        tqRows.forEach((r: any) => {
          if (!r.question_id) return;
          const qid = String(r.question_id).trim();
          const bid = String(r.book_id || '').trim();
          if (workbookBookIdSet.has(bid)) {
            workbookQuestionIds.add(qid);
          } else if (mainBookIdSet.has(bid)) {
            mainQuestionIds.add(qid);
          }
        });
        if (tqRows.length < step) break;
        from += step;
      }
    }
  } catch (e) {
    console.error('주교재/워크북 제외 목록 조회 실패:', e);
  }

  cachedMainExclusion = {
    timestamp: Date.now(),
    mainBookTitles,
    mainQuestionIds,
    workbookBookTitles,
    workbookQuestionIds,
  };
  return cachedMainExclusion;
};

// 🌟 문항이 '워크북' 문항인지 판별하는 헬퍼 (/lesson의 워크북 DB 및 교재명 연동)
export const isWorkbookQuestion = (
  q: any,
  exclusion?: Partial<TextbookExclusionInfo> | null
): boolean => {
  if (!q) return false;

  // 1) 쌍둥이(TWIN) / 유사(SIMILAR) 파생 문항은 워크북 원본 문항이 아님
  const deriv = String(q.derivation_type || '').trim().toUpperCase();
  if (deriv === 'TWIN' || deriv === '쌍둥이' || deriv === '유사' || deriv === 'SIMILAR') {
    return false;
  }
  const pType = String(q.problem_type || '').trim().toUpperCase();
  if (pType === '쌍둥이' || pType === '유사' || pType === 'TWIN' || pType === 'SIMILAR') {
    return false;
  }

  const bookName = String(q.book_name || '').trim();
  const sourceBookName = String(q.source_book_name || '').trim();
  const pdfSource = String(q.pdf_source || '').trim();
  const combinedBook = `${bookName} ${sourceBookName} ${pdfSource}`.trim();

  // 2) 교재명에 추가문제, 쌍둥이, 유사 등이 명시된 경우 워크북 원본이 아니라 파생/추가 문항임
  if (DERIVATIVE_OR_EXTRA_KEYWORDS_REGEX.test(combinedBook)) {
    return false;
  }

  // 3) textbook(워크북) 및 textbook_question에 등록된 워크북 문항인지 확인
  const realQid = String(q.question_id || '').trim().replace(/_added_\d+$/, '');
  if (exclusion?.workbookQuestionIds?.has(realQid)) {
    return true;
  }
  if (bookName && exclusion?.workbookBookTitles?.has(bookName)) {
    return true;
  }
  if (sourceBookName && exclusion?.workbookBookTitles?.has(sourceBookName)) {
    return true;
  }

  // 4) 교재명에 '워크북' 또는 'WORKBOOK'이 포함된 경우
  if (/(?:워크북|WORKBOOK)/i.test(combinedBook)) {
    return true;
  }

  return false;
};

export const isMainTextbookQuestion = (
  q: any,
  exclusion?: Partial<TextbookExclusionInfo> | null
): boolean => {
  if (!q) return false;

  // 워크북 문항은 주교재가 아님 ('워크북 제외' 체크박스에서 별도 제어)
  if (isWorkbookQuestion(q, exclusion)) {
    return false;
  }

  // 1) 쌍둥이(TWIN) / 유사(SIMILAR) 파생 문항은 시험지 출제용 문항이므로 메인교재가 아님
  const deriv = String(q.derivation_type || '').trim().toUpperCase();
  if (deriv === 'TWIN' || deriv === '쌍둥이' || deriv === '유사' || deriv === 'SIMILAR') {
    return false;
  }
  const pType = String(q.problem_type || '').trim();
  if (pType === '쌍둥이' || pType === '유사' || pType === 'TWIN') {
    return false;
  }

  const bookName = String(q.book_name || '').trim();
  const sourceBookName = String(q.source_book_name || '').trim();
  const pdfSource = String(q.pdf_source || '').trim();
  const combinedBook = `${bookName} ${sourceBookName} ${pdfSource}`.trim();

  // 2) 교재명에 추가문제, 쌍둥이, 유사, 워크북, 부교재, 테스트, 평가 등이 포함되어 있으면 주교재가 아님
  if (NON_MAIN_BOOK_KEYWORDS_REGEX.test(combinedBook)) {
    return false;
  }

  // 3) textbook(주교재) 및 textbook_question에 등록된 메인교재 문항인지 확인
  const realQid = String(q.question_id || '').trim().replace(/_added_\d+$/, '');
  if (exclusion?.mainQuestionIds?.has(realQid)) {
    return true;
  }
  if (bookName && exclusion?.mainBookTitles?.has(bookName)) {
    return true;
  }
  if (sourceBookName && exclusion?.mainBookTitles?.has(sourceBookName)) {
    return true;
  }

  // 4) 교재 업로드(/book-upload)를 통해 올라가 book_name이 비어있고 source_book_name만 있는 일반 교재 문항
  if (!bookName && sourceBookName) {
    return true;
  }

  // 5) 로지카 본교재 명칭(예: 초등로지카 MAX 4-2, 초등로지카 Core 3-1 등)이면서 추가문제/쌍둥이/유사/워크북/테스트가 아닌 경우
  if (/(?:로지카|LOGICA)/i.test(combinedBook)) {
    return true;
  }

  return false;
};

// 🌟 문항이 '쌍둥이/유사' 문항인지 판별하는 헬퍼
export const isTwinOrSimilarQuestion = (q: any): boolean => {
  if (!q) return false;
  const deriv = String(q.derivation_type || '').trim().toUpperCase();
  if (deriv === 'TWIN' || deriv === '쌍둥이' || deriv === '유사' || deriv === 'SIMILAR') {
    return true;
  }
  const pType = String(q.problem_type || '').trim().toUpperCase();
  if (pType === '쌍둥이' || pType === '유사' || pType === 'TWIN' || pType === 'SIMILAR') {
    return true;
  }
  const bookName = String(q.book_name || '').trim();
  const sourceBookName = String(q.source_book_name || '').trim();
  const pdfSource = String(q.pdf_source || '').trim();
  const combinedBook = `${bookName} ${sourceBookName} ${pdfSource}`.trim();

  if (/(?:쌍둥이|TWIN|유사|SIMILAR)/i.test(combinedBook)) {
    return true;
  }

  const qNumStr = String(q.question_number || '').trim();
  if (/-(?:T|S)\d+$/i.test(qNumStr)) {
    return true;
  }

  const hasExplicitExtraBook = /(?:추가\s*문제|추가\s*문항|_추가|추가_|추가)/i.test(combinedBook);
  if (!hasExplicitExtraBook) {
    const pid = String(q.parent_question_id || '').trim();
    if (pid && pid !== 'null' && pid !== 'undefined') {
      return true;
    }
    if (q.parent_relations && String(q.parent_relations) !== 'null') {
      let parsed = q.parent_relations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === 'object' && (parsed.twin_id || parsed.similars_ids || parsed.similar_ids)) {
        return true;
      }
    }
  }

  return false;
};

// 🌟 Step 1 & Step 2 '추가문제' / '쌍둥이/유사' / '주교재 제외' / '워크북 제외' 체크박스 필터 매칭 헬퍼
export const matchesSourceCategoryFilter = (
  q: any,
  sourceCategories?: {
    extra?: boolean;
    twinSimilar?: boolean;
    excludeMain?: boolean;
    excludeWorkbook?: boolean;
  } | null,
  exclusion?: Partial<TextbookExclusionInfo> | null
): boolean => {
  if (!q) return false;
  const allowExtra = sourceCategories?.extra ?? true;
  const allowTwinSimilar = sourceCategories?.twinSimilar ?? true;
  const excludeMain = sourceCategories?.excludeMain ?? true;
  const excludeWorkbook = sourceCategories?.excludeWorkbook ?? true;

  // 1) 주교재 문항인 경우: '주교재 제외'가 체크되어 있으면 제외(false), 체크 해제되어 있으면 포함(true)
  if (isMainTextbookQuestion(q, exclusion)) {
    return !excludeMain;
  }

  // 2) 워크북 문항인 경우: '워크북 제외'가 체크되어 있으면 제외(false), 체크 해제되어 있으면 포함(true)
  if (isWorkbookQuestion(q, exclusion)) {
    return !excludeWorkbook;
  }

  // 3) 일반 출제 문항('추가문제' / '쌍둥이/유사'): book_name 또는 source_book_name 키워드 매칭
  if (!allowExtra && !allowTwinSimilar) return false;

  const bookName = String(q.book_name || '').trim();
  const sourceBookName = String(q.source_book_name || '').trim();
  const bookText = `${bookName} ${sourceBookName}`.trim();

  const hasExtraWord = bookText.includes('추가');
  const hasTwinSimilarWord =
    bookText.includes('쌍둥이') ||
    bookText.includes('유사');

  if (allowExtra && hasExtraWord) return true;
  if (allowTwinSimilar && hasTwinSimilarWord) return true;
  return false;
};

// 🌟 서브 분류(sub_taxonomy_id) 등으로 불러온 문항에 이미지가 누락된 경우
// textbook_question.raw_metadata, 부모 문항(parent_question_id), 또는 동일 출처/페이지/번호 문항에서 이미지를 자동 복원하고 DB에도 백필하는 헬퍼
export const hydrateMissingQuestionImages = async (supabaseClient: any, questionsArray: any[]) => {
  if (!Array.isArray(questionsArray) || questionsArray.length === 0) return;

  const hasValidImg = (val: any) =>
    Boolean(val && String(val).trim() !== '' && String(val) !== 'null' && String(val) !== 'undefined');

  // 1) 문항 자체의 raw_metadata / raw_source_tags 내부에 이미지가 들어있는 경우 우선 복원
  questionsArray.forEach((q: any) => {
    if (!q || hasValidImg(q.image_url)) return;
    const rawMeta = q.raw_metadata || q.raw_source_tags;
    if (rawMeta) {
      let parsed = rawMeta;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
      }
      if (parsed && typeof parsed === 'object') {
        if (hasValidImg(parsed.image_url)) q.image_url = parsed.image_url;
        if (!hasValidImg(q.image_2_url) && hasValidImg(parsed.image_2_url)) q.image_2_url = parsed.image_2_url;
        if (!q.image_box && parsed.image_box) q.image_box = parsed.image_box;
        if (!q.image_2_box && parsed.image_2_box) q.image_2_box = parsed.image_2_box;
        if (!hasValidImg(q.answer_image_url) && hasValidImg(parsed.answer_image_url)) q.answer_image_url = parsed.answer_image_url;
      }
    }
  });

  const stillMissing = questionsArray.filter((q: any) => q && !hasValidImg(q.image_url));
  if (stillMissing.length === 0) return;

  const toRealId = (qid: any) => String(qid || '').trim().replace(/_added_\d+$/, '');
  const missingIds = Array.from(new Set(stillMissing.map((q: any) => toRealId(q.question_id)).filter(Boolean)));
  const patchedDbPayloads = new Map<string, Record<string, any>>();

  // 2) textbook_question.raw_metadata 에서 복원
  try {
    for (let i = 0; i < missingIds.length; i += 100) {
      const chunk = missingIds.slice(i, i + 100);
      const { data: tqRows } = await supabaseClient
        .from('textbook_question')
        .select('question_id, raw_metadata')
        .in('question_id', chunk);

      if (Array.isArray(tqRows)) {
        const metaByQid = new Map<string, any>();
        tqRows.forEach((row: any) => {
          if (!row.question_id || !row.raw_metadata) return;
          let meta = row.raw_metadata;
          if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch (e) { meta = null; }
          }
          if (meta && typeof meta === 'object' && (hasValidImg(meta.image_url) || hasValidImg(meta.image_2_url))) {
            metaByQid.set(String(row.question_id).trim(), meta);
          }
        });

        stillMissing.forEach((q: any) => {
          const rId = toRealId(q.question_id);
          const meta = metaByQid.get(rId);
          if (!meta) return;
          const dbPatch: Record<string, any> = {};
          if (!hasValidImg(q.image_url) && hasValidImg(meta.image_url)) {
            q.image_url = meta.image_url;
            dbPatch.image_url = meta.image_url;
          }
          if (!hasValidImg(q.image_2_url) && hasValidImg(meta.image_2_url)) {
            q.image_2_url = meta.image_2_url;
            dbPatch.image_2_url = meta.image_2_url;
          }
          if (!q.image_box && meta.image_box) {
            q.image_box = meta.image_box;
            dbPatch.image_box = meta.image_box;
          }
          if (!q.image_2_box && meta.image_2_box) {
            q.image_2_box = meta.image_2_box;
            dbPatch.image_2_box = typeof meta.image_2_box === 'object' ? JSON.stringify(meta.image_2_box) : meta.image_2_box;
          }
          if (!hasValidImg(q.answer_image_url) && hasValidImg(meta.answer_image_url)) {
            q.answer_image_url = meta.answer_image_url;
            dbPatch.answer_image_url = meta.answer_image_url;
          }
          if (Object.keys(dbPatch).length > 0) {
            patchedDbPayloads.set(rId, { ...(patchedDbPayloads.get(rId) || {}), ...dbPatch });
          }
        });
      }
    }
  } catch (e) {}

  // 3) 부모 문항(parent_question_id)에서 이미지 상속 복원 (쌍둥이/유사 문항 생성 시 image_box만 복사되고 image_url이 누락된 경우)
  const missingWithParent = questionsArray.filter(
    (q: any) =>
      q &&
      !hasValidImg(q.image_url) &&
      q.parent_question_id &&
      String(q.parent_question_id).trim() !== '' &&
      String(q.parent_question_id).trim() !== 'null'
  );
  if (missingWithParent.length > 0) {
    try {
      const parentIds = Array.from(
        new Set(missingWithParent.map((q: any) => String(q.parent_question_id).trim()))
      );
      const parentMap = new Map<string, any>();
      for (let i = 0; i < parentIds.length; i += 100) {
        const chunk = parentIds.slice(i, i + 100);
        const { data: pRows } = await supabaseClient
          .from('question_db')
          .select('question_id, image_url, image_2_url, image_box, image_2_box, answer_image_url, answer_image_2_url, answer_image_box')
          .in('question_id', chunk);
        if (Array.isArray(pRows)) {
          pRows.forEach((p: any) => {
            if (p.question_id) parentMap.set(String(p.question_id).trim(), p);
          });
        }
      }

      missingWithParent.forEach((q: any) => {
        const p = parentMap.get(String(q.parent_question_id).trim());
        if (!p) return;
        const rId = toRealId(q.question_id);
        const dbPatch: Record<string, any> = {};
        if (!hasValidImg(q.image_url) && hasValidImg(p.image_url)) {
          q.image_url = p.image_url;
          dbPatch.image_url = p.image_url;
        }
        if (!hasValidImg(q.image_2_url) && hasValidImg(p.image_2_url)) {
          q.image_2_url = p.image_2_url;
          dbPatch.image_2_url = p.image_2_url;
        }
        if (!q.image_box && p.image_box) {
          q.image_box = p.image_box;
          dbPatch.image_box = p.image_box;
        }
        if (!q.image_2_box && p.image_2_box) {
          q.image_2_box = p.image_2_box;
          dbPatch.image_2_box = p.image_2_box;
        }
        if (Object.keys(dbPatch).length > 0) {
          patchedDbPayloads.set(rId, { ...(patchedDbPayloads.get(rId) || {}), ...dbPatch });
        }
      });
    } catch (e) {}
  }

  // 4) 동일 교재(source_book_name / book_name / pdf_source) + 동일 페이지 + 동일 문항번호의 다른 행에 이미지가 존재하는 경우 복원
  const stillMissingAfterParent = questionsArray.filter((q: any) => q && !hasValidImg(q.image_url));
  if (stillMissingAfterParent.length > 0) {
    try {
      const booksToLookup = Array.from(
        new Set(
          stillMissingAfterParent
            .flatMap((q: any) => [q.book_name, q.source_book_name, q.pdf_source])
            .map((s: any) => (s ? String(s).trim() : ''))
            .filter(Boolean)
        )
      ).slice(0, 10);

      if (booksToLookup.length > 0) {
        const { data: siblingRows } = await supabaseClient
          .from('question_db')
          .select('question_id, book_name, source_book_name, pdf_source, final_printed_page, detected_page_num, question_number, sub_num, image_url, image_2_url, image_box, image_2_box, answer_image_url')
          .in('source_book_name', booksToLookup)
          .not('image_url', 'is', null)
          .limit(1000);

        if (Array.isArray(siblingRows) && siblingRows.length > 0) {
          const makeKey = (row: any) => {
            const page = String(row.final_printed_page || row.detected_page_num || '').replace(/[^0-9]/g, '');
            const qn = String(row.question_number || '').trim();
            const sn = String(row.sub_num ?? 0).trim();
            return `${page}__${qn}__${sn}`;
          };
          const siblingMap = new Map<string, any>();
          siblingRows.forEach((s: any) => {
            if (hasValidImg(s.image_url)) {
              siblingMap.set(makeKey(s), s);
            }
          });

          stillMissingAfterParent.forEach((q: any) => {
            const match = siblingMap.get(makeKey(q));
            if (!match) return;
            const rId = toRealId(q.question_id);
            const dbPatch: Record<string, any> = {};
            if (!hasValidImg(q.image_url) && hasValidImg(match.image_url)) {
              q.image_url = match.image_url;
              dbPatch.image_url = match.image_url;
            }
            if (!hasValidImg(q.image_2_url) && hasValidImg(match.image_2_url)) {
              q.image_2_url = match.image_2_url;
              dbPatch.image_2_url = match.image_2_url;
            }
            if (!q.image_box && match.image_box) {
              q.image_box = match.image_box;
              dbPatch.image_box = match.image_box;
            }
            if (!q.image_2_box && match.image_2_box) {
              q.image_2_box = match.image_2_box;
              dbPatch.image_2_box = match.image_2_box;
            }
            if (Object.keys(dbPatch).length > 0) {
              patchedDbPayloads.set(rId, { ...(patchedDbPayloads.get(rId) || {}), ...dbPatch });
            }
          });
        }
      }
    } catch (e) {}
  }

  // 복원된 이미지 정보를 백그라운드에서 question_db 에도 영구 반영
  if (patchedDbPayloads.size > 0) {
    Promise.all(
      Array.from(patchedDbPayloads.entries()).map(([qId, payload]) =>
        supabaseClient.from('question_db').update(payload).eq('question_id', qId)
      )
    ).catch(() => {});
  }
};

export const getDiffLabelByRate = (rate: number | null | undefined) => {
  if(rate === null || rate === undefined) return '중';
  if(rate >= 80) return '최하'; if(rate >= 60) return '하';
  if(rate >= 40) return '중'; if(rate >= 20) return '상'; return '최상';
};

export const getTypeName = (q: any) => {
  const pt = String(q.problem_type || '').toUpperCase();
  if (pt === 'SUBJECTIVE' || pt === 'SHORT_ANSWER') return '단답형';
  if (pt === 'ESSAY' || pt === 'DESCRIPTIVE') return '서술형';
  return '객관식';
};

// 💡 배지 렌더링을 위한 사고력 문제 판별 로직은 그대로 유지합니다.
export const isThinking = (q: any) => !!(q.thk_taxonomy_id && String(q.thk_taxonomy_id).trim() !== '');

export const smartSplitTaxonomy = (pathStr: string) => {
  if (!pathStr) return [];
  const parts = String(pathStr).split('>');
  const merged: string[] = [];
  let current = parts[0];
  for (let i = 1; i < parts.length; i++) {
      const openCount = (current.match(/</g) || []).length;
      const closeCount = (current.match(/>/g) || []).length;
      if (openCount > closeCount) current += '>' + parts[i]; 
      else { merged.push(current.trim()); current = parts[i]; }
  }
  merged.push(current.trim());
  return merged.filter(p => p !== '');
};

// 🌟 사고력 문제라도 교과 분류(기본 taxonomy)를 출력하도록 thk_taxonomy 우선 적용 로직을 제거했습니다. (sub_taxonomy_id 폴백 포함)
export const getDepth5Name = (q: any, depth5Map: Record<string, string>) => {
  const tId = q?.taxonomy_id ? String(q.taxonomy_id).trim().toUpperCase() : null;
  const iId = q?.item_id ? String(q.item_id).trim().toUpperCase() : null;
  const subId = q?.sub_taxonomy_id ? String(q.sub_taxonomy_id).trim().toUpperCase() : null;
  if (tId && depth5Map[tId]) return depth5Map[tId];
  if (iId && depth5Map[iId]) return depth5Map[iId];
  if (tId && tId.includes("-")) {
    const parentCat = tId.split("-").slice(0, -1).join("-");
    if (depth5Map[parentCat]) return depth5Map[parentCat];
  }
  if (q?.taxonomy_name) {
    const parts = smartSplitTaxonomy(q.taxonomy_name);
    return parts.length >= 5 ? parts[4] : parts[parts.length - 1];
  }
  if (subId && depth5Map[subId]) return depth5Map[subId];
  if (subId && subId.includes("-")) {
    const parentCat = subId.split("-").slice(0, -1).join("-");
    if (depth5Map[parentCat]) return depth5Map[parentCat];
  }
  if (q?.sub_taxonomy_name) {
    const parts = smartSplitTaxonomy(q.sub_taxonomy_name);
    return parts.length >= 5 ? parts[4] : parts[parts.length - 1];
  }
  return '분류 없음';
};

// 🌟 사고력 문제라도 교과 분류(기본 taxonomy)를 출력하도록 thk_taxonomy 우선 적용 로직을 제거했습니다. (sub_taxonomy_id 폴백 포함)
export const getDepth6Name = (q: any, depth6Map: Record<string, string>) => {
  const tId = q?.taxonomy_id ? String(q.taxonomy_id).trim().toUpperCase() : null;
  const iId = q?.item_id ? String(q.item_id).trim().toUpperCase() : null;
  const subId = q?.sub_taxonomy_id ? String(q.sub_taxonomy_id).trim().toUpperCase() : null;
  if (tId && depth6Map[tId]) return depth6Map[tId];
  if (iId && depth6Map[iId]) return depth6Map[iId];
  if (tId && tId.includes("-")) {
    const parentCat = tId.split("-").slice(0, -1).join("-");
    if (depth6Map[parentCat]) return depth6Map[parentCat];
  }
  if (q?.taxonomy_name) {
    const parts = smartSplitTaxonomy(q.taxonomy_name);
    return parts.length >= 6 ? parts[5] : parts[parts.length - 1];
  }
  if (subId && depth6Map[subId]) return depth6Map[subId];
  if (subId && subId.includes("-")) {
    const parentCat = subId.split("-").slice(0, -1).join("-");
    if (depth6Map[parentCat]) return depth6Map[parentCat];
  }
  if (q?.sub_taxonomy_name) {
    const parts = smartSplitTaxonomy(q.sub_taxonomy_name);
    return parts.length >= 6 ? parts[5] : parts[parts.length - 1];
  }
  return '유형 분류 없음';
};

// 🌟 서브 분류(sub_taxonomy_id)가 존재할 때 해당 서브 분류의 Depth 6 이름을 반환하는 헬퍼
export const getSubDepth6Name = (q: any, depth6Map: Record<string, string>): string => {
  const subId = q?.sub_taxonomy_id ? String(q.sub_taxonomy_id).trim().toUpperCase() : null;
  if (!subId || subId === "NULL" || subId === "NONE" || subId === "미분류") return "";
  if (depth6Map[subId]) return depth6Map[subId];
  if (subId.includes("-")) {
    const parentCat = subId.split("-").slice(0, -1).join("-");
    if (depth6Map[parentCat]) return depth6Map[parentCat];
  }
  if (q?.sub_taxonomy_name) {
    const parts = smartSplitTaxonomy(q.sub_taxonomy_name);
    return parts.length >= 6 ? parts[5] : parts[parts.length - 1];
  }
  return subId;
};

export const formatText = (str: string) => {
  if (!str) return '내용이 없습니다.';
  let t = String(str).replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ').replace(/\n/g, '<br>');
  while (/\\text\s*\{\s*\\text\s*\{/.test(t)) {
      t = t.replace(/\\text\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, '\\text{$1}');
  }
  t = t.replace(/\\text\s*\{([^{}]*[가-힣]+[^{}]*)\}/g, '$1');
  t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  return t;
};

export const extractParentIds = (relationsStr: any, parentQId: string) => {
  let twins: string[] = [];
  let similars: string[] = [];
  if (relationsStr && relationsStr !== 'null') {
    let parsed = relationsStr;
    if (typeof relationsStr === 'string') { try { parsed = JSON.parse(relationsStr); } catch(e) {} }
    if (Array.isArray(parsed)) parsed = parsed[0];
    if (parsed && typeof parsed === 'object') {
      if (parsed.twin_id) {
        let ids = Array.isArray(parsed.twin_id) ? parsed.twin_id : [parsed.twin_id];
        ids.forEach((id: any) => { if (id && typeof id === 'string') twins.push(id); });
      }
      if (parsed.similars_ids || parsed.similar_ids) {
        let sids = parsed.similars_ids || parsed.similar_ids;
        let ids = Array.isArray(sids) ? sids : [sids];
        ids.forEach((id: any) => { if (id && typeof id === 'string') similars.push(id); });
      }
    }
  }
  if (parentQId && parentQId !== 'null' && String(parentQId).trim() !== '') twins.push(parentQId);
  return { twins: Array.from(new Set(twins)), similars: Array.from(new Set(similars)) };
};

export const getParentSourceText = (parentQ: any, typeLabel: string) => {
  if (!parentQ) return '';
  let bookName = parentQ.source_book_name || parentQ.pdf_source || '';
  let pageNum = parentQ.final_printed_page || parentQ.detected_page_num || '';
  let qNum = parentQ.question_number || '';
  
  let tags = parentQ.raw_source_tags || parentQ.raw_source_tag;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch(e) {} }
  if (typeof tags === 'object' && tags !== null) {
    if(!bookName) bookName = tags.source_book_name || '';
    if(!pageNum) pageNum = tags.final_printed_page || tags.detected_page_num || '';
    if(!qNum) qNum = tags.question_number || '';
  } else if (!bookName && typeof tags === 'string' && tags.trim() !== '') {
    bookName = tags; 
  }

  let parts = [];
  if (bookName) parts.push(bookName);
  if (pageNum) {
    let pageStr = String(pageNum).trim();
    if (pageStr.toLowerCase().startsWith('p')) { pageStr = pageStr.replace(/\./g, ''); parts.push(pageStr); } 
    else { parts.push(`p${pageStr}`); }
  }
  if (qNum) { parts.push(String(qNum).replace(/번/g, '').trim()); }
  
  let combined = parts.join(', ').trim();
  if (combined) return `[${typeLabel}] ${combined}`;
  return '';
};

export const renderParentRelations = (q: any, parentSourceMap: Record<string, any>) => {
  const ext = extractParentIds(q.parent_relations, q.parent_question_id);
  let lines: string[] = [];
  
  ext.twins.forEach(tId => {
    const pData = parentSourceMap[tId];
    if (pData) { const txt = getParentSourceText(pData, '쌍둥이'); if (txt && !lines.includes(txt)) lines.push(txt); }
  });
  ext.similars.forEach(sId => {
    const pData = parentSourceMap[sId];
    if (pData) { const txt = getParentSourceText(pData, '유사'); if (txt && !lines.includes(txt)) lines.push(txt); }
  });
  
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
      {lines.slice(0, 3).map((line, i) => {
        const isTwin = line.startsWith('[쌍둥이]');
        const content = line.replace(/^\[(쌍둥이|유사)\]/, '').trim();
        return (
          <div key={i} className="text-[12px] font-bold text-slate-500 leading-tight tracking-wide flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-100">
            {isTwin ? <span className="text-rose-500 font-bold">[쌍둥이]</span> : <span className="text-indigo-500 font-bold">[유사]</span>}
            <span>{content}</span>
          </div>
        );
      })}
    </div>
  );
};

export const processGroupText = (items: any[]) => {
  if (!items || items.length === 0) return { common: "", remainders: [] };
  if (items.length === 1) return { common: "", remainders: [items[0].question || items[0].text_question || ""] };

  const strings = items.map(i => String(i.question || i.text_question || "").trim());
  if (strings.some(s => !s)) return { common: "", remainders: strings };

  // 🌟 모든 서브문항의 문제 텍스트가 100% 동일한 경우 (예: (1), (2)가 이미지 안에 들어있는 문항)
  // 전체 지문을 공통 지문(common)으로 올리고 각 서브문항 텍스트(remainders)는 빈 문자열("")로 처리
  if (strings.every(s => s === strings[0])) {
    const textOnly = strings[0].replace(/<[^>]+>/g, "").trim();
    if (textOnly.length >= 2) {
      return { common: strings[0], remainders: strings.map(() => "") };
    }
  }

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.substring(0, j);
  }

  // 끝에 걸친 열린 괄호 "(", "[" 등 서브문항 번호 조각 제거
  prefix = prefix.replace(/[\(\[\{\s]+$/, "");

  let common = prefix;
  const boundary = Math.max(
    prefix.lastIndexOf("<br"), prefix.lastIndexOf("</p>"), 
    prefix.lastIndexOf("</div>"), prefix.lastIndexOf("<table")
  );
  
  if (boundary !== -1) {
    const endTag = prefix.indexOf(">", boundary);
    if (endTag !== -1) common = prefix.substring(0, endTag + 1);
    else common = prefix.substring(0, boundary);
  } else {
    const lastPunc = Math.max(
      prefix.lastIndexOf("."),
      prefix.lastIndexOf("?"),
      prefix.lastIndexOf("!"),
      prefix.lastIndexOf(":"),
      prefix.lastIndexOf("시오"),
      prefix.lastIndexOf("세요")
    );
    if (lastPunc !== -1) {
      if (prefix.slice(lastPunc, lastPunc + 2) === "시오" || prefix.slice(lastPunc, lastPunc + 2) === "세요") {
        const afterVerb = prefix[lastPunc + 2] === "." ? lastPunc + 3 : lastPunc + 2;
        common = prefix.substring(0, afterVerb);
      } else {
        common = prefix.substring(0, lastPunc + 1);
      }
    } else {
      const lastSpace = prefix.lastIndexOf(" ");
      if (lastSpace !== -1) common = prefix.substring(0, lastSpace + 1);
    }
  }

  const remainders = strings.map(s => {
    let rem = s.substring(common.length);
    rem = rem.replace(/^(\s*<br\s*\/?>\s*)+/gi, "").trim();
    return rem;
  });

  const textOnlyCommon = common.replace(/<[^>]+>/g, "").trim();
  if (textOnlyCommon.length < 2) {
    return { common: "", remainders: strings };
  }

  return { common, remainders };
};

export const parseQuestionNumberParts = (numStr: any) => {
  if (numStr === null || numStr === undefined || numStr === "") {
    return { main: 99999, dash: 0, paren: 0, orig: "" };
  }
  const s = String(numStr).trim();
  const mMain = s.match(/^(\d+)/);
  if (!mMain) return { main: 99999, dash: 0, paren: 0, orig: s };
  const main = parseInt(mMain[1], 10);

  const noParen = s.replace(/\(\d+\)/g, "");
  const mDash = noParen.match(/-(\d+)/);
  const dash = mDash ? parseInt(mDash[1], 10) : 0;

  const mParen = s.match(/\((\d+)\)/);
  const paren = mParen ? parseInt(mParen[1], 10) : 0;

  return { main, dash, paren, orig: s };
};

const parseLeadingSubMarker = (rem: string): number => {
  if (!rem) return 0;
  const s = rem.trim();
  const mParenNum = s.match(/^\(\s*(\d+)\s*\)/);
  if (mParenNum) return parseInt(mParenNum[1], 10) || 0;

  const mCircle = s.match(/^([①②③④⑤⑥⑦⑧⑨⑩])/);
  if (mCircle) return "①②③④⑤⑥⑦⑧⑨⑩".indexOf(mCircle[1]) + 1;

  const mKor = s.match(/^\(\s*([가나다라마바사아자차카타파하])\s*\)/);
  if (mKor) return "가나다라마바사아자차카타파하".indexOf(mKor[1]) + 1;

  const mBracket = s.match(/^\[\s*(\d+)\s*\]/);
  if (mBracket) return parseInt(mBracket[1], 10) || 0;

  return 0;
};

const extractStandaloneSubMarker = (rawText: string): number => {
  if (!rawText) return 0;
  const clean = String(rawText)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

  const direct = parseLeadingSubMarker(clean);
  if (direct > 0) return direct;

  const mAfterPrompt = clean.match(
    /(?:\n|(?:답하세요|답하시오|구하세요|구하시오|고르세요|고르시오|쓰세요|쓰시오|나타내시오|나타내세요)[\.\:\s]*)\s*(?:\(\s*(\d+)\s*\)|([①②③④⑤⑥⑦⑧⑨⑩])|\(\s*([가나다라마바사아자차카타파하])\s*\))/
  );
  if (mAfterPrompt) {
    if (mAfterPrompt[1]) return parseInt(mAfterPrompt[1], 10) || 0;
    if (mAfterPrompt[2]) return "①②③④⑤⑥⑦⑧⑨⑩".indexOf(mAfterPrompt[2]) + 1;
    if (mAfterPrompt[3]) return "가나다라마바사아자차카타파하".indexOf(mAfterPrompt[3]) + 1;
  }
  return 0;
};

export const extractSubMarkerBetween = (textA: string, textB: string): [number, number] => {
  const cleanA = String(textA || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  const cleanB = String(textB || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

  let k = 0;
  while (k < cleanA.length && k < cleanB.length && cleanA[k] === cleanB[k]) k++;
  while (k > 0 && /[\(\[\{0-9가-하①-⑩\s]/.test(cleanA[k - 1])) k--;

  const remA = cleanA.slice(k).trim();
  const remB = cleanB.slice(k).trim();

  const mA = parseLeadingSubMarker(remA) || extractStandaloneSubMarker(cleanA);
  const mB = parseLeadingSubMarker(remB) || extractStandaloneSubMarker(cleanB);
  return [mA, mB];
};

export const compareSubQuestions = (a: any, b: any): number => {
  if (!a || !b) return 0;

  const idA = String(a.question_id || "").trim();
  const idB = String(b.question_id || "").trim();
  const parentA = String(a.parent_question_id || "").trim();
  const parentB = String(b.parent_question_id || "").trim();

  if (idA && parentB && idA === parentB && idA !== idB) return -1;
  if (idB && parentA && idB === parentA && idA !== idB) return 1;

  const textA = String(a.question || a.text_question || "");
  const textB = String(b.question || b.text_question || "");
  const [markerA, markerB] = extractSubMarkerBetween(textA, textB);
  if (markerA > 0 && markerB > 0 && markerA !== markerB) {
    return markerA - markerB;
  }

  const subA = parseInt(String(a.sub_num ?? "0"), 10) || 0;
  const subB = parseInt(String(b.sub_num ?? "0"), 10) || 0;
  if (subA > 0 && subB > 0 && subA !== subB) {
    return subA - subB;
  }

  const pageA = parseInt(String(a.page_number || a.final_printed_page || a.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;
  const pageB = parseInt(String(b.page_number || b.final_printed_page || b.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;
  if (pageA > 0 && pageB > 0 && pageA !== pageB) {
    return pageA - pageB;
  }

  const qA = parseQuestionNumberParts(a.question_number);
  const qB = parseQuestionNumberParts(b.question_number);
  if (qA.main !== qB.main) return qA.main - qB.main;
  if (qA.dash !== qB.dash) return qA.dash - qB.dash;
  if (qA.paren !== qB.paren) return qA.paren - qB.paren;
  if (qA.orig !== qB.orig) return qA.orig.localeCompare(qB.orig, "ko", { numeric: true });

  return 0;
};

export const compareQuestionsBySource = (a: any, b: any): number => {
  if (!a || !b) return 0;
  const getBook = (q: any) => String(q.source_book_name || q.book_name || q.pdf_source || q.raw_source_tags || "").trim();
  const getPage = (q: any) => parseInt(String(q.page_number || q.final_printed_page || q.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;

  const bookA = getBook(a);
  const bookB = getBook(b);
  if (bookA !== bookB) return bookA.localeCompare(bookB, "ko", { numeric: true });

  const pageA = getPage(a);
  const pageB = getPage(b);
  if (pageA !== pageB) return pageA - pageB;

  const qA = parseQuestionNumberParts(a.question_number);
  const qB = parseQuestionNumberParts(b.question_number);
  if (qA.main !== qB.main) return qA.main - qB.main;
  if (qA.dash !== qB.dash) return qA.dash - qB.dash;
  if (qA.paren !== qB.paren) return qA.paren - qB.paren;

  return compareSubQuestions(a, b);
};

export const getDiagnosticMainScore = (gIdx: number): number => {
  const idx = Math.max(0, Math.min(29, gIdx));
  return [2, 3, 4, 5][
    idx < 4 ? 0 : idx < 13 ? 1 : idx < 20 ? 2 : idx === 20 ? 3 : idx < 23 ? 0 : idx < 25 ? 1 : idx < 28 ? 2 : 3
  ];
};

const getTwinVariantSuffix = (qNumRaw: any): string => {
  const s = String(qNumRaw || "").trim();
  const m = s.match(/-((?:T|S)\d+)$/i);
  return m ? m[1].toUpperCase() : "";
};

export const shouldMergeAdjacentQuestions = (lastItem: any, nextItem: any, isDiagnosticMode: boolean = false): boolean => {
  if (!lastItem || !nextItem) return false;
  const qid1 = String(lastItem.question_id || "").trim();
  const qid2 = String(nextItem.question_id || "").trim();
  if (qid1 && qid2 && qid1 === qid2) return false;

  // 서로 다른 쌍둥이/유사 파생 번호(-T1 vs -T2, -T1 vs -S1 등)를 가진 문항끼리는 서브문항으로 묶지 않음
  const var1 = getTwinVariantSuffix(lastItem.question_number);
  const var2 = getTwinVariantSuffix(nextItem.question_number);
  if ((var1 || var2) && var1 !== var2) return false;

  const gid1 = String(lastItem.group_id || "").trim();
  const gid2 = String(nextItem.group_id || "").trim();
  if (gid1 && gid1 !== "null" && gid1 === gid2) return true;

  const book1 = String(lastItem.source_book_name || lastItem.book_name || lastItem.pdf_source || "").trim();
  const book2 = String(nextItem.source_book_name || nextItem.book_name || nextItem.pdf_source || "").trim();
  if (!isDiagnosticMode && book1 && book2 && book1 !== book2) return false;

  const page1 = parseInt(String(lastItem.page_number || lastItem.final_printed_page || lastItem.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;
  const page2 = parseInt(String(nextItem.page_number || nextItem.final_printed_page || nextItem.detected_page_num || "0").replace(/[^0-9]/g, ""), 10) || 0;
  const samePage = page1 === page2 || page1 === 0 || page2 === 0;

  const num1 = parseQuestionNumberParts(lastItem.question_number);
  const num2 = parseQuestionNumberParts(nextItem.question_number);
  const sub1 = parseInt(String(lastItem.sub_num ?? "0"), 10) || 0;
  const sub2 = parseInt(String(nextItem.sub_num ?? "0"), 10) || 0;
  const ss1 = parseInt(String(lastItem.sub_sub_num ?? "0"), 10) || 0;
  const ss2 = parseInt(String(nextItem.sub_sub_num ?? "0"), 10) || 0;

  const text1 = String(lastItem.question || lastItem.text_question || "");
  const text2 = String(nextItem.question || nextItem.text_question || "");
  const [m1, m2] = extractSubMarkerBetween(text1, text2);

  const removeNumberingRegex = /^((?:<[^>]+>|&nbsp;|\s)*)(?:\([0-9가-힣a-zA-Z]+\)|[①-⑩]|[0-9]+[\.\)])(?:&nbsp;|\s)*/i;
  const clean1 = text1.replace(removeNumberingRegex, "$1");
  const clean2 = text2.replace(removeNumberingRegex, "$1");

  let k = 0;
  while (k < clean1.length && k < clean2.length && clean1[k] === clean2[k]) k++;
  const commonPrefix = clean1.substring(0, k);
  const textOnlyCommon = commonPrefix.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();

  if (samePage && num1.main !== 99999 && num1.main === num2.main) {
    const hasDistinctSubIndicator =
      sub1 !== sub2 ||
      ss1 !== ss2 ||
      num1.dash !== num2.dash ||
      num1.paren !== num2.paren ||
      (m1 > 0 && m2 > 0 && m1 !== m2) ||
      textOnlyCommon.length >= 6 ||
      sub1 > 0 ||
      sub2 > 0 ||
      num1.dash > 0 ||
      num2.dash > 0 ||
      num1.paren > 0 ||
      num2.paren > 0;
    if (hasDistinctSubIndicator) {
      return true;
    }
  }
  if (
    isDiagnosticMode &&
    num1.main !== 99999 &&
    num1.main === num2.main &&
    (samePage || num1.dash > 0 || num2.dash > 0 || num1.paren > 0 || num2.paren > 0)
  ) {
    return true;
  }

  if (samePage && num1.main === num2.main && sub2 > 1 && (sub2 === sub1 + 1 || sub1 >= 1)) {
    return true;
  }

  if (samePage && (num1.main === num2.main || num1.main === 99999 || num2.main === 99999) && textOnlyCommon.length >= 8) {
    return true;
  }

  if (samePage && (num1.main === num2.main || num1.main === 99999 || num2.main === 99999)) {
    if (m1 >= 1 && m2 === m1 + 1) {
      return true;
    }
  }

  return false;
};

// 🌟 서브문항이 있는 문항이 선택되었을 때, 단원(taxonomy_id)이나 정답률/유형 필터 때문에
// 같은 묶음의 다른 서브문항((1), (2), (3) 등)이 누락되지 않도록 DB 및 조회 풀에서 형제 서브문항을 모두 찾아 합쳐주는 헬퍼
export const ensureCompleteSubQuestionBundles = async (
  supabaseClient: any,
  filteredData: any[],
  allFetchedData: any[] = [],
  isDiagnosticMode: boolean = false
): Promise<any[]> => {
  if (!Array.isArray(filteredData) || filteredData.length === 0) return [];

  const resultMap = new Map<string, any>();
  filteredData.forEach((q: any) => {
    if (q && q.question_id) resultMap.set(String(q.question_id), q);
  });

  // 1) 이미 메모리에 로드된 allFetchedData 내에서 같은 묶음(서브문항)인 행이 있으면 즉시 포함
  const currentList = Array.from(resultMap.values());
  (allFetchedData || []).forEach((cand: any) => {
    if (!cand || !cand.question_id) return;
    if (cand.is_hidden === true || cand.is_hidden === "Y" || cand.is_hidden === "true") return;
    const cid = String(cand.question_id);
    if (resultMap.has(cid)) return;
    if (currentList.some((existing) => shouldMergeAdjacentQuestions(existing, cand, isDiagnosticMode))) {
      resultMap.set(cid, cand);
    }
  });

  // 2) 다른 taxonomy_id 로 분류되어 초기 쿼리에 포함되지 않은 형제 서브문항을 DB에서 조회하여 보강
  const hasSubIndicator = (q: any): boolean => {
    if (!q) return false;
    const sub = parseInt(String(q.sub_num ?? "0"), 10) || 0;
    const ssub = parseInt(String(q.sub_sub_num ?? "0"), 10) || 0;
    if (sub > 0 || ssub > 0) return true;
    if (q.group_id && String(q.group_id) !== "null") return true;
    const np = parseQuestionNumberParts(q.question_number);
    if (np.dash > 0 || np.paren > 0) return true;
    const txt = String(q.question || q.text_question || "");
    if (extractStandaloneSubMarker(txt) > 0) return true;
    return false;
  };

  const subCandidates = Array.from(resultMap.values()).filter(hasSubIndicator);
  if (subCandidates.length > 0 && supabaseClient) {
    try {
      const booksToFetch = Array.from(
        new Set(
          subCandidates
            .map((q: any) => String(q.source_book_name || q.book_name || "").trim())
            .filter(Boolean)
        )
      ).slice(0, 15);

      if (booksToFetch.length > 0) {
        const { data: siblingRows } = await supabaseClient
          .from("question_db")
          .select("*")
          .in("source_book_name", booksToFetch)
          .limit(2000);

        if (Array.isArray(siblingRows) && siblingRows.length > 0) {
          const snapshot = Array.from(resultMap.values());
          siblingRows.forEach((row: any) => {
            if (!row || !row.question_id) return;
            if (row.is_hidden === true || row.is_hidden === "Y" || row.is_hidden === "true") return;
            const rid = String(row.question_id);
            if (resultMap.has(rid)) return;
            if (snapshot.some((existing) => shouldMergeAdjacentQuestions(existing, row, isDiagnosticMode))) {
              resultMap.set(rid, row);
            }
          });
        }
      }
    } catch (e) {}
  }

  return Array.from(resultMap.values());
};

export const buildMergedQuestionGroups = (rawQuestions: any[], isDiagnosticMode: boolean = false, preserveOrder: boolean = false): any[] => {
  if (!rawQuestions || rawQuestions.length === 0) return [];
  const sorted = preserveOrder ? [...rawQuestions] : [...rawQuestions].sort(compareQuestionsBySource);

  const result: any[] = [];
  let i = 0;

  while (i < sorted.length) {
    const firstQ = sorted[i];
    const currentItems: any[] = [firstQ];
    let j = i + 1;

    while (j < sorted.length) {
      const lastItem = currentItems[currentItems.length - 1];
      const nextItem = sorted[j];
      const matchesAnyInGroup =
        shouldMergeAdjacentQuestions(lastItem, nextItem, isDiagnosticMode) ||
        shouldMergeAdjacentQuestions(currentItems[0], nextItem, isDiagnosticMode);

      if (matchesAnyInGroup) {
        currentItems.push(nextItem);
        j++;
      } else {
        break;
      }
    }

    if (currentItems.length > 1) {
      currentItems.sort(compareSubQuestions);
      result.push({
        id: `merged_${Date.now()}_${i}_${currentItems[0].question_id}`,
        is_group: true,
        is_merged_text: true,
        items: currentItems,
        sort_order: i + 1,
      });
    } else {
      result.push({
        id: `single_${firstQ.question_id}_${i}_${Math.random()}`,
        is_group: false,
        is_merged_text: false,
        items: currentItems,
        sort_order: i + 1,
      });
    }

    i = j;
  }

  return result;
};


// 🌟 서브문항 텍스트가 "(1)", "(2)", "①", "[1]", "(가)" 등 번호만 있고 본문 텍스트가 없는지 판별

// 🌟 텍스트 앞단에 이미 (1), (2), ①, [1], 1) 등의 서브문항 번호가 있는지 판별
export const hasLeadingSubNumber = (rawText: any): boolean => {
  if (!rawText) return false;
  const plain = String(rawText)
    .replace(/^(\s*<[^>]+>\s*)*/, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (!plain) return false;
  return /^(?:\(\s*(?:\d+|[가-하]|[ㄱ-ㅎ]|[a-zA-Z])\s*\)|\[\s*\d+\s*\]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|\d+\s*\))/.test(plain);
};

// 🌟 텍스트 앞단의 (1), (2), ①, [1], 1) 서브문항 번호를 제거
export const stripLeadingSubNumber = (rawText: any): string => {
  if (!rawText) return "";
  let s = String(rawText);
  s = s.replace(/^((?:\s*<[^>]+>\s*)*)\(\s*(?:\d+|[가-하]|[ㄱ-ㅎ]|[a-zA-Z])\s*\)\s*/, "$1");
  s = s.replace(/^((?:\s*<[^>]+>\s*)*)\[\s*\d+\s*\]\s*/, "$1");
  s = s.replace(/^((?:\s*<[^>]+>\s*)*)[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]\s*/, "$1");
  s = s.replace(/^((?:\s*<[^>]+>\s*)*)\d+\s*\)\s*/, "$1");
  return s;
};

// 🌟 텍스트 앞단에 (1), (2) 등의 서브문항 번호가 없으면 자동으로 붙여주는 헬퍼
export const ensureLeadingSubNumber = (rawText: any, subNum: number): string => {
  if (!rawText) return "";
  const s = String(rawText);
  if (!s.trim()) return "";
  if (hasLeadingSubNumber(s) || splitTrailingSubNumberText(s).isTrailingSubNum) {
    return s;
  }
  return s.replace(/^((?:\s*<[^>]+>\s*)*)/, `$1(${subNum}) `);
};

export const isSubNumberOnlyText = (rawText: any): boolean => {
  if (!rawText) return false;
  const plain = String(rawText)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (!plain) return false;
  return /^(?:\(\s*(?:\d+|[가-하]|[ㄱ-ㅎ]|[a-zA-Z])\s*\)|\[\s*\d+\s*\]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|\d+\s*\))\.?$/.test(plain);
};

// 🌟 서브문항 텍스트가 "(1)", "(2)" 등 번호만 있거나, 앞선 지문 뒤에 "(1)" 번호로 끝나고 그 뒤에 이어지는 텍스트가 없는 경우 분리
export const splitTrailingSubNumberText = (
  rawText: any
): { isTrailingSubNum: boolean; introText: string; subMarkerText: string } => {
  if (!rawText) return { isTrailingSubNum: false, introText: "", subMarkerText: "" };
  const s = String(rawText).trim();
  if (!s) return { isTrailingSubNum: false, introText: "", subMarkerText: "" };

  // 끝에 위치한 서브문항 번호 패턴: (1), (2), [1], ①~⑮, (가)~(하), 1) 등 (뒤에 줄바꿈/빈 태그만 있는 경우 포함)
  const trailingRegex = /^([\s\S]*?)((?:\(\s*(?:\d+|[가-하]|[ㄱ-ㅎ]|[a-zA-Z])\s*\)|\[\s*\d+\s*\]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|(?:^|\s|<br\s*\/?>|>)(?:\d+\s*\)))\.?)(?:\s*<br\s*\/?>|\s*<\/p>|\s*<\/div>|\s)*$/i;
  const m = s.match(trailingRegex);
  if (!m) {
    return { isTrailingSubNum: false, introText: s, subMarkerText: "" };
  }

  let intro = (m[1] || "").trim();
  let marker = (m[2] || "").trim();

  // marker 앞에 붙은 <br> 이나 > 정리
  const brMatch = marker.match(/^((?:<br\s*\/?>|\s)+)([\s\S]*)$/i);
  if (brMatch) {
    marker = brMatch[2].trim();
  }
  if (marker.startsWith(">")) {
    intro += ">";
    marker = marker.slice(1).trim();
  }

  // intro 끝에 불필요하게 반복된 <br> 태그 제거
  intro = intro.replace(/(?:\s*<br\s*\/?>\s*)+$/gi, "").trim();
  const plainIntro = intro.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();

  return {
    isTrailingSubNum: true,
    introText: plainIntro ? intro : "",
    subMarkerText: marker,
  };
};
