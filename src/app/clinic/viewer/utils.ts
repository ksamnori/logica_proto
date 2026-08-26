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

export const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export const isObjectiveQuestion = (q: any) => {
  if (!q) return false;
  if (q.options && q.options.length > 0) return true;
  const ans = String(q.answer ?? '').trim().replace(/\$/g, '').trim();
  return CIRCLED_DIGITS.includes(ans);
};

export const matchLeadingKeypadToken = (s: string): { token: string; value: number } | null => {
  let m = s.match(/^(-?\d+)\\d?frac\s*\{\s*(-?\d+)\s*\}\s*\{\s*(-?\d+)\s*\}/);
  if (m) {
    const whole = parseFloat(m[1]), num = parseFloat(m[2]), den = parseFloat(m[3]);
    return den ? { token: m[0], value: whole + (whole < 0 ? -1 : 1) * (num / den) } : null;
  }
  m = s.match(/^\\d?frac\s*\{\s*(-?\d+)\s*\}\s*\{\s*(-?\d+)\s*\}/);
  if (m) {
    const num = parseFloat(m[1]), den = parseFloat(m[2]);
    return den ? { token: m[0], value: num / den } : null;
  }
  m = s.match(/^(-?\d+)\s+(\d+)\/(\d+)/);
  if (m) {
    const whole = parseFloat(m[1]), num = parseFloat(m[2]), den = parseFloat(m[3]);
    return den ? { token: m[0], value: whole + (whole < 0 ? -1 : 1) * (num / den) } : null;
  }
  const numPart = String.raw`-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?`;
  m = s.match(new RegExp(`^(?:${numPart})(?:\\/(?:${numPart}))?`));
  if (!m) return null;
  const tok = m[0].replace(/,/g, '');
  const value = tok.includes('/') ? parseFloat(tok.split('/')[0]) / parseFloat(tok.split('/')[1]) : parseFloat(tok);
  return { token: m[0], value };
};

export const parseKeypadNumber = (raw: string | null | undefined): number | null => {
  const s = String(raw ?? '').trim().replace(/\$/g, '').trim();
  return matchLeadingKeypadToken(s)?.value ?? null;
};

export const splitAnswerParts = (s: string) => s.split(/,(?!\d)/).map(p => p.trim());

export const isKeypadEnterable = (correctAns: string | null | undefined): boolean => {
  const b = String(correctAns ?? '').trim();
  if (!b) return false;
  return splitAnswerParts(b).every(part => {
    const s = part.replace(/\$/g, '').trim();
    const m = matchLeadingKeypadToken(s);
    if (!m) return false;
    return !/\d/.test(s.slice(m.token.length));
  });
};

export const keypadAnswersMatch = (myAns: string | null, correctAns: string) => {
  if (!myAns) return false;
  const a = String(myAns).trim(); const b = String(correctAns).trim();
  if (a === b) return true;

  const aParts = splitAnswerParts(a);
  const bParts = splitAnswerParts(b);
  if (aParts.length !== bParts.length) {
    const v1 = parseKeypadNumber(a); const v2 = parseKeypadNumber(b);
    return v1 !== null && v2 !== null && v1 === v2;
  }
  return aParts.every((part, i) => {
    const v1 = parseKeypadNumber(part); const v2 = parseKeypadNumber(bParts[i]);
    return v1 !== null && v2 !== null && v1 === v2;
  });
};

export const mcAnswersMatch = (myAns: string | null, correctAns: string) => {
  if (!myAns) return false;
  const b = String(correctAns ?? '').trim().replace(/\$/g, '').trim();
  if (myAns === b) return true;
  const circledIdx = CIRCLED_DIGITS.indexOf(b);
  if (circledIdx !== -1) return myAns === String(circledIdx + 1);
  const n = parseInt(b, 10);
  return !Number.isNaN(n) && myAns === String(n);
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
    return { hasHint: false, needsAiHint: false, hintText: '교재 문제라 힌트가 없습니다.' };
  }
  return { hasHint: true, needsAiHint: true, hintText: null };
};

// 🌟 DB에 저장된 빈칸(" ", "null" 텍스트 등)을 완벽하게 걸러내어, 실제 데이터가 있을 때만 HTML로 병합합니다.
export const combineDbHints = (step1: any, step2: any) => {
  const s1 = String(step1 || '').trim();
  const s2 = String(step2 || '').trim();
  
  if ((!s1 || s1 === 'null' || s1 === 'undefined') && (!s2 || s2 === 'null' || s2 === 'undefined')) {
    return null;
  }
  
  return `<b>[개념]</b><br/>${s1 && s1 !== 'null' && s1 !== 'undefined' ? s1 : '생략됨'}<br/><br/><b>[접근법]</b><br/>${s2 && s2 !== 'null' && s2 !== 'undefined' ? s2 : '생략됨'}`;
};