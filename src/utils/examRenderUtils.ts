// src/utils/examRenderUtils.ts

export const LOGO_FOOTER_LEFT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_left.png";
export const LOGO_FOOTER_RIGHT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_right.png";
export const ADMISSION_HEADER_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo_original.png";

export interface HeaderExtraMeta {
  isFirstPage?: boolean;
  depth5Scope?: string;
  questionCount?: number;
}

export const formatExamDate = (isoStr: string) => {
  if (!isoStr) return '';
  const parts = isoStr.split('-');
  if (parts.length !== 3) return '';
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
};

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null' || url === 'undefined') return '';
  let validUrl = String(url).trim();
  if (validUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(validUrl);
      if (Array.isArray(parsed) && parsed.length > 0) validUrl = String(parsed[0] || '').trim();
    } catch (e) {}
  }
  validUrl = validUrl.replace(/^["']|["']$/g, '').trim();
  const lower = validUrl.toLowerCase();
  if (!validUrl || lower === 'null' || lower === 'undefined') return '';
  if (!lower.startsWith('http') && !lower.startsWith('data:image') && !lower.startsWith('blob:')) {
    const cleanPath = validUrl.replace(/^\/+/, '').replace(/^question_images\/+/, '');
    validUrl = `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/question_images/${cleanPath}`;
  }
  return validUrl;
};

export const formatQText = (str: string) => {
  if (!str) return ''; str = String(str);
  str = str.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ').replace(/\n/g, '<br>');
  str = str.replace(/<br>\s*,\s*<br>/g, ', ').replace(/<br>\s*,/g, ', ').replace(/,\s*<br>/g, ', ');
  while (/\\text\s*\{\s*\\text\s*\{/.test(str)) { str = str.replace(/\\text\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, '\\text{$1}'); }
  str = str.replace(/\\text\s*\{([^{}]*[가-힣]+[^{}]*)\}/g, '$1');
  str = str.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  str = str.replace(/[◀◁]\s*\|?\s*[▶▷]/g, '□').replace(/◁\|▷/g, '□').replace(/◀\|▶/g, '□');
  str = str.replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*\\square\s*\}/g, ' $1 ').replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*□\s*\}/g, ' $1 '); 
  return str;
};

