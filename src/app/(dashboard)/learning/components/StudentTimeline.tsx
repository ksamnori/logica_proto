// src/app/(dashboard)/learning/components/StudentTimeline.tsx
"use client";

import React, { useState, useEffect } from 'react';
import LearningRow, { statusToneOf } from "./LearningRow";
import { supabase as supabaseClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { createClinicExamBundleAction } from '@/app/actions/clinicActions';
import { isConfidentialExamText, isConfidentialIncorrectRecord, isConfidentialQuestionObj } from '@/lib/confidentialExamGuard';
import {
  fetchMainTextbookExclusionSet,
  getCleanUrl,
  isMainTextbookQuestion,
  isWorkbookQuestion,
} from '@/app/exam/step2/examUtils';

type ModalTabType = 'TAXONOMY' | 'PERIOD' | 'SELECTED' | 'TEXTBOOK';
type TextbookGradeSymbol = 'X' | 'TO' | 'TX' | 'RO' | '☆' | 'B';

interface TextbookWrongQuestionItem {
  tqId: number;
  bookId: string;
  questionId: string;
  pageNum: number;
  questionNum: string;
  gradeCode: TextbookGradeSymbol | 'O';
}

interface StudentTextbookEntry {
  bookId: string;
  title: string;
  bookType: string;
  isWorkbook: boolean;
  courseStatus: '수강중' | '수강완료';
  classNames: string[];
  questions: TextbookWrongQuestionItem[];
  counts: Record<TextbookGradeSymbol | 'O', number>;
}

const TEXTBOOK_GRADE_OPTIONS: {
  code: TextbookGradeSymbol;
  label: string;
  desc: string;
  activeCls: string;
  badgeCls: string;
}[] = [
  { code: 'X', label: 'X', desc: '오답', activeCls: 'border-rose-300 bg-rose-50 text-rose-700', badgeCls: 'bg-rose-100 text-rose-700 border-rose-200' },
  { code: 'TO', label: 'TO', desc: '도움정답', activeCls: 'border-emerald-300 bg-emerald-50 text-emerald-700', badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { code: 'TX', label: 'TX', desc: '도움오답', activeCls: 'border-orange-300 bg-orange-50 text-orange-700', badgeCls: 'bg-orange-100 text-orange-700 border-orange-200' },
  { code: 'RO', label: 'RO', desc: '고침정답', activeCls: 'border-sky-300 bg-sky-50 text-sky-700', badgeCls: 'bg-sky-100 text-sky-700 border-sky-200' },
  { code: '☆', label: '별', desc: '☆ 별표', activeCls: 'border-amber-300 bg-amber-50 text-amber-700', badgeCls: 'bg-amber-100 text-amber-700 border-amber-200' },
  { code: 'B', label: '빈칸', desc: '미입력', activeCls: 'border-violet-300 bg-violet-50 text-violet-700', badgeCls: 'bg-violet-100 text-violet-700 border-violet-200' },
];

const ENDED_ENROLLMENT_STATUSES = ['수강종료', '종료', '퇴원', '취소'];

const parseQuestionNumParts = (raw: any) => {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d+)(?:-(\d+))?(?:\((\d+)\))?/);
  if (!m) return { main: 99999, dash: 0, paren: 0, orig: s };
  return {
    main: parseInt(m[1], 10) || 0,
    dash: m[2] ? parseInt(m[2], 10) : 0,
    paren: m[3] ? parseInt(m[3], 10) : 0,
    orig: s,
  };
};

const normalizeTextbookGradeCode = (rawCode: any, rawInput?: any): TextbookGradeSymbol | 'O' | null => {
  const raw = String(rawCode ?? '').trim();
  const upper = raw.toUpperCase();
  if (upper === 'O') return 'O';
  if (upper === 'X') return 'X';
  if (upper === 'TO') return 'TO';
  if (upper === 'TX') return 'TX';
  if (upper === 'RO') return 'RO';
  if (raw === '☆' || raw === '★' || upper === 'STAR' || raw === '별') return '☆';
  if (upper === 'B' || upper === 'BLANK' || raw === '빈칸') return 'B';
  if (!raw && String(rawInput ?? '').trim() === '미입력') return 'B';
  return null;
};

const isWorkbookTypeOrTitle = (bookType: string, title: string): boolean => {
  const bt = String(bookType || '').trim();
  const btTitle = String(title || '').trim();
  return bt === '워크북' || bt === '과제' || /(?:워크북|WORKBOOK)/i.test(btTitle);
};

const safeParseNumericIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === 'null' || val.trim() === '') return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number).filter(n => !isNaN(n));
  } catch {
    return [];
  }
  return [];
};

// 공용 싱글톤 supabase 인스턴스 사용 (중복 GoTrue 리프레시 토큰 경합 방지)

interface StudentTimelineProps {
  currentView: any;
  activeTab: string;
  dateFilter: string;
  setDateFilter: (filter: 'ALL' | '1W' | '1M') => void;
  isLoading: boolean;
  filteredTimeline: any[];
  selectedBlocks: string[];
  setSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  handleSelectAllStudent: () => void;
  handleBulkCompleteStudent: () => void;
  handleBulkDeleteStudent: () => void;
  handleGenerateIncorrectPrint: () => void;
  handleExtractCommonHomework: () => void; 
  isGeneratingPrint: boolean;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string, studentId: string) => void;
  handlePrintItem: (e: React.MouseEvent, type: string, masterId: any, targetQuestions?: any[], title?: string, subTitle?: string) => void; 
  handleEditHomeworkToStep2?: (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string, subTitle?: string, studentName?: string, studentId?: string, classId?: string) => void; 
  handleEditExamToStep2?: (e: React.MouseEvent, assignId: any, masterId: any, title: string, subTitle: string, studentName: string, studentId: string, classId: string, examType: string) => void; 
  handleBulkPrintAction: (items: any[]) => void; 
  handleRenameItem: (e: React.MouseEvent, type: string, realId: string, masterId: string | null, currentTitle: string) => void; 
  openRawIncManageModal: (studentId: string, studentName: string, month: string) => void;
  handleEditRawIncorrectToStep2: (e: React.MouseEvent, targetQuestions: any[], title: string, studentName: string, studentId: string, classId: string) => void;
  handleDeleteRawIncArchive: (month: string, studentId: string, isArchive: boolean) => void; // 🔥 추가
}

const formatTaxonomyName = (id: string, categoryMap: Record<string, string>) => {
  if (!id) return "분류 없음";
  if (categoryMap && categoryMap[id]) return categoryMap[id];
  return id;
};

const getLocalDateStr = (isoString: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
};

const InlineCalendar = ({ label, dateValue, onDateChange, colorTheme }: { label: string, dateValue: string, onDateChange: (d: string) => void, colorTheme: 'blue' | 'red' }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(dateValue));

  useEffect(() => {
    setCurrentMonth(new Date(dateValue));
  }, [dateValue]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const theme = colorTheme === 'blue' ? {
    bg: 'bg-sky-500', text: 'text-sky-600', lightBg: 'bg-sky-50', border: 'border-sky-200'
  } : {
    bg: 'bg-rose-400', text: 'text-rose-500', lightBg: 'bg-rose-50', border: 'border-rose-200'
  };

  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(<div key={`empty-${i}`} className="w-6 h-6"></div>);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateValue === dateStr;
    const isToday = new Date().toISOString().split('T')[0] === dateStr;

    days.push(
      <button
        key={d}
        onClick={() => onDateChange(dateStr)}
        className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-all
          ${isSelected ? `${theme.bg} text-white shadow-md transform scale-110` :
            isToday ? `${theme.text} ${theme.lightBg} border ${theme.border}` :
            `text-slate-600 hover:bg-slate-100`}`}
      >
        {d}
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-3 w-[220px]">
      <div className="flex justify-between items-center mb-3">
        <span className={`text-xs font-bold ${theme.text} ${theme.lightBg} px-2 py-1 rounded-md shadow-sm border ${theme.border}`}>{label}</span>
        <div className="flex items-center gap-1">
          <button onClick={handlePrevMonth} className="w-5 h-5 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-400 transition-colors text-xs">◀</button>
          <span className="font-bold text-[12px] text-slate-700 w-14 text-center">{year}.{String(month + 1).padStart(2, '0')}</span>
          <button onClick={handleNextMonth} className="w-5 h-5 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-400 transition-colors text-xs">▶</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1.5 text-center text-xs font-bold text-slate-400">
        <div className="text-rose-400">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-400">토</div>
      </div>
      <div className="grid grid-cols-7 gap-1 justify-items-center">
        {days}
      </div>
    </div>
  );
};

export default function StudentTimeline({
  currentView, activeTab, dateFilter, setDateFilter, isLoading,
  filteredTimeline = [], selectedBlocks = [], setSelectedBlocks, handleSelectAllStudent,
  handleBulkCompleteStudent, handleBulkDeleteStudent,
  handleGenerateIncorrectPrint, handleExtractCommonHomework, isGeneratingPrint,
  formatDateLabel, handleForceComplete, handleDeleteExam, handleDeleteHomework, handleDeletePrint, handlePrintItem, handleEditHomeworkToStep2, handleEditExamToStep2,
  handleBulkPrintAction, handleRenameItem, openRawIncManageModal, handleEditRawIncorrectToStep2, handleDeleteRawIncArchive
}: StudentTimelineProps) {
  
  const router = useRouter();

  const [modalTab, setModalTab] = useState<ModalTabType | null>(null);
  const [isEngineRunning, setIsEngineRunning] = useState(false);

  const [genMethod, setGenMethod] = useState<'SAME' | 'TWIN'>('TWIN');
  const [twinCount, setTwinCount] = useState<number>(1);
  const [similarCount, setSimilarCount] = useState<number>(1);
  const [difficultyOption, setDifficultyOption] = useState<string>('그대로');
  const [excludeOriginal, setExcludeOriginal] = useState<boolean>(true);
  const [excludeMain, setExcludeMain] = useState<boolean>(true);
  const [excludeWorkbook, setExcludeWorkbook] = useState<boolean>(true);
  const [maxTypeLimit, setMaxTypeLimit] = useState<number>(3);
  const [isMaxTypeLimitActive, setIsMaxTypeLimitActive] = useState<boolean>(true);

  const todayDate = new Date().toISOString().split('T')[0];
  const lastMonthDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(lastMonthDate);
  const [endDate, setEndDate] = useState(todayDate);

  const [taxonomyTree, setTaxonomyTree] = useState<any>({});
  const [taxonomyStats, setTaxonomyStats] = useState<Record<string, { total: number; correct: number; pending: number }>>({});
  const [isTaxonomyLoading, setIsTaxonomyLoading] = useState(false);
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<Set<string>>(new Set());

  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [allIncorrectRecords, setAllIncorrectRecords] = useState<any[]>([]);

  // 🌟 교재별 오답 탭 상태
  const [studentTextbooks, setStudentTextbooks] = useState<StudentTextbookEntry[]>([]);
  const [isTextbookLoading, setIsTextbookLoading] = useState(false);
  const [selectedTextbookIds, setSelectedTextbookIds] = useState<string[]>([]);
  const [textbookStatusFilter, setTextbookStatusFilter] = useState<'ALL' | '수강중' | '수강완료'>('ALL');
  const [textbookSearchQuery, setTextbookSearchQuery] = useState<string>('');
  const [checkedGradeCodes, setCheckedGradeCodes] = useState<Record<TextbookGradeSymbol, boolean>>({
    X: true,
    TO: true,
    TX: true,
    RO: true,
    '☆': true,
    B: true,
  });
  const [excludedTextbookItemKeys, setExcludedTextbookItemKeys] = useState<Set<string>>(new Set());
  const [previewQuestion, setPreviewQuestion] = useState<any | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const [isCalculating, setIsCalculating] = useState(false);
  const [matchedCache, setMatchedCache] = useState<string[]>([]);
  const [matchWarningMsg, setMatchWarningMsg] = useState<string>('');

  useEffect(() => {
    const fetchMasterCategory = async () => {
      try {
        const buildMap = (dataArray: any[]) => {
          const map: Record<string, string> = {};
          dataArray.forEach(item => {
            if (!item.category_id || !item.full_path) return;
            const parts = item.category_id.split('-');
            const paths = item.full_path.split('>').map((s: string) => s.trim());
            let currentPrefix = "";

            parts.forEach((p: string, idx: number) => {
              currentPrefix = currentPrefix ? `${currentPrefix}-${p}` : p;
              const pathIdx = paths.length - parts.length + idx;
              if (pathIdx >= 0 && paths[pathIdx]) {
                let name = paths[pathIdx];
                if (idx === 0 && pathIdx >= 1) {
                  const grade = paths[pathIdx - 1].replace(/초등학교 |중학교 |고등학교 /g, '');
                  name = `[${grade}] ${name}`;
                }
                map[currentPrefix] = name;
              }
            });
          });
          return map;
        };

        let finalMap: Record<string, string> = {};
        const { data: fileData, error: fileError } = await supabaseClient.storage.from('system_data').download('master_category.json');
        if (!fileError && fileData) {
          const text = await fileData.text();
          const json = JSON.parse(text);
          finalMap = buildMap(Array.isArray(json) ? json : Object.values(json));
        }

        if (Object.keys(finalMap).length === 0) {
          let allData: any[] = [];
          let from = 0;
          while (true) {
            const { data, error } = await supabaseClient.from('master_category').select('category_id, full_path').range(from, from + 999);
            if (error || !data || data.length === 0) break;
            allData = allData.concat(data);
            if (data.length < 1000) break;
            from += 1000;
          }
          finalMap = buildMap(allData);
        }

        setCategoryMap(finalMap);
      } catch (err) {
        console.error("마스터 카테고리 로딩 실패:", err);
      }
    };
    fetchMasterCategory();
  }, []);

  const [loadedTextbookStudentId, setLoadedTextbookStudentId] = useState<string>('');

  const loadStudentTextbooksData = async (studentId: string) => {
    if (!studentId) return;
    await Promise.resolve();
    setIsTextbookLoading(true);
    try {
      const fetchAllPaged = async (buildQuery: () => any, pageSize = 1000) => {
        const rows: any[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await buildQuery().range(from, from + pageSize - 1);
          if (error || !data || data.length === 0) break;
          rows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }
        return rows;
      };

      const [
        { data: enrollRows },
        hwAnsRows,
        { data: hwResRows },
        { data: examAssignRows },
        { data: incRows },
        stuAnsRows,
      ] = await Promise.all([
        supabaseClient
          .from('enrollment')
          .select('class_id, status, start_date, end_date, class(class_id, name, level_name, status)')
          .eq('student_id', studentId),
        fetchAllPaged(() =>
          supabaseClient
            .from('student_homework_answer')
            .select('hw_answer_id, homework_id, tq_id, grading_code, student_input')
            .eq('student_id', studentId)
            .order('hw_answer_id', { ascending: true })
        ),
        supabaseClient
          .from('student_homework_result')
          .select('*')
          .eq('student_id', studentId),
        supabaseClient
          .from('exam_assignment')
          .select('assignment_id, status, exam_master(exam_type, title)')
          .eq('student_id', studentId),
        supabaseClient
          .from('student_incorrect_record')
          .select('record_id, tq_id, question_id, status, resolved_at, source_type')
          .eq('student_id', studentId),
        fetchAllPaged(() =>
          supabaseClient
            .from('student_answer')
            .select('answer_id, exam_assignment_id, question_id, grading_code, student_input')
            .eq('student_id', studentId)
            .order('answer_id', { ascending: true })
        ),
      ]);

      const unwrapObj = (v: any) => (Array.isArray(v) ? v[0] : v);

      // 1) 학생 수강중 / 수강종료 반 맵 구성
      const classInfoMap = new Map<string, { classId: string; className: string; levelName: string; isActive: boolean }>();
      (enrollRows || []).forEach((e: any) => {
        const statusStr = String(e.status || '').trim();
        if (statusStr === '취소' || !e.class_id) return;
        const cls = unwrapObj(e.class);
        const clsStatus = String(cls?.status || '').trim();
        const isEnded =
          ENDED_ENROLLMENT_STATUSES.includes(statusStr) ||
          Boolean(e.end_date) ||
          clsStatus === '종료' ||
          clsStatus === '폐강';
        const isActive = !isEnded;
        const prev = classInfoMap.get(e.class_id);
        classInfoMap.set(e.class_id, {
          classId: e.class_id,
          className: cls?.name || prev?.className || '반 미지정',
          levelName: cls?.level_name || prev?.levelName || '',
          isActive: Boolean(prev?.isActive || isActive),
        });
      });

      if (currentView?.classId && !classInfoMap.has(currentView.classId)) {
        classInfoMap.set(currentView.classId, {
          classId: currentView.classId,
          className: currentView.className || '현재 반',
          levelName: '',
          isActive: true,
        });
      }

      const enrolledClassIds = Array.from(classInfoMap.keys());
      const answeredHwIds = Array.from(
        new Set(
          [
            ...(hwAnsRows || []).map((a: any) => a.homework_id),
            ...(hwResRows || []).map((r: any) => r.homework_id),
          ].filter(Boolean)
        )
      );

      // 2) 반 배정 교재(class_textbook) 및 과제 배정(homework_assignment) 조회
      const hwOrParts: string[] = [`target_student_id.eq.${studentId}`];
      if (enrolledClassIds.length > 0) {
        hwOrParts.push(`class_id.in.(${enrolledClassIds.join(',')})`);
      }

      const [classBookRes, hwByClassOrStuRes] = await Promise.all([
        enrolledClassIds.length > 0
          ? supabaseClient
              .from('class_textbook')
              .select('*, textbook(book_id, title, book_type)')
              .in('class_id', enrolledClassIds)
          : Promise.resolve({ data: [] as any[] }),
        supabaseClient
          .from('homework_assignment')
          .select('homework_id, book_id, class_id, target_student_id, homework_title, target_questions')
          .or(hwOrParts.join(',')),
      ]);

      const hwMap = new Map<number, any>();
      (hwByClassOrStuRes.data || []).forEach((h: any) => {
        if (h?.homework_id) hwMap.set(Number(h.homework_id), h);
      });

      const missingHwIds = answeredHwIds.filter(id => !hwMap.has(Number(id)));
      if (missingHwIds.length > 0) {
        for (let i = 0; i < missingHwIds.length; i += 200) {
          const chunk = missingHwIds.slice(i, i + 200);
          const { data: extraHws } = await supabaseClient
            .from('homework_assignment')
            .select('homework_id, book_id, class_id, target_student_id, homework_title, target_questions')
            .in('homework_id', chunk);
          (extraHws || []).forEach((h: any) => {
            if (h?.homework_id) hwMap.set(Number(h.homework_id), h);
          });
        }
      }

      // 3) 학생의 교재 메타데이터 통합 (교재 관리 페이지 등록 교재 기준)
      const bookAccumMap = new Map<
        string,
        {
          bookId: string;
          title: string;
          bookType: string;
          hasActiveLink: boolean;
          classNameSet: Set<string>;
        }
      >();

      (classBookRes.data || []).forEach((cb: any) => {
        const tb = unwrapObj(cb.textbook);
        const bid = String(cb.book_id || tb?.book_id || '').trim();
        const title = String(tb?.title || '').trim();
        if (!bid || !title || isConfidentialExamText(title)) return;

        const clsInfo = classInfoMap.get(cb.class_id);
        const cbStatus = String(cb.status || '').trim();
        const linkActive = Boolean(clsInfo?.isActive) && cbStatus !== '완료' && cbStatus !== '종료';

        if (!bookAccumMap.has(bid)) {
          bookAccumMap.set(bid, {
            bookId: bid,
            title,
            bookType: String(tb?.book_type || '').trim(),
            hasActiveLink: linkActive,
            classNameSet: new Set<string>(),
          });
        } else if (linkActive) {
          bookAccumMap.get(bid)!.hasActiveLink = true;
        }
        if (clsInfo?.className) {
          bookAccumMap.get(bid)!.classNameSet.add(clsInfo.className);
        }
      });

      // 과제 이력에 등장했지만 class_textbook에서 빠진 교재(반 이동/종료 특강 등) 보완
      const extraBookIds = new Set<string>();
      hwMap.forEach((h: any) => {
        const bid = String(h.book_id || '').trim();
        if (bid && !bookAccumMap.has(bid)) {
          extraBookIds.add(bid);
        }
      });

      if (extraBookIds.size > 0) {
        const extraIdsArr = Array.from(extraBookIds);
        const { data: extraTbs } = await supabaseClient
          .from('textbook')
          .select('book_id, title, book_type')
          .in('book_id', extraIdsArr);

        (extraTbs || []).forEach((tb: any) => {
          const bid = String(tb.book_id || '').trim();
          const title = String(tb.title || '').trim();
          if (!bid || !title || isConfidentialExamText(title)) return;

          let hasActive = false;
          const cNames = new Set<string>();
          hwMap.forEach((h: any) => {
            if (String(h.book_id || '').trim() === bid && h.class_id) {
              const ci = classInfoMap.get(h.class_id);
              if (ci?.className) cNames.add(ci.className);
              if (ci?.isActive) hasActive = true;
            }
          });

          bookAccumMap.set(bid, {
            bookId: bid,
            title,
            bookType: String(tb.book_type || '').trim(),
            hasActiveLink: hasActive,
            classNameSet: cNames,
          });
        });
      }

      const allBookIds = Array.from(bookAccumMap.keys());
      if (allBookIds.length === 0) {
        setStudentTextbooks([]);
        return;
      }

      // 4) 등록 교재들의 textbook_question 전체 조회 (tq_id 커서 페이지네이션)
      const tqByBookMap = new Map<string, any[]>();
      const BOOK_CHUNK = 15;
      for (let i = 0; i < allBookIds.length; i += BOOK_CHUNK) {
        const bChunk = allBookIds.slice(i, i + BOOK_CHUNK);
        let lastTqId: number | null = null;
        while (true) {
          let q = supabaseClient
            .from('textbook_question')
            .select('tq_id, book_id, question_id, page_number, question_number')
            .in('book_id', bChunk)
            .not('question_id', 'is', null)
            .order('tq_id', { ascending: true })
            .limit(1000);
          if (lastTqId !== null) {
            q = q.gt('tq_id', lastTqId);
          }
          const { data: tqRows, error: tqErr } = await q;
          if (tqErr || !tqRows || tqRows.length === 0) break;

          tqRows.forEach((r: any) => {
            const bid = String(r.book_id || '').trim();
            if (!bid || !r.question_id) return;
            if (!tqByBookMap.has(bid)) tqByBookMap.set(bid, []);
            tqByBookMap.get(bid)!.push(r);
          });

          if (tqRows.length < 1000) break;
          const nextCursor = Number(tqRows[tqRows.length - 1]?.tq_id);
          if (isNaN(nextCursor) || nextCursor === lastTqId) break;
          lastTqId = nextCursor;
        }
      }

      // 5) 학생 답안/오답 기록으로부터 문항별 채점 코드(O, X, TO, TX, RO, ☆, B) 산출
      const hwAnswerGradeByTq = new Map<number, TextbookGradeSymbol | 'O'>();
      (hwAnsRows || []).forEach((a: any) => {
        const tqId = Number(a.tq_id);
        if (isNaN(tqId)) return;
        const norm = normalizeTextbookGradeCode(a.grading_code, a.student_input);
        if (norm) {
          hwAnswerGradeByTq.set(tqId, norm);
        }
      });

      const legacyHwGradeByTq = new Map<number, TextbookGradeSymbol | 'O'>();
      (hwResRows || []).forEach((res: any) => {
        const incTqs = safeParseNumericIds(res.incorrect_questions);
        const incSet = new Set<number>(incTqs);
        incTqs.forEach(tqId => {
          legacyHwGradeByTq.set(tqId, 'X');
        });
        if (res.status === '채점완료') {
          const hw = hwMap.get(Number(res.homework_id));
          const targetTqs = safeParseNumericIds(hw?.target_questions);
          targetTqs.forEach(tqId => {
            if (!incSet.has(tqId) && !legacyHwGradeByTq.has(tqId)) {
              legacyHwGradeByTq.set(tqId, 'O');
            }
          });
        }
      });

      const printAssignIds = new Set<number>();
      const validNonClinicAssignIds = new Set<number>();
      (examAssignRows || []).forEach((ea: any) => {
        const em = unwrapObj(ea.exam_master);
        const eType = String(em?.exam_type || '').trim();
        const eTitle = String(em?.title || '').trim();
        if (isConfidentialExamText(eType) || isConfidentialExamText(eTitle)) return;
        if (['오답프린트', '오답'].includes(eType)) {
          printAssignIds.add(Number(ea.assignment_id));
        } else if (!['오답유사', '과제오답유사'].includes(eType)) {
          validNonClinicAssignIds.add(Number(ea.assignment_id));
        }
      });

      const clinicResolvedQids = new Set<string>();
      const clinicResolvedTqs = new Set<number>();
      const nonClinicExamGradeByQid = new Map<string, TextbookGradeSymbol | 'O'>();

      (stuAnsRows || []).forEach((sa: any) => {
        const qid = String(sa.question_id || '').trim();
        if (!qid) return;
        const assignId = Number(sa.exam_assignment_id);
        const norm = normalizeTextbookGradeCode(sa.grading_code, sa.student_input);
        if (printAssignIds.has(assignId)) {
          if (norm === 'O' || norm === 'RO') {
            clinicResolvedQids.add(qid);
          }
          return;
        }
        if (validNonClinicAssignIds.has(assignId) && norm) {
          nonClinicExamGradeByQid.set(qid, norm);
        }
      });

      const incGradeByTq = new Map<number, TextbookGradeSymbol | 'O'>();
      const incGradeByQid = new Map<string, TextbookGradeSymbol | 'O'>();
      (incRows || []).forEach((r: any) => {
        if (isConfidentialExamText(r.source_type)) return;
        const resolved = Boolean(r.resolved_at) || String(r.status || '').trim().toUpperCase() === 'RO';
        const norm = resolved
          ? 'RO'
          : normalizeTextbookGradeCode(r.status) || 'X';
        if (r.tq_id && !isNaN(Number(r.tq_id))) {
          const tqNum = Number(r.tq_id);
          incGradeByTq.set(tqNum, norm);
          if (resolved) clinicResolvedTqs.add(tqNum);
        }
        if (r.question_id) {
          const qid = String(r.question_id).trim();
          if (qid) {
            incGradeByQid.set(qid, norm);
            if (resolved) clinicResolvedQids.add(qid);
          }
        }
      });

      // 6) 교재별 문항 리스트 및 기호별 카운트 구성
      const entries: StudentTextbookEntry[] = [];
      bookAccumMap.forEach(meta => {
        const rawTqs = tqByBookMap.get(meta.bookId) || [];
        const counts: Record<TextbookGradeSymbol | 'O', number> = {
          O: 0,
          X: 0,
          TO: 0,
          TX: 0,
          RO: 0,
          '☆': 0,
          B: 0,
        };
        const gradedQuestions: TextbookWrongQuestionItem[] = [];

        rawTqs.forEach((tq: any) => {
          const tqId = Number(tq.tq_id);
          const qid = String(tq.question_id || '').trim();
          if (!qid || isNaN(tqId)) return;

          let grade: TextbookGradeSymbol | 'O' | null = null;
          if (hwAnswerGradeByTq.has(tqId)) {
            grade = hwAnswerGradeByTq.get(tqId)!;
          } else if (legacyHwGradeByTq.has(tqId)) {
            grade = legacyHwGradeByTq.get(tqId)!;
          } else if (incGradeByTq.has(tqId)) {
            grade = incGradeByTq.get(tqId)!;
          } else if (nonClinicExamGradeByQid.has(qid)) {
            grade = nonClinicExamGradeByQid.get(qid)!;
          } else if (incGradeByQid.has(qid)) {
            grade = incGradeByQid.get(qid)!;
          }

          if (!grade) return;

          if (grade === 'X' && (clinicResolvedTqs.has(tqId) || clinicResolvedQids.has(qid))) {
            grade = 'RO';
          }

          counts[grade] = (counts[grade] || 0) + 1;
          gradedQuestions.push({
            tqId,
            bookId: meta.bookId,
            questionId: qid,
            pageNum: parseInt(String(tq.page_number || '0'), 10) || 0,
            questionNum: String(tq.question_number || '').trim(),
            gradeCode: grade,
          });
        });

        gradedQuestions.sort((a, b) => {
          if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
          const pA = parseQuestionNumParts(a.questionNum);
          const pB = parseQuestionNumParts(b.questionNum);
          if (pA.main !== pB.main) return pA.main - pB.main;
          if (pA.dash !== pB.dash) return pA.dash - pB.dash;
          if (pA.paren !== pB.paren) return pA.paren - pB.paren;
          if (pA.orig !== pB.orig) return pA.orig.localeCompare(pB.orig, undefined, { numeric: true });
          return a.tqId - b.tqId;
        });

        const isWb = isWorkbookTypeOrTitle(meta.bookType, meta.title);
        const normalizedType = meta.bookType || (isWb ? '워크북' : '주교재');

        entries.push({
          bookId: meta.bookId,
          title: meta.title,
          bookType: normalizedType,
          isWorkbook: isWb,
          courseStatus: meta.hasActiveLink ? '수강중' : '수강완료',
          classNames: Array.from(meta.classNameSet),
          questions: gradedQuestions,
          counts,
        });
      });

      entries.sort((a, b) => {
        if (a.courseStatus !== b.courseStatus) {
          return a.courseStatus === '수강중' ? -1 : 1;
        }
        const wrongA = a.counts.X + a.counts.TO + a.counts.TX + a.counts.RO + a.counts['☆'] + a.counts.B;
        const wrongB = b.counts.X + b.counts.TO + b.counts.TX + b.counts.RO + b.counts['☆'] + b.counts.B;
        if ((wrongA > 0) !== (wrongB > 0)) return wrongA > 0 ? -1 : 1;
        if (a.isWorkbook !== b.isWorkbook) return a.isWorkbook ? 1 : -1;
        return a.title.localeCompare(b.title, 'ko');
      });

      setStudentTextbooks(entries);
      setLoadedTextbookStudentId(studentId);
    } catch (err) {
      console.error('학생 교재별 오답 로딩 오류:', err);
    } finally {
      setIsTextbookLoading(false);
    }
  };

  const loadTaxonomyData = async () => {
    await Promise.resolve();
    setIsTaxonomyLoading(true);
    try {
      const { data: statsData, error: statsErr } = await supabaseClient.rpc('get_taxonomy_stats', { p_student_id: currentView.studentId });

      if (!statsErr && statsData) {
        const stats: Record<string, { total: number; correct: number; pending: number }> = {};

        statsData.forEach((row: any) => {
          const parts = (row.taxonomy_id || '').split('-');
          for (let i = 1; i <= Math.min(parts.length, 5); i++) {
            const prefix = parts.slice(0, i).join('-');
            if (!stats[prefix]) stats[prefix] = { total: 0, correct: 0, pending: 0 };
            stats[prefix].total += Number(row.total_cnt);
            stats[prefix].correct += Number(row.correct_cnt);
            stats[prefix].pending += Number(row.pending_cnt);
          }
        });

        setTaxonomyStats(stats);

        const tree: any = {};
        Object.keys(stats).forEach(prefix => {
            const parts = prefix.split('-');
            let currentLevel = tree;
            let currentPrefix = "";
            parts.forEach((part, idx) => {
                currentPrefix = currentPrefix ? `${currentPrefix}-${part}` : part;
                if (!currentLevel[currentPrefix]) currentLevel[currentPrefix] = { children: {} };
                if (idx < parts.length - 1) currentLevel = currentLevel[currentPrefix].children;
            });
        });
        setTaxonomyTree(tree);
      }

      const { data: incData } = await supabaseClient.from('student_incorrect_record')
        .select('record_id, question_id, created_at, source_type, question_db(source_book_name, book_name, pdf_source)')
        .eq('student_id', currentView.studentId)
        .is('resolved_at', null);

      setAllIncorrectRecords((incData || []).filter((r: any) => !isConfidentialIncorrectRecord(r)));
    } catch (e) {
      console.error("분류 체계 로딩 오류:", e);
    } finally {
      setIsTaxonomyLoading(false);
    }
  };

  useEffect(() => {
    if ((modalTab === 'TAXONOMY' || modalTab === 'PERIOD') && currentView?.studentId) {
      loadTaxonomyData();
    } else if (modalTab === 'TEXTBOOK' && currentView?.studentId) {
      loadStudentTextbooksData(currentView.studentId);
    }
  }, [modalTab, currentView?.studentId]);

  const toggleTaxNode = (prefix: string, isChecked: boolean) => {
    setSelectedTaxonomyIds(prev => {
      const next = new Set(prev);
      const allKeys = Object.keys(taxonomyStats);
      if (isChecked) {
        allKeys.forEach(k => { if (k === prefix || k.startsWith(prefix + '-')) next.add(k); });
      } else {
        allKeys.forEach(k => { if (k === prefix || k.startsWith(prefix + '-')) next.delete(k); });
        const parts = prefix.split('-');
        let ancestor = '';
        parts.forEach(p => { ancestor = ancestor ? `${ancestor}-${p}` : p; next.delete(ancestor); });
      }
      return next;
    });
  };

  const activeStudentTextbooks = loadedTextbookStudentId === currentView?.studentId ? studentTextbooks : [];

  const syncExclusionsForSelectedBooks = (nextBookIds: string[], booksSource: StudentTextbookEntry[] = activeStudentTextbooks) => {
    if (nextBookIds.length === 0) {
      setExcludeMain(true);
      setExcludeWorkbook(true);
      return;
    }
    const selSet = new Set(nextBookIds);
    const chosen = booksSource.filter(b => selSet.has(b.bookId));
    const hasMain = chosen.some(b => !b.isWorkbook);
    const hasWb = chosen.some(b => b.isWorkbook);
    setExcludeMain(!hasMain);
    setExcludeWorkbook(!hasWb);
  };

  const switchModalTab = (tab: ModalTabType) => {
    if (loadedTextbookStudentId !== currentView?.studentId) {
      setSelectedTextbookIds([]);
      setExcludedTextbookItemKeys(new Set());
      setSelectedTaxonomyIds(new Set());
      setPreviewQuestion(null);
    }
    setModalTab(tab);
    setMatchWarningMsg('');
    if (tab === 'TEXTBOOK') {
      const validBookIds = loadedTextbookStudentId === currentView?.studentId ? selectedTextbookIds : [];
      syncExclusionsForSelectedBooks(validBookIds);
    } else {
      setExcludeMain(true);
      setExcludeWorkbook(true);
    }
  };

  const openModal = (tab: ModalTabType) => {
    if (tab === 'SELECTED' && selectedBlocks.length === 0) return alert('먼저 타임라인에서 학습지를 체크해주세요!');
    switchModalTab(tab);
  };

  const handleToggleTextbook = (bookId: string) => {
    setSelectedTextbookIds(prev => {
      const next = prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId];
      syncExclusionsForSelectedBooks(next);
      return next;
    });
  };

  const handlePreviewTextbookQuestion = async (e: React.MouseEvent, item: TextbookWrongQuestionItem, bookTitle: string) => {
    e.stopPropagation();
    e.preventDefault();
    setIsPreviewLoading(true);
    setPreviewQuestion({ bookTitle, item, dbRow: null });
    try {
      const { data } = await supabaseClient
        .from('question_db')
        .select('question_id, question, image_url, image_2_url, answer')
        .eq('question_id', item.questionId)
        .maybeSingle();
      setPreviewQuestion({ bookTitle, item, dbRow: data || null });
    } catch {
      setPreviewQuestion({ bookTitle, item, dbRow: null });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const getCandidateTextbookQuestions = (): (TextbookWrongQuestionItem & { bookTitle: string })[] => {
    if (selectedTextbookIds.length === 0) return [];
    const selectedSet = new Set(selectedTextbookIds);
    const list: (TextbookWrongQuestionItem & { bookTitle: string })[] = [];
    activeStudentTextbooks.forEach(tb => {
      if (!selectedSet.has(tb.bookId)) return;
      tb.questions.forEach(q => {
        if (q.gradeCode === 'O') return;
        if (!checkedGradeCodes[q.gradeCode]) return;
        list.push({ ...q, bookTitle: tb.title });
      });
    });
    return list;
  };

  const getTargetTextbookQuestionIds = (): string[] => {
    const candidates = getCandidateTextbookQuestions();
    const seen = new Set<string>();
    const result: string[] = [];
    candidates.forEach(q => {
      const itemKey = `${q.bookId}_${q.tqId}`;
      if (excludedTextbookItemKeys.has(itemKey)) return;
      if (q.questionId && !seen.has(q.questionId)) {
        seen.add(q.questionId);
        result.push(q.questionId);
      }
    });
    return result;
  };

  const getBasePendingCount = () => {
    if (modalTab === 'TAXONOMY') {
      const selectedArray = Array.from(selectedTaxonomyIds).sort();
      const topLevelSelected = selectedArray.filter(id => !selectedArray.some(otherId => id !== otherId && id.startsWith(otherId + '-')));
      return topLevelSelected.reduce((acc, id) => acc + (taxonomyStats[id]?.pending || 0), 0);
    } else if (modalTab === 'SELECTED') {
      return filteredTimeline.filter(item => selectedBlocks.includes(item.id)).reduce((acc, curr) => {
        if (curr.rawAnswers) {
          return acc + curr.rawAnswers.filter((a: any) => ['X', 'TX', '☆', 'B'].includes(a.grading_code)).length;
        }
        return acc + (curr.xCount || 0);
      }, 0);
    } else if (modalTab === 'PERIOD') {
      const targetWQs = allIncorrectRecords.filter(r => {
         const localDate = getLocalDateStr(r.created_at);
         return localDate >= startDate && localDate <= endDate;
      });
      const uniqueQids = new Set(targetWQs.map(r => r.question_id).filter(Boolean));
      return uniqueQids.size;
    } else if (modalTab === 'TEXTBOOK') {
      return getTargetTextbookQuestionIds().length;
    }
    return 0;
  };

  const basePendingCount = getBasePendingCount();

  let expectedFinalCount = 0;
  if (genMethod === 'SAME') {
    expectedFinalCount = basePendingCount;
  } else {
    expectedFinalCount = (basePendingCount * twinCount) + (basePendingCount * similarCount);
    if (!excludeOriginal) expectedFinalCount += basePendingCount;
  }

  // 🌟 주교재 제외 / 워크북 제외 및 유형별 최대 문제 수 제한 후처리 헬퍼
  const filterClinicMatchedQuestions = async (rawIds: string[]): Promise<string[]> => {
    if (!Array.isArray(rawIds) || rawIds.length === 0) return [];

    const exclusion = (excludeMain || excludeWorkbook) ? await fetchMainTextbookExclusionSet(supabaseClient) : null;
    const qMap = new Map<string, any>();
    const cleanIds = Array.from(
      new Set(
        rawIds
          .map((id) => String(id || '').trim().replace(/_added_\d+$/, ''))
          .filter(Boolean)
      )
    );

    for (let i = 0; i < cleanIds.length; i += 500) {
      const chunk = cleanIds.slice(i, i + 500);
      const { data: qRows } = await supabaseClient
        .from('question_db')
        .select('question_id, taxonomy_id, sub_taxonomy_id, derivation_type, problem_type, book_name, source_book_name, pdf_source')
        .in('question_id', chunk);
      (qRows || []).forEach((row: any) => {
        if (row?.question_id) qMap.set(String(row.question_id).trim(), row);
      });
    }

    const typeCounter = new Map<string, number>();
    const filtered: string[] = [];

    for (const rawId of rawIds) {
      const qid = String(rawId || '').trim();
      if (!qid) continue;
      const realQid = qid.replace(/_added_\d+$/, '');
      const q = qMap.get(qid) || qMap.get(realQid) || { question_id: realQid };

      if (isConfidentialQuestionObj(q)) continue;
      if (excludeMain && isMainTextbookQuestion(q, exclusion)) continue;
      if (excludeWorkbook && isWorkbookQuestion(q, exclusion)) continue;

      if (genMethod !== 'SAME' && isMaxTypeLimitActive && maxTypeLimit > 0) {
        const taxKey = String(q.taxonomy_id || q.sub_taxonomy_id || '').trim();
        if (taxKey) {
          const used = typeCounter.get(taxKey) || 0;
          if (used >= maxTypeLimit) continue;
          typeCounter.set(taxKey, used + 1);
        }
      }

      filtered.push(qid);
    }

    return filtered;
  };

  const calculateExactMatches = async () => {
    setIsCalculating(true);
    try {
      let uniqueQids: string[] = [];

      if (modalTab === 'TAXONOMY') {
          const { data: taxData } = await supabaseClient.from('student_answer')
            .select('question_id, exam_assignment(exam_master(exam_type, title)), question_db(source_book_name, book_name, pdf_source)')
            .eq('student_id', currentView.studentId)
            .in('grading_code', ['X', 'TX', '☆', 'B']);
          
          if (taxData) {
            const safeTaxRows = (taxData as any[]).filter((r: any) => {
              if (isConfidentialQuestionObj(r.question_db)) return false;
              const ea = Array.isArray(r.exam_assignment) ? r.exam_assignment[0] : r.exam_assignment;
              const em = Array.isArray(ea?.exam_master) ? ea.exam_master[0] : ea?.exam_master;
              if (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title)) return false;
              return true;
            });
            uniqueQids = Array.from(new Set(safeTaxRows.map(r => r.question_id).filter(Boolean)));
          }

      } else if (modalTab === 'PERIOD') {
          const targetWQs = allIncorrectRecords.filter(r => {
              const localDate = getLocalDateStr(r.created_at);
              return localDate >= startDate && localDate <= endDate;
          });
          uniqueQids = Array.from(new Set(targetWQs.map(r => r.question_id).filter(Boolean)));

      } else if (modalTab === 'SELECTED') {
          const tempQIds: string[] = [];
          const selectedItems = filteredTimeline.filter(item => selectedBlocks.includes(item.id));
          
          for (const item of selectedItems) {
            if (['exam', 'quarterly', 'hw_exam', 'print', 'similar', 'overdue'].includes(item.type)) {
              const assignId = item.realId; 
              const { data: ans } = await supabaseClient.from('student_answer')
                .select('question_id')
                .eq('exam_assignment_id', assignId)
                .in('grading_code', ['X', 'TX', '☆', 'B']);
              ans?.forEach(a => { if (a.question_id) tempQIds.push(a.question_id); });
            } 
            else if (item.type.includes('hw')) {
              const hwId = item.realId;
              const { data: hwAns } = await supabaseClient.from('student_homework_answer')
                .select('tq_id')
                .eq('homework_id', hwId)
                .eq('student_id', currentView.studentId)
                .in('grading_code', ['X', 'TX', '☆', 'B']);

              if (hwAns && hwAns.length > 0) {
                const tqIds = hwAns.map((a: any) => a.tq_id).filter(Boolean);
                if (tqIds.length > 0) {
                  const { data: tqs } = await supabaseClient.from('textbook_question').select('question_id').in('tq_id', tqIds);
                  tqs?.forEach((t: any) => { if(t.question_id) tempQIds.push(t.question_id); });
                }
              }
            }
          }
          uniqueQids = Array.from(new Set(tempQIds.filter(Boolean)));
      } else if (modalTab === 'TEXTBOOK') {
          uniqueQids = getTargetTextbookQuestionIds();
      }

      if (uniqueQids.length === 0) {
        setMatchWarningMsg('선택하신 조건에 해당하는 오답 문항이 0개입니다.');
        setMatchedCache([]);
        setIsCalculating(false);
        return;
      }

      if (genMethod === 'SAME') {
        const filteredSame = await filterClinicMatchedQuestions(uniqueQids);
        if (filteredSame.length === 0) {
          setMatchWarningMsg('주교재 제외 / 워크북 제외 설정으로 인해 원본 문항이 모두 제외되었습니다.');
        } else {
          setMatchWarningMsg('');
        }
        setMatchedCache(filteredSame);
        setIsCalculating(false);
        return;
      }

      const rpcMaxLimit = (excludeMain || excludeWorkbook) && isMaxTypeLimitActive
        ? Math.max(maxTypeLimit * 5, 20)
        : maxTypeLimit;

      const { data: matchedIds, error } = await supabaseClient.rpc('get_clinic_matches', {
        p_target_qids: uniqueQids,
        p_twin_count: twinCount,
        p_sim_count: similarCount,
        p_diff_opt: difficultyOption,
        p_exclude_orig: excludeOriginal,
        p_max_limit: rpcMaxLimit,
        p_is_limit_active: isMaxTypeLimitActive
      });

      if (error) {
        console.error("Match Engine RPC Error:", error);
        alert(`DB 매칭 중 에러가 발생했습니다. 오버로딩 에러일 수 있습니다.\n상세내용: ${error.message}`);
        setMatchedCache([]);
        setMatchWarningMsg('');
      } else {
        const finalFilteredIds = await filterClinicMatchedQuestions(matchedIds || []);
        if (!finalFilteredIds || finalFilteredIds.length === 0) {
          setMatchWarningMsg(`원본 오답 ${uniqueQids.length}개를 찾았으나 조건에 부합하는 쌍둥이/유사문제가 없습니다. (제외 조건 확인)`);
        } else {
          setMatchWarningMsg('');
        }
        setMatchedCache(finalFilteredIds || []);
      }
    } catch (err) {
      console.error("Calculate Catch Error:", err);
    } finally {
      setIsCalculating(false);
    }
  };

  useEffect(() => {
    if (!modalTab || expectedFinalCount === 0) return;
    const timer = setTimeout(() => { calculateExactMatches(); }, 300);
    return () => clearTimeout(timer);
  }, [
    selectedTaxonomyIds,
    selectedBlocks,
    selectedTextbookIds,
    checkedGradeCodes,
    excludedTextbookItemKeys,
    activeStudentTextbooks,
    modalTab,
    twinCount,
    similarCount,
    difficultyOption,
    excludeOriginal,
    excludeMain,
    excludeWorkbook,
    genMethod,
    isMaxTypeLimitActive,
    maxTypeLimit,
    startDate,
    endDate,
    expectedFinalCount,
  ]);

  const effectiveMatchedCache = (!modalTab || expectedFinalCount === 0) ? [] : matchedCache;
  const effectiveMatchWarning = (!modalTab || expectedFinalCount === 0) ? '' : matchWarningMsg;
  const effectiveIsCalculating = (!modalTab || expectedFinalCount === 0) ? false : isCalculating;

  const getTextbookSubTitle = () => {
    const chosen = activeStudentTextbooks.filter(b => selectedTextbookIds.includes(b.bookId));
    if (chosen.length === 0) return '교재별 맞춤 오답 복습';
    if (chosen.length === 1) return `${chosen[0].title} 오답 복습`;
    return `${chosen[0].title} 외 ${chosen.length - 1}권 오답 복습`;
  };

  const handleEditAndCreate = async () => {
    if (effectiveMatchedCache.length === 0) return alert("추출 조건에 부합하는 문제가 없습니다. 세팅을 확인해주세요.");

    let subTitle = '맞춤 오답 복습';
    if (modalTab === 'TAXONOMY') subTitle = '단원별 취약 유형 복습';
    else if (modalTab === 'PERIOD') subTitle = '기간별 맞춤 오답 복습';
    else if (modalTab === 'SELECTED') subTitle = '학습지 맞춤 오답 복습';
    else if (modalTab === 'TEXTBOOK') subTitle = getTextbookSubTitle();

    sessionStorage.clear();
    
    sessionStorage.setItem('restoreExamQuestions', '1');
    sessionStorage.setItem('examQuestions', JSON.stringify(effectiveMatchedCache));
    sessionStorage.setItem('examTitle', `[맞춤 오답 클리닉] ${currentView?.studentName} 학생`);
    sessionStorage.setItem('examSubTitle', subTitle); 

    sessionStorage.setItem('clinicTargetStudentId', currentView?.studentId);
    sessionStorage.setItem('clinicTargetClassId', currentView?.classId);
    sessionStorage.setItem('isClinicMode', 'true');
    sessionStorage.setItem('examType', '오답유사');
    sessionStorage.setItem(
      'sourceCategories',
      JSON.stringify({
        extra: true,
        twinSimilar: true,
        excludeMain,
        excludeWorkbook,
      })
    );

    window.location.href = '/exam/step2?source=clinic_incorrect';
  };

  const handleCreatePrint = async () => {
    if (effectiveMatchedCache.length === 0) return alert("추출 조건에 부합하는 문제가 없습니다.");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) throw new Error("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    setIsEngineRunning(true);

    try {
      const instId = localStorage.getItem('logica_instructor_id');
      if (!instId) throw new Error("로그인 정보를 찾을 수 없습니다. 다시 로그인 해주세요.");

      const examTitle = `[맞춤 오답 클리닉] ${currentView?.studentName} 학생`;

      let subTitle = '맞춤 오답 복습';
      if (modalTab === 'TAXONOMY') subTitle = '단원별 취약 유형 복습';
      else if (modalTab === 'PERIOD') subTitle = '기간별 맞춤 오답 복습';
      else if (modalTab === 'SELECTED') subTitle = '학습지 맞춤 오답 복습';
      else if (modalTab === 'TEXTBOOK') subTitle = getTextbookSubTitle();

      const bundleRes = await createClinicExamBundleAction({
        title: examTitle,
        subTitle,
        examType: '오답유사',
        instructorId: instId,
        tenantId: myTenantId,
        layoutSettings: {
          column: 2,
          split: 4,
          titleMode: 'all',
          template: 'basic1',
          numberColor: '#175b6a',
          titleColor: '#002864',
          lineColor: '#94a3b8'
        },
        questionIds: effectiveMatchedCache,
        studentId: currentView.studentId,
        classId: currentView.classId,
        createClinicTasks: true
      });
      if (!bundleRes.success) throw new Error(`시험지 생성 및 배부 실패: ${bundleRes.error}`);

      alert(`[출제 및 전송 완료! 🎉]\n조회된 ${effectiveMatchedCache.length}개의 맞춤 문항이 '학습 타임라인'에 배부되었으며,\n학생의 클리닉 패드로 즉시 전송되었습니다!`);
      setModalTab(null);

      setTimeout(() => {
        window.location.reload();
      }, 500);

    } catch (err: any) {
      console.error(err);
      alert(`출제 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsEngineRunning(false);
    }
  };

  const handleBulkPrint = () => {
    const selectedItems = filteredTimeline.filter(item => selectedBlocks.includes(item.id));
    if (selectedItems.length === 0) return;

    const printItems = selectedItems.map(item => ({
      printType: item.type || (activeTab === 'EXAM' || activeTab === 'QUARTERLY' ? 'exam' : activeTab === 'HOMEWORK' && !item.type.includes('hw_exam') ? 'hw' : activeTab === 'INCORRECT' ? 'print' : activeTab === 'SIMILAR' ? 'similar' : 'exam'),
      masterId: item.masterId,
      targetQuestions: item.target_questions,
      title: (item.title || '제목 없음').replace(/^\[시스템\]\s*/, ''),
      subTitle: item.subTitle || ''
    }));

    handleBulkPrintAction(printItems);
  };

  const renderHeader = () => {
    const isAllSelected = filteredTimeline?.length > 0 && selectedBlocks.length === filteredTimeline.length;
    return (
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-2.5">
        <div className="flex justify-between items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap min-w-0">
            <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded shadow-sm whitespace-nowrap shrink-0">{currentView?.className || '반 미지정'}</span>
            <span 
              onClick={() => currentView?.studentId && router.push(`/student/${currentView.studentId}`)}
              className="text-brand whitespace-nowrap cursor-pointer hover:underline hover:text-blue-600 transition-colors shrink-0"
              title="학생 상세 페이지로 이동"
            >
              {currentView?.studentName || '알 수 없음'}
            </span>
            <span className="whitespace-nowrap truncate">학생 전체 활동 타임라인</span>
          </h2>
          <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm shrink-0">
            <button onClick={() => setDateFilter('1W')} className={`px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap ${dateFilter === '1W' ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1주일</button>
            <div className="w-px bg-slate-300"></div>
            <button onClick={() => setDateFilter('1M')} className={`px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap ${dateFilter === '1M' ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1개월</button>
            <div className="w-px bg-slate-300"></div>
            <button onClick={() => setDateFilter('ALL')} className={`px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap ${dateFilter === 'ALL' ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-50'}`}>전체</button>
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer pl-1 whitespace-nowrap shrink-0">
              <input type="checkbox" checked={isAllSelected || false} onChange={handleSelectAllStudent || (() => {})} className="w-4 h-4 accent-rose-500 shrink-0" />
              <span className="text-[12px] font-bold text-slate-700 whitespace-nowrap">전체 선택</span>
            </label>
            <div className="w-px h-3.5 bg-slate-300 mx-0.5 shrink-0"></div>
            {activeTab === 'HOMEWORK' && selectedBlocks.length >= 2 && (
              <button onClick={handleExtractCommonHomework} className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-bold text-[11.5px] xl:text-[12px] transition-colors shadow-sm animate-pulse whitespace-nowrap shrink-0">
                🔗 공통 과제 분리
              </button>
            )}
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[11.5px] xl:text-[12px] disabled:opacity-40 whitespace-nowrap shrink-0">✅ 선택 완료 ({selectedBlocks.length})</button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[11.5px] xl:text-[12px] disabled:opacity-40 whitespace-nowrap shrink-0">🗑️ 선택 삭제 ({selectedBlocks.length})</button>
            
            <button onClick={handleBulkPrint} disabled={selectedBlocks.length === 0} className="px-2 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 font-bold text-[11.5px] xl:text-[12px] disabled:opacity-40 shadow-sm whitespace-nowrap shrink-0">🖨️ 선택 한 장에 모아 출력 ({selectedBlocks.length})</button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11.5px] xl:text-[12px] font-bold text-slate-500 flex items-center gap-1 whitespace-nowrap shrink-0">🖨️ 맞춤 오답 프린트 생성기 <span className="text-slate-300 ml-0.5">|</span></span>
            
            {selectedBlocks.length > 0 && (
              <button 
                onClick={() => openModal('SELECTED')} 
                className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[11.5px] xl:text-[12px] transition-all shadow-sm whitespace-nowrap shrink-0"
              >
                학습지별 오답 추출
              </button>
            )}
            
            <button onClick={() => openModal('TEXTBOOK')} className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold text-[11.5px] xl:text-[12px] transition-all shadow-sm whitespace-nowrap shrink-0">교재별 오답 추출</button>
            <button onClick={() => openModal('TAXONOMY')} className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[11.5px] xl:text-[12px] transition-all shadow-sm whitespace-nowrap shrink-0">유형별 약점 추출</button>
            <button onClick={() => openModal('PERIOD')} className="px-2 py-1 rounded bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold text-[11.5px] xl:text-[12px] transition-all shadow-sm whitespace-nowrap shrink-0">기간별 오답 추출</button>
          </div>
        </div>
      </div>
    );
  };

  const renderTaxonomyTree = (nodes: any, depth: number = 1) => {
    return Object.keys(nodes).sort().map(key => {
      const node = nodes[key];
      const stat = taxonomyStats[key] || { total: 0, correct: 0, pending: 0 };
      const rate = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
      const isLeaf = Object.keys(node.children).length === 0;

      const displayName = formatTaxonomyName(key, categoryMap);

      const progressBar = stat.total > 0 && (
        <div className="flex items-center gap-2 w-[100px] shrink-0 ml-auto mr-2">
           <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
              <div className={`h-full transition-all duration-700 ${rate >= 80 ? 'bg-emerald-400' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${rate}%` }}></div>
           </div>
           <span className={`text-xs font-bold w-7 text-right ${rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{rate}%</span>
        </div>
      );

      if (isLeaf) {
        return (
          <div key={key} className="flex items-center py-1 px-1.5 ml-10 hover:bg-slate-50 rounded transition-colors group">
            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 py-1">
              <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} className="w-3.5 h-3.5 rounded border-slate-300 accent-brand shrink-0 cursor-pointer" />
              <span className="flex-1 text-[13px] font-semibold text-slate-600 truncate group-hover:text-brand transition-colors min-w-0" title={displayName}>{displayName}</span>
              {stat.pending > 0 && <span className="ml-1 text-xs font-bold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-[1px] rounded shadow-sm whitespace-nowrap shrink-0 flex items-center justify-center">오답 {stat.pending}</span>}
            </label>
            {progressBar}
          </div>
        );
      }

      return (
        <details key={key} open={depth <= 2} className={depth === 1 ? "mb-2" : "mb-1 pl-1 ml-2 border-l border-slate-200"}>
          <summary className={`cursor-pointer flex items-center py-1.5 transition-colors select-none group ${depth === 1 ? "bg-slate-50 hover:bg-slate-100 px-3 rounded-lg border border-slate-200 shadow-sm" : "hover:bg-slate-50 px-2 rounded-md"}`}>
            <svg className="w-4 h-4 text-slate-400 group-hover:text-brand transition-transform details-arrow shrink-0 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7-7"></path></svg>
            <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 rounded border-slate-300 accent-brand shrink-0 cursor-pointer mr-2" />
            <span className={`flex-1 truncate min-w-0 ${depth === 1 ? "text-[14px] font-bold text-brand" : "text-[13px] font-bold text-slate-700"}`} title={displayName}>{displayName}</span>
            {stat.pending > 0 && <span className="ml-2 text-xs font-bold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-[1px] rounded shadow-sm whitespace-nowrap shrink-0 flex items-center justify-center">오답 {stat.pending}</span>}
            {progressBar}
          </summary>
          <div className={depth === 1 ? "pl-2 mt-1 space-y-0.5" : "mt-0.5 space-y-0.5"}>
            {renderTaxonomyTree(node.children, depth + 1)}
          </div>
        </details>
      );
    });
  };

  const renderTextbookTab = () => {
    const normTbSearch = textbookSearchQuery.trim().toLowerCase();
    const activeCount = activeStudentTextbooks.filter(b => b.courseStatus === '수강중').length;
    const completedCount = activeStudentTextbooks.filter(b => b.courseStatus === '수강완료').length;

    const visibleBooks = activeStudentTextbooks.filter(b => {
      if (textbookStatusFilter !== 'ALL' && b.courseStatus !== textbookStatusFilter) return false;
      if (normTbSearch && !b.title.toLowerCase().includes(normTbSearch) && !b.classNames.some(cn => cn.toLowerCase().includes(normTbSearch))) return false;
      return true;
    });

    const scopeBooks = selectedTextbookIds.length > 0
      ? activeStudentTextbooks.filter(b => selectedTextbookIds.includes(b.bookId))
      : activeStudentTextbooks;

    const symbolTotals: Record<TextbookGradeSymbol, number> = {
      X: 0,
      TO: 0,
      TX: 0,
      RO: 0,
      '☆': 0,
      B: 0,
    };
    scopeBooks.forEach(b => {
      TEXTBOOK_GRADE_OPTIONS.forEach(opt => {
        symbolTotals[opt.code] += b.counts[opt.code] || 0;
      });
    });

    const allGradesChecked = TEXTBOOK_GRADE_OPTIONS.every(opt => checkedGradeCodes[opt.code]);
    const candidateQuestions = getCandidateTextbookQuestions();
    const activeCandidateCount = candidateQuestions.filter(q => !excludedTextbookItemKeys.has(`${q.bookId}_${q.tqId}`)).length;
    const allCandidatesSelected = candidateQuestions.length > 0 && activeCandidateCount === candidateQuestions.length;

    const toggleAllGrades = () => {
      const nextVal = !allGradesChecked;
      setCheckedGradeCodes({
        X: nextVal,
        TO: nextVal,
        TX: nextVal,
        RO: nextVal,
        '☆': nextVal,
        B: nextVal,
      });
    };

    const toggleAllCandidateQuestions = () => {
      if (allCandidatesSelected) {
        setExcludedTextbookItemKeys(prev => {
          const next = new Set(prev);
          candidateQuestions.forEach(q => next.add(`${q.bookId}_${q.tqId}`));
          return next;
        });
      } else {
        setExcludedTextbookItemKeys(prev => {
          const next = new Set(prev);
          candidateQuestions.forEach(q => next.delete(`${q.bookId}_${q.tqId}`));
          return next;
        });
      }
    };

    const toggleSingleCandidateQuestion = (itemKey: string) => {
      setExcludedTextbookItemKeys(prev => {
        const next = new Set(prev);
        if (next.has(itemKey)) next.delete(itemKey);
        else next.add(itemKey);
        return next;
      });
    };

    const getBookTypeBadge = (bookType: string, isWb: boolean) => {
      if (isWb) return 'bg-amber-100 text-amber-800 border-amber-200';
      if (bookType.includes('특강')) return 'bg-violet-100 text-violet-700 border-violet-200';
      if (bookType.includes('부교재') || bookType.includes('연산')) return 'bg-teal-100 text-teal-700 border-teal-200';
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    };

    return (
      <div className="space-y-4 pb-6">
        {/* 1) 채점 기호 체크박스 (O 제외 6종 - 기본 모두 체크) */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-sm">
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              ✅ 출제할 채점 유형 선택
              <span className="text-[11px] font-semibold text-slate-400">(O 정답 제외)</span>
            </span>
            <button
              type="button"
              onClick={toggleAllGrades}
              className="text-[11px] font-bold text-sky-600 hover:text-sky-700 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm"
            >
              {allGradesChecked ? '전체 해제' : '전체 선택'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TEXTBOOK_GRADE_OPTIONS.map(opt => {
              const checked = checkedGradeCodes[opt.code];
              return (
                <label
                  key={opt.code}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all select-none ${
                    checked ? `${opt.activeCls} shadow-sm` : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => setCheckedGradeCodes(prev => ({ ...prev, [opt.code]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded accent-sky-500 shrink-0 cursor-pointer"
                    />
                    <span className="text-xs font-bold truncate">{opt.label}</span>
                    <span className="text-[10.5px] opacity-75 truncate">{opt.desc}</span>
                  </div>
                  <span className="text-[11px] font-extrabold ml-1 shrink-0">{symbolTotals[opt.code]}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 2) 수강중 / 수강완료 교재 목록 */}
        <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTextbookStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  textbookStatusFilter === 'ALL' ? 'bg-brand text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                전체 ({activeStudentTextbooks.length})
              </button>
              <button
                type="button"
                onClick={() => setTextbookStatusFilter('수강중')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  textbookStatusFilter === '수강중' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                수강중 ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setTextbookStatusFilter('수강완료')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  textbookStatusFilter === '수강완료' ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                수강완료 ({completedCount})
              </button>
            </div>

            <div className="relative flex-1 min-w-[140px] max-w-[190px]">
              <input
                type="text"
                value={textbookSearchQuery}
                onChange={e => setTextbookSearchQuery(e.target.value)}
                placeholder="교재명 검색..."
                className="w-full pl-2.5 pr-6 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-500"
              />
              {textbookSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTextbookSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {isTextbookLoading ? (
            <div className="py-12 text-center text-slate-400 font-bold animate-pulse text-sm">
              학생의 수강 교재를 불러오는 중입니다... 📚
            </div>
          ) : visibleBooks.length === 0 ? (
            <div className="py-10 text-center text-slate-400 font-bold text-xs">
              {activeStudentTextbooks.length === 0
                ? '수강중이거나 수강 완료한 등록 교재가 없습니다.'
                : '검색 조건에 맞는 교재가 없습니다.'}
            </div>
          ) : (
            <div className="max-h-[220px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {visibleBooks.map(tb => {
                const isSelected = selectedTextbookIds.includes(tb.bookId);
                const matchedWrongCnt = TEXTBOOK_GRADE_OPTIONS.reduce(
                  (acc, opt) => acc + (checkedGradeCodes[opt.code] ? tb.counts[opt.code] || 0 : 0),
                  0
                );
                return (
                  <label
                    key={tb.bookId}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleTextbook(tb.bookId)}
                        className="w-4 h-4 rounded accent-sky-500 shrink-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span
                            className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                              tb.courseStatus === '수강중'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {tb.courseStatus}
                          </span>
                          <span
                            className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${getBookTypeBadge(
                              tb.bookType,
                              tb.isWorkbook
                            )}`}
                          >
                            {tb.bookType}
                          </span>
                          {tb.classNames.length > 0 && (
                            <span className="text-[10.5px] font-semibold text-slate-400 truncate">
                              {tb.classNames.join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="text-[13px] font-bold text-slate-800 truncate" title={tb.title}>
                          {tb.title}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${
                          matchedWrongCnt > 0
                            ? 'text-rose-600 bg-rose-50 border-rose-100'
                            : 'text-slate-400 bg-slate-50 border-slate-200'
                        }`}
                      >
                        대상 {matchedWrongCnt}개
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 3) 선택한 교재 내 개별 오답 문항 골라내기 */}
        {selectedTextbookIds.length > 0 && (
          <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                🎯 문항 직접 골라내기{' '}
                <span className="text-sky-600 font-extrabold">
                  ({activeCandidateCount} / {candidateQuestions.length}문항 선택됨)
                </span>
              </span>
              {candidateQuestions.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllCandidateQuestions}
                  className="text-[11px] font-bold text-sky-600 hover:text-sky-700 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm"
                >
                  {allCandidatesSelected ? '전체 해제' : '전체 선택'}
                </button>
              )}
            </div>

            {candidateQuestions.length === 0 ? (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                선택한 교재에 체크된 채점 유형(O 제외)의 문항이 없습니다.
              </div>
            ) : (
              <div className="p-3 max-h-[210px] overflow-y-auto custom-scrollbar grid grid-cols-2 gap-1.5">
                {candidateQuestions.map(q => {
                  const itemKey = `${q.bookId}_${q.tqId}`;
                  const isIncluded = !excludedTextbookItemKeys.has(itemKey);
                  const optMeta = TEXTBOOK_GRADE_OPTIONS.find(o => o.code === q.gradeCode);
                  return (
                    <div
                      key={itemKey}
                      onClick={() => toggleSingleCandidateQuestion(itemKey)}
                      title={`${q.bookTitle} · ${q.pageNum > 0 ? `p.${q.pageNum} ` : ''}${q.questionNum ? `${q.questionNum}번` : `#${q.tqId}`}`}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${
                        isIncluded
                          ? 'border-sky-200 bg-sky-50/40 text-slate-800 shadow-sm'
                          : 'border-slate-200 bg-slate-50/60 text-slate-400 line-through'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded accent-sky-500 shrink-0 pointer-events-none"
                        />
                        <div className="min-w-0 truncate">
                          {selectedTextbookIds.length > 1 && (
                            <span className="text-[10px] font-semibold text-slate-400 mr-1">
                              [{q.bookTitle.length > 8 ? `${q.bookTitle.slice(0, 8)}…` : q.bookTitle}]
                            </span>
                          )}
                          <span className="font-bold">
                            {q.pageNum > 0 ? `p.${q.pageNum} ` : ''}
                            {q.questionNum ? `${q.questionNum}번` : `#${q.tqId}`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <span
                          className={`text-[10.5px] font-extrabold px-1.5 py-0.5 rounded border no-underline ${
                            optMeta?.badgeCls || 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {q.gradeCode === 'B' ? '빈칸' : q.gradeCode === '☆' ? '별' : q.gradeCode}
                        </span>
                        <button
                          type="button"
                          onClick={e => handlePreviewTextbookQuestion(e, q, q.bookTitle)}
                          className="text-[11px] text-slate-400 hover:text-sky-600 px-1 py-0.5 rounded hover:bg-white transition-colors"
                          title="문항 미리보기"
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderModal = () => {
    if (!modalTab) return null;

    return (
      <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-white w-[1100px] h-[720px] max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">

          <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-white shrink-0">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-200">마법사</span>
              {currentView?.studentName} 학생 맞춤 오답 출제
            </h2>
            <button onClick={() => setModalTab(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-40 border-r border-slate-200 bg-slate-50 flex flex-col pt-4 shrink-0">
              <button onClick={() => switchModalTab('SELECTED')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'SELECTED' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>학습지별 오답</button>
              <button onClick={() => switchModalTab('TAXONOMY')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'TAXONOMY' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>유형별 오답</button>
              <button onClick={() => switchModalTab('PERIOD')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'PERIOD' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>기간별 오답</button>
              <button onClick={() => switchModalTab('TEXTBOOK')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'TEXTBOOK' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>교재별 오답</button>
            </div>

            <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
              <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">

                {modalTab === 'TAXONOMY' && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">💡 최근 1년 내 푼 단원의 <strong className="text-slate-800">최초 정답률(%)</strong>과 <strong className="text-rose-500">현재 미해결 오답 수</strong>입니다.</span>
                    </div>
                    {isTaxonomyLoading ? (
                       <div className="text-center py-20 text-slate-400 font-bold animate-pulse text-sm">데이터를 분석 중입니다... 📊</div>
                    ) : Object.keys(taxonomyTree).length === 0 ? (
                       <div className="text-center py-20 text-slate-400 font-bold text-sm">학생의 학습 데이터가 없습니다.</div>
                    ) : (
                       <div className="pb-8 pl-1">
                         {renderTaxonomyTree(taxonomyTree, 1)}
                       </div>
                    )}
                  </div>
                )}

                {modalTab === 'PERIOD' && (
                  <div className="flex flex-col h-full">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-6 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1">💡 선택한 기간에 발생한 <strong className="text-sky-600">미해결 오답</strong>을 조회합니다.</span>
                      <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded shadow-sm border border-rose-100">조회된 오답: {basePendingCount}개</span>
                    </div>
                    <div className="flex items-start justify-center flex-1 pb-10 gap-2 mt-2">
                      <div className="flex flex-col items-center gap-2">
                        <InlineCalendar label="시작일" dateValue={startDate} onDateChange={setStartDate} colorTheme="blue" />
                        <div className="text-xs font-bold text-sky-600 bg-sky-50 px-3 py-1 rounded-full border border-sky-100 shadow-sm">{startDate}</div>
                      </div>
                      <div className="flex flex-col items-center justify-center h-[230px] px-2">
                        <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <InlineCalendar label="종료일" dateValue={endDate} onDateChange={setEndDate} colorTheme="red" />
                        <div className="text-xs font-bold text-rose-500 bg-rose-50 px-3 py-1 rounded-full border border-rose-100 shadow-sm">{endDate}</div>
                      </div>
                    </div>
                  </div>
                )}

                {modalTab === 'SELECTED' && (
                  <div>
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600">타임라인에서 선택된 학습지 <span className="text-rose-500 font-bold">{selectedBlocks.length}개</span>의 오답을 추출합니다.</span>
                    </div>
                    <ul className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                      {filteredTimeline.filter(item => selectedBlocks.includes(item.id)).map(item => {
                        const finalXCount = item.rawAnswers ? item.rawAnswers.filter((a: any) => ['X', 'TX', '☆', 'B'].includes(a.grading_code)).length : (item.xCount || 0);
                        return (
                          <li key={item.id} className="px-4 py-3 border-b last:border-0 border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <span className="font-bold text-sm text-slate-700 truncate w-3/4">{(item.title || '').replace(/^\[시스템\]\s*/, '')}</span>
                            <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 shadow-sm">오답 {finalXCount}개</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {modalTab === 'TEXTBOOK' && renderTextbookTab()}

              </div>
            </div>

            <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.02)]">
              <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">

                <div className="mb-4">
                  <div className="text-xs font-bold text-slate-500 mb-2">출제 구성 방식</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGenMethod('SAME')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                        genMethod === 'SAME'
                          ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-500/30'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      📌 오답 그대로
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGenMethod('TWIN');
                        if (twinCount === 0 && similarCount === 0) {
                          setTwinCount(1);
                        }
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                        genMethod === 'TWIN'
                          ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-500/30'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      🔄 쌍둥이 · 유사 문제
                    </button>
                  </div>
                </div>

                {genMethod === 'SAME' ? (
                  <div className="bg-sky-50/60 border border-sky-200 rounded-xl p-4 mb-6 text-[13px] font-bold text-slate-700 leading-relaxed shadow-sm break-keep">
                    선택된 오답 문항(<span className="text-sky-600 font-extrabold">{basePendingCount}개</span>)을 변형 없이 <span className="text-sky-700 underline underline-offset-2">오답 그대로</span> 학습지로 구성합니다.
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-[13px] font-bold text-slate-600 leading-loose shadow-sm break-keep">
                    대상 문제의 <span className="text-sky-500 font-bold">쌍둥이</span>
                    <select
                      value={twinCount}
                      onChange={e => { setTwinCount(Number(e.target.value)); setGenMethod('TWIN'); }}
                      className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-bold cursor-pointer shadow-sm"
                    >
                      {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}개</option>)}
                    </select>와 <span className="text-sky-500 font-bold">유사</span>
                    <select
                      value={similarCount}
                      onChange={e => { setSimilarCount(Number(e.target.value)); setGenMethod('TWIN'); }}
                      className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-bold cursor-pointer shadow-sm"
                    >
                      {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}개</option>)}
                    </select>로 학습지를 만듭니다. 유사문제 난이도는
                    <select
                      value={difficultyOption}
                      onChange={e => { setDifficultyOption(e.target.value); setGenMethod('TWIN'); }}
                      className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-bold cursor-pointer shadow-sm"
                    >
                      <option value="그대로">그대로</option><option value="더 쉽게">더 쉽게</option><option value="더 어렵게">더 어렵게</option>
                    </select> 출제합니다.
                  </div>
                )}

                <div className="space-y-3.5 mb-8 pl-1">
                  <label className={`flex items-center gap-2 group w-max ${genMethod === 'SAME' ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={genMethod === 'SAME' ? false : excludeOriginal}
                      disabled={genMethod === 'SAME'}
                      onChange={e => setExcludeOriginal(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 accent-sky-500"
                    />
                    <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">기존 출제 문제 제외</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer group w-max">
                    <input type="checkbox" checked={excludeMain} onChange={e => setExcludeMain(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-sky-500" />
                    <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">주교재 제외</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer group w-max">
                    <input type="checkbox" checked={excludeWorkbook} onChange={e => setExcludeWorkbook(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-sky-500" />
                    <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">워크북 제외</span>
                  </label>

                  <div className={`flex items-center gap-3 ${genMethod === 'SAME' ? 'opacity-45' : ''}`}>
                    <label className={`flex items-center gap-2 group ${genMethod === 'SAME' ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={isMaxTypeLimitActive}
                        disabled={genMethod === 'SAME'}
                        onChange={(e) => setIsMaxTypeLimitActive(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 accent-sky-500"
                      />
                      <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">유형별 최대 문제 수 제한</span>
                    </label>
                    <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${isMaxTypeLimitActive && genMethod !== 'SAME' ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                      <button onClick={() => setMaxTypeLimit(p => Math.max(1, p - 1))} disabled={!isMaxTypeLimitActive || genMethod === 'SAME'} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                      <input type="text" value={maxTypeLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                      <button onClick={() => setMaxTypeLimit(p => p + 1)} disabled={!isMaxTypeLimitActive || genMethod === 'SAME'} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                    </div>
                    <span className="text-[14px] font-bold text-slate-700">개</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50/80 border-t border-slate-200 p-6 shrink-0 flex flex-col items-center">
                {effectiveMatchWarning && !effectiveIsCalculating && (
                  <div className="w-full mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11.5px] font-bold text-amber-700 text-center break-keep">
                    ⚠️ {effectiveMatchWarning}
                  </div>
                )}
                <div className="text-center flex flex-col items-center justify-center">
                  <span className="font-bold text-slate-800 text-base">최종 출제 문항 수</span>
                  <div className="flex items-end mt-1 h-12">
                    {effectiveIsCalculating ? (
                      <span className="font-bold text-2xl text-sky-500 tracking-tighter animate-pulse mb-1">매칭 중...</span>
                    ) : (
                      <>
                        <span className="font-bold text-4xl text-brand tracking-tighter">{effectiveMatchedCache.length}</span>
                        <span className="font-bold text-slate-800 text-base mb-1 ml-1.5">개</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 w-full mt-4">
                  <button onClick={handleEditAndCreate} disabled={effectiveMatchedCache.length === 0 || effectiveIsCalculating} className="flex-1 px-4 py-3.5 bg-white border border-slate-300 rounded-xl shadow-sm hover:bg-slate-50 transition-colors text-sm font-bold text-slate-600 disabled:opacity-50">편집 후 만들기</button>
                  <button onClick={handleCreatePrint} disabled={isEngineRunning || effectiveMatchedCache.length === 0 || effectiveIsCalculating} className="flex-1 px-4 py-3.5 bg-sky-500 hover:bg-sky-600 border border-transparent rounded-xl shadow-md transition-colors text-sm font-bold text-white disabled:opacity-50">바로 배부하기</button>
                </div>
              </div>
            </div>

          </div>

          {previewQuestion && (
            <div
              className="absolute inset-0 z-30 bg-slate-900/50 flex items-center justify-center p-6"
              onClick={() => setPreviewQuestion(null)}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-[560px] max-h-[80vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-700 truncate pr-3">
                    📖 {previewQuestion.bookTitle} ·{' '}
                    {previewQuestion.item.pageNum > 0 ? `p.${previewQuestion.item.pageNum} ` : ''}
                    {previewQuestion.item.questionNum ? `${previewQuestion.item.questionNum}번` : ''}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewQuestion(null)}
                    className="text-slate-400 hover:text-slate-600 text-sm font-bold px-1.5"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-4 overflow-y-auto space-y-3 text-sm text-slate-800">
                  {isPreviewLoading ? (
                    <div className="py-10 text-center text-xs font-bold text-slate-400 animate-pulse">
                      문항을 불러오는 중입니다...
                    </div>
                  ) : !previewQuestion.dbRow ? (
                    <div className="py-10 text-center text-xs font-bold text-slate-400">
                      문항 상세 정보를 찾을 수 없습니다.
                    </div>
                  ) : (
                    <>
                      {previewQuestion.dbRow.question && (
                        <div className="whitespace-pre-wrap font-semibold leading-relaxed text-[13px]">
                          {previewQuestion.dbRow.question}
                        </div>
                      )}
                      {previewQuestion.dbRow.image_url && getCleanUrl(previewQuestion.dbRow.image_url) && (
                        <img
                          src={getCleanUrl(previewQuestion.dbRow.image_url)}
                          alt="문항 이미지"
                          className="max-w-full rounded border border-slate-100"
                        />
                      )}
                      {previewQuestion.dbRow.image_2_url && getCleanUrl(previewQuestion.dbRow.image_2_url) && (
                        <img
                          src={getCleanUrl(previewQuestion.dbRow.image_2_url)}
                          alt="문항 보조 이미지"
                          className="max-w-full rounded border border-slate-100"
                        />
                      )}
                      {previewQuestion.dbRow.answer && (
                        <div className="pt-2 border-t border-dashed border-slate-200 text-xs font-bold text-blue-700">
                          정답: {previewQuestion.dbRow.answer}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
      `}} />
      {renderHeader()}
      <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
        {isLoading ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">타임라인을 구성하는 중입니다...</div>
        ) : filteredTimeline.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">해당 기간에 기록된 활동이 없습니다.</div>
        ) : (
          <div className="space-y-3 pb-20">
            {filteredTimeline.map((item, idx) => {
              if (!item || !item.id || !item.type) return null;

              const isSelected = selectedBlocks.includes(item.id);
              const isCompleted = item.isCompleted;

              let badgeColor = "bg-slate-100 text-slate-500";
              let typeLabel = "";

              if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 주간/중간테스트"; }
              else if (item.type === 'quarterly') { badgeColor = "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200"; typeLabel = "📅 분기평가"; }
              else if (item.type.includes('hw')) { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
              else if (item.type === 'print') { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "❌ 오답"; }
              else if (item.type === 'similar') { badgeColor = "bg-violet-100 text-violet-700 border-violet-200"; typeLabel = "🔄 오답유사"; }
              else if (item.type === 'overdue') { badgeColor = "bg-rose-100 text-rose-700 border-rose-200"; typeLabel = "⏰ 미완료과제"; }
              else if (item.type === 'archive') { badgeColor = "bg-slate-700 text-amber-400 border-slate-600"; typeLabel = "📦 보존됨"; }
              else if (item.type === 'raw_inc') { badgeColor = "bg-rose-800 text-rose-100 border-rose-700"; typeLabel = "🔥 원본오답"; }

              const rowBgClass = isSelected
                ? 'border-rose-400 bg-rose-50/30 shadow-rose-100'
                : isCompleted
                  ? 'bg-slate-200/60 border-slate-300 text-slate-600 hover:bg-slate-200/80'
                  : 'bg-white border-slate-200 hover:border-brand';

              const displayTitle = (item.title || '제목 없음').replace(/^\[시스템\]\s*/, '');
              
              const finalOCount = item.rawAnswers ? item.rawAnswers.filter((a: any) => ['O', 'RO', 'TO'].includes(a.grading_code)).length : (item.oCount || 0);
              const finalXCount = item.rawAnswers ? item.rawAnswers.filter((a: any) => ['X', 'TX', '☆', 'B'].includes(a.grading_code)).length : (item.xCount || 0);

              // 타임라인은 종류가 섞이므로 종류 배지를 항상 표시 (구분용 파스텔 색)
              const TYPE_META: Record<string, { label: string; cls: string }> = {
                exam: { label: '주간/중간테스트', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
                quarterly: { label: '분기평가', cls: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
                print: { label: '오답', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
                similar: { label: '오답유사', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
                overdue: { label: '미완료과제', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
                archive: { label: '보존됨', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
                raw_inc: { label: '원본오답', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
              };
              const meta = TYPE_META[item.type] || (item.type.includes('hw') ? { label: '과제', cls: 'bg-amber-100 text-amber-700 border-amber-200' } : { label: '', cls: '' });
              const isRawLike = item.type === 'raw_inc' || item.type === 'archive';
              const isExamLike = item.type === 'exam' || item.type === 'quarterly' || item.type === 'print' || item.type === 'hw_exam' || item.type === 'similar' || item.type === 'overdue';
              const completeKind = item.type === 'raw_inc' ? 'raw_inc' : item.type === 'archive' ? 'archive' : (item.type === 'quarterly' || item.type === 'exam') ? 'exam' : item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : activeTab === 'INCORRECT' ? 'print' : activeTab === 'SIMILAR' ? 'similar' : activeTab === 'OVERDUE' ? 'overdue' : 'exam';
              const printKind = isRawLike ? 'raw_inc' : item.type || (activeTab === 'EXAM' || activeTab === 'QUARTERLY' ? 'exam' : activeTab === 'HOMEWORK' && !item.type.includes('hw_exam') ? 'hw' : activeTab === 'INCORRECT' ? 'print' : activeTab === 'SIMILAR' ? 'similar' : 'exam');
              const statusText = item.status || '미제출';
              const goDetail = () => {
                let detailHref = '';
                if (item.type === 'hw') detailHref = `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}`;
                else if (item.type === 'quarterly') detailHref = `/exam/review?assignment_id=${item.realId}&student_id=${currentView.studentId}`;
                else detailHref = `/homework/review?assignment_id=${item.realId}&student_id=${currentView.studentId}&is_exam_hw=true`;
                window.location.href = detailHref;
              };
              const doDelete = () => {
                if (item.type === 'exam' || item.type === 'quarterly' || item.type === 'hw_exam' || item.type === 'overdue') handleDeleteExam(item.realId, currentView.studentId);
                else if (item.type.includes('hw')) handleDeleteHomework(item.realId, currentView.studentId);
                else if (item.type === 'print' || item.type === 'similar') handleDeletePrint(item.realId, item.masterId, currentView.studentId);
                else if (isRawLike) handleDeleteRawIncArchive(item.realId, currentView.studentId, item.type === 'archive');
              };

              return (
                <LearningRow
                  key={`${item.id}_${idx}`}
                  selected={isSelected}
                  completed={isCompleted}
                  onToggle={() => setSelectedBlocks(p => p.includes(item.id) ? p.filter(id => id !== item.id) : [...p, item.id])}
                  title={displayTitle}
                  typeLabel={meta.label || undefined}
                  typeClass={meta.cls}
                  subTitle={item.subTitle}
                  date={item.created_at || item.date}
                  totalQ={item.total || 0}
                  oCount={finalOCount}
                  xCount={finalXCount}
                  status={statusText}
                  statusTone={statusToneOf(statusText, !!isCompleted, item.type === 'overdue')}
                  onComplete={(e) => handleForceComplete(e, completeKind, item.realId, currentView.studentId)}
                  primary={isRawLike
                    ? { label: '문제 보기', tone: 'danger', onClick: (e) => handlePrintItem(e, 'raw_inc', null, item.target_questions, displayTitle, item.subTitle) }
                    : { label: '상세', onClick: goDetail }}
                  menu={[
                    { label: '문항 확인 및 개별 삭제', hidden: item.type !== 'raw_inc', onClick: () => openRawIncManageModal(currentView.studentId, currentView.studentName, item.realId) },
                    { label: '이름 변경', hidden: isRawLike, onClick: (e) => handleRenameItem(e, item.type, item.realId, item.masterId, displayTitle) },
                    isRawLike
                      ? { label: '맞춤 오답 다시 출제', onClick: (e) => handleEditRawIncorrectToStep2?.(e, item.target_questions, displayTitle, currentView?.studentName, currentView?.studentId, currentView?.classId) }
                      : isExamLike
                        ? { label: '문제 수정', onClick: (e) => handleEditExamToStep2?.(e, item.realId, item.masterId, displayTitle, item.subTitle, currentView?.studentName, currentView?.studentId, currentView?.classId, item.type) }
                        : { label: '과제 문항 수정', onClick: (e) => handleEditHomeworkToStep2?.(e, item.type, item.realId, item.target_questions, displayTitle, item.subTitle, currentView?.studentName, currentView?.studentId, currentView?.classId) },
                    { label: '문제 보기 및 출력', onClick: (e) => handlePrintItem(e, printKind, item.masterId, item.target_questions, displayTitle, item.subTitle) },
                    { label: '삭제', danger: true, onClick: doDelete },
                  ]}
                />
              );
            })}
          </div>
        )}
      </div>

      {renderModal()}
    </>
  );
}