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

export const getDepth5Name = (q: any, depth5Map: Record<string, string>) => {
  if (isThinking(q) && q.thk_taxonomy_name) {
    const parts = smartSplitTaxonomy(q.thk_taxonomy_name);
    return parts.length >= 5 ? parts[4] : parts[parts.length - 1];
  }
  const iId = q.item_id ? String(q.item_id).trim().toUpperCase() : null;
  if (iId && depth5Map[iId]) return depth5Map[iId];
  if (q.taxonomy_name) {
    const parts = smartSplitTaxonomy(q.taxonomy_name);
    return parts.length >= 5 ? parts[4] : parts[parts.length - 1];
  }
  return '분류 없음';
};

export const getDepth6Name = (q: any, depth6Map: Record<string, string>) => {
  if (isThinking(q) && q.thk_taxonomy_name) {
    const parts = smartSplitTaxonomy(q.thk_taxonomy_name);
    return parts.length >= 6 ? parts[5] : parts[parts.length - 1];
  }
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
            {isTwin ? <span className="text-rose-500 font-extrabold">[쌍둥이]</span> : <span className="text-indigo-500 font-extrabold">[유사]</span>}
            <span>{content}</span>
          </div>
        );
      })}
    </div>
  );
};