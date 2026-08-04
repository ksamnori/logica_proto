// src/app/exam/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getISOWeekKST } from "@/lib/classRound";

// 분리된 컴포넌트 불러오기
import ViewerHeader from "@/components/exam/ViewerHeader";
import PublishPanel from "@/components/exam/PublishPanel";

const LOGO_FOOTER_LEFT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_left.png";
const LOGO_FOOTER_RIGHT_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_footer_right.png";
const ADMISSION_HEADER_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logo_entrance.png";

const COLUMN_GAP_PX = 15 * (96 / 25.4);
const SAFETY_MARGIN_PX = 8 * (96 / 25.4);
const PALETTE_STORAGE_KEY = 'examViewerColorPalette';
const DEFAULT_PALETTE = ['#2563eb', '#002864', '#14532d'];

export default function ExamViewerPage() {
  const router = useRouter();

  // === DOM Refs ===
  const examContainerRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const mathJaxRef = useRef(false);

  // === 줌 컨트롤 Refs ===
  const zoomStateRef = useRef({ active: false, direction: 1, speed: 0.002 });
  const zoomRafRef = useRef<number | null>(null);
  const zoomDelayTimerRef = useRef<any>(null);

  // === 핵심 렌더링 상태 ===
  const examStateRef = useRef<any>(null);
  const currentScaleRef = useRef(1);
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const isNewExamRef = useRef<boolean>(false);
  const rebuildExamIdRef = useRef<string | null>(null);
  const currentExamIdRef = useRef<string | null>(null);
  
  // PublishPanel에 넘길 React State (Ref 대신 변경 감지용)
  const [savedExamId, setSavedExamId] = useState<string | null>(null);
  const [isExamDistributed, setIsExamDistributed] = useState<boolean>(false);

  // === 레이아웃 UI 상태 ===
  const [layoutType, setLayoutType] = useState("선택없음"); 
  // === 주간테스트 전용: 주차/학년 자동 배정 ===
  const [testWeek, setTestWeek] = useState<number>(getISOWeekKST());
  const [weeklyTargetGrade, setWeeklyTargetGrade] = useState("");
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
  const [weeklyMatchedCount, setWeeklyMatchedCount] = useState<number | null>(null);
  const [template, setTemplate] = useState("basic1");
  const [titleMode, setTitleMode] = useState("all");
  const [columns, setColumns] = useState(2);
  const [splits, setSplits] = useState(4);
  const [examDate, setExamDate] = useState("");
  const [examTitle, setExamTitle] = useState("시험지");
  const [displayBadge, setDisplayBadge] = useState("");
  
  const [colorNum, setColorNum] = useState("#175b6a");
  const [colorTitle, setColorTitle] = useState("#002864");
  const [colorLine, setColorLine] = useState("#94a3b8");
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  const [fontSize, setFontSize] = useState(16);

  // === 뷰어 컨트롤 상태 ===
  const [zoomFactor, setZoomFactor] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState('1');
  const movingToTargetRef = useRef(false);
  const moveSettleTimerRef = useRef<any>(null);
  const buttonPageTimerRef = useRef<any>(null);
  const pendingButtonPageRef = useRef<number | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [isAdmissionLock, setIsAdmissionLock] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // === 사이드 패널 접기 & 모달 상태 ===
  const [isSidebarFolded, setIsSidebarFolded] = useState(false);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PALETTE_STORAGE_KEY) || "[]");
      if (Array.isArray(saved) && saved.length === 3) setPalette(saved);
    } catch (e) {}

    loadMathJax();
    initExamData();

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (zoomDelayTimerRef.current) clearTimeout(zoomDelayTimerRef.current);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!movingToTargetRef.current && !buttonPageTimerRef.current) setPageInputValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const handleResize = () => { if (examStateRef.current) updatePreviewViewport(); };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [zoomFactor]);

  useEffect(() => {
    const timer = setTimeout(() => { if (examStateRef.current) updatePreviewViewport(); }, 350); 
    return () => clearTimeout(timer);
  }, [isSidebarFolded]);

  useEffect(() => {
    const wrapper = previewWrapperRef.current;
    if (!wrapper) return;

    let zoomRafPending = false;
    const handleWheel = (e: WheelEvent) => {
      if (!examStateRef.current) return;
      if (!(e.ctrlKey || e.metaKey)) return; 
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;

      const prevScale = currentScaleRef.current || 1;
      const w = previewWrapperRef.current;
      const anchorX = w ? (w.scrollLeft + w.clientWidth / 2) / prevScale : 0;
      const anchorY = w ? (w.scrollTop + w.clientHeight / 2) / prevScale : 0;

      setZoomFactor(prev => {
        const next = Math.min(2, Math.max(0.3, prev + direction * 0.1));
        if (!zoomRafPending) {
          zoomRafPending = true;
          requestAnimationFrame(() => {
            zoomRafPending = false;
            updatePreviewViewport(next);
            const wrap = previewWrapperRef.current;
            if (wrap) {
              const newScale = currentScaleRef.current || 1;
              wrap.scrollLeft = anchorX * newScale - wrap.clientWidth / 2;
              wrap.scrollTop = anchorY * newScale - wrap.clientHeight / 2;
            }
          });
        }
        return next;
      });
    };

    let scrollTrackTimer: any = null;
    const handleScroll = () => {
      if (scrollTrackTimer) return;
      scrollTrackTimer = setTimeout(() => {
        scrollTrackTimer = null;
        updateCurrentPageFromScroll();
      }, 100);
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    wrapper.addEventListener('scroll', handleScroll);
    return () => {
      wrapper.removeEventListener('wheel', handleWheel);
      wrapper.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] }, svg: { fontCache: 'global' } };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const nextFrame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  const initExamData = async () => {
    const params = new URLSearchParams(window.location.search);
    const urlExamId = params.get('exam_id') || params.get('id');

    let isNew = false;
    let title = "시험지";
    let badge = "";
    let lType = "선택없음";
    let dbLayoutSettings: any = null;
    let orderedQuestions: any[] = [];
    let wWeek: number | null = null;
    let wGrade = "";

    try {
      if (urlExamId) {
        currentExamIdRef.current = urlExamId;
        setSavedExamId(urlExamId);

        const { data: examData } = await supabase.from('exam_master').select('*').eq('exam_id', urlExamId).single();
        if (!examData) throw new Error("시험지를 찾을 수 없습니다.");
        
        badge = [examData.target_grade || examData.grade, examData.course || examData.course_name].filter(Boolean).join(' ');
        if (!badge) badge = examData.sub_title || '';
        title = examData.title || '시험지';
        lType = examData.exam_type || '선택없음';
        dbLayoutSettings = examData.layout_settings || null;
        wWeek = examData.test_week || null;
        wGrade = examData.target_grade || "";

        const { data: assignmentCheck } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', urlExamId).limit(1);
        setIsExamDistributed(!!(assignmentCheck && assignmentCheck.length > 0));

        const { data: examItems } = await supabase.from('exam_item').select('*').eq('exam_id', urlExamId).order('sort_order');
        const qIds = examItems?.map((i: any) => i.question_id) || [];
        const { data: questions } = await supabase.from('question_db').select('*').in('question_id', qIds);
        
        orderedQuestions = examItems?.map((item: any) => {
            const q = questions?.find(qu => qu.question_id === item.question_id);
            return q ? { ...q, sort_order: item.sort_order } : null;
        }).filter(Boolean) || [];

      } else if (sessionStorage.getItem('examQuestions')) {
        isNew = true;
        isNewExamRef.current = true;
        const editExamId = sessionStorage.getItem('editExamId') || null;
        const duplicateExamId = sessionStorage.getItem('duplicateExamId') || null;
        rebuildExamIdRef.current = editExamId;
        const loadExamId = editExamId || duplicateExamId;

        title = sessionStorage.getItem('examTitle') || '새로운 테스트';

        if (loadExamId) {
          const { data: origExam } = await supabase.from('exam_master').select('*').eq('exam_id', loadExamId).single();
          if (origExam) {
            title = duplicateExamId ? (origExam.title + ' (복제본)') : origExam.title;
            badge = origExam.sub_title || '';
            lType = origExam.exam_type || '선택없음';
            dbLayoutSettings = origExam.layout_settings || null;
            wWeek = origExam.test_week || null;
            wGrade = origExam.target_grade || "";
            if (duplicateExamId && dbLayoutSettings) {
                let cloned = typeof dbLayoutSettings === 'string' ? JSON.parse(dbLayoutSettings) : { ...dbLayoutSettings };
                delete cloned.examDate;
                dbLayoutSettings = cloned;
            }
          }
        }

        const parsedData = JSON.parse(sessionStorage.getItem('examQuestions') || "[]");
        const flatQIds: string[] = [];
        parsedData.forEach((g: any) => { (Array.isArray(g) ? g : [g]).forEach((qid: string) => flatQIds.push(qid)); });

        const { data: questions } = await supabase.from('question_db').select('*').in('question_id', flatQIds);
        orderedQuestions = flatQIds.map((qid, idx) => {
            const q = questions?.find(qu => qu.question_id === qid);
            return q ? { ...q, sort_order: idx + 1 } : null;
        }).filter(Boolean);
      } else {
        throw new Error("시험지 정보가 없습니다.");
      }

      setExamTitle(title);
      setDisplayBadge(badge);
      setLayoutType(lType);
      setIsAdmissionLock(lType === '입학테스트');
      if (wWeek) setTestWeek(wWeek);
      if (wGrade) setWeeklyTargetGrade(wGrade);

      let initialCol = 2, initialSplit = 4, initialTitleMode = 'all', initialTmpl = 'basic1';
      let cNum = '#175b6a', cTit = '#002864', cLin = '#94a3b8', eDate = '';

      if (dbLayoutSettings) {
        const s = typeof dbLayoutSettings === 'string' ? JSON.parse(dbLayoutSettings) : dbLayoutSettings;
        if (s.column) initialCol = parseInt(s.column);
        if (s.split) initialSplit = parseInt(s.split);
        if (s.titleMode) initialTitleMode = s.titleMode;
        if (s.template) initialTmpl = s.template;
        if (s.numberColor) cNum = s.numberColor;
        if (s.titleColor) cTit = s.titleColor;
        if (s.lineColor) cLin = s.lineColor;
        if (s.examDate) eDate = s.examDate;
      }

      setColumns(initialCol); setSplits(initialSplit); setTitleMode(initialTitleMode); setTemplate(initialTmpl);
      setColorNum(cNum); setColorTitle(cTit); setColorLine(cLin); setExamDate(eDate);

      hasUnsavedChangesRef.current = isNew;

      const groupMap = new Map(); const groups: any[] = [];
      orderedQuestions.forEach(q => {
          const src = String(q.pdf_source || 'UNKNOWN'); 
          const page = String(q.detected_page_num || q.final_printed_page || 'U');
          const baseNumMatch = String(q.question_number || '').match(/\d+/);
          const baseNum = baseNumMatch ? baseNumMatch[0] : q.question_id; 
          
          let groupId = `${src}_${page}_${baseNum}`;
          if (q.parent_question_id && String(q.parent_question_id) !== 'null') groupId = `${src}_${page}_${q.parent_question_id}`;
          if (!groupMap.has(groupId)) { const newG = { id: groupId, questions: [], repQ: q, sort_order: q.sort_order }; groupMap.set(groupId, newG); groups.push(newG); }
          groupMap.get(groupId).questions.push(q);
      });

      groups.forEach(g => {
          g.questions.sort((a: any, b: any) => {
              if (a.question_id === a.parent_question_id || a.sub_num === 0) return -1;
              if (b.question_id === b.parent_question_id || b.sub_num === 0) return 1;
              return (a.sub_num || 0) - (b.sub_num || 0);
          });
          g.sort_order = Math.min(...g.questions.map((q: any) => q.sort_order));
      });
      groups.sort((a, b) => a.sort_order - b.sort_order);
      groups.forEach((g, idx) => { g.displayNum = idx + 1; });

      examStateRef.current = { groups, examTitle: title, displayBadge: badge };

      Promise.all([
        document.fonts.load("400 17px 'NanumSquare'"),
        document.fonts.load("700 17px 'NanumSquare'"),
        document.fonts.load("normal 42px 'CJU_Medium'")
      ]).catch(() => {}).finally(() => {
        if (lType === '입학테스트') renderAdmissionTestPages();
        else remeasureAndRender(initialCol, initialSplit, initialTitleMode, initialTmpl, eDate, title, badge);
      });

    } catch (e: any) {
      if (examContainerRef.current) examContainerRef.current.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">에러: ${e.message}</div>`;
    }
  };

  const formatExamDate = (isoStr: string) => {
    if (!isoStr) return '';
    const parts = isoStr.split('-');
    if (parts.length !== 3) return '';
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  };

  const buildHeaderHtml = (badge: string, title: string, showTitle: boolean, currTmpl: string, eDate: string) => {
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

  const buildFooterHtml = (badge: string, pageIndex: number, totalPages: number, title: string, currTmpl: string, eDate: string) => {
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

  const getCleanUrl = (url: string) => {
    if (!url || url === 'null') return '';
    let validUrl = url;
    if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e){} }
    if (validUrl && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) {
        validUrl = `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/question_images/${validUrl.replace(/^\/+/, '')}`;
    }
    return validUrl;
  };

  const formatQText = (str: string) => {
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

  const generateGroupBlock = (g: any) => {
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

  const generateColHtml = (colGroups: any[]) => {
    if (!colGroups || colGroups.length === 0) return `<div class="w-full min-w-0"></div>`;
    const n = colGroups.length;
    let colHtml = `<div class="w-full min-w-0" data-col-count="${n}" style="display:grid; grid-template-rows: repeat(${n}, 1fr); gap: 15mm; height:100%; position:relative; overflow: hidden;">`;
    colGroups.forEach(g => { colHtml += generateGroupBlock(g); });
    colHtml += '</div>';
    return colHtml;
  };

  const shrinkOverflowingMath = (scopeEl: HTMLElement) => {
    scopeEl.querySelectorAll('mjx-container').forEach((mjx: any) => {
        mjx.style.zoom = ''; 
        const parent = mjx.parentElement;
        if (!parent) return;
        const availW = parent.clientWidth;
        const mathW = mjx.scrollWidth;
        if (availW > 0 && mathW > availW + 1) {
            mjx.style.zoom = Math.max(0.4, availW / mathW); 
        }
    });
  };

  const measureGroupHeights = async (groups: any[], columnWidth: number) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute; left:-9999px; top:0; width:${columnWidth}px; visibility:hidden;`;
    document.body.appendChild(probe);

    groups.forEach((g, idx) => {
        const wrap = document.createElement('div');
        wrap.id = `measure-${idx}`;
        wrap.innerHTML = generateGroupBlock(g);
        probe.appendChild(wrap);
    });

    const imgs = Array.from(probe.querySelectorAll('img'));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; })));

    if ((window as any).MathJax?.typesetPromise) {
        await (window as any).MathJax.typesetPromise([probe]);
    }
    await new Promise(res => setTimeout(res, 200));
    shrinkOverflowingMath(probe);
    await new Promise(res => setTimeout(res, 100));

    groups.forEach((g, idx) => {
        const el = document.getElementById(`measure-${idx}`);
        if(el) g.measuredHeight = el.offsetHeight;
    });
    document.body.removeChild(probe);
  };

  const chunkColumnsByHeight = (groups: any[], maxColumnHeight: number, maxPerColumn: number) => {
    const columns = [];
    let i = 0;
    while (i < groups.length) {
        let placed = false;
        const maxTry = Math.min(maxPerColumn, groups.length - i);
        for (let count = maxTry; count >= 1; count--) {
            const slice = groups.slice(i, i + count);
            const gapTotal = COLUMN_GAP_PX * (count - 1);
            const shareEach = (maxColumnHeight - gapTotal) / count;
            const allFit = slice.every(g => g.measuredHeight <= shareEach);
            if (allFit) {
                columns.push(slice);
                i += count;
                placed = true;
                break;
            }
        }
        if (!placed) { columns.push([groups[i]]); i += 1; }
    }
    return columns;
  };

  const waitForFonts = async (currentArgs: [number, number, string, string, string, string, string]) => {
    const timeout = (ms: number) => new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));

    const checkOne = (label: string, spec: string) => document.fonts.load(spec).then(() => 'ok').catch(() => 'fail');

    const fontsReady = Promise.all([
      checkOne('NanumSquare-400', "400 17px 'NanumSquare'"),
      checkOne('NanumSquare-700', "700 17px 'NanumSquare'"),
      checkOne('CJU_Medium', "normal 42px 'CJU_Medium'"),
    ]).then(() => document.fonts.ready).then(() => 'ready').catch((e) => 'error');

    const result = await Promise.race([fontsReady, timeout(5000)]);

    if (result === 'timeout') {
      fontsReady.then((r) => {
        if (r === 'ready' && examStateRef.current) remeasureAndRender(...currentArgs);
      });
    }
  };

  const remeasureAndRender = async (col: number = columns, split: number = splits, tMode: string = titleMode, tmpl: string = template, eDate: string = examDate, tit: string = examTitle, badge: string = displayBadge) => {
    if (!examStateRef.current) return;
    (window as any).__examRenderReady = false;
    await waitForFonts([col, split, tMode, tmpl, eDate, tit, badge]);
    const { groups } = examStateRef.current;

    const probeHeaderFirst = buildHeaderHtml(badge, tit, true, tmpl, eDate);
    const probeHeaderOther = buildHeaderHtml(badge, tit, false, tmpl, eDate);
    const probeFooter = buildFooterHtml(badge, 0, 1, tit, tmpl, eDate);

    const probe = document.createElement('div');
    probe.className = 'a3-page';
    probe.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
    probe.innerHTML = probeHeaderFirst + `<div class="exam-grid-admission pt-6 pb-6"></div>` + probeFooter;
    document.body.appendChild(probe);
    await nextFrame();

    const grid = probe.querySelector('.exam-grid-admission') as HTMLElement;
    const availableHeightFirst = grid.clientHeight;
    const columnWidth = grid.clientWidth / 2;
    document.body.removeChild(probe);

    const probe2 = document.createElement('div');
    probe2.className = 'a3-page';
    probe2.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden;';
    probe2.innerHTML = probeHeaderOther + `<div class="exam-grid-admission pt-6 pb-6"></div>` + probeFooter;
    document.body.appendChild(probe2);
    await nextFrame();
    const grid2 = probe2.querySelector('.exam-grid-admission') as HTMLElement;
    const availableHeightOther = grid2.clientHeight;
    document.body.removeChild(probe2);

    await measureGroupHeights(groups, columnWidth);

    examStateRef.current = { ...examStateRef.current, availableHeightFirst, availableHeightOther, columnWidth };
    await renderPages(col, split, tMode, tmpl, eDate, tit, badge);
  };

  const renderPages = async (col: number = columns, split: number = splits, tMode: string = titleMode, tmpl: string = template, eDate: string = examDate, tit: string = examTitle, badge: string = displayBadge) => {
    if (!examStateRef.current || !examContainerRef.current) return;

    const { groups, availableHeightFirst, availableHeightOther } = examStateRef.current;
    const maxPerColumn = split / 2;
    
    let targetCols = [];
    if (tMode === 'first') {
      const pass1 = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn);
      const firstCols = pass1.slice(0, col);
      const consumed = firstCols.reduce((sum, c) => sum + c.length, 0);
      const rem = groups.slice(consumed);
      const pass2 = rem.length > 0 ? chunkColumnsByHeight(rem, availableHeightOther - SAFETY_MARGIN_PX, maxPerColumn) : [];
      targetCols = firstCols.concat(pass2);
    } else {
      targetCols = chunkColumnsByHeight(groups, availableHeightFirst - SAFETY_MARGIN_PX, maxPerColumn);
    }

    const pages = [];
    if (col === 1) {
      targetCols.forEach(c => pages.push({ left: c, right: null }));
    } else {
      for (let j = 0; j < targetCols.length; j += 2) pages.push({ left: targetCols[j], right: targetCols[j+1] || [] });
    }

    let finalHtml = '';
    pages.forEach((pageCols, pIdx) => {
      const showTitle = !(tMode === 'first' && pIdx > 0);
      const hHtml = buildHeaderHtml(badge, tit, showTitle, tmpl, eDate);
      const fHtml = buildFooterHtml(badge, pIdx, pages.length, tit, tmpl, eDate);
      
      let rHtml = '';
      if (pageCols.right === null) {
        const h = showTitle ? availableHeightFirst : availableHeightOther;
        const lines = Array.from({ length: Math.ceil((h || 1587)/28) + 1 }).map(() => `<div style="height: 28px; border-bottom: 1px solid #e2e8f0; box-sizing: border-box;"></div>`).join('');
        rHtml = `<div class="w-full h-full min-w-0 flex flex-col pl-6" style="border-left: 1px dashed #cbd5e1; overflow: hidden;"><div class="text-[13px] font-bold text-slate-400 mb-2 tracking-widest">풀 이</div><div class="flex-1" style="overflow: hidden;">${lines}</div></div>`;
      } else {
        rHtml = generateColHtml(pageCols.right);
      }

      finalHtml += `<div class="a3-page">${hHtml}<div class="exam-grid-admission pt-6 pb-6">${generateColHtml(pageCols.left)}${rHtml}</div>${fHtml}</div>`;
    });

    examContainerRef.current.innerHTML = finalHtml;
    
    if ((window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetClear();
      try { await (window as any).MathJax.typesetPromise([examContainerRef.current]); } catch(e){}
    }
    shrinkOverflowingMath(examContainerRef.current);
    
    setTotalPages(pages.length);
    updatePreviewViewport();
    (window as any).__examRenderReady = true;
  };

  const renderAdmissionTestPages = async () => {
    if (!examStateRef.current || !examContainerRef.current) return;
    (window as any).__examRenderReady = false;
    const { groups, examTitle, displayBadge } = examStateRef.current;
    
    const cols = [];
    let i = 0, qNum = 1;
    while (i < groups.length) {
        if ((qNum >= 1 && qNum <= 6) || (qNum >= 8 && qNum <= 9) || (qNum >= 22 && qNum <= 25)) {
            if (i + 1 < groups.length) { cols.push([groups[i], groups[i + 1]]); i += 2; qNum += 2; } 
            else { cols.push([groups[i]]); i += 1; qNum += 1; }
        } else {
            cols.push([groups[i]]); i += 1; qNum += 1;
        }
    }

    const pages = [];
    for (let j = 0; j < cols.length; j += 2) pages.push({ left: cols[j], right: cols[j + 1] || [] });

    let globalQNum = 1;
    let finalHtml = '';

    pages.forEach((pageCols, pIdx) => {
        const courseBadge = displayBadge ? `<div class="text-slate-700 font-bold text-[14px] px-3 py-1.5 rounded-md shadow-sm bg-slate-200">${displayBadge}</div>` : '';
        const dateHtml = examDate ? `<div class="text-[13px] font-bold text-slate-500">${formatExamDate(examDate)}</div>` : '';
        const topRightStack = (dateHtml || courseBadge) ? `<div class="flex flex-col items-end gap-1">${dateHtml}${courseBadge}</div>` : '';
        const hHtml = `
            <div class="flex justify-between items-start border-b-[2px] border-slate-400 pb-3 shrink-0 w-full relative z-10 bg-white">
                <img src="${ADMISSION_HEADER_URL}" class="h-[104px] object-contain -mt-5" onerror="this.outerHTML='<h1 class=\\'text-4xl font-bold text-[#002864] -mt-2\\'>입학테스트</h1>'">
                <div class="mt-7">${topRightStack}</div>
            </div>`;

        const fHtml = `
            <div class="border-t-[2px] border-slate-400 pt-4 flex justify-between items-end h-[40px] shrink-0 bg-white w-full relative z-20">
                <img src="${LOGO_FOOTER_LEFT_URL}" class="h-[16px] object-contain absolute left-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-lexend font-black text-black text-sm absolute left-0 bottom-0\\'>LOGICA</span>'">
                <div class="absolute left-0 right-0 bottom-0 flex justify-center items-center pb-[1px] pointer-events-none">
                    <div class="w-[150px] text-right pr-4 text-[14px] font-bold text-slate-600">${displayBadge}</div>
                    <div class="text-[14px] text-slate-400 font-bold whitespace-nowrap text-center tracking-widest">${pIdx + 1} / ${pages.length}</div>
                    <div class="w-[150px] text-left pl-4 text-[14px] font-bold text-slate-600">입학테스트</div>
                </div>
                <img src="${LOGO_FOOTER_RIGHT_URL}" class="h-[22px] object-contain absolute right-0 bottom-0" onerror="this.outerHTML='<span class=\\'font-bold text-[#006699] text-sm absolute right-0 bottom-0\\'>천종현수학연구소</span>'">
            </div>`;

        const genCol = (cGroups: any[]) => {
            if (!cGroups || cGroups.length === 0) return `<div class="flex flex-col flex-1 w-full min-w-0"></div>`;
            let cHtml = '<div class="flex flex-col flex-1 w-full min-w-0 gap-[15mm]">';
            cGroups.forEach(g => {
                let subHtml = '';
                const finalScore = g.questions[0].assigned_score;
                g.questions.forEach((q: any, sIdx: number) => {
                    let safeImgUrl = String(q.image_url || '').trim();
                    let imgHtml = '';
                    if (safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null') {
                        imgHtml = `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="max-height: 450px;"></div>`;
                    }
                    const prefix = g.questions.length > 1 ? `<span class="font-extrabold text-black mr-1">(${q.sub_num || sIdx + 1})</span>` : '';
                    subHtml += `<div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(q.question)}</div>${imgHtml}</div>`;
                });
                const scoreTagHtml = finalScore ? `<div class="mt-2 bg-[#d5d8df] text-[#625c86] font-extrabold text-[12px] px-2 py-0.5 rounded-[5px] leading-none whitespace-nowrap tracking-tight shadow-sm">${finalScore}점</div>` : '';
                cHtml += `
                    <div class="flex-1 flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
                        <div class="flex items-start w-full min-w-0">
                            <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                                <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${globalQNum}</span>
                                ${scoreTagHtml}
                            </div>
                            <div class="flex flex-col w-full min-w-0 pt-[2px]">${subHtml}</div>
                        </div>
                    </div>`;
                globalQNum++;
            });
            cHtml += '</div>';
            return cHtml;
        };

        finalHtml += `<div class="a3-page">${hHtml}<div class="exam-grid-admission pt-6 pb-6">${genCol(pageCols.left)}${genCol(pageCols.right)}</div>${fHtml}</div>`;
    });

    examContainerRef.current.innerHTML = finalHtml;
    if ((window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetClear();
      try { await (window as any).MathJax.typesetPromise([examContainerRef.current]); } catch(e){}
    }
    shrinkOverflowingMath(examContainerRef.current);
    
    setTotalPages(pages.length);
    updatePreviewViewport();
    (window as any).__examRenderReady = false;
  };

  const updatePreviewViewport = (zf: number = zoomFactor) => {
    if (!examContainerRef.current || !previewBoxRef.current || !previewWrapperRef.current) return;
    const pages = examContainerRef.current.querySelectorAll('.a3-page') as NodeListOf<HTMLElement>;
    if (pages.length === 0) return;

    let targetPage = currentPage;
    if (targetPage < 1) targetPage = 1;
    if (targetPage > pages.length) targetPage = pages.length;

    const page = pages[0];
    const pageW = page.offsetWidth; const pageH = page.offsetHeight;
    const pageGap = 24; 
    const availW = previewWrapperRef.current.clientWidth - 48;
    const availH = previewWrapperRef.current.clientHeight - 110; 
    
    const fitScale = Math.max(0.05, Math.min(availW / pageW, availH / pageH, 1));
    const scale = fitScale * zf;
    currentScaleRef.current = scale;

    examContainerRef.current.style.transform = `scale(${scale})`;
    examContainerRef.current.style.transformOrigin = 'top left';
    previewBoxRef.current.style.width = `${pageW * scale}px`;
    previewBoxRef.current.style.height = `${(pageH * pages.length + pageGap * (pages.length - 1)) * scale}px`;
  };

  const updateCurrentPageFromScroll = () => {
    if (movingToTargetRef.current) return; 
    if (!previewWrapperRef.current || !examContainerRef.current) return;
    const pages = examContainerRef.current.querySelectorAll('.a3-page');
    if (pages.length === 0) return;

    const wrapperRect = previewWrapperRef.current.getBoundingClientRect();
    const viewportCenterY = wrapperRect.top + wrapperRect.height / 2;
    let bestIdx = 0; let bestDist = Infinity;
    pages.forEach((p, i) => {
        const r = p.getBoundingClientRect();
        const pageCenterY = r.top + r.height / 2;
        const dist = Math.abs(pageCenterY - viewportCenterY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    setCurrentPage(bestIdx + 1);
  };

  const handlePageMove = (n: number): number | null => {
    if (isNaN(n)) return null;
    const pages = examContainerRef.current?.querySelectorAll('.a3-page') as NodeListOf<HTMLElement> | undefined;
    if (!pages || pages.length === 0) return null;
    const clamped = Math.max(1, Math.min(n, pages.length));
    setCurrentPage(clamped);
    setPageInputValue(String(clamped));
    movingToTargetRef.current = true;
    if (moveSettleTimerRef.current) clearInterval(moveSettleTimerRef.current);

    const wrap = previewWrapperRef.current;
    const container = examContainerRef.current;
    const box = previewBoxRef.current;
    if (wrap && container && box && pages[0]) {
      const scale = currentScaleRef.current || 1;
      const pageH = pages[0].offsetHeight;
      const pageGap = 24;
      const pageTopUnscaled = (clamped - 1) * (pageH + pageGap);
      const pageCenterUnscaled = pageTopUnscaled + pageH / 2;
      const targetTop = pageCenterUnscaled * scale - wrap.clientHeight / 2;
      const maxTop = Math.max(0, box.offsetHeight - wrap.clientHeight);
      wrap.scrollTo({ top: Math.max(0, Math.min(targetTop, maxTop)), behavior: 'smooth' });
    }
    
    if (wrap) {
      let lastTop: number | null = null;
      let stableCount = 0;
      const startedAt = Date.now();
      moveSettleTimerRef.current = setInterval(() => {
        const top = wrap.scrollTop;
        const stable = lastTop !== null && Math.abs(top - lastTop) < 0.5;
        stableCount = stable ? stableCount + 1 : 0;
        lastTop = top;
        if (stableCount >= 2 || Date.now() - startedAt > 2000) {
          clearInterval(moveSettleTimerRef.current);
          moveSettleTimerRef.current = null;
          movingToTargetRef.current = false;
          updateCurrentPageFromScroll();
        }
      }, 100);
    } else {
      movingToTargetRef.current = false;
    }
    return clamped;
  };

  const handlePageStep = (delta: number) => {
    const base = pendingButtonPageRef.current !== null ? pendingButtonPageRef.current : currentPage;
    const next = base + delta;
    pendingButtonPageRef.current = next;
    setPageInputValue(String(Math.max(1, next)));
    if (buttonPageTimerRef.current) clearTimeout(buttonPageTimerRef.current);
    buttonPageTimerRef.current = setTimeout(() => {
      buttonPageTimerRef.current = null;
      const target = pendingButtonPageRef.current;
      pendingButtonPageRef.current = null;
      if (target !== null) {
        const clamped = handlePageMove(target);
        if (clamped !== null) setPageInputValue(String(clamped));
      }
    }, 400);
  };

  const performZoomStep = useCallback(() => {
    if (!zoomStateRef.current.active) return;
    setZoomFactor(prev => {
      zoomStateRef.current.speed = Math.min(zoomStateRef.current.speed + 0.0004, 0.025);
      const step = zoomStateRef.current.direction * zoomStateRef.current.speed;
      const next = Math.min(2.0, Math.max(0.3, prev + step));
      requestAnimationFrame(() => updatePreviewViewport(next));
      return next;
    });
    zoomRafRef.current = requestAnimationFrame(performZoomStep);
  }, []);

  const handleZoom = (delta: number) => {
    setZoomFactor(prev => {
      const next = Math.min(2.0, Math.max(0.3, prev + delta));
      requestAnimationFrame(() => updatePreviewViewport(next));
      return next;
    });
  };

  const startZoom = (delta: number) => {
    if (zoomStateRef.current.active) return;
    const dir = delta > 0 ? 1 : -1;
    zoomStateRef.current = { active: true, direction: dir, speed: 0.002 }; 
    handleZoom(dir * 0.01);
    zoomDelayTimerRef.current = setTimeout(() => {
      if (zoomStateRef.current.active) zoomRafRef.current = requestAnimationFrame(performZoomStep);
    }, 150);
  };

  const stopZoom = () => {
    zoomStateRef.current.active = false;
    if (zoomDelayTimerRef.current) clearTimeout(zoomDelayTimerRef.current);
    if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
  };

  const getNextTuesdayWeekString = () => {
    const today = new Date();
    const currentDay = today.getDay();
    let daysUntilNextTuesday = (2 - currentDay + 7) % 7;
    if (daysUntilNextTuesday === 0) daysUntilNextTuesday = 7;

    const nextTuesday = new Date(today);
    nextTuesday.setDate(today.getDate() + daysUntilNextTuesday);

    const month = nextTuesday.getMonth() + 1;
    const date = nextTuesday.getDate();
    const weekOfMonth = Math.ceil(date / 7);

    return `${month}월 ${weekOfMonth}주차`;
  };

  const handleSettingChange = (field: string, val: any) => {
    hasUnsavedChangesRef.current = true;
    
    if (field === 'colorNum') { setColorNum(val); return; }
    if (field === 'colorTitle') { setColorTitle(val); return; }
    if (field === 'colorLine') { setColorLine(val); return; }

    if (field === 'column') { setColumns(val); remeasureAndRender(val, splits, titleMode, template, examDate, examTitle, displayBadge); }
    if (field === 'split') { setSplits(val); remeasureAndRender(columns, val, titleMode, template, examDate, examTitle, displayBadge); }
    if (field === 'titleMode') { setTitleMode(val); remeasureAndRender(columns, splits, val, template, examDate, examTitle, displayBadge); }
    if (field === 'template') { setTemplate(val); remeasureAndRender(columns, splits, titleMode, val, examDate, examTitle, displayBadge); }
    
    if (field === 'examTitle') { setExamTitle(val); if(layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, examDate, val, displayBadge); else renderAdmissionTestPages(); }
    if (field === 'displayBadge') { setDisplayBadge(val); if(layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, examDate, examTitle, val); else renderAdmissionTestPages(); }
    if (field === 'examDate') { setExamDate(val); if(layoutType !== '입학테스트') remeasureAndRender(columns, splits, titleMode, template, val, examTitle, displayBadge); else renderAdmissionTestPages(); }
    
    if (field === 'layoutType') {
      setLayoutType(val);
      setIsAdmissionLock(val === '입학테스트');

      let newExamTitle = examTitle;
      // 💡 [수정] 주간테스트 선택 시, 기존 값을 덮어쓰고 'x월 x주차'를 "시험지 제목"에 자동 설정
      if (val === '주간테스트') {
        newExamTitle = getNextTuesdayWeekString();
        setExamTitle(newExamTitle);
      }

      if (val === '입학테스트') {
        if (examStateRef.current?.groups.length !== 30) {
          alert('입학테스트 문제는 30개로 고정되어 있습니다.');
          setLayoutType(layoutType); 
          setIsAdmissionLock(false);
          return;
        }
        renderAdmissionTestPages();
      } else {
        remeasureAndRender(columns, splits, titleMode, template, examDate, newExamTitle, displayBadge);
      }
    }
  };

  const savePalette = (hex: string, idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const newPal = [...palette];
    newPal[idx] = hex;
    setPalette(newPal);
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(newPal));
  };

  useEffect(() => {
    if (layoutType !== '주간테스트') return;
    (async () => {
      const { data } = await supabase.from('class').select('class_id, target_grade').not('target_grade', 'is', null);
      const options = Array.from(new Set((data || []).map((c: any) => c.target_grade).filter(Boolean))) as string[];
      setGradeOptions(options);
    })();
  }, [layoutType]);

  useEffect(() => {
    if (layoutType !== '주간테스트' || !weeklyTargetGrade) { setWeeklyMatchedCount(null); return; }
    let cancelled = false;
    (async () => {
      const count = await countStudentsForGrade(weeklyTargetGrade);
      if (!cancelled) setWeeklyMatchedCount(count);
    })();
    return () => { cancelled = true; };
  }, [layoutType, weeklyTargetGrade]);

  const fetchStudentsForGrade = async (targetGrade: string): Promise<string[]> => {
    const { data: classes } = await supabase.from('class').select('class_id').eq('target_grade', targetGrade);
    const classIds = (classes || []).map((c: any) => c.class_id);
    if (classIds.length === 0) return [];

    const [{ data: directStudents }, { data: enrolls }] = await Promise.all([
      supabase.from('student').select('student_id, status').in('class_id', classIds),
      supabase.from('enrollment').select('student_id, student(status)').in('class_id', classIds),
    ]);

    const studentMap = new Map<string, string>();
    (directStudents || []).forEach((s: any) => studentMap.set(s.student_id, s.status));
    (enrolls || []).forEach((e: any) => { if (e.student) studentMap.set(e.student_id, (e.student as any).status); });

    return Array.from(studentMap.entries()).filter(([, status]) => status === '재원').map(([id]) => id);
  };

  const countStudentsForGrade = async (targetGrade: string) => (await fetchStudentsForGrade(targetGrade)).length;

  const autoAssignWeeklyTest = async (examId: string) => {
    if (layoutType !== '주간테스트' || !weeklyTargetGrade) return;
    const studentIds = await fetchStudentsForGrade(weeklyTargetGrade);
    if (studentIds.length === 0) return;

    const { data: existing } = await supabase.from('exam_assignment').select('student_id').eq('exam_id', examId);
    const existingIds = new Set((existing || []).map((e: any) => e.student_id));

    const inserts = studentIds.filter(id => !existingIds.has(id)).map(id => ({ exam_id: examId, student_id: id, status: '미응시' }));
    if (inserts.length > 0) await supabase.from('exam_assignment').insert(inserts);
  };

  const saveExam = async (skipNav: boolean = false): Promise<boolean> => {
    setIsSaving(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      if (!instId) throw new Error("로그인 정보를 찾을 수 없습니다.");
      if (layoutType === '입학테스트' && examStateRef.current?.groups.length !== 30) throw new Error('입학테스트 문제는 30개로 고정되어 있습니다.');

      const finalLayoutSettings = { column: columns, split: splits, titleMode, numberColor: colorNum, titleColor: colorTitle, lineColor: colorLine, examDate: examDate || null, template };
      const isWeeklyTest = layoutType === '주간테스트';
      
      const weeklyFields = isWeeklyTest && weeklyTargetGrade 
        ? { test_week: testWeek, target_grade: weeklyTargetGrade } 
        : { test_week: null, target_grade: null };

      let examId = currentExamIdRef.current;
      if (isNewExamRef.current) {
        if (rebuildExamIdRef.current) {
          const { error: rebuildErr } = await supabase.from('exam_master').update({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType,
            total_questions: examStateRef.current?.groups.length || 0, instructor_id: instId,
            major_grade: sessionStorage.getItem('majorGrade') || null, avg_difficulty: sessionStorage.getItem('avgDifficulty') || null,
            scope_start: sessionStorage.getItem('scopeStart') || null, scope_end: sessionStorage.getItem('scopeEnd') || null,
            layout_settings: finalLayoutSettings, ...weeklyFields
          }).eq('exam_id', rebuildExamIdRef.current);
          if (rebuildErr) throw new Error(`시험지 저장 실패: ${rebuildErr.message}`);
          examId = rebuildExamIdRef.current;
          const { error: delErr } = await supabase.from('exam_item').delete().eq('exam_id', examId);
          if (delErr) throw new Error(`기존 문항 삭제 실패: ${delErr.message}`);
        } else {
          const { data, error: insertErr } = await supabase.from('exam_master').insert({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType,
            total_questions: examStateRef.current?.groups.length || 0, instructor_id: instId,
            major_grade: sessionStorage.getItem('majorGrade') || null, avg_difficulty: sessionStorage.getItem('avgDifficulty') || null,
            scope_start: sessionStorage.getItem('scopeStart') || null, scope_end: sessionStorage.getItem('scopeEnd') || null,
            layout_settings: finalLayoutSettings, ...weeklyFields
          }).select().single();
          if (insertErr || !data) throw new Error(`시험지 생성 실패: ${insertErr?.message || '알 수 없는 오류'}`);
          examId = data.exam_id;
        }

        const items: any[] = []; let fIdx = 1;
        examStateRef.current?.groups.forEach((g: any, gIdx: number) => {
          const score = layoutType === '입학테스트' ? [2,3,4,5][(gIdx < 4 ? 0 : gIdx < 13 ? 1 : gIdx < 20 ? 2 : gIdx === 20 ? 3 : gIdx < 23 ? 0 : gIdx < 25 ? 1 : gIdx < 28 ? 2 : 3)] : null;
          g.questions.forEach((q: any) => items.push({ exam_id: examId, question_id: q.question_id, sort_order: fIdx++, assigned_score: score }));
        });
        const { error: itemsErr } = await supabase.from('exam_item').insert(items);
        if (itemsErr) throw new Error(`문항 저장 실패: ${itemsErr.message}`);
      } else {
        const { error: updateErr } = await supabase.from('exam_master').update({ title: examTitle, sub_title: displayBadge, exam_type: layoutType, layout_settings: finalLayoutSettings, ...weeklyFields }).eq('exam_id', examId);
        if (updateErr) throw new Error(`레이아웃 설정 저장 실패: ${updateErr.message}`);
      }

      if (isWeeklyTest && examId && weeklyTargetGrade) await autoAssignWeeklyTest(examId);

      hasUnsavedChangesRef.current = false;
      const wasNew = isNewExamRef.current;

      if (wasNew) {
        sessionStorage.removeItem('examQuestions'); sessionStorage.removeItem('qCount');
        sessionStorage.removeItem('examTitle'); sessionStorage.removeItem('editExamId'); sessionStorage.removeItem('duplicateExamId');
        currentExamIdRef.current = examId; 
        setSavedExamId(examId); 
        isNewExamRef.current = false; 
        rebuildExamIdRef.current = null;
      }

      if (!skipNav) {
        alert('✅ 성공적으로 저장되었습니다. 문제지 관리 페이지로 이동합니다.');
        router.push('/exam-list');
      }
      return true;
    } catch (e: any) {
      alert("저장 실패: " + e.message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = async () => {
    await saveExam(true);
    window.print();
  };

  const downloadPdfViaServer = async () => {
    setIsGeneratingPdf(true);
    try {
      const saved = await saveExam(true); 
      if (!saved) return; 

      const examId = currentExamIdRef.current;
      if (!examId) throw new Error('저장된 시험지 ID를 찾을 수 없습니다.');

      const res = await fetch(`/api/exam-pdf?exam_id=${examId}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '서버 응답 오류');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${examTitle || '시험지'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { alert('PDF 생성 실패: ' + e.message); } finally { setIsGeneratingPdf(false); }
  };

  const attemptLeave = (fn: () => void) => {
    if (hasUnsavedChangesRef.current) { setPendingLeaveAction(() => fn); setUnsavedModalOpen(true); }
    else fn();
  };

  return (
    <div id="viewer-root" className="flex flex-col h-screen overflow-hidden bg-[#cbd5e1] font-pretendard">
      <style dangerouslySetInnerHTML={{__html: `
        @font-face { font-family: 'CJU_Medium'; src: local('청주대학교M'), local('CJU_Medium'), url('/CJU_Medium.ttf') format('truetype'); }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .a3-page { width: 297mm; height: 420mm; background: white; margin: 0; box-shadow: 0 10px 25px rgba(0,0,0,0.1); padding: 15mm 20mm; position: relative; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; will-change: transform; backface-visibility: hidden; transform: translateZ(0); }
        #exam-container { will-change: transform; backface-visibility: hidden; }
        .a3-page + .a3-page { margin-top: 24px; }
        
        .exam-grid-admission { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20mm; flex: 1; min-height: 0; width: 100%; position: relative; overflow: hidden; }
        .exam-grid-admission::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background-color: var(--color-line); transform: translateX(-50%); }
        .math-protect { min-width: 0; max-width: 100%; word-break: keep-all; overflow-wrap: break-word; }
        mjx-container[display="true"] { max-width: 100% !important; overflow-x: auto !important; overflow-y: hidden !important; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
            html, body { width: 210mm; margin: 0 !important; padding: 0 !important; background: white; }
            .a3-page { width: 297mm; height: 420mm; zoom: 70.7071%; margin: 0 !important; padding: 15mm 20mm !important; box-shadow: none !important; border: none !important; page-break-after: always; page-break-inside: avoid; display: flex !important; transform: none !important; }
            .no-print { display: none !important; }
            #exam-container { transform: none !important; }
            #preview-box { width: auto !important; height: auto !important; overflow: visible !important; box-shadow: none !important; margin: 0 !important; }
            body, .content-row, #preview-viewport, #preview-wrapper, #viewer-root { display: block !important; height: auto !important; overflow: visible !important; }
            .a3-page:last-child { page-break-after: auto; }
        }
      `}} />
      
      {isAdmissionLock && (
        <style dangerouslySetInnerHTML={{__html: `
          @page { size: A3 portrait; margin: 0; }
          @media print { html, body { width: 297mm !important; } .a3-page { width: 297mm !important; height: 419.5mm !important; zoom: 100% !important; } }
        `}} />
      )}

      {/* 헤더 컴포넌트 호출 */}
      <ViewerHeader 
        isExamDistributed={isExamDistributed} 
        isNewExam={isNewExamRef.current} 
        currentExamId={currentExamIdRef.current} 
        onAttemptLeave={attemptLeave} 
      />

      <div className="content-row flex flex-1 min-h-0 relative">
        <aside className={`no-print shrink-0 h-full bg-slate-50 border-slate-300 transition-all duration-500 ease-in-out z-20 overflow-hidden flex flex-col border-r ${isSidebarFolded ? 'w-0 opacity-0 border-r-0' : 'w-[720px] opacity-100'}`}>
          <div className="w-[720px] h-full flex flex-col">
            
            <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 sticky top-0 z-10">
                <span className="font-extrabold text-slate-800 text-lg flex items-center gap-2">⚙️ 설정 및 배포 관리</span>
                <button onClick={() => setIsSidebarFolded(true)} className="text-slate-400 hover:text-[#002864] text-xs font-bold flex items-center gap-1 transition-colors">
                    ◀ 설정 접기
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4 items-start">
               <div className="w-full flex gap-4 items-stretch">
                  
                  {/* 왼쪽 단: 템플릿 및 레이아웃 설정 */}
                  <div className="w-1/2 flex flex-col">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col gap-4">
                      <h3 className="font-bold text-slate-700 border-b pb-2 flex items-center gap-1.5 text-[13px] shrink-0">🎨 템플릿 및 레이아웃 설정</h3>
                      
                      <div className="flex flex-col gap-4">
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">제목 표시 모드</label>
                              <div className="flex gap-2">
                                  <button onClick={() => handleSettingChange('titleMode', 'first')} className={`flex-1 px-2 py-1.5 rounded border font-bold text-[11px] ${titleMode === 'first' ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>첫 장만 표시</button>
                                  <button onClick={() => handleSettingChange('titleMode', 'all')} className={`flex-1 px-2 py-1.5 rounded border font-bold text-[11px] ${titleMode === 'all' ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>전체 표시</button>
                              </div>
                          </div>
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">디자인 템플릿</label>
                              <select value={isAdmissionLock ? '입학테스트' : template} onChange={e => handleSettingChange('template', e.target.value)} className={`w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold text-slate-700 bg-white focus:outline-none focus:border-[#002864] ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>
                                  <option value="basic1">기본1 (좌측 여백 활용)</option>
                                  <option value="basic2">기본2 (슬림 헤더, 하단 라벨)</option>
                                  {isAdmissionLock && <option value="입학테스트">입학테스트 전용</option>}
                              </select>
                          </div>
                          <div className={isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">색상 설정 (미리보기 즉시 반영)</label>
                              <div className="space-y-2 border border-slate-100 p-2 rounded bg-slate-50/50">
                                  <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">번호 색상</span>
                                          <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorNum', p)} onContextMenu={(e) => savePalette(colorNum, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                      </div>
                                      <input type="color" value={colorNum} onChange={e => handleSettingChange('colorNum', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                                  </div>
                                  <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">제목 색상</span>
                                          <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorTitle', p)} onContextMenu={(e) => savePalette(colorTitle, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                      </div>
                                      <input type="color" value={colorTitle} onChange={e => handleSettingChange('colorTitle', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                                  </div>
                                  <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">라인 색상</span>
                                          <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorLine', p)} onContextMenu={(e) => savePalette(colorLine, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                      </div>
                                      <input type="color" value={colorLine} onChange={e => handleSettingChange('colorLine', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                                  </div>
                              </div>
                          </div>
                          <div className="flex gap-4">
                              <div className="flex-1">
                                  <label className="block text-[11px] font-bold text-slate-500 mb-1.5">단 구성</label>
                                  <div className="flex gap-1">
                                      <button onClick={() => handleSettingChange('column', 1)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${columns === 1 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>1단</button>
                                      <button onClick={() => handleSettingChange('column', 2)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${columns === 2 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>2단</button>
                                  </div>
                              </div>
                              <div className="flex-1">
                                  <label className="block text-[11px] font-bold text-slate-500 mb-1.5">분할 설정</label>
                                  <div className="flex gap-1">
                                      {[2,4,6].map(num => (
                                        <button key={num} onClick={() => handleSettingChange('split', num)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${splits === num ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>{num}</button>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </div>
                    </div>
                  </div>

                  {/* 오른쪽 단: 시험지 메타 수정 (💡간격 및 정렬 UI 수정) */}
                  <div className="w-1/2 flex flex-col">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col gap-4">
                      <h3 className="font-bold text-slate-700 border-b pb-2 flex items-center gap-1.5 text-[13px] shrink-0">✏️ 시험지 메타 수정</h3>
                      
                      <div className="flex-1 flex flex-col gap-4">
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">시험지 제목</label>
                              <input type="text" value={examTitle} onChange={e => handleSettingChange('examTitle', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                          </div>
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">학년 / 과정 표기</label>
                              <input type="text" value={displayBadge} onChange={e => handleSettingChange('displayBadge', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                          </div>
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">날짜</label>
                              <div className="flex flex-col gap-2">
                                  <input type="date" value={examDate} onChange={e => handleSettingChange('examDate', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                                  <div className="flex gap-2">
                                      <button onClick={() => handleSettingChange('examDate', new Date().toISOString().split('T')[0])} className="flex-1 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-[11px] text-slate-600 hover:bg-slate-100 transition-colors">오늘 날짜</button>
                                      <button onClick={() => handleSettingChange('examDate', '')} className="flex-1 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-[11px] text-slate-400 hover:bg-slate-100 transition-colors">지우기</button>
                                  </div>
                              </div>
                          </div>
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">프린트 양식</label>
                              <select value={layoutType} onChange={e => handleSettingChange('layoutType', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none">
                                  <option value="선택없음">선택없음</option>
                                  <option value="과제프린트">과제프린트</option>
                                  <option value="오답프린트">오답프린트</option>
                                  <option value="주간테스트">주간테스트</option>
                                  <option value="중간평가">중간평가</option>
                                  <option value="분기평가">분기평가</option>
                                  <option value="입학테스트">입학테스트</option>
                              </select>
                          </div>
                          {layoutType === '주간테스트' && (
                              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3 pointer-events-none opacity-60 select-none">
                                  <div className="flex items-center justify-between">
                                      <span className="text-[11px] font-bold text-emerald-700">🎯 주간테스트 자동 배정 (사용 중지)</span>
                                      <span className="text-[11px] font-black text-emerald-700">{weeklyMatchedCount ?? 0}명</span>
                                  </div>
                                  <div>
                                      <label className="block text-[11px] font-bold text-slate-500 mb-1.5">주차 (ISO 달력 주차, 전원 공통)</label>
                                      <input type="number" min={1} max={53} value={testWeek} onChange={e => setTestWeek(parseInt(e.target.value, 10) || 1)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                                  </div>
                                  <div>
                                      <label className="block text-[11px] font-bold text-slate-500 mb-1.5">배정 대상 학년 (class.target_grade 기준)</label>
                                      <select value={weeklyTargetGrade} onChange={e => setWeeklyTargetGrade(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none bg-slate-100">
                                          <option value="">학년 선택</option>
                                          {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                                      </select>
                                  </div>
                              </div>
                          )}
                      </div>
                    </div>
                  </div>
               </div>

               {/* 하단 전체 너비: 분리된 배포 관리 패널 호출 (간격 띄움) */}
               <div className="w-full mb-8 mt-4">
                  <PublishPanel 
                    examId={savedExamId} 
                    onPublishComplete={() => setIsExamDistributed(true)} 
                  />
               </div>
            </div>

            <div className="p-4 bg-white border-t border-slate-200 shrink-0 flex gap-2">
              <button onClick={() => saveExam(false)} disabled={isSaving} className="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
                <span>💾</span> {isSaving ? "저장 중..." : "저장"}
              </button>
              <button onClick={handlePrint} disabled={isSaving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
                <span>🖨️</span> 인쇄
              </button>
              <button onClick={downloadPdfViaServer} disabled={isSaving || isGeneratingPdf} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
                <span>⬇️</span> {isGeneratingPdf ? "추출 중..." : "PDF"}
              </button>
            </div>
          </div>
        </aside>

        {/* 중앙 미리보기 영역 (CSS 변수 적용) */}
        <main 
          id="preview-viewport" 
          className="flex-1 h-full flex flex-col overflow-hidden relative z-0" 
          style={{ 
            '--color-num': colorNum, 
            '--color-title': colorTitle, 
            '--color-line': colorLine, 
            '--q-font-size': `${fontSize}px` 
          } as React.CSSProperties}
        >
          {isSidebarFolded && (
             <button onClick={() => setIsSidebarFolded(false)} className="absolute left-0 top-6 z-50 bg-white border border-slate-300 border-l-0 rounded-r-xl px-2.5 py-4 shadow-md hover:bg-slate-50 flex flex-col items-center gap-1.5 text-slate-500 hover:text-[#002864] transition-colors">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                 <span className="text-[11px] font-black tracking-widest" style={{ writingMode: 'vertical-rl' }}>설정 펼치기</span>
             </button>
          )}

          <div ref={previewWrapperRef} id="preview-wrapper" className="flex-1 min-h-0 flex overflow-auto">
              <div ref={previewBoxRef} id="preview-box" className="bg-white" style={{ margin:'auto', overflow:'hidden', boxShadow:'0 10px 30px rgba(0,0,0,0.15)' }}>
                  <div ref={examContainerRef} id="exam-container"></div>
              </div>
          </div>

          <div className="no-print flex items-center gap-3 py-3 px-6 bg-white border-t border-slate-200 w-full justify-center shrink-0">
              <button onClick={() => handlePageStep(-1)} className="px-4 py-1.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-600 hover:bg-slate-50">◀ 이전</button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pageInputValue}
                onChange={e => setPageInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { if (pageInputValue) handlePageMove(parseInt(pageInputValue)); }}
                className="w-16 text-center border border-slate-300 rounded-lg py-1.5 font-bold text-sm"
              />
              <span className="text-slate-400 font-bold text-sm">/ {totalPages} 페이지</span>
              <button onClick={() => handlePageStep(1)} className="px-4 py-1.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-600 hover:bg-slate-50">다음 ▶</button>
              
              <div className="w-px h-5 bg-slate-200 mx-1"></div>
              
              <div className="flex items-center gap-1 bg-slate-50 rounded-lg border border-slate-200 p-0.5 select-none">
                  <button 
                    onMouseDown={() => startZoom(-0.01)} onMouseUp={stopZoom} onMouseLeave={stopZoom} onTouchStart={() => startZoom(-0.01)} onTouchEnd={stopZoom}
                    className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors text-lg leading-none pb-0.5"
                  >-</button>
                  <span className="text-slate-600 font-bold text-[11px] w-12 text-center">🔍 {Math.round(zoomFactor * 100)}%</span>
                  <button 
                    onMouseDown={() => startZoom(0.01)} onMouseUp={stopZoom} onMouseLeave={stopZoom} onTouchStart={() => startZoom(0.01)} onTouchEnd={stopZoom}
                    className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors text-lg leading-none pb-0.5"
                  >+</button>
              </div>

              <button onClick={() => {
                const prevScale = currentScaleRef.current || 1;
                const w = previewWrapperRef.current;
                const anchorX = w ? (w.scrollLeft + w.clientWidth / 2) / prevScale : 0;
                const anchorY = w ? (w.scrollTop + w.clientHeight / 2) / prevScale : 0;
                setZoomFactor(1);
                updatePreviewViewport(1);
                if (w) {
                  const newScale = currentScaleRef.current || 1;
                  w.scrollLeft = anchorX * newScale - w.clientWidth / 2;
                  w.scrollTop = anchorY * newScale - w.clientHeight / 2;
                }
              }} className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-[11px] text-slate-500 hover:bg-slate-50">초기화</button>
          </div>
        </main>
      </div>

      {unsavedModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-[70] no-print">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center">
                <p className="text-slate-700 font-bold mb-1">저장되지 않았습니다.</p>
                <p className="text-slate-500 text-sm mb-6">정말 나가시겠습니까?</p>
                <div className="flex flex-col gap-2">
                    <button onClick={async () => { await saveExam(true); setUnsavedModalOpen(false); if(pendingLeaveAction) pendingLeaveAction(); }} className="w-full bg-emerald-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 transition-colors">저장하고 나가기</button>
                    <button onClick={() => { setUnsavedModalOpen(false); hasUnsavedChangesRef.current = false; if(pendingLeaveAction) pendingLeaveAction(); }} className="w-full bg-white border border-slate-300 text-slate-600 px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors">저장하지 않고 나가기</button>
                    <button onClick={() => setUnsavedModalOpen(false)} className="w-full mt-2 text-slate-400 text-sm hover:underline">취소</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}