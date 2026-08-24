// src/app/exam/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getISOWeekKST, getKSTDateString } from "@/lib/classRound";

import ViewerHeader from "@/components/exam/ViewerHeader";
import ViewerSidebar from "@/components/exam/ViewerSidebar";
import ViewerToolbar from "@/components/exam/ViewerToolbar";

import {
  ADMISSION_HEADER_URL, LOGO_FOOTER_LEFT_URL, LOGO_FOOTER_RIGHT_URL,
  formatExamDate, getCleanUrl, formatQText, buildHeaderHtml, buildFooterHtml
} from "@/utils/examRenderUtils";

import { processGroupText } from "../step2/examUtils";

const COLUMN_GAP_PX = 15 * (96 / 25.4);
const SAFETY_MARGIN_PX = 8 * (96 / 25.4);
const PALETTE_STORAGE_KEY = 'examViewerColorPalette';
const DEFAULT_PALETTE = ['#2563eb', '#002864', '#14532d'];

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    return [];
  }
  return [];
};

export default function ExamViewerPage() {
  const router = useRouter();

  const examContainerRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const mathJaxRef = useRef(false);

  const zoomStateRef = useRef({ active: false, direction: 1, speed: 0.002 });
  const zoomRafRef = useRef<number | null>(null);
  const zoomDelayTimerRef = useRef<any>(null);

  const examStateRef = useRef<any>(null);
  const currentScaleRef = useRef(1);
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const isNewExamRef = useRef<boolean>(false);
  const rebuildExamIdRef = useRef<string | null>(null);
  const currentExamIdRef = useRef<string | null>(null);
  
  const [savedExamId, setSavedExamId] = useState<string | null>(null);
  const [isExamDistributed, setIsExamDistributed] = useState<boolean>(false);

  const [layoutType, setLayoutType] = useState("선택없음"); 
  const [testWeek, setTestWeek] = useState<number>(getISOWeekKST());
  const [testDate, setTestDate] = useState<string>(getKSTDateString());
  const [isWeekPopupOpen, setIsWeekPopupOpen] = useState(false);
  const [weeklyTargetGrade, setWeeklyTargetGrade] = useState("");
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

  const [isSidebarFolded, setIsSidebarFolded] = useState(false);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    sessionStorage.setItem("restoreExamQuestions", "1");

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
        
        const editOriginalType = sessionStorage.getItem('editOriginalType');
        const editOriginalId = sessionStorage.getItem('editOriginalId');
        
        let loadExamId = null;
        if (editOriginalType === 'exam') {
            loadExamId = editOriginalId;
            rebuildExamIdRef.current = editOriginalId;
        } else {
            rebuildExamIdRef.current = null;
        }

        title = sessionStorage.getItem('examTitle') || '새로운 테스트';
        badge = sessionStorage.getItem('examSubTitle') || '';
        const sessionExamType = sessionStorage.getItem('examType');

        if (sessionStorage.getItem('isClinicMode') === 'true' || sessionExamType === '과제프린트' || sessionExamType === '오답프린트') {
          lType = sessionExamType || '과제프린트';
        } else {
          try {
            const step1Data = JSON.parse(sessionStorage.getItem('exam_step1_data') || '{}');
            if (step1Data.examType === 'print') lType = '오답프린트';
            else if (step1Data.examType === 'homework') lType = '과제프린트';
          } catch(e) {}
        }

        const parsedData = JSON.parse(sessionStorage.getItem('examQuestions') || "[]");
        const flatQIds = parsedData.reduce((acc: string[], val: any) => acc.concat(Array.isArray(val) ? val.map(String) : [String(val)]), []);

        const { data: questions } = await supabase.from('question_db').select('*').in('question_id', flatQIds);
        
        let userMergedTextQuestions: any[][] = [];
        if (sessionStorage.getItem('examUserMergedTextQuestions')) {
           userMergedTextQuestions = JSON.parse(sessionStorage.getItem('examUserMergedTextQuestions') || '[]');
        }

        const customGroupMap = new Map<string, boolean>();
        userMergedTextQuestions.forEach((arr: any[]) => {
            if (arr.length > 0) customGroupMap.set(String(arr[0]), true); 
        });

        const groups: any[] = [];
        parsedData.forEach((group: any, gIdx: number) => {
            const qids = Array.isArray(group) ? group.map(String) : [String(group)];
            const items = qids.map((qid: string) => questions?.find(qu => String(qu.question_id) === qid)).filter(Boolean);
            if (items.length > 0) {
                const firstQid = items[0].question_id;
                groups.push({
                    id: `group_${gIdx}_${firstQid}`,
                    questions: items,
                    repQ: items[0],
                    sort_order: gIdx + 1,
                    displayNum: gIdx + 1,
                    is_merged_text: !!customGroupMap.get(String(firstQid))
                });
            }
        });

        let initialCol = 2, initialSplit = 4, initialTitleMode = 'all', initialTmpl = 'basic1';
        let cNum = '#175b6a', cTit = '#002864', cLin = '#94a3b8', eDate = '';

        if (loadExamId) {
          const { data: origExam } = await supabase.from('exam_master').select('*').eq('exam_id', loadExamId).single();
          if (origExam) {
            title = origExam.title;
            if (sessionStorage.getItem('isClinicMode') !== 'true') {
              badge = origExam.sub_title || '';
              lType = origExam.exam_type || '선택없음';
            }
            dbLayoutSettings = origExam.layout_settings || null;
            wWeek = origExam.test_week || null;
            wGrade = origExam.target_grade || "";
          }
        }

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

        setExamTitle(title);
        setDisplayBadge(badge);
        setLayoutType(lType);
        setIsAdmissionLock(lType === '입학테스트');
        if (wWeek) setTestWeek(wWeek);
        if (wGrade) setWeeklyTargetGrade(wGrade);

        setColumns(initialCol); setSplits(initialSplit); setTitleMode(initialTitleMode); setTemplate(initialTmpl);
        setColorNum(cNum); setColorTitle(cTit); setColorLine(cLin); setExamDate(eDate);

        hasUnsavedChangesRef.current = isNew;

        examStateRef.current = { groups, examTitle: title, displayBadge: badge };

        Promise.all([
          document.fonts.load("400 17px 'NanumSquare'"),
          document.fonts.load("700 17px 'NanumSquare'"),
          document.fonts.load("normal 42px 'CJU_Medium'")
        ]).catch(() => {}).finally(() => {
          if (lType === '입학테스트') renderAdmissionTestPages();
          else remeasureAndRender(initialCol, initialSplit, initialTitleMode, initialTmpl, eDate, title, badge);
        });

        return; 
      } else {
        throw new Error("시험지 정보가 없습니다.");
      }

    } catch (e: any) {
      if (examContainerRef.current) examContainerRef.current.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">에러: ${e.message}</div>`;
    }
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
        
        const isGroupMerged = g.is_merged_text && g.questions.length > 1;
        const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
        
        let subHtml = '';
        if (isGroupMerged && common) {
            subHtml += `<div class="w-full min-w-0 math-protect mb-3"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
        }

        g.questions.forEach((q: any, sIdx: number) => {
            let safeImgUrl = String(q.image_url || '').trim();
            let imgHtml = safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null' ? `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="max-height: 450px;"></div>` : '';
            
            const prefix = ''; 
            const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
            
            subHtml += `<div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}"><div class="flex items-start"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(textToRender)}</div></div>${imgHtml}</div>`;
        });

        wrap.innerHTML = `<div class="flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
          <div class="flex items-start w-full min-w-0">
              <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                  <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${g.displayNum}</span>
              </div>
              <div class="flex flex-col w-full min-w-0 pt-[2px]">
                ${subHtml}
              </div>
          </div>
      </div>`;
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

  const generateLocalColHtml = (cGroups: any[]) => {
    if (!cGroups || cGroups.length === 0) return `<div class="flex flex-col flex-1 w-full min-w-0"></div>`;
    let cHtml = '<div class="flex flex-col flex-1 w-full min-w-0 gap-[15mm]">';
    
    cGroups.forEach(g => {
        const isGroupMerged = g.is_merged_text && g.questions.length > 1;
        const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
        
        let subHtml = '';
        if (isGroupMerged && common) {
            subHtml += `<div class="w-full min-w-0 math-protect mb-3"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
        }

        const finalScore = g.questions[0].assigned_score;
        g.questions.forEach((q: any, sIdx: number) => {
            let safeImgUrl = String(q.image_url || '').trim();
            let imgHtml = '';
            if (safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null') {
                imgHtml = `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="max-height: 450px;"></div>`;
            }
            
            const prefix = ''; 
            const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
            
            subHtml += `<div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}"><div class="flex items-start"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(textToRender)}</div></div>${imgHtml}</div>`;
        });
        const scoreTagHtml = finalScore ? `<div class="mt-2 bg-[#d5d8df] text-[#625c86] font-extrabold text-[12px] px-2 py-0.5 rounded-[5px] leading-none whitespace-nowrap tracking-tight shadow-sm">${finalScore}점</div>` : '';
        
        cHtml += `
            <div class="flex-1 flex flex-col relative w-full min-w-0 bg-white z-10" data-display-num="${g.displayNum}">
                <div class="flex items-start w-full min-w-0">
                    <div class="flex flex-col items-center mr-3 shrink-0 min-w-[36px]">
                        <span style="font-family: 'CJU_Medium', sans-serif !important; color: var(--color-num);" class="text-[42px] leading-[0.85] tracking-tighter">${g.displayNum}</span>
                        ${scoreTagHtml}
                    </div>
                    <div class="flex flex-col w-full min-w-0 pt-[2px]">${subHtml}</div>
                </div>
            </div>`;
    });
    cHtml += '</div>';
    return cHtml;
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
        rHtml = generateLocalColHtml(pageCols.right);
      }

      finalHtml += `<div class="a3-page">${hHtml}<div class="exam-grid-admission pt-6 pb-6">${generateLocalColHtml(pageCols.left)}${rHtml}</div>${fHtml}</div>`;
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
                
                const isGroupMerged = g.is_merged_text && g.questions.length > 1;
                const { common, remainders } = isGroupMerged ? processGroupText(g.questions) : { common: "", remainders: [] };
                
                let subHtml = '';
                if (isGroupMerged && common) {
                    subHtml += `<div class="w-full min-w-0 math-protect mb-3"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${formatQText(common)}</div></div>`;
                }

                const finalScore = g.questions[0].assigned_score;
                g.questions.forEach((q: any, sIdx: number) => {
                    let safeImgUrl = String(q.image_url || '').trim();
                    let imgHtml = '';
                    if (safeImgUrl && safeImgUrl !== 'undefined' && safeImgUrl !== 'null') {
                        imgHtml = `<div class="w-full flex justify-center mt-4 mb-3"><img src="${getCleanUrl(safeImgUrl)}" class="max-w-full object-contain mix-blend-multiply" style="max-height: 450px;"></div>`;
                    }
                    const prefix = ''; 
                    const textToRender = isGroupMerged && remainders[sIdx] ? remainders[sIdx] : (q.question || q.text_question || '');
                    subHtml += `<div class="w-full min-w-0 math-protect ${sIdx > 0 ? 'mt-8' : ''}"><div class="flex items-start"><div class="text-[17px] leading-[1.9] text-black tracking-wide w-full font-semibold text-justify">${prefix}${formatQText(textToRender)}</div></div>${imgHtml}</div>`;
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
      if (val === '주간테스트') {
        newExamTitle = getISOWeekKST(new Date(testDate + 'T00:00:00Z')) + "주차 평가";
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

  const handleWeeklyMetaChange = useCallback((grade: string) => {
    setWeeklyTargetGrade(grade);
  }, []);

  const handleWeekDateSelect = (d: string) => {
    setTestDate(d);
    setTestWeek(getISOWeekKST(new Date(d + 'T00:00:00Z')));
  };

  // 🌟 [핵심 업데이트] 분리 명령(`splitHomeworkIds`)을 받아 안전하게 처리하고 자동 다중 배부!
  const saveExam = async (skipNav: boolean = false): Promise<boolean> => {
    setIsSaving(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const myTenantId = localStorage.getItem('logica_tenant_id'); 
      
      if (!instId) throw new Error("로그인 정보를 찾을 수 없습니다.");
      if (layoutType === '입학테스트' && examStateRef.current?.groups.length !== 30) throw new Error('입학테스트 문제는 30개로 고정되어 있습니다.');

      const flatQIds = examStateRef.current?.groups.reduce((acc: string[], g: any) => acc.concat(g.questions.map((q: any) => String(q.question_id))), []) || [];
      
      let userMergedTextQuestions: string[][] = [];
      if (sessionStorage.getItem('examUserMergedTextQuestions')) {
         userMergedTextQuestions = JSON.parse(sessionStorage.getItem('examUserMergedTextQuestions') || '[]');
      } else if (examStateRef.current?.groups) {
         userMergedTextQuestions = examStateRef.current.groups
            .filter((g: any) => g.is_merged_text)
            .map((g: any) => g.questions.map((q: any) => q.question_id));
      }

      const finalLayoutSettings = { 
         column: columns, split: splits, titleMode, numberColor: colorNum, 
         titleColor: colorTitle, lineColor: colorLine, examDate: examDate || null, 
         template, userMergedTextQuestions 
      };

      const isWeeklyTest = layoutType === '주간테스트';
      const weeklyFields = isWeeklyTest && weeklyTargetGrade 
        ? { test_week: testWeek, target_grade: weeklyTargetGrade } 
        : { test_week: null, target_grade: null };

      const editOriginalType = sessionStorage.getItem('editOriginalType');
      const editOriginalId = sessionStorage.getItem('editOriginalId');
      
      let targetStudentId = sessionStorage.getItem('clinicTargetStudentId') || sessionStorage.getItem('editStudentId');
      let targetClassId = sessionStorage.getItem('clinicTargetClassId') || sessionStorage.getItem('editClassId');

      // 1. 단일 원본 파기 로직 (일반 수정 시 기존 과제 삭제)
      if (editOriginalType === 'hw' && editOriginalId) {
          const hwNum = Number(editOriginalId);
          const { data: origHw } = await supabase.from('homework_assignment').select('*').eq('homework_id', hwNum).single();
          if (origHw) {
              if (!targetStudentId) targetStudentId = origHw.target_student_id;
              if (!targetClassId) targetClassId = origHw.class_id;

              if (origHw.target_student_id) {
                 await supabase.from('student_homework_answer').delete().eq('homework_id', hwNum);
                 await supabase.from('student_homework_result').delete().eq('homework_id', hwNum);
                 await supabase.from('homework_assignment').delete().eq('homework_id', hwNum);
              } else {
                 await supabase.from('student_homework_answer').delete().eq('homework_id', hwNum).eq('student_id', targetStudentId);
                 await supabase.from('student_homework_result').delete().eq('homework_id', hwNum).eq('student_id', targetStudentId);
              }
          }
      }

      let examId = currentExamIdRef.current;

      // 새 마스터로 굽기 (수정 모드이거나, 분리/복제 모드일 때)
      const splitHwIdsStr = sessionStorage.getItem('splitHomeworkIds');
      if (isNewExamRef.current || editOriginalId || splitHwIdsStr) {
        if (rebuildExamIdRef.current) {
          // 기존 시험지(Exam)를 덮어씀 (채점 이력 보존)
          const { error: rebuildErr } = await supabase.from('exam_master').update({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트',
            total_questions: flatQIds.length, instructor_id: instId,
            layout_settings: finalLayoutSettings, tenant_id: myTenantId, 
            ...weeklyFields
          }).eq('exam_id', rebuildExamIdRef.current);
          if (rebuildErr) throw new Error(`문제지 갱신 실패: ${rebuildErr.message}`);
          examId = rebuildExamIdRef.current;
          await supabase.from('exam_item').delete().eq('exam_id', examId);
        } else {
          // 아예 새로운 시험지 생성 (원본 과제가 삭제되었거나 공통 추출로 신규 발급 시)
          const { data, error: insertErr } = await supabase.from('exam_master').insert({
            title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트',
            total_questions: flatQIds.length, instructor_id: instId,
            layout_settings: finalLayoutSettings, tenant_id: myTenantId, 
            ...weeklyFields
          }).select().single();
          if (insertErr || !data) throw new Error(`새 문제지 생성 실패: ${insertErr?.message || '알 수 없는 오류'}`);
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
        const { error: updateErr } = await supabase.from('exam_master').update({ title: examTitle, sub_title: displayBadge, exam_type: layoutType || '과제프린트', layout_settings: finalLayoutSettings, ...weeklyFields }).eq('exam_id', examId);
        if (updateErr) throw new Error(`레이아웃 설정 저장 실패: ${updateErr.message}`);
      }

      // 🌟 [핵심] 2. 다중 원본 분리(Split) 적용 - 새 마스터가 성공적으로 구워진 뒤에만 안전하게 기존 과제를 쪼갭니다!
      const splitCommonTqIdsStr = sessionStorage.getItem('splitCommonTqIds');
      
      if (splitHwIdsStr && splitCommonTqIdsStr) {
          const splitHwIds = JSON.parse(splitHwIdsStr);
          const splitCommonTqIds = JSON.parse(splitCommonTqIdsStr);
          
          const { data: hwData } = await supabase.from('homework_assignment').select('*').in('homework_id', splitHwIds);
          if (hwData) {
              for (const hw of hwData) {
                  const originalTqs = safeParseIds(hw.target_questions);
                  const remainderTqs = originalTqs.filter((id: number) => !splitCommonTqIds.includes(id));

                  if (remainderTqs.length === 0) {
                      await supabase.from('student_homework_answer').delete().eq('homework_id', hw.homework_id);
                      await supabase.from('student_homework_result').delete().eq('homework_id', hw.homework_id);
                      await supabase.from('homework_assignment').delete().eq('homework_id', hw.homework_id);
                  } else {
                      await supabase.from('homework_assignment').update({ target_questions: remainderTqs }).eq('homework_id', hw.homework_id);
                  }
              }
          }
      }

      // 🌟 [핵심] 3. 학생 다중 배부 로직 (클리닉 모드이거나, 공통 분리 모드일 때 모두 자동 배부)
      const multiStudentsStr = sessionStorage.getItem('clinicTargetStudentIds');
      const targetStudents = multiStudentsStr ? JSON.parse(multiStudentsStr) : (targetStudentId ? [targetStudentId] : []);
      
      if (targetStudents.length > 0 && examId) {
          for (const stuId of targetStudents) {
              const { data: existAssign } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', examId).eq('student_id', stuId).maybeSingle();
              if (!existAssign) {
                  await supabase.from('exam_assignment').insert({
                      exam_id: examId,
                      student_id: stuId,
                      class_id: targetClassId || null,
                      status: '미응시'
                  });
              }
              const tasks: any[] = [];
              flatQIds.forEach((qId: string) => {
                  tasks.push({ student_id: stuId, task_type: '유형오답클리닉', question_id: qId, status: '대기' });
              });
              if (tasks.length > 0) await supabase.from('clinic_task').insert(tasks);
          }
      }

      hasUnsavedChangesRef.current = false;
      isNewExamRef.current = false; 
      currentExamIdRef.current = examId; 
      setSavedExamId(examId); 
      
      // 깔끔한 세션 정리
      const keysToRemove = [
        'restoreExamQuestions', 'examQuestions', 'examTitle', 'examSubTitle', 'examType',
        'editOriginalType', 'editOriginalId', 'editStudentId', 'editClassId', 'editMasterId',
        'examUserMergedTextQuestions', 'clinicTargetStudentId', 'clinicTargetClassId', 'clinicTargetStudentIds',
        'editHomeworkId', 'editExamId', 'duplicateExamId', 'splitHomeworkIds', 'splitCommonTqIds'
      ];
      keysToRemove.forEach(k => sessionStorage.removeItem(k));

      if (!skipNav) {
          if (targetStudents.length > 0) {
              alert('✅ 맞춤 문제지가 성공적으로 생성되어 학생 기기로 자동 배부되었습니다!\n(원본 과제들은 안전하게 분리/파기되었습니다.)');
              router.push('/learning');
          } else {
              alert('✅ 맞춤 문제지가 성공적으로 업데이트 되었습니다!\n문제지 관리 페이지로 이동합니다.');
              router.push('/exam-list');
          }
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

      <ViewerHeader 
        isExamDistributed={isExamDistributed} 
        isNewExam={isNewExamRef.current} 
        currentExamId={currentExamIdRef.current} 
        onAttemptLeave={attemptLeave} 
      />

      <div className="absolute top-0 left-0 w-full h-20 pointer-events-none z-50">
        <div className="flex justify-center h-full items-center pl-[250px]">
          <div className="flex space-x-6 pointer-events-auto">
            <div className="flex items-center space-x-2 opacity-50"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold">1</span><span className="font-bold text-slate-400">조건 및 단원 설정</span></div>
            <div className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { sessionStorage.setItem("restoreExamQuestions", "1"); router.push('/exam/step2'); }}>
              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">2</span><span className="font-bold text-slate-400">문항 뷰어 & 편집</span>
            </div>
            <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-[#002864] text-white text-center text-sm font-bold shadow-sm">3</span><span className="font-bold text-[#002864]">시험지 배포</span></div>
          </div>
        </div>
      </div>

      <div className="content-row flex flex-1 min-h-0 relative">
        <ViewerSidebar 
          isSidebarFolded={isSidebarFolded}
          setIsSidebarFolded={setIsSidebarFolded}
          isAdmissionLock={isAdmissionLock}
          titleMode={titleMode}
          template={template}
          colorNum={colorNum}
          colorTitle={colorTitle}
          colorLine={colorLine}
          palette={palette}
          columns={columns}
          splits={splits}
          examTitle={examTitle}
          displayBadge={displayBadge}
          examDate={examDate}
          layoutType={layoutType}
          testDate={testDate}
          isWeekPopupOpen={isWeekPopupOpen}
          setIsWeekPopupOpen={setIsWeekPopupOpen}
          savedExamId={savedExamId}
          weeklyTargetGrade={weeklyTargetGrade}
          isSaving={isSaving}
          isGeneratingPdf={isGeneratingPdf}
          handleSettingChange={handleSettingChange}
          savePalette={savePalette}
          handleWeekDateSelect={handleWeekDateSelect}
          handleWeeklyMetaChange={handleWeeklyMetaChange}
          setIsExamDistributed={setIsExamDistributed}
          saveExam={saveExam}
          handlePrint={handlePrint}
          downloadPdfViaServer={downloadPdfViaServer}
        />

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

          <ViewerToolbar 
            currentPage={currentPage}
            totalPages={totalPages}
            pageInputValue={pageInputValue}
            setPageInputValue={setPageInputValue}
            handlePageMove={handlePageMove}
            handlePageStep={handlePageStep}
            zoomFactor={zoomFactor}
            startZoom={startZoom}
            stopZoom={stopZoom}
            resetZoom={() => {
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
            }}
          />
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