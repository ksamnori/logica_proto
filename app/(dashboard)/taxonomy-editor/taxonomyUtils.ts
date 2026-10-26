// src/app/(dashboard)/taxonomy-editor/taxonomyUtils.ts
import { supabase } from "@/lib/supabase";

export const taxSort = (a: string, b: string) => {
  const order: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  if (order[a] && order[b] && order[a] !== order[b]) return order[a] - order[b];
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
};

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
};

export const formatQNum = (qNum: string | number, subNum?: string | number) => {
  let numStr = String(qNum || "").trim().replace(/-0$/, '');
  
  if (subNum !== undefined && subNum !== null && String(subNum).trim() !== "") {
    const cleanSubNum = String(subNum).replace(/[()]/g, '').trim();
    if (cleanSubNum !== "") {
      numStr = `${numStr}-${cleanSubNum}`;
    }
  }
  
  return numStr.replace(/-0$/, '');
};

export const parseNatural = (str: string) => {
  return String(str || "")
    .match(/(\d+)|(\D+)/g)
    ?.map(part => {
      const num = parseInt(part, 10);
      return isNaN(num) ? part : num;
    }) || [];
};

export const compareNatural = (strA: string, strB: string) => {
  const partsA = parseNatural(strA);
  const partsB = parseNatural(strB);
  
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const partA = partsA[i];
    const partB = partsB[i];
    
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    
    if (typeof partA === 'number' && typeof partB === 'number') {
      if (partA !== partB) return partA - partB; 
    } else if (typeof partA === 'string' && typeof partB === 'string') {
      const cmp = String(partA).localeCompare(String(partB));
      if (cmp !== 0) return cmp; 
    } else {
      return typeof partA === 'number' ? -1 : 1;
    }
  }
  return 0;
};

export const sortQuestionsList = (data: any[]) => {
  return [...data].sort((a, b) => {
    const parsePage = (p1: any, p2: any) => {
      const v1 = parseInt(String(p1));
      if (!isNaN(v1) && v1 > 0) return v1;
      const v2 = parseInt(String(p2));
      if (!isNaN(v2) && v2 > 0) return v2;
      return 99999;
    };
    const pageA = parsePage(a.final_printed_page, a.detected_page_num);
    const pageB = parsePage(b.final_printed_page, b.detected_page_num);
    if (pageA !== pageB) return pageA - pageB;

    const dispA = formatQNum(a.question_number, a.sub_num);
    const dispB = formatQNum(b.question_number, b.sub_num);
    return compareNatural(dispA, dispB);
  });
};

export const fetchAllRows = async (tableName: string, selectQuery: string = '*', filterCol?: string, filterVal?: string) => {
  let allData: any[] = [];
  let start = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(tableName).select(selectQuery);
    
    if (filterCol && filterVal !== undefined) {
      query = query.eq(filterCol, filterVal);
    }
    
    if (tableName === 'question_db' || tableName === 'textbook_question') {
      query = query.order('question_id', { ascending: true });
    } else if (tableName === 'master_category') {
      query = query.order('category_id', { ascending: true });
    } else if (tableName === 'master_item') {
      query = query.order('item_id', { ascending: true });
    }

    query = query.range(start, start + step - 1);
    
    const { data, error } = await query;
    if (error) { console.error(`${tableName} 로드 실패:`, error); break; }
    if (data && data.length > 0) { allData = [...allData, ...data]; start += step; }
    if (!data || data.length < step) hasMore = false; 
  }
  return allData;
};

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null' || url === 'undefined') return '';
  let validUrl = String(url).trim();
  
  if (validUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(validUrl);
      if (Array.isArray(parsed) && parsed.length > 0) {
        validUrl = String(parsed[0]).trim();
      }
    } catch(e) {}
  }
  
  validUrl = validUrl.replace(/^["']|["']$/g, '').trim();
  const lowerUrl = validUrl.toLowerCase();
  
  if (validUrl && validUrl !== 'null' && !lowerUrl.startsWith('http') && !lowerUrl.startsWith('data:image') && !lowerUrl.startsWith('blob:')) {
    if (validUrl.startsWith('/')) validUrl = validUrl.substring(1);
    
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
    validUrl = `${baseUrl}/storage/v1/object/public/question_images/${validUrl}`;
  }
  
  return validUrl;
};