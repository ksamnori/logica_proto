// src/utils/examRenderUtils.ts

export const LOGO_FOOTER_LEFT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_left.png";
export const LOGO_FOOTER_RIGHT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_right.png";
export const ADMISSION_HEADER_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_entrance.png";

export const formatExamDate = (isoStr: string) => {
  if (!isoStr) return '';
  const parts = isoStr.split('-');
  if (parts.length !== 3) return '';
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
};

export const getCleanUrl = (url: string) => {
  if (!url || url === 'null') return '';
  let validUrl = url;
  if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e){} }
  if (validUrl && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) {
      validUrl = `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/question_images/${validUrl.replace(/^\/+/, '')}`;
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

export const buildHeaderHtml = (badge: string, title: string, showTitle: boolean, currTmpl: string, eDate: string) => {
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
                <img src="${LOGO_FOOTER_LEFT_URL}" class="h-9 object-contain shrink-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-lg shrink-0\\'>LOGICA</span>'">
                <h1 class="text-[22px] font-bold whitespace-nowrap overflow-hidden text-ellipsis translate-y-1" style="color: var(--color-title);">${title}</h1>
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
              <h1 class="text-[26px] font-bold whitespace-nowrap overflow-hidden text-ellipsis w-full" style="color: var(--color-title);">${title}</h1>
          </div>
          <div class="mt-4">${topRightStack}</div>
      </div>`;
};

export const buildFooterHtml = (badge: string, pageIndex: number, totalPages: number, title: string, currTmpl: string, eDate: string) => {
  if (currTmpl === 'basic2') {
    const displayPageNum = `${pageIndex + 1} / ${totalPages}`;
    return `
        <div class="border-t-[2px] pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20" style="border-top-color: var(--color-line);">
            <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
            <div class="absolute right-0 bottom-0 flex justify-end items-end pointer-events-none">
                <div class="text-[13px] text-slate-500 font-bold whitespace-nowrap text-right tracking-widest">${displayPageNum}</div>
            </div>
        </div>`;
  }

  return `
      <div class="border-t-[2px] pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20" style="border-top-color: var(--color-line);">
          <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
          <div class="absolute right-0 bottom-0 flex justify-end items-end pointer-events-none">
              <div class="text-[14px] text-slate-400 font-bold whitespace-nowrap text-right tracking-widest">${pageIndex + 1} / ${totalPages}</div>
          </div>
      </div>`;
};

export const generateGroupBlock = (g: any) => {
  let subHtml = '';
  g.questions.forEach((q: any, sIdx: number) => {
      let safeImgUrl = String(q.image_url || '').trim();
      let imgHtml = '';
      if (safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null') {
          imgHtml = `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="max-height: 450px;"></div>`;
      }
      const prefix = g.questions.length > 1 ? `<span class="font-extrabold text-black mr-1">(${q.sub_num || sIdx + 1})</span>` : '';
      subHtml += `
          <div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}">
              <div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(q.question)}</div>
              ${imgHtml}
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