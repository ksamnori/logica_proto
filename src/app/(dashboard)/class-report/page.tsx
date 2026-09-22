// src/app/(dashboard)/class-report/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type ReportTabType = 'LOG' | 'ALL' | 'EXAM' | 'HW' | 'OVERDUE' | 'PRINT' | 'SIMILAR';

interface ClassInfo {
  class_id: string;
  name: string;
  status?: string;
  instructor_id?: string;
  instructor?: any; 
}

interface AnalyzedItem {
  id: string;
  type: ReportTabType;
  sourceType: 'TEXTBOOK' | 'EXAM';
  title: string;
  date: string;
  totalQ: number;
  status: string;
  underlyingIds: string[]; 
}

interface MatrixCol {
  qId: string;
  displayNum: string;
  page: string;
  number: string;
  questionText: string;
  imageUrl: string;
  answer: string;
}

interface MatrixCell {
  code: string;
  isBlocked: boolean; 
}

interface MatrixRow {
  studentId: string;
  studentName: string;
  cells: Record<string, MatrixCell>; 
  totalCorrect: number;
  status: string; 
}

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
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

const getKSTDateStr = (offsetDays = 0) => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000) + (offsetDays * 86400000));
  return kst.toISOString().split('T')[0];
};

export default function ClassReportPage() {
  const router = useRouter(); 
  
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isSuperLevel: false, isAdmin: false });

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ReportTabType>('ALL');
  
  const [assignments, setAssignments] = useState<AnalyzedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<AnalyzedItem | null>(null);

  const [lessonLogs, setLessonLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  
  const [matrixCols, setMatrixCols] = useState<MatrixCol[]>([]);
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [questionRates, setQuestionRates] = useState<Record<string, number>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isMatrixLoading, setIsMatrixLoading] = useState(false);

  const [modalQuestion, setModalQuestion] = useState<MatrixCol | null>(null);
  const mathJaxRef = useRef(false);

  // 🌟 [수정 포인트] 개별 학생 코멘트를 배열로 관리하는 폼 구조로 개선
  const [isLessonLogModalOpen, setIsLessonLogModalOpen] = useState(false);
  const [lessonForm, setLessonForm] = useState({
    lesson_log_id: null as number | null,
    actual_date: getKSTDateStr(),
    progress_desc: "",
    homework_desc: "", 
    individual_comments: [] as { student_id: string; comment: string }[],
    instructor_note: "" 
  });

  const classListRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragged, setDragged] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!classListRef.current) return;
    setIsDragging(true);
    setDragged(false);
    setStartX(e.pageX - classListRef.current.offsetLeft);
    setScrollLeft(classListRef.current.scrollLeft);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !classListRef.current) return;
      e.preventDefault(); 
      const x = e.pageX - classListRef.current.offsetLeft;
      const walk = (x - startX) * 1.5; 
      if (Math.abs(walk) > 5) setDragged(true); 
      classListRef.current.scrollLeft = scrollLeft - walk;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setTimeout(() => setDragged(false), 50); 
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, startX, scrollLeft]);

  const handleClassClick = (e: React.MouseEvent, classId: string) => {
    if (dragged) {
      e.preventDefault();
      return; 
    }
    setSelectedClassId(classId);
  };

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
        chtml: { displayAlign: 'left', displayIndent: '0em' },
        svg: { fontCache: 'global' }
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  useEffect(() => { loadMathJax(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [modalQuestion]);

  const getCleanUrl = (url: string) => {
    if (!url || url === 'null') return '';
    let validUrl = url;
    if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} }
    if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) {
      validUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/question_images/${validUrl}`;
    }
    return validUrl;
  };

  const formatMathTextForWeb = (text: string) => {
    if (!text) return "";
    let t = String(text).replace(/<br\s*\/?>/gi, '__LOGICA_BR_PLACEHOLDER__');
    t = t.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
    t = t.replace(/__LOGICA_BR_PLACEHOLDER__/g, '<br>');
    return t;
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlTab = searchParams.get('tab');
    if (urlTab && ['LOG', 'ALL', 'EXAM', 'HW', 'OVERDUE', 'PRINT', 'SIMILAR'].includes(urlTab)) {
      setActiveTab(urlTab as ReportTabType);
    }

    const fetchClasses = async () => {
      const instId = localStorage.getItem('logica_instructor_id') || "";
      const name = localStorage.getItem('logica_instructor_name') || "";
      const tenantId = localStorage.getItem('logica_tenant_id');
      const role = localStorage.getItem('logica_instructor_role');
      const pos = localStorage.getItem('logica_instructor_position') || '';
      
      const isSuperLevel = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('최고관리자') || pos.includes('원장') || pos.includes('실장');
      const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('원장') || pos.includes('최고관리자');

      setCurrentUser({ instId, name, isSuperLevel, isAdmin });

      let query = supabase.from('class').select('class_id, name, status, instructor_id, instructor(name)').order('name');
      if (tenantId && tenantId !== 'hq') query = query.eq('tenant_id', tenantId);
      if (!isAdmin && instId) query = query.eq('instructor_id', instId);

      const { data, error } = await query;
      if (error) console.error("클래스 데이터 로딩 실패:", error);

      if (data && data.length > 0) {
        const activeClasses = data.filter((c: any) => c.status !== "종료" && c.status !== "폐강");
        setClasses(activeClasses);

        const urlClassId = searchParams.get('class_id');
        if (urlClassId && activeClasses.some((c: any) => c.class_id === urlClassId)) {
          setSelectedClassId(urlClassId);
          
          setTimeout(() => {
             if (classListRef.current) {
               const activeBtn = classListRef.current.querySelector(`button[data-class-id="${urlClassId}"]`) as HTMLElement;
               if (activeBtn) {
                 const scrollPos = activeBtn.offsetLeft - classListRef.current.offsetLeft - 20;
                 classListRef.current.scrollTo({ left: scrollPos, behavior: 'smooth' });
               }
             }
          }, 100);

        } else if (activeClasses.length > 0) {
          setSelectedClassId(activeClasses[0].class_id);
        }
      }
      setIsLoading(false);
    };
    fetchClasses();
  }, []);

  const handleDeleteLog = async (e: React.MouseEvent, logId: number) => {
    e.stopPropagation(); 
    if (!confirm("정말 이 수업 일지를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) return;

    try {
      const { error } = await supabase.from('daily_lesson_log').delete().eq('lesson_log_id', logId);
      if (error) throw error;
      alert("✅ 성공적으로 삭제되었습니다.");
      if (selectedLog && selectedLog.lesson_log_id === logId) setSelectedLog(null);
      fetchAssignmentsAndLogs(); 
    } catch (err: any) {
      console.error("삭제 에러:", err);
      alert("삭제 중 오류가 발생했습니다: " + err.message);
    }
  };

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const fetchAssignmentsAndLogs = async () => {
    if (!selectedClassId) return;
    setIsLoading(true);
    try {
      // 🌟 [수정 포인트] 신규 테이블(lesson_log_student_comment) 조인 추가
      const { data: logData } = await supabase
        .from('daily_lesson_log')
        .select(`
          lesson_log_id, 
          actual_date, 
          instructor_note, 
          homework_desc,
          lesson_log_student_comment(student_id, comment, student(name))
        `)
        .eq('class_id', selectedClassId)
        .order('actual_date', { ascending: false });
      
      setLessonLogs(logData || []);

      let list: AnalyzedItem[] = [];

      const { data: examData } = await supabase
        .from('exam_assignment')
        .select('exam_id, status, created_at, exam_master!inner(title, exam_type, total_questions)')
        .eq('class_id', selectedClassId);

      if (examData) {
        const groupedExams = new Map<string, any>();
        
        examData.forEach((a: any) => {
          const m = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
          const dateStr = formatDateLabel(a.created_at);
          const title = m?.title || '제목 없음';
          
          const key = `EXAM_${dateStr}_${title}`; 

          if (!groupedExams.has(key)) {
            let type: ReportTabType = 'EXAM';
            const eType = m?.exam_type;
            if (['과제', '과제프린트'].includes(eType)) type = 'HW';
            else if (['오답프린트', '오답'].includes(eType)) type = 'PRINT';
            else if (['오답유사', '과제오답유사'].includes(eType)) type = 'SIMILAR';
            else if (eType === '미완료과제') type = 'OVERDUE'; 

            groupedExams.set(key, {
              id: key, type, sourceType: 'EXAM', title, date: a.created_at,
              totalQ: m?.total_questions || 0,
              statuses: [], underlyingIds: new Set<string>()
            });
          }
          
          const g = groupedExams.get(key);
          g.underlyingIds.add(a.exam_id);
          g.statuses.push(a.status);
          g.totalQ = Math.max(g.totalQ, m?.total_questions || 0); 
        });

        groupedExams.forEach(g => {
          const isAllDone = g.statuses.length > 0 && g.statuses.every((s: string) => ['제출완료', '채점완료', '완료'].includes(s));
          list.push({ ...g, status: isAllDone ? '완료' : '진행중', underlyingIds: Array.from(g.underlyingIds) });
        });
      }

      const { data: hwData } = await supabase
        .from('homework_assignment')
        .select('homework_id, homework_title, created_at, target_questions, student_homework_result(status)')
        .eq('class_id', selectedClassId)
        .neq('homework_title', '[시스템] 수업 진도 완료 기록');

      if (hwData) {
        const groupedHws = new Map<string, any>();

        hwData.forEach((hw: any) => {
          const dateStr = formatDateLabel(hw.created_at);
          const title = hw.homework_title || '교재 과제';
          const key = `HW_${dateStr}_${title}`;

          if (!groupedHws.has(key)) {
            groupedHws.set(key, {
              id: key, type: 'HW', sourceType: 'TEXTBOOK', title, date: hw.created_at,
              totalQ: 0, tqSet: new Set<number>(), statuses: [], underlyingIds: new Set<string>()
            });
          }

          const g = groupedHws.get(key);
          g.underlyingIds.add(String(hw.homework_id));
          safeParseIds(hw.target_questions).forEach((id: number) => g.tqSet.add(id));
          if (hw.student_homework_result) {
            hw.student_homework_result.forEach((r: any) => g.statuses.push(r.status));
          }
        });

        groupedHws.forEach(g => {
          const isAllDone = g.statuses.length > 0 && g.statuses.every((s: string) => ['제출완료', '채점완료', '완료'].includes(s));
          list.push({ ...g, totalQ: g.tqSet.size, status: isAllDone ? '완료' : '진행중', underlyingIds: Array.from(g.underlyingIds) });
        });
      }

      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setAssignments(list);
      setSelectedItem(null);
      setMatrixCols([]);
      setMatrixRows([]);
    } catch (err) {
      console.error("리스트 로딩 실패:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignmentsAndLogs();
  }, [selectedClassId]);

  useEffect(() => {
    if (!selectedItem || !selectedClassId || activeTab === 'LOG') return;

    const fetchMatrix = async () => {
      setIsMatrixLoading(true);
      try {
        let cols: MatrixCol[] = [];
        let rowsMap = new Map<string, MatrixRow>();

        const { data: enrolls } = await supabase
          .from('enrollment')
          .select('student_id, student(name, status)')
          .eq('class_id', selectedClassId);

        enrolls?.forEach((e: any) => {
          const s = Array.isArray(e.student) ? e.student[0] : e.student;
          if (s?.status === '재원') {
            rowsMap.set(e.student_id, {
              studentId: e.student_id,
              studentName: s.name,
              cells: {},
              totalCorrect: 0,
              status: '미응시' 
            });
          }
        });

        const uIds = selectedItem.underlyingIds;

        if (selectedItem.sourceType === 'TEXTBOOK') {
          const { data: hwData } = await supabase.from('homework_assignment')
            .select('homework_id, target_student_id, target_questions')
            .in('homework_id', uIds);

          const tqToHwMap = new Map<string, Set<number>>();
          let globalTqs: number[] = [];

          hwData?.forEach(hw => {
            const tqs = safeParseIds(hw.target_questions);
            if (hw.target_student_id) {
               if (!tqToHwMap.has(String(hw.target_student_id))) tqToHwMap.set(String(hw.target_student_id), new Set());
               tqs.forEach(id => tqToHwMap.get(String(hw.target_student_id))!.add(id));
            } else {
               rowsMap.forEach((_, sId) => {
                   if (!tqToHwMap.has(sId)) tqToHwMap.set(sId, new Set());
                   tqs.forEach(id => tqToHwMap.get(sId)!.add(id));
               });
            }
            globalTqs.push(...tqs);
          });

          const unionTqs = Array.from(new Set(globalTqs));
          
          let tqDetails: any[] = [];
          for (let i = 0; i < unionTqs.length; i += 150) {
            const chunk = unionTqs.slice(i, i + 150);
            const { data } = await supabase.from('textbook_question').select('*, question_db(*)').in('tq_id', chunk);
            if (data) tqDetails = [...tqDetails, ...data];
          }

          tqDetails.sort((a, b) => {
            const aPage = a.page_number || a.question_db?.page_number || 0;
            const bPage = b.page_number || b.question_db?.page_number || 0;
            if (aPage !== bPage) return aPage - bPage;
            return String(a.question_number || '').localeCompare(String(b.question_number || ''), undefined, { numeric: true });
          });

          const tqMap = new Map();
          tqDetails.forEach(tq => tqMap.set(String(tq.tq_id), tq));

          cols = tqDetails.map((tq, idx) => {
            const q = tq.question_db || {};
            return {
              qId: String(tq.tq_id),
              displayNum: `${idx + 1}`,
              page: tq.page_number || q.page_number || q.final_printed_page || q.detected_page_num || '',
              number: tq.question_number || q.question_number || '',
              questionText: tq.question || q.question || '',
              imageUrl: q.image_url || tq.image_url || '',
              answer: tq.answer || q.answer || ''
            };
          });

          rowsMap.forEach((row, sId) => {
            cols.forEach(col => {
               const isBlocked = !(tqToHwMap.get(sId)?.has(Number(col.qId)));
               row.cells[col.qId] = { code: 'B', isBlocked };
            });
          });

          const { data: answers } = await supabase.from('student_homework_answer').select('student_id, tq_id, grading_code').in('homework_id', uIds);
          answers?.forEach((a: any) => {
            const row = rowsMap.get(String(a.student_id));
            if (row && row.cells[String(a.tq_id)]) {
               row.cells[String(a.tq_id)].code = a.grading_code;
            }
          });

          const { data: hwResults } = await supabase.from('student_homework_result').select('student_id, status').in('homework_id', uIds);
          hwResults?.forEach((r: any) => {
             const row = rowsMap.get(String(r.student_id));
             if (row) row.status = r.status || '진행중';
          });

        } else {
          const { data: items } = await supabase.from('exam_item').select('exam_id, question_id, sort_order').in('exam_id', uIds);
          const examToQMap = new Map<string, Set<string>>();
          const qSortMap = new Map<string, number>();

          items?.forEach(i => {
             if (!examToQMap.has(i.exam_id)) examToQMap.set(i.exam_id, new Set());
             examToQMap.get(i.exam_id)!.add(String(i.question_id));
             
             const exist = qSortMap.get(String(i.question_id));
             if (!exist || i.sort_order < exist) qSortMap.set(String(i.question_id), i.sort_order);
          });

          const unionQids = Array.from(qSortMap.keys()).sort((a, b) => (qSortMap.get(a) || 0) - (qSortMap.get(b) || 0));

          let qDetails: any[] = [];
          for (let i = 0; i < unionQids.length; i += 150) {
            const chunk = unionQids.slice(i, i + 150);
            const { data } = await supabase.from('question_db').select('*').in('question_id', chunk);
            if (data) qDetails = [...qDetails, ...data];
          }

          const qMap = new Map();
          qDetails.forEach(q => qMap.set(String(q.question_id), q));

          cols = unionQids.map((qid, idx) => {
            const q = qMap.get(qid) || {};
            return {
              qId: qid,
              displayNum: `${idx + 1}`,
              page: q.page_number || q.final_printed_page || q.detected_page_num || '',
              number: q.question_number || '',
              questionText: q.question || '',
              imageUrl: q.image_url || '',
              answer: q.answer || ''
            };
          });

          const { data: assigns } = await supabase.from('exam_assignment').select('assignment_id, student_id, exam_id, status').in('exam_id', uIds).eq('class_id', selectedClassId);
          const stuToExamMap = new Map<string, Set<string>>();
          const assignMap = new Map<string, string>();
          
          assigns?.forEach((a: any) => {
            assignMap.set(a.assignment_id, String(a.student_id));
            if (!stuToExamMap.has(String(a.student_id))) stuToExamMap.set(String(a.student_id), new Set());
            stuToExamMap.get(String(a.student_id))!.add(a.exam_id);
            
            const row = rowsMap.get(String(a.student_id));
            if (row) row.status = a.status || '미응시';
          });

          rowsMap.forEach((row, sId) => {
            cols.forEach(col => {
               const examIds = stuToExamMap.get(sId);
               const isBlocked = !(Array.from(examIds || []).some(eid => examToQMap.get(eid)?.has(col.qId)));
               row.cells[col.qId] = { code: 'B', isBlocked };
            });
          });

          if (assigns && assigns.length > 0) {
            const assignIds = assigns.map((a: any) => a.assignment_id);
            const { data: answers } = await supabase.from('student_answer').select('exam_assignment_id, question_id, grading_code').in('exam_assignment_id', assignIds);

            answers?.forEach((a: any) => {
              const sId = assignMap.get(a.exam_assignment_id);
              if (sId) {
                const row = rowsMap.get(String(sId));
                if (row && row.cells[String(a.question_id)]) {
                   row.cells[String(a.question_id)].code = a.grading_code;
                }
              }
            });
          }
        }

        const rates: Record<string, number> = {};
        cols.forEach(col => {
          let correctCount = 0;
          let attemptCount = 0;
          rowsMap.forEach(row => {
            const cell = row.cells[col.qId];
            if (cell && !cell.isBlocked) {
              const code = cell.code;
              if (code && code !== 'B') {
                attemptCount++;
                if (['O', 'TO', 'RO'].includes(code)) correctCount++;
              }
            }
          });
          rates[col.qId] = attemptCount > 0 ? Math.round((correctCount / attemptCount) * 100) : 0;
        });

        const finalRows = Array.from(rowsMap.values())
          .filter(row => {
             return cols.some(col => row.cells[col.qId] && !row.cells[col.qId].isBlocked);
          })
          .map(row => {
            let cCount = 0;
            cols.forEach(col => { 
               const cell = row.cells[col.qId];
               if (cell && !cell.isBlocked && ['O', 'TO', 'RO'].includes(cell.code)) cCount++; 
            });
            return { ...row, totalCorrect: cCount };
          })
          .sort((a, b) => a.studentName.localeCompare(b.studentName));

        setMatrixCols(cols);
        setMatrixRows(finalRows);
        setQuestionRates(rates);

      } catch (err) {
        console.error("매트릭스 로딩 실패:", err);
      } finally {
        setIsMatrixLoading(false);
      }
    };

    fetchMatrix();
  }, [selectedItem, selectedClassId, activeTab]);

  const filteredAssignments = useMemo(() => {
    if (activeTab === 'ALL' || activeTab === 'LOG') return assignments;
    return assignments.filter(a => a.type === activeTab);
  }, [assignments, activeTab]);

  const getCellUI = (cell: MatrixCell) => {
    if (!cell || cell.isBlocked) {
      return <div className="w-full h-full min-h-[50px] bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABAD2OQQ/9rX+aQAAAABJRU5ErkJggg==')] opacity-15 pointer-events-none" title="배부되지 않은 문항"></div>;
    }
    const code = cell.code;
    if (!code) return <span className="text-slate-200">-</span>;
    if (code === 'O') return <span className="text-emerald-500 font-black text-[14px]">O</span>;
    if (code === 'TO') return <span className="text-teal-500 font-black text-[14px]">TO</span>;
    if (code === 'RO') return <span className="text-blue-500 font-black text-[14px]">RO</span>;
    if (code === 'X') return <span className="text-rose-500 font-black text-[14px]">X</span>;
    if (code === 'TX') return <span className="text-orange-500 font-black text-[14px]">TX</span>;
    if (code === '☆') return <span className="text-orange-500 font-black text-[14px]">☆</span>;
    if (code === 'B') return <span className="text-slate-400 font-black text-[14px]">B</span>;
    return <span className="text-slate-600 font-black text-[14px]">{code}</span>;
  };

  const getTypeBadge = (type: ReportTabType) => {
    switch (type) {
      case 'EXAM': return <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-blue-200">시험</span>;
      case 'HW': return <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-amber-200">과제</span>;
      case 'OVERDUE': return <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-rose-200">미완료</span>;
      case 'PRINT': return <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-emerald-200">오답</span>;
      case 'SIMILAR': return <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-violet-200">유사</span>;
      default: return null;
    }
  };

  const openLessonLogModal = () => {
    setIsLessonLogModalOpen(true);
    setLessonForm({
      lesson_log_id: null,
      actual_date: getKSTDateStr(),
      progress_desc: "",
      homework_desc: "",
      individual_comments: [],
      instructor_note: ""
    });
  };

  const openEditLessonLogModal = (log: any) => {
    const desc = log.homework_desc || "";
    const progressMatch = desc.match(/\[📖 오늘의 진도\]\n([\s\S]*?)(?=\n\n\[📝 공통 과제\]|$)/);
    const hwMatch = desc.match(/\[📝 공통 과제\]\n([\s\S]*?)$/);

    let p = progressMatch ? progressMatch[1].trim() : "";
    let h = hwMatch ? hwMatch[1].trim() : "";
    if (!progressMatch && !hwMatch) h = desc;

    const mappedComments = (log.lesson_log_student_comment || []).map((c: any) => ({
      student_id: c.student_id,
      comment: c.comment
    }));

    setLessonForm({
      lesson_log_id: log.lesson_log_id,
      actual_date: log.actual_date,
      progress_desc: p,
      homework_desc: h,
      individual_comments: mappedComments,
      instructor_note: log.instructor_note || ""
    });
    setIsLessonLogModalOpen(true);
  };

  const handleLessonLogSubmit = async () => {
    if (!lessonForm.progress_desc.trim() && !lessonForm.homework_desc.trim()) {
      alert("진도 또는 공통 과제 내용 중 하나는 필수로 입력해주세요.");
      return;
    }

    let finalDesc = "";
    if (lessonForm.progress_desc.trim()) finalDesc += `[📖 오늘의 진도]\n${lessonForm.progress_desc.trim()}\n\n`;
    if (lessonForm.homework_desc.trim()) finalDesc += `[📝 공통 과제]\n${lessonForm.homework_desc.trim()}`;
    finalDesc = finalDesc.trim();

    setIsLoading(true);
    try {
      let currentLogId = lessonForm.lesson_log_id;

      if (currentLogId) {
        const { error: logErr } = await supabase.from("daily_lesson_log").update({
          actual_date: lessonForm.actual_date || getKSTDateStr(),
          homework_desc: finalDesc,
          instructor_note: lessonForm.instructor_note
        }).eq('lesson_log_id', currentLogId);
        
        if (logErr) throw logErr;
      } else {
        const { data: newLog, error: logErr } = await supabase.from("daily_lesson_log").insert({
          class_id: selectedClassId,
          actual_date: lessonForm.actual_date || getKSTDateStr(),
          homework_desc: finalDesc, 
          instructor_note: lessonForm.instructor_note 
        }).select('lesson_log_id').single();
        
        if (logErr) throw logErr;
        currentLogId = newLog.lesson_log_id;
      }

      if (currentLogId) {
         await supabase.from('lesson_log_student_comment').delete().eq('lesson_log_id', currentLogId);
         const validComments = lessonForm.individual_comments.filter(c => c.student_id && c.comment.trim());
         
         if (validComments.length > 0) {
           const inserts = validComments.map(c => ({
             lesson_log_id: currentLogId,
             student_id: c.student_id,
             comment: c.comment.trim()
           }));
           await supabase.from('lesson_log_student_comment').insert(inserts);
         }
      }

      alert(`✅ 수업 일지가 성공적으로 ${lessonForm.lesson_log_id ? '수정' : '등록'}되었습니다!`);
      setIsLessonLogModalOpen(false);
      fetchAssignmentsAndLogs(); 
    } catch (e: any) {
      console.error(e);
      alert("처리 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderLogView = () => {
    if (!selectedLog) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
          <span className="text-5xl mb-4 text-indigo-200">📝</span>
          <p className="font-extrabold text-lg text-slate-500">좌측에서 조회할 수업 일지를 선택해주세요.</p>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50 relative">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-black bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg shadow-sm border border-indigo-200">
                  {formatDateLabel(selectedLog.actual_date)}
                </span>
              </div>
              <h2 className="text-2xl font-black text-slate-800">수업 일지 기록</h2>
            </div>
            
            {currentUser.isAdmin && (
              <div className="flex gap-2 shrink-0">
                <button 
                  onClick={() => openEditLessonLogModal(selectedLog)}
                  className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-lg transition-colors border border-indigo-200 text-sm shadow-sm"
                >
                  ✏️ 내용 수정
                </button>
                <button 
                  onClick={(e) => handleDeleteLog(e, selectedLog.lesson_log_id)}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-lg transition-colors border border-rose-200 text-sm shadow-sm"
                >
                  🗑️ 삭제
                </button>
              </div>
            )}
          </div>

          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="text-base font-black text-slate-800 border-b border-slate-100 pb-3 mb-5 flex items-center gap-2">
              <span className="text-xl">📚</span> 학부모 안내장 (진도 및 과제 내역)
            </h3>
            {selectedLog.homework_desc ? (
              <div className="text-[15px] font-medium text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                {selectedLog.homework_desc}
              </div>
            ) : (
              <div className="text-center py-8 opacity-60">
                <span className="text-sm font-bold text-slate-400">작성된 학부모 안내장이 없습니다.</span>
              </div>
            )}

            {/* 🌟 개별 특이 과제 및 코멘트 렌더링 영역 */}
            {selectedLog.lesson_log_student_comment && selectedLog.lesson_log_student_comment.length > 0 && (
              <div className="mt-5 pt-5 border-t border-slate-100">
                <h4 className="text-sm font-black text-slate-700 mb-3 flex items-center gap-1.5">
                  <span className="text-emerald-500">🧑‍🎓</span> 개별 과제 및 코멘트
                </h4>
                <div className="flex flex-col gap-2.5">
                  {selectedLog.lesson_log_student_comment.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <span className="font-black text-xs text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded border border-indigo-200 shrink-0">
                        {c.student?.name || '학생'}
                      </span>
                      <span className="text-[14px] font-medium text-slate-700 whitespace-pre-wrap leading-snug pt-0.5">
                        {c.comment}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-yellow-50 p-6 md:p-8 rounded-2xl shadow-sm border border-yellow-200">
            <h3 className="text-base font-black text-yellow-800 border-b border-yellow-200/60 pb-3 mb-5 flex items-center gap-2">
              <span className="text-xl">🔒</span> 강사 특이사항 메모 <span className="text-xs font-bold text-yellow-600/70 ml-2 bg-yellow-100 px-2 py-1 rounded">(학부모 미노출)</span>
            </h3>
            {selectedLog.instructor_note ? (
              <p className="text-[15px] font-medium text-slate-700 whitespace-pre-wrap leading-loose">
                {selectedLog.instructor_note}
              </p>
            ) : (
              <div className="text-center py-8 opacity-60">
                <span className="text-sm font-bold text-yellow-700">작성된 특이사항 메모가 없습니다.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMatrixView = () => {
    if (!selectedItem) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
          <span className="text-5xl mb-4">👈</span>
          <p className="font-extrabold text-lg">좌측에서 분석할 시험지나 과제를 선택해주세요.</p>
        </div>
      );
    }
    
    if (isMatrixLoading) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="font-bold text-sm">학생별 정오답 데이터를 분석 중입니다...</p>
        </div>
      );
    }

    if (matrixCols.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
          <p className="font-bold text-sm">해당 문제지에 문항 데이터가 없습니다.</p>
        </div>
      );
    }

    return (
      <>
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between shrink-0 gap-4">
          <div>
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              {getTypeBadge(selectedItem.type)} {selectedItem.title.replace(/^\[시스템\]\s*/, '')}
            </h3>
            <div className="text-xs font-bold text-slate-500 mt-1 flex gap-3">
              <span>📅 출제일: {formatDateLabel(selectedItem.date)}</span>
              <span>📝 전체 합산 총 {matrixCols.length}문항</span>
              <span>👥 배부 인원 {matrixRows.length}명</span>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2.5 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-1"><span className="text-[11px] font-black text-emerald-500">O</span><span className="text-[10px] font-bold text-slate-600">정답</span></div>
            <div className="flex items-center gap-1 ml-1"><span className="text-[11px] font-black text-teal-500">TO</span><span className="text-[10px] font-bold text-slate-600">힌트정답</span></div>
            <div className="flex items-center gap-1 ml-1"><span className="text-[11px] font-black text-blue-500">RO</span><span className="text-[10px] font-bold text-slate-600">재시도정답</span></div>
            <div className="flex items-center gap-1 ml-1 border-l border-slate-200 pl-2"><span className="text-[11px] font-black text-rose-500">X</span><span className="text-[10px] font-bold text-slate-600">오답</span></div>
            <div className="flex items-center gap-1 ml-1"><span className="text-[11px] font-black text-orange-500">TX</span><span className="text-[10px] font-bold text-slate-600">힌트오답</span></div>
            <div className="flex items-center gap-1 ml-1"><span className="text-[11px] font-black text-orange-500">☆</span><span className="text-[10px] font-bold text-slate-600">질문</span></div>
            <div className="flex items-center gap-1 ml-1 border-l border-slate-200 pl-2"><span className="text-[11px] font-black text-slate-400">B</span><span className="text-[10px] font-bold text-slate-600">빈칸</span></div>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scroll relative bg-slate-50/30">
          <table className="w-max border-collapse">
            <thead className="sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="sticky left-0 z-30 bg-slate-100 p-3 min-w-[150px] w-[150px] max-w-[150px] border-r border-b border-slate-200 text-center align-middle shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                  <span className="text-xs font-extrabold text-slate-700">학생명</span>
                </th>
                <th className="bg-slate-50 p-3 min-w-[80px] w-[80px] max-w-[80px] border-r border-b border-slate-200 text-center align-middle shadow-sm">
                  <span className="text-xs font-extrabold text-slate-700">정답 수</span>
                </th>
                
                {matrixCols.map(col => (
                  <th key={col.qId} className="bg-blue-50 p-1 min-w-[50px] w-[50px] max-w-[50px] border-r border-b border-slate-200 text-center align-middle">
                    <div className="flex flex-col items-center justify-center gap-0.5">
                      <div className="flex items-center gap-0.5">
                        <span className="text-[13px] font-black text-[#002864] leading-none">{col.displayNum}</span>
                        <button onClick={() => setModalQuestion(col)} className="text-[10px] text-blue-400 hover:text-blue-700 transition-colors leading-none" title="문제 상세 보기">🔍</button>
                      </div>
                      {(col.page || col.number) && (
                        <span className="text-[8px] font-bold text-blue-500 leading-none tracking-tighter truncate w-full px-0.5" title={`${col.page ? `p.${col.page}` : ''}${col.page && col.number ? '-' : ''}${col.number ? `${col.number}번` : ''}`}>
                          {col.page ? `p${col.page}` : ''}{col.page && col.number ? '-' : ''}{col.number}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row, idx) => {
                const isCompleted = ['완료', '채점완료', '제출완료'].includes(row.status);
                let assignedCount = 0;
                matrixCols.forEach(col => { if (row.cells[col.qId] && !row.cells[col.qId].isBlocked) assignedCount++; });

                return (
                  <tr key={row.studentId} className={`hover:bg-blue-50/50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                    <td className="sticky left-0 z-10 bg-white p-2 border-r border-b border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.02)] align-middle text-center font-extrabold text-[13px] text-slate-800 min-w-[150px] w-[150px] max-w-[150px] group-hover:bg-blue-50/50 h-[50px]">
                      <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
                        <span 
                          onClick={() => router.push(`/student/${row.studentId}`)}
                          className="truncate w-full text-center cursor-pointer hover:underline hover:text-blue-600 transition-colors"
                          title="학생 상세 기록 보기"
                        >
                          {row.studentName}
                        </span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${isCompleted ? 'text-slate-400 bg-slate-100' : 'text-rose-500 bg-rose-50 border border-rose-100'}`}>
                          {row.status || '미제출'}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 border-r border-b border-slate-200 text-center align-middle min-w-[80px] w-[80px] max-w-[80px] h-[50px]">
                      <span className="text-xs font-black text-[#002864] bg-blue-50 px-2 py-1 rounded border border-blue-100 whitespace-nowrap">
                        {row.totalCorrect} / {assignedCount}
                      </span>
                    </td>
                    {matrixCols.map(col => (
                      <td key={col.qId} className={`p-0 border-r border-b border-slate-200 text-center align-middle text-[13px] min-w-[50px] w-[50px] max-w-[50px] h-[50px] ${row.cells[col.qId]?.isBlocked ? 'bg-slate-100/50' : ''}`}>
                        <div className="flex items-center justify-center w-full h-full">
                          {getCellUI(row.cells[col.qId])}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
              <tr>
                <th colSpan={2} className="sticky left-0 z-30 bg-slate-100 p-2 border-r border-t border-slate-200 text-center align-middle shadow-[2px_0_5px_rgba(0,0,0,0.05)] h-[40px]">
                  <span className="text-xs font-black text-slate-700">문항별 정답률</span>
                </th>
                {matrixCols.map(col => {
                  const rate = questionRates[col.qId] || 0;
                  let rateColor = "text-slate-700";
                  if (rate < 50 && rate > 0) rateColor = "text-rose-500"; 
                  else if (rate >= 80) rateColor = "text-emerald-600"; 

                  return (
                    <th key={col.qId} className="bg-slate-50 p-1 border-r border-t border-slate-200 text-center align-middle min-w-[50px] w-[50px] max-w-[50px] h-[40px]">
                      <span className={`text-[12px] font-black ${rateColor}`}>{rate}%</span>
                    </th>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  };

  // 반 학생 목록 조회 (모달에 띄울 용도)
  const [classStudents, setClassStudents] = useState<any[]>([]);
  useEffect(() => {
    if (selectedClassId) {
      supabase.from("enrollment").select("student(student_id, name)").eq("class_id", selectedClassId)
        .then(({ data }) => {
          if (data) {
             const stds = data.map((d: any) => Array.isArray(d.student) ? d.student[0] : d.student).filter(Boolean);
             setClassStudents(stds.sort((a,b) => a.name.localeCompare(b.name)));
          }
        });
    }
  }, [selectedClassId]);

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative font-pretendard">
      
      {/* 상단 헤더 및 반 선택 가로 스크롤 영역 */}
      <div className="flex flex-col gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-black text-[#002864] tracking-tight flex items-center gap-2">
            <span>📊</span> 반별 문항 분석 및 학습 결과
          </h2>
          <p className="text-sm font-bold text-slate-500 mt-1.5">
            반 전체 학생의 정오답 분석 결과와 수업 일지(진도/과제 이력)를 확인합니다.
          </p>
        </div>

        <div 
          ref={classListRef}
          onMouseDown={handleMouseDown}
          className={`flex gap-2.5 overflow-x-auto pb-2 pt-1 min-h-[70px] select-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          {classes.length === 0 ? <span className="text-sm font-bold text-slate-400 py-2">배정된 반이 없습니다.</span> :
            classes.map((c) => {
              const instName = Array.isArray(c.instructor) ? c.instructor[0]?.name : c.instructor?.name;
              const displayInstructor = instName ? `${instName} 선생님` : '담당 미정';
              const isActive = selectedClassId === c.class_id;
              return (
                <button 
                  key={c.class_id} 
                  data-class-id={c.class_id}
                  onClick={(e) => handleClassClick(e, c.class_id)}
                  className={`px-4 py-2 rounded-xl border-2 shadow-sm flex flex-col items-start transition-all text-left min-w-[120px] max-w-[160px] shrink-0 ${isActive ? "bg-[#002864] text-white border-[#002864] transform scale-[1.02]" : "bg-white text-slate-500 border-transparent hover:border-slate-300 hover:text-slate-700"}`}
                >
                  <span className="text-sm font-extrabold tracking-tight leading-tight truncate w-full">{c.name}</span>
                  <span className="text-[10px] mt-0.5 font-medium opacity-80 leading-none tracking-tight whitespace-nowrap truncate w-full">👤 {displayInstructor}</span>
                </button>
              );
            })
          }
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        
        {/* 좌측 패널 (필터 버튼 영역) */}
        <div className="w-[320px] 2xl:w-[350px] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm shrink-0 overflow-hidden">
          
          <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-stretch gap-2 shrink-0">
            <button 
              onClick={() => setActiveTab('LOG')} 
              className={`relative flex-1 min-w-[80px] flex flex-col items-center justify-center rounded-xl transition-all border p-2 gap-1 group overflow-visible
                ${activeTab === 'LOG' 
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-inner' 
                  : 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm hover:bg-indigo-100 hover:border-indigo-400 hover:-translate-y-0.5'}`
              }
            >
              {activeTab !== 'LOG' && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500 border border-white"></span>
                </span>
              )}
              <span className="text-2xl leading-none transition-transform group-hover:scale-110">📝</span>
              <span className="text-xs font-black">수업 일지</span>
            </button>
            
            <div className="flex-[2] grid grid-cols-3 gap-1.5">
              <button onClick={() => setActiveTab('ALL')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'ALL' ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>전체 분석</button>
              <button onClick={() => setActiveTab('EXAM')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'EXAM' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>💯 시험</button>
              <button onClick={() => setActiveTab('HW')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'HW' ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>📝 과제</button>
              
              <button onClick={() => setActiveTab('OVERDUE')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'OVERDUE' ? 'bg-rose-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>⏰ 미완료</button>
              <button onClick={() => setActiveTab('PRINT')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'PRINT' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>❌ 오답</button>
              <button onClick={() => setActiveTab('SIMILAR')} className={`py-1.5 rounded-lg text-[10px] font-black transition-colors ${activeTab === 'SIMILAR' ? 'bg-violet-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>🔄 유사</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5 bg-slate-50/50">
            {activeTab === 'LOG' && (
              <button 
                onClick={openLessonLogModal}
                className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-bold text-xs py-2.5 rounded-xl shadow-md hover:from-indigo-400 hover:to-indigo-500 transition-colors mb-2 flex items-center justify-center gap-1.5 group"
              >
                <span className="group-hover:scale-110 transition-transform">➕</span> 오늘 수업 일지 새로 작성하기
              </button>
            )}

            {isLoading ? (
              <div className="py-10 text-center text-sm font-bold text-slate-400">목록을 불러오는 중...</div>
            ) : activeTab === 'LOG' ? (
              lessonLogs.length === 0 ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">작성된 수업 일지가 없습니다.</div>
              ) : (
                lessonLogs.map((log) => (
                  <div 
                    key={log.lesson_log_id} 
                    onClick={() => setSelectedLog(log)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedLog?.lesson_log_id === log.lesson_log_id ? 'bg-indigo-50 border-indigo-300 shadow-md transform scale-[1.02] ml-1' : 'bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50 shadow-sm'}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-indigo-200">일지</span>
                        <span className={`text-[10px] font-bold truncate ${selectedLog?.lesson_log_id === log.lesson_log_id ? 'text-indigo-400' : 'text-slate-400'}`}>{formatDateLabel(log.actual_date)}</span>
                      </div>
                      
                      {currentUser.isAdmin && (
                        <button 
                          onClick={(e) => handleDeleteLog(e, log.lesson_log_id)}
                          className="text-slate-300 hover:text-rose-500 transition-colors p-1 rounded-md hover:bg-rose-50"
                          title="이 일지 삭제하기"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      )}
                    </div>
                    <div className={`font-extrabold text-[13px] leading-snug line-clamp-2 ${selectedLog?.lesson_log_id === log.lesson_log_id ? 'text-indigo-900' : 'text-slate-800'}`}>
                      수업 일지 기록
                    </div>
                  </div>
                ))
              )
            ) : filteredAssignments.length === 0 ? (
              <div className="py-10 text-center text-sm font-bold text-slate-400">출제된 항목이 없습니다.</div>
            ) : (
              filteredAssignments.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => setSelectedItem(item)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedItem?.id === item.id ? 'bg-[#002864] border-[#002864] shadow-md transform scale-[1.02] ml-1' : 'bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50 shadow-sm'}`}
                >
                  <div className="flex items-center gap-2 mb-1.5 justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {getTypeBadge(item.type)}
                      <span className={`text-[10px] font-bold truncate ${selectedItem?.id === item.id ? 'text-blue-200' : 'text-slate-400'}`}>{formatDateLabel(item.date)}</span>
                    </div>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${item.status === '완료' ? 'bg-slate-100 text-slate-400' : 'bg-rose-500 text-white shadow-sm'}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className={`font-extrabold text-[13px] leading-snug line-clamp-2 ${selectedItem?.id === item.id ? 'text-white' : 'text-slate-800'}`}>
                    {item.title.replace(/^\[시스템\]\s*/, '')}
                  </div>
                  <div className={`mt-2 text-[11px] font-bold ${selectedItem?.id === item.id ? 'text-blue-200' : 'text-slate-500'}`}>
                    배부된 전체 문항수: {item.totalQ}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 우측 패널 */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          {activeTab === 'LOG' ? renderLogView() : renderMatrixView()}
        </div>
      </div>

      {/* 문항 상세 보기 모달 */}
      {modalQuestion && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <span>🔍</span> {modalQuestion.displayNum}번 문항 상세 
                {(modalQuestion.page || modalQuestion.number) && <span className="text-sm font-medium text-blue-200 ml-2">({modalQuestion.page ? `p.${modalQuestion.page} ` : ''}{modalQuestion.number ? `${modalQuestion.number}번` : ''})</span>}
              </h2>
              <button onClick={() => setModalQuestion(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3">질문 (Question)</h3>
                <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQuestion.questionText || '-').replace(/\n/g, '<br>') }} />
                {getCleanUrl(modalQuestion.imageUrl) && <img src={getCleanUrl(modalQuestion.imageUrl)} className="max-w-full mt-4 rounded-lg border border-slate-200" alt="Question" />}
              </div>
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3">정답 (Answer)</h3>
                <div className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: `$ ${formatMathTextForWeb(modalQuestion.answer || '-')} $` }} />
              </div>
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalQuestion(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 수정된 수업 일지 작성 모달 */}
      {isLessonLogModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-gradient-to-r from-indigo-700 to-blue-800 p-5 text-white flex justify-between items-center shrink-0">
              <h3 className="text-lg font-black flex items-center gap-2">📝 {lessonForm.lesson_log_id ? "수업 일지 내용 수정" : "새 수업 일지 작성"}</h3>
              <button onClick={() => setIsLessonLogModalOpen(false)} className="text-white hover:text-rose-400 text-2xl font-bold leading-none transition-colors">&times;</button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] bg-slate-50/50 custom-scroll">
              
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-black text-slate-700 flex items-center gap-1.5">
                  📅 수업 일자 <span className="text-xs text-slate-400 font-normal">(소급 작성 시 변경 가능)</span>
                </label>
                <input 
                  type="date" 
                  value={lessonForm.actual_date} 
                  onChange={e => setLessonForm({...lessonForm, actual_date: e.target.value})} 
                  className="border border-slate-300 p-3 w-1/3 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-black text-indigo-700 flex items-center gap-1.5">
                    <span>📖 오늘의 진도</span> <span className="text-rose-500">*</span>
                  </label>
                  <textarea 
                    value={lessonForm.progress_desc} 
                    onChange={e => setLessonForm({...lessonForm, progress_desc: e.target.value})} 
                    rows={4}
                    className="border border-indigo-200 p-4 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm resize-none placeholder-slate-300"
                    placeholder="예) 이차방정식의 근과 계수 개념 학습 및 대표 유형 문제 풀이 (p.45 ~ p.50)" 
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-black text-indigo-700 flex items-center gap-1.5">
                    <span>📝 공통 과제</span> <span className="text-rose-500">*</span>
                  </label>
                  <textarea 
                    value={lessonForm.homework_desc} 
                    onChange={e => setLessonForm({...lessonForm, homework_desc: e.target.value})} 
                    rows={4}
                    className="border border-indigo-200 p-4 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm resize-none placeholder-slate-300"
                    placeholder="예) 워크북 p.20 ~ p.25 홀수번 풀이 및 채점해오기" 
                  />
                </div>
              </div>

              {/* 🌟 개별 코멘트 배열 관리 UI */}
              <div className="flex flex-col gap-2 pt-2">
                <label className="text-sm font-black text-emerald-700 flex items-center gap-1.5">
                  <span>🧑‍🎓 개별 특이 과제 / 코멘트</span>
                  <span className="text-[11px] text-emerald-600/70 font-bold bg-emerald-50 px-2 py-0.5 rounded">(선택)</span>
                </label>
                <div className="flex flex-col gap-2">
                  {lessonForm.individual_comments.map((ic, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-emerald-50/30 p-2.5 rounded-xl border border-emerald-100">
                      <select 
                        value={ic.student_id} 
                        onChange={(e) => {
                          const newComments = [...lessonForm.individual_comments];
                          newComments[idx].student_id = e.target.value;
                          setLessonForm({ ...lessonForm, individual_comments: newComments });
                        }}
                        className="border border-slate-300 p-2.5 w-[120px] rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:border-emerald-500 shrink-0 shadow-sm"
                      >
                        <option value="">학생 선택</option>
                        {classStudents.map((s: any) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
                      </select>
                      <textarea 
                        value={ic.comment} 
                        onChange={(e) => {
                          const newComments = [...lessonForm.individual_comments];
                          newComments[idx].comment = e.target.value;
                          setLessonForm({ ...lessonForm, individual_comments: newComments });
                        }}
                        rows={2}
                        className="border border-slate-300 p-2.5 flex-1 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-emerald-500 resize-none placeholder-slate-400 shadow-sm"
                        placeholder="특정 학생의 개별 과제나 코멘트를 입력하세요."
                      />
                      <button 
                        onClick={() => {
                          const newComments = lessonForm.individual_comments.filter((_, i) => i !== idx);
                          setLessonForm({ ...lessonForm, individual_comments: newComments });
                        }}
                        className="mt-0.5 p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="이 코멘트 지우기"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => setLessonForm(prev => ({ ...prev, individual_comments: [...prev.individual_comments, { student_id: "", comment: "" }] }))}
                  className="w-full py-2.5 bg-white text-emerald-600 hover:bg-emerald-50 font-bold text-xs rounded-xl border-2 border-emerald-200 border-dashed transition-colors flex items-center justify-center gap-1.5 mt-1 shadow-sm"
                >
                  <span className="text-base leading-none">➕</span> 학생 특정 코멘트 추가하기
                </button>
              </div>

              <div className="flex flex-col gap-1.5 pt-4 border-t border-slate-200">
                <label className="text-sm font-black text-slate-500 flex items-center gap-1.5">
                  <span>🔒 강사 특이사항 메모</span>
                  <span className="text-[11px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded">(학부모 미노출)</span>
                </label>
                <textarea 
                  value={lessonForm.instructor_note} 
                  onChange={e => setLessonForm({...lessonForm, instructor_note: e.target.value})} 
                  rows={2}
                  className="border border-slate-300 p-3 w-full rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 bg-white shadow-sm resize-none placeholder-slate-300"
                  placeholder="강사들끼리만 공유할 태도 불량, 특별 케이스 등의 내용을 적어주세요." 
                />
              </div>

            </div>
            
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button onClick={() => setIsLessonLogModalOpen(false)} className="px-6 py-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-xl text-sm transition-colors shadow-sm">취소</button>
              <button onClick={handleLessonLogSubmit} className="px-6 py-3 bg-[#002864] hover:bg-blue-900 text-white font-black rounded-xl text-sm shadow-md transition-colors flex items-center gap-2">
                ✅ {lessonForm.lesson_log_id ? "수정 내용 저장" : "새 일지 등록 완료"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}