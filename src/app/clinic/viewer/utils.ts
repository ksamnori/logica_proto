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

// 🌟 수퍼바이저·학생포털과 동일하게 오전 6시 리셋 기준 적용
export const getKSTDateString = () => {
  const kstAdjusted = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000);
  return kstAdjusted.toISOString().split('T')[0];
};

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

export const safeParseOptions = (options: any): string[] => {
  if (!options) return [];
  if (Array.isArray(options)) return options;
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

export const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export const isObjectiveQuestion = (q: any) => {
  if (!q) return false;
  if (q.options && q.options.length > 0) return true;
  return false;
};

export const matchLeadingKeypadToken = (s: string): { token: string; value: number } | null => {
  if (s && s.length > 0) {
    const cIdx = CIRCLED_DIGITS.indexOf(s[0]);
    if (cIdx !== -1) {
      const tokMatch = s.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*번?/);
      return { token: tokMatch ? tokMatch[0] : s[0], value: cIdx + 1 };
    }
  }
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

export const combineDbHints = (step1: any, step2: any) => {
  const s1 = String(step1 || '').trim();
  const s2 = String(step2 || '').trim();
  
  if ((!s1 || s1 === 'null' || s1 === 'undefined') && (!s2 || s2 === 'null' || s2 === 'undefined')) {
    return null;
  }
  
  return `<b>[개념]</b><br/>${s1 && s1 !== 'null' && s1 !== 'undefined' ? s1 : '생략됨'}<br/><br/><b>[접근법]</b><br/>${s2 && s2 !== 'null' && s2 !== 'undefined' ? s2 : '생략됨'}`;
};

/**
 * 🌟 학생이 문제(지문 텍스트 + 문제 이미지) 위에 펜으로 작성한 캔버스를
 * 화면상의 실제 렌더링 좌표(getBoundingClientRect) 그대로 하나의 이미지로 합성합니다.
 * - AI 채점 시 뒤에 비치는 문제(빈칸 □, 세로셈, 도형 등)와 손글씨의 위치 관계를 완벽히 인식하게 하고
 * - 선생님(수퍼바이저/조교) 화면의 '학생 손글씨 답안 이미지' 칸에도 문제와 손글씨가 정확한 좌표로 함께 표시되게 합니다.
 */
export const measureStageDimensions = async (
  stageEl: HTMLElement | null,
  rawInkDataUrl: string | null
): Promise<{ stageWidth: number; stageHeight: number; cropHeight: number }> => {
  if (typeof window === 'undefined' || !stageEl) {
    return { stageWidth: 640, stageHeight: 480, cropHeight: 320 };
  }
  const stageRect = stageEl.getBoundingClientRect();
  const stageW = Math.max(1, Math.round(stageRect.width));
  const stageH = Math.max(1, Math.round(stageRect.height));

  let contentMaxY = 0;
  const qDisplayRoot = stageEl.firstElementChild as HTMLElement | null;
  if (qDisplayRoot) {
    contentMaxY = Math.max(contentMaxY, qDisplayRoot.scrollHeight || 0);
    const r = qDisplayRoot.getBoundingClientRect();
    if (r.height > 0) {
      contentMaxY = Math.max(contentMaxY, r.bottom - stageRect.top);
    }
  }
  const domImgs = Array.from(stageEl.querySelectorAll('img')) as HTMLImageElement[];
  domImgs.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      contentMaxY = Math.max(contentMaxY, r.bottom - stageRect.top);
    }
  });

  let inkMaxY = 0;
  if (rawInkDataUrl) {
    try {
      const inkImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = rawInkDataUrl;
      });
      if (inkImg) {
        const probeCanvas = document.createElement('canvas');
        probeCanvas.width = stageW;
        probeCanvas.height = stageH;
        const pCtx = probeCanvas.getContext('2d');
        if (pCtx) {
          pCtx.drawImage(inkImg, 0, 0, stageW, stageH);
          const imgData = pCtx.getImageData(0, 0, stageW, stageH).data;
          for (let y = stageH - 1; y >= 0; y--) {
            let rowHasInk = false;
            const rowOffset = y * stageW * 4;
            for (let x = 0; x < stageW; x += 2) {
              if (imgData[rowOffset + x * 4 + 3] > 15) {
                rowHasInk = true;
                break;
              }
            }
            if (rowHasInk) {
              inkMaxY = y;
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  const cropH = Math.min(
    stageH,
    Math.max(Math.ceil(contentMaxY), Math.ceil(inkMaxY), 180) + 36
  );

  return { stageWidth: stageW, stageHeight: stageH, cropHeight: cropH };
};

/**
 * 🌟 AI 채점용 이미지 합성 헬퍼:
 * - 문제에 이미지(<img>: 도형, 표, 그림 빈칸 등)가 있는 경우 실제 화면 좌표 그대로 배경에 깔고 그 위에 학생 필기를 합성하여 AI가 문제 그림과 필기를 함께 인식하게 합니다.
 * - MathJax 수식 텍스트는 건드리지 않으므로 텍스트 깨짐("이개" 중복 등)이 전혀 발생하지 않습니다.
 */
export const captureCompositeQuestionImage = async (
  stageEl: HTMLElement | null,
  rawInkDataUrl: string | null
): Promise<string> => {
  if (!rawInkDataUrl) return '';
  if (typeof window === 'undefined' || !stageEl) return rawInkDataUrl;

  try {
    const domImgs = Array.from(stageEl.querySelectorAll('img')) as HTMLImageElement[];
    // 문제에 별도 <img>가 없는 경우(순수 텍스트/MathJax 문항)에는 원본 필기 이미지를 그대로 전달 (AI는 questionText의 LaTeX과 함께 채점)
    if (domImgs.length === 0) return rawInkDataUrl;

    const stageRect = stageEl.getBoundingClientRect();
    const stageW = Math.round(stageRect.width);
    const stageH = Math.round(stageRect.height);
    if (stageW <= 0 || stageH <= 0) return rawInkDataUrl;

    const loadImg = (src: string, useCors: boolean = true): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        if (!src) return resolve(null);
        const im = new Image();
        if (useCors && !src.startsWith('data:') && !src.startsWith('blob:')) {
          im.crossOrigin = 'anonymous';
        }
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      });

    const loadCorsSafeImg = async (imgEl: HTMLImageElement): Promise<HTMLImageElement | null> => {
      const src = imgEl.currentSrc || imgEl.src;
      if (!src) return null;
      if (src.startsWith('data:') || src.startsWith('blob:')) {
        return loadImg(src, false);
      }
      try {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (res.ok) {
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          return await loadImg(objUrl, false);
        }
      } catch (e) {}
      return loadImg(src, true);
    };

    const inkImg = await loadImg(rawInkDataUrl, false);
    if (!inkImg) return rawInkDataUrl;

    const { cropHeight } = await measureStageDimensions(stageEl, rawInkDataUrl);
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.round(stageW * scale);
    outCanvas.height = Math.round(cropHeight * scale);
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return rawInkDataUrl;

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, stageW, cropHeight);

    ctx.save();
    ctx.globalAlpha = 0.78;
    for (const imgEl of domImgs) {
      const r = imgEl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const safeImg = await loadCorsSafeImg(imgEl);
      if (safeImg) {
        ctx.drawImage(safeImg, r.left - stageRect.left, r.top - stageRect.top, r.width, r.height);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.drawImage(inkImg, 0, 0, stageW, stageH);
    ctx.restore();

    return outCanvas.toDataURL('image/png');
  } catch (err) {
    return rawInkDataUrl;
  }
};