export const buildHeaderHtml = (
  badge: string,
  title: string,
  showTitle: boolean,
  currTmpl: string,
  eDate: string,
  extraMeta?: HeaderExtraMeta
) => {
  const isFirstPage = extraMeta?.isFirstPage !== false;
  const depth5Scope = (extraMeta?.depth5Scope || '').trim();
  const qCount = extraMeta?.questionCount || 0;

  // 🌟 추천 1: 학원 표준 평가형 (1페이지에만 Depth 5 출제 범위 + 큼직한 반/이름/점수 기입 테이블 표시)
  // 주의: innerHTML 주입 시 Tailwind 임의 클래스(w-[...])가 누락되어 칸이 찌그러지지 않도록 반드시 인라인 style 치수를 명시합니다.
  if (currTmpl === 'academy_standard') {
    const courseBadge = badge
      ? `<span style="color: var(--color-title); font-size: 15px; font-weight: 800; padding: 4px 12px; border-radius: 6px; background: #f1f5f9; border: 1.5px solid #cbd5e1; white-space: nowrap;">${badge}</span>`
      : '';
    const dateHtml = eDate
      ? `<span style="font-size: 15px; font-weight: 700; color: #64748b; white-space: nowrap;">${formatExamDate(eDate)}</span>`
      : '';

    if (!isFirstPage) {
      if (!showTitle) {
        return `<div class="flex justify-end items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 8px;">${courseBadge}</div>`;
      }
      return `
        <div class="flex justify-between items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 10px;">
          <div class="flex items-center gap-3 overflow-hidden" style="max-width: 72%;">
            <img src="${LOGO_FOOTER_LEFT_URL}" style="height: 24px; object-fit: contain; flex-shrink: 0;" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-base shrink-0\\'>LOGICA</span>'">
            <span style="color: var(--color-title); font-size: 20px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">${dateHtml}${courseBadge}</div>
        </div>`;
    }

    const scopeHtml = depth5Scope
      ? `<div class="flex items-center gap-2.5" style="margin-top: 10px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 7px 14px; max-width: 100%; width: fit-content;">
           <span style="background-color: var(--color-title); color: #ffffff; font-size: 13px; font-weight: 800; padding: 3px 9px; border-radius: 5px; flex-shrink: 0;">출제 범위</span>
           <span style="font-size: 15px; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${depth5Scope}</span>
         </div>`
      : '';

    return `
      <div class="flex justify-between items-end shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2.5px solid var(--color-line); padding-bottom: 14px; gap: 24px;">
        <div class="flex flex-col justify-end min-w-0 flex-1">
          <div class="flex items-center gap-3" style="margin-bottom: 8px;">
            <img src="${LOGO_FOOTER_LEFT_URL}" style="height: 28px; object-fit: contain; flex-shrink: 0;" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-lg shrink-0\\'>LOGICA</span>'">
            ${courseBadge}
            ${dateHtml}
          </div>
          <h1 style="color: var(--color-title); font-size: 34px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h1>
          ${scopeHtml}
        </div>
        <div style="flex-shrink: 0;">
          <table style="width: 430px; border-collapse: collapse; border: 2px solid #475569; background: #ffffff; table-layout: fixed;">
            <tbody>
              <tr style="height: 48px;">
                <td style="width: 68px; border: 1.5px solid #64748b; background: #f1f5f9; font-size: 16px; font-weight: 800; color: #334155; text-align: center; vertical-align: middle;">반</td>
                <td style="width: 172px; border: 1.5px solid #64748b; background: #ffffff;"></td>
                <td style="width: 190px; border: 1.5px solid #64748b; background: #f1f5f9; font-size: 16px; font-weight: 800; color: #334155; text-align: center; vertical-align: middle;">점 수</td>
              </tr>
              <tr style="height: 58px;">
                <td style="width: 68px; border: 1.5px solid #64748b; background: #f1f5f9; font-size: 16px; font-weight: 800; color: #334155; text-align: center; vertical-align: middle;">이 름</td>
                <td style="width: 172px; border: 1.5px solid #64748b; background: #ffffff;"></td>
                <td style="width: 190px; border: 1.5px solid #64748b; background: #ffffff; text-align: right; vertical-align: bottom; padding: 0 14px 8px 14px; font-size: 16px; font-weight: 800; color: #94a3b8;">/ ${qCount > 0 ? `${qCount}문항` : '100점'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // 🌟 추천 2: 모던 요약바형 (1페이지 상단에 큼직한 단원 범위 + 반/이름/맞은개수 필기 바 표시)
  if (currTmpl === 'summary_bar') {
    const courseBadge = badge
      ? `<span style="color: var(--color-title); font-size: 15px; font-weight: 800; padding: 5px 16px; border-radius: 9999px; background: #f1f5f9; border: 1.5px solid #cbd5e1; white-space: nowrap;">${badge}</span>`
      : '';
    const dateHtml = eDate
      ? `<span style="font-size: 15px; font-weight: 700; color: #64748b; white-space: nowrap;">${formatExamDate(eDate)}</span>`
      : '';

    if (!isFirstPage) {
      if (!showTitle) {
        return `<div class="flex justify-end items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 8px;">${courseBadge}</div>`;
      }
      return `
        <div class="flex justify-between items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 10px;">
          <h1 style="color: var(--color-title); font-size: 20px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h1>
          <div class="flex items-center gap-3 shrink-0">${dateHtml}${courseBadge}</div>
        </div>`;
    }

    return `
      <div class="flex flex-col shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2.5px solid var(--color-line); padding-bottom: 14px; gap: 12px;">
        <div class="flex justify-between items-end gap-4">
          <div class="flex items-center gap-4 min-w-0">
            <img src="${LOGO_FOOTER_LEFT_URL}" style="height: 36px; object-fit: contain; flex-shrink: 0;" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-xl shrink-0\\'>LOGICA</span>'">
            <h1 style="color: var(--color-title); font-size: 34px; font-weight: 800; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h1>
          </div>
          <div class="flex items-center gap-3 shrink-0">${dateHtml}${courseBadge}</div>
        </div>
        <div class="w-full flex items-center justify-between" style="background: #f8fafc; border: 2px solid #cbd5e1; border-radius: 10px; padding: 12px 20px; min-height: 60px; gap: 20px;">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <span style="font-size: 15px; font-weight: 800; color: #64748b; flex-shrink: 0;">📚 단원 범위:</span>
            <span style="color: var(--color-title); font-size: 16px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${depth5Scope || '전 범위'}</span>
          </div>
          <div class="flex items-end shrink-0" style="gap: 22px; font-size: 16px; font-weight: 800; color: #334155;">
            <span class="flex items-end">반:<span style="display: inline-block; width: 115px; height: 30px; border-bottom: 2px solid #475569; margin-left: 8px;"></span></span>
            <span class="flex items-end">이름:<span style="display: inline-block; width: 155px; height: 30px; border-bottom: 2px solid #475569; margin-left: 8px;"></span></span>
            <span class="flex items-end">맞은 개수:<span style="display: inline-block; width: 75px; height: 30px; border-bottom: 2px solid #475569; margin-left: 8px;"></span><span style="margin-left: 6px; color: #64748b;">${qCount > 0 ? `/ ${qCount}` : ''}</span></span>
          </div>
        </div>
      </div>`;
  }

  // 🌟 추천 3: 클리닉·과제 노트형 (1페이지에 Depth 5 단원 표시 + 큼직한 학습일/학생 이름/선생님 확인란)
  if (currTmpl === 'clinic_note') {
    const courseBadge = badge
      ? `<span style="font-size: 14px; font-weight: 800; padding: 4px 12px; border-radius: 6px; background: #1e293b; color: #ffffff; white-space: nowrap;">${badge}</span>`
      : '';
    const dateHtml = eDate ? formatExamDate(eDate) : '202  .     .     .';

    if (!isFirstPage) {
      if (!showTitle) {
        return `<div class="flex justify-end items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 8px;">${courseBadge}</div>`;
      }
      return `
        <div class="flex justify-between items-center shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2px solid var(--color-line); padding-bottom: 10px;">
          <h1 style="color: var(--color-title); font-size: 20px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h1>
          ${courseBadge}
        </div>`;
    }

    return `
      <div class="flex justify-between items-end shrink-0 w-full relative z-10 bg-white" style="border-bottom: 2.5px solid var(--color-line); padding-bottom: 14px; gap: 24px;">
        <div class="flex flex-col min-w-0 flex-1">
          <div class="flex items-center gap-2.5" style="margin-bottom: 8px;">
            <span style="color: var(--color-title); border: 1.5px solid var(--color-line); font-size: 13px; font-weight: 900; letter-spacing: 0.08em; padding: 3px 10px; border-radius: 6px;">LOGICA STUDY SHEET</span>
            ${courseBadge}
          </div>
          <h1 style="color: var(--color-title); font-size: 34px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h1>
          ${depth5Scope ? `<div style="margin-top: 8px; font-size: 15px; font-weight: 700; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🎯 학습 단원: <span style="color: #0f172a; font-weight: 800;">${depth5Scope}</span></div>` : ''}
        </div>
        <div style="flex-shrink: 0;">
          <table style="width: 440px; border-collapse: collapse; border: 2px solid #475569; background: #ffffff; table-layout: fixed;">
            <thead>
              <tr style="height: 32px; background: #f1f5f9;">
                <th style="width: 140px; border: 1.5px solid #64748b; font-size: 14px; font-weight: 800; color: #475569; text-align: center;">학습일</th>
                <th style="width: 180px; border: 1.5px solid #64748b; font-size: 14px; font-weight: 800; color: #475569; text-align: center;">학생 이름</th>
                <th style="width: 120px; border: 1.5px solid #64748b; font-size: 14px; font-weight: 800; color: #475569; text-align: center;">선생님 확인</th>
              </tr>
            </thead>
            <tbody>
              <tr style="height: 64px;">
                <td style="border: 1.5px solid #64748b; text-align: center; vertical-align: middle; font-size: 16px; font-weight: 800; color: ${eDate ? '#1e293b' : '#94a3b8'}; white-space: nowrap;">${dateHtml}</td>
                <td style="border: 1.5px solid #64748b; background: #ffffff;"></td>
                <td style="border: 1.5px solid #64748b; background: #ffffff;"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  if (currTmpl === 'basic2') {
    const courseBadge = badge ? `<div class="font-bold text-[14px] px-3 py-1.5 rounded-md shadow-sm bg-slate-200 shrink-0" style="color: var(--color-title);">${badge}</div>` : '';
    if (!showTitle) {
        return `<div class="flex justify-end items-center border-b-[2px] pb-1 shrink-0 w-full relative z-10 bg-white" style="border-bottom-color: var(--color-line);">${courseBadge}</div>`;
    }
    const yearText = eDate ? `${eDate.split('-')[0]}년` : '';
    const yearHtml = yearText ? `<div class="text-[14px] font-bold text-slate-500 whitespace-nowrap shrink-0">${yearText}</div>` : '';
    return `
        <div class="flex justify-between items-end border-b-[2px] pb-1 shrink-0 w-full relative z-10 bg-white" style="border-bottom-color: var(--color-line);">
            <div class="h-[80px] flex items-center gap-4 overflow-hidden" style="max-width: 70%;">
                <img src="${LOGO_FOOTER_LEFT_URL}" class="h-9 object-contain shrink-0" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-lg shrink-0\\'>LOGICA</span>'">
                <h1 class="text-[26px] font-bold whitespace-nowrap overflow-hidden text-ellipsis translate-y-1" style="color: var(--color-title);">${title}</h1>
                ${yearHtml}
            </div>
            ${courseBadge}
        </div>`;
  }

  const courseBadge = badge ? `<div class="font-bold text-[14px] px-3 py-1.5 rounded-md shadow-sm bg-slate-200" style="color: var(--color-title);">${badge}</div>` : '';
  const dateHtml = eDate ? `<div class="text-[13px] font-bold" style="color: var(--color-line);">${formatExamDate(eDate)}</div>` : '';
  const topRightStack = (dateHtml || courseBadge) ? `<div class="flex flex-col items-end gap-1">${dateHtml}${courseBadge}</div>` : '';
  
  if (!showTitle) {
    return `<div class="flex justify-end items-center border-b-[2px] pb-1 shrink-0 w-full relative z-10 bg-white" style="border-bottom-color: var(--color-line);">${topRightStack}</div>`;
  }
  return `
      <div class="flex justify-between items-end border-b-[2px] pb-1 shrink-0 w-full relative z-10 bg-white" style="border-bottom-color: var(--color-line);">
          <div class="h-[80px] flex items-end overflow-hidden pb-1" style="max-width: 70%;">
              <h1 class="text-[30px] font-bold whitespace-nowrap overflow-hidden text-ellipsis w-full" style="color: var(--color-title);">${title}</h1>
          </div>
          <div class="mt-4">${topRightStack}</div>
      </div>`;
};

export const buildFooterHtml = (badge: string, pageIndex: number, totalPages: number, title: string, currTmpl: string, eDate: string) => {
  if (currTmpl === 'basic2') {
    const displayPageNum = `${pageIndex + 1} / ${totalPages}`;
    return `
        <div class="border-t-[2px] pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20" style="border-top-color: var(--color-line);">
            <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
            <div class="absolute right-0 bottom-0 flex justify-end items-end pointer-events-none">
                <div class="text-[13px] text-slate-500 font-bold whitespace-nowrap text-right tracking-widest">${displayPageNum}</div>
            </div>
        </div>`;
  }

  return `
      <div class="border-t-[2px] pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20" style="border-top-color: var(--color-line);">
          <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-bold text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
          <div class="absolute right-0 bottom-0 flex justify-end items-end pointer-events-none">
              <div class="text-[14px] text-slate-400 font-bold whitespace-nowrap text-right tracking-widest">${pageIndex + 1} / ${totalPages}</div>
          </div>
      </div>`;
};

export const generateGroupBlock = (g: any) => {
  let subHtml = '';
  g.questions.forEach((q: any, sIdx: number) => {
      let safeImgUrl = String(q.image_url || '').trim();
      let safeImg2Url = String(q.image_2_url || '').trim();
      let imgHtml = '';
      if (safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null') {
          imgHtml += `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full h-auto object-contain mix-blend-multiply" style="width: auto; height: auto;"></div>`;
      }
      if (safeImg2Url && safeImg2Url !== 'undefined' && safeImg2Url !== 'null') {
          imgHtml += `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImg2Url)}" class="max-w-full h-auto object-contain mix-blend-multiply" style="width: auto; height: auto;"></div>`;
      }
      let rawQ2 = String(q.question_2 || '').trim();
      let q2Html = '';
      if (rawQ2 && rawQ2 !== 'undefined' && rawQ2 !== 'null') {
          q2Html = `<div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify mt-3">${formatQText(rawQ2)}</div>`;
      }
      const prefix = g.questions.length > 1 ? `<span class="font-bold text-black mr-1">(${q.sub_num || sIdx + 1})</span>` : '';
      subHtml += `
          <div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}">
              <div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(q.question)}</div>
              ${imgHtml}
              ${q2Html}
          </div>`;
  });
  return `
      <div class="flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
          <div class="flex items-start w-full min-w-0">
              <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                  <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${g.displayNum}</span>
              </div>
              <div class="flex flex-col w-full min-w-0 pt-[2px]">${subHtml}</div>
          </div>
      </div>`;
};

export const generateColHtml = (colGroups: any[]) => {
  if (!colGroups || colGroups.length === 0) return `<div class="w-full min-w-0"></div>`;
  const n = colGroups.length;
  let colHtml = `<div class="w-full min-w-0" data-col-count="${n}" style="display:grid; grid-template-rows: repeat(${n}, 1fr); gap: 15mm; height:100%; position:relative; overflow: hidden;">`;
  colGroups.forEach(g => { colHtml += generateGroupBlock(g); });
  colHtml += '</div>';
  return colHtml;
};