// src/app/clinic/viewer/utils.ts
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const CLINIC_ROOM = "logica-clinic-room";
export const ROUND1_TIME_LIMIT_SECONDS = 20 * 60;

export const GEMINI_API_KEY_STORAGE_KEY = 'logica_gemini_api_key';
export const GEMINI_MODEL_STORAGE_KEY = 'logica_gemini_model';
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
export const PEN_COLORS = ['#1C2530', '#DC2626', '#2563EB', '#16A34A'];
export const ERASER_WIDTH_MULTIPLIER = 6;

export const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  let t = text.replace(/<br\s*\/?>/gi, '__LOGICA_BR_PLACEHOLDER__');
  t = t.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
  t = t.replace(/__LOGICA_BR_PLACEHOLDER__/g, '<br>');
  t = t.replace(/<br>\s*,\s*<br>/g, ', ').replace(/<br>\s*,/g, ', ').replace(/,\s*<br>/g, ', ');
  while (/\\text\s*\{\s*\\text\s*\{/.test(t)) { t = t.replace(/\\text\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, '\\text{$1}'); }
  t = t.replace(/\\text\s*\{([^{}]*[가-힣]+[^{}]*)\}/g, '$1');
  t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  t = t.replace(/[◀◁]\s*\|?\s*[▶▷]/g, '□').replace(/◁\|▷/g, '□').replace(/◀\|▶/g, '□');
  t = t.replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*\\square\s*\}/g, ' $1 ').replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*□\s*\}/g, ' $1 ');
  t = t.replace(/\n/g, '<br>'); 
  return t;
};

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null') return '';
  let validUrl = url;
  if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { 
    try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} 
  }
  if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) { 
    validUrl = SUPABASE_URL + '/storage/v1/object/public/question_images/' + validUrl; 
  }
  return validUrl;
};

export const hintStorageKey = (sId: string, q: any) => `logica_hint_${sId}_${q.question_id ?? 'q'}_${q.tq_id ?? 'tq'}`;

export const hydrateHintState = (sId: string, mapped: any[]): Record<number, any> => {
  const next: Record<number, any> = {};
  if (typeof window === 'undefined') return next;
  mapped.forEach((q, i) => {
    try {
      const raw = window.localStorage.getItem(hintStorageKey(sId, q));
      if (raw) next[i] = JSON.parse(raw);
    } catch (e) {}
  });
  return next;
};

export const saveHintState = (sId: string, q: any, hq: any) => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(hintStorageKey(sId, q), JSON.stringify(hq)); } catch (e) {}
};

export const NO_HINT_BOOK_TYPES = ['주교재', '부교재'];
export const textbookHintFields = (bookType: string | null | undefined) => {
  if (bookType && NO_HINT_BOOK_TYPES.includes(bookType)) {
    return { hasHint: false, needsAiHint: false, hints: ['교재 문제라 힌트가 없습니다.', '교재 문제라 힌트가 없습니다.'] };
  }
  return { hasHint: true, needsAiHint: true, hints: ['', ''] };
};

export const keypadAnswersMatch = (myAns: string | null, correctAns: string) => {
  if (!myAns) return false;
  const a = String(myAns).trim(); const b = String(correctAns).trim();
  if (a === b) return true;
  const m1 = a.match(/^-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/);
  const m2 = b.match(/^-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/);
  if (!m1 || !m2) return false;
  const p1 = m1[0].includes('/') ? parseFloat(m1[0].split('/')[0])/parseFloat(m1[0].split('/')[1]) : parseFloat(m1[0]);
  const p2 = m2[0].includes('/') ? parseFloat(m2[0].split('/')[0])/parseFloat(m2[0].split('/')[1]) : parseFloat(m2[0]);
  return p1 === p2;
};