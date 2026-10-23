// src/app/exam/step2/examUtils.tsx
import React from "react";

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null') return '';
  let validUrl = url;
  if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { 
    try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} 
  }
  if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfwlmbwornivkrvoeqdh.supabase.co';
    validUrl = `${SUPABASE_URL}/storage/v1/object/public/question_images/${validUrl.replace(/^\/+/, '')}`;
  }
  return validUrl;
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

// 🌟 사고력 문제라도 교과 분류(기본 taxonomy)를 출력하도록 thk_taxonomy 우선 적용 로직을 제거했습니다.
export const getDepth5Name = (q: any, depth5Map: Record<string, string>) => {
  const iId = q.item_id ? String(q.item_id).trim().toUpperCase() : null;
  if (iId && depth5Map[iId]) return depth5Map[iId];
  if (q.taxonomy_name) {
    const parts = smartSplitTaxonomy(q.taxonomy_name);
    return parts.length >= 5 ? parts[4] : parts[parts.length - 1];
  }
  return '분류 없음';
};

// 🌟 사고력 문제라도 교과 분류(기본 taxonomy)를 출력하도록 thk_taxonomy 우선 적용 로직을 제거했습니다.
export const getDepth6Name = (q: any, depth6Map: Record<string, string>) => {
  const iId = q.item_id ? String(q.item_id).trim().toUpperCase() : null;
  if (iId && depth6Map[iId]) return depth6Map[iId];
  if (q.taxonomy_name) {
    const parts = smartSplitTaxonomy(q.taxonomy_name);
    return parts.length >= 6 ? parts[5] : parts[parts.length - 1];
  }
  return '유형 분류 없음';
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

  let strings = items.map(i => i.question || i.text_question || "");
  if (strings.some(s => !s)) return { common: "", remainders: strings };

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
      let s = strings[i];
      let j = 0;
      while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
      prefix = prefix.substring(0, j);
  }

  let common = prefix;
  let boundary = Math.max(
      prefix.lastIndexOf("<br"), prefix.lastIndexOf("</p>"), 
      prefix.lastIndexOf("</div>"), prefix.lastIndexOf("<table")
  );
  
  if (boundary !== -1) {
      let endTag = prefix.indexOf(">", boundary);
      if (endTag !== -1) common = prefix.substring(0, endTag + 1);
      else common = prefix.substring(0, boundary);
  } else {
      let lastPunc = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf(":"), prefix.lastIndexOf("시오"));
      if (lastPunc !== -1) {
          if (prefix[lastPunc] === '오') common = prefix.substring(0, lastPunc + 1); 
          else common = prefix.substring(0, lastPunc + 1);
      } else {
          let lastSpace = prefix.lastIndexOf(" ");
          if (lastSpace !== -1) common = prefix.substring(0, lastSpace + 1);
      }
  }

  let remainders = strings.map(s => {
      let rem = s.substring(common.length);
      rem = rem.replace(/^(\s*<br\s*\/?>\s*)+/gi, '').trim();
      return rem;
  });

  const textOnlyCommon = common.replace(/<[^>]+>/g, '').trim();
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
