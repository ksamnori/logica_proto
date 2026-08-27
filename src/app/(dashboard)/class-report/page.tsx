// src/app/(dashboard)/class-report/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";

type ReportTabType = 'ALL' | 'EXAM' | 'HW' | 'PRINT' | 'SIMILAR';

interface ClassInfo {
  class_id: string;
  name: string;
  status?: string;
  schedule_days?: string;
  class_schedule?: any[];
}

interface AnalyzedItem {
  id: string;
  type: ReportTabType;
  sourceType: 'TEXTBOOK' | 'EXAM';
  title: string;
  date: string;
  totalQ: number;
  status: string;
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

interface MatrixRow {
  studentId: string;
  studentName: string;
  cells: Record<string, string>; 
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

export default function ClassReportPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ReportTabType>('ALL');
  
  const [assignments, setAssignments] = useState<AnalyzedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<AnalyzedItem | null>(null);
  
  const [matrixCols, setMatrixCols] = useState<MatrixCol[]>([]);
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [questionRates, setQuestionRates] = useState<Record<string, number>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isMatrixLoading, setIsMatrixLoading] = useState(false);

  const [modalQuestion, setModalQuestion] = useState<MatrixCol | null>(null);
  const mathJaxRef = useRef(false);

  // 반 목록 마우스 드래그 스크롤
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

  const handleMouseLeave = () => { setIsDragging(false); };
  const handleMouseUp = () => { setIsDragging(false); };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !classListRef.current) return;
    e.preventDefault();
    const x = e.pageX - classListRef.current.offsetLeft;
    const walk = (x - startX) * 1.5; 
    if (Math.abs(walk) > 5) setDragged(true); 
    classListRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleClassClick = (classId: string) => {
    if (dragged) return; 
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

  // 1. 소속 반 목록 가져오기 및 URL 파라미터 초기화
  useEffect(() => {
    // 🌟 대시보드에서 전달된 파라미터 캡치
    const searchParams = new URLSearchParams(window.location.search);
    const urlTab = searchParams.get('tab');
    if (urlTab && ['ALL', 'EXAM', 'HW', 'PRINT', 'SIMILAR'].includes(urlTab)) {
      setActiveTab(urlTab as ReportTabType);
    }

    const fetchClasses = async () => {
      const instId = localStorage.getItem('logica_instructor_id');
      const tenantId = localStorage.getItem('logica_tenant_id');
      const role = localStorage.getItem('logica_instructor_role');
      const pos = localStorage.getItem('logica_instructor_position') || '';
      
      const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('원장') || pos.includes('최고관리자');

      let query = supabase.from('class').select('class_id, name, status, schedule_days, class_schedule(day_of_week, start_time, end_time)').order('name');
      if (tenantId && tenantId !== 'hq') query = query.eq('tenant_id', tenantId);
      if (!isAdmin && instId) query = query.eq('instructor_id', instId);

      const { data } = await query;
      if (data && data.length > 0) {
        const activeClasses = data.filter((c: any) => c.status !== "종료" && c.status !== "폐강");
        setClasses(activeClasses);

        // 🌟 파라미터에 class_id가 있으면 해당 반으로 자동 선택
        const urlClassId = searchParams.get('class_id');
        if (urlClassId && activeClasses.some((c: any) => c.class_id === urlClassId)) {
          setSelectedClassId(urlClassId);
          
          // 🌟 선택된 반 버튼 위치로 가로 스크롤 부드럽게 이동
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

  // 2. 선택된 반의 문제지 리스트 및 상태 가져오기
  useEffect(() => {
    if (!selectedClassId) return;

    const fetchAssignments = async () => {
      setIsLoading(true);
      try {
        let list: AnalyzedItem[] = [];

        const { data: examData } = await supabase
          .from('exam_assignment')
          .select('exam_id, status, created_at, exam_master!inner(title, exam_type, total_questions)')
          .eq('class_id', selectedClassId);

        if (examData) {
          const uniqueExams = new Map<string, any>();
          examData.forEach((a: any) => {
            if (!uniqueExams.has(a.exam_id)) {
              uniqueExams.set(a.exam_id, {
                id: a.exam_id,
                date: a.created_at,
                master: Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master,
                statuses: [a.status]
              });
            } else {
              uniqueExams.get(a.exam_id).statuses.push(a.status);
            }
          });

          uniqueExams.forEach((val) => {
            let type: ReportTabType = 'EXAM';
            const eType = val.master?.exam_type;
            if (['과제', '과제프린트'].includes(eType)) type = 'HW';
            else if (['오답프린트', '오답'].includes(eType)) type = 'PRINT';
            else if (['오답유사', '과제오답유사'].includes(eType)) type = 'SIMILAR';

            const isAllDone = val.statuses.every((s: string) => ['제출완료', '채점완료', '완료'].includes(s));

            list.push({
              id: val.id,
              type: type,
              sourceType: 'EXAM',
              title: val.master?.title || '제목 없음',
              date: val.date,
              totalQ: val.master?.total_questions || 0,
              status: isAllDone ? '완료' : '진행중'
            });
          });
        }

        const { data: hwData } = await supabase
          .from('homework_assignment')
          .select('homework_id, homework_title, created_at, target_questions, student_homework_result(status)')
          .eq('class_id', selectedClassId)
          .neq('homework_title', '[시스템] 수업 진도 완료 기록');

        if (hwData) {
          hwData.forEach((hw: any) => {
            const tqs = safeParseIds(hw.target_questions);
            
            let isAllDone = false;
            if (hw.student_homework_result && hw.student_homework_result.length > 0) {
               isAllDone = hw.student_homework_result.every((r: any) => ['제출완료', '채점완료', '완료'].includes(r.status));
            }

            list.push({
              id: String(hw.homework_id),
              type: 'HW',
              sourceType: 'TEXTBOOK',
              title: hw.homework_title || '교재 과제',
              date: hw.created_at,
              totalQ: tqs.length || 0,
              status: isAllDone ? '완료' : '진행중'
            });
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

    fetchAssignments();
  }, [selectedClassId]);

  // 3. 문항 분석 매트릭스 및 개별 학생 상태 구성하기
  useEffect(() => {
    if (!selectedItem || !selectedClassId) return;

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

        if (selectedItem.sourceType === 'TEXTBOOK') {
          const { data: hwData } = await supabase.from('homework_assignment').select('target_questions').eq('homework_id', selectedItem.id).single();
          let tqs = safeParseIds(hwData?.target_questions); 
          if (!Array.isArray(tqs)) tqs = []; 
          
          let tqDetails: any[] = [];
          for (let i = 0; i < tqs.length; i += 150) {
            const chunk = tqs.slice(i, i + 150);
            const { data } = await supabase.from('textbook_question').select('*, question_db(*)').in('tq_id', chunk);
            if (data) tqDetails = [...tqDetails, ...data];
          }

          const tqMap = new Map();
          tqDetails.forEach(tq => tqMap.set(String(tq.tq_id), tq));

          cols = tqs.map((tqId, idx) => {
            const tq = tqMap.get(String(tqId)) || {};
            const q = tq.question_db || {};
            return {
              qId: String(tqId),
              displayNum: `${idx + 1}`,
              page: tq.page_number || q.page_number || q.final_printed_page || q.detected_page_num || '',
              number: tq.question_number || q.question_number || '',
              questionText: tq.question || q.question || '',
              imageUrl: q.image_url || tq.image_url || '',
              answer: tq.answer || q.answer || ''
            };
          });

          const { data: answers } = await supabase.from('student_homework_answer').select('student_id, tq_id, grading_code').eq('homework_id', selectedItem.id);
          answers?.forEach((a: any) => {
            const row = rowsMap.get(String(a.student_id));
            if (row) row.cells[String(a.tq_id)] = a.grading_code;
          });

          const { data: hwResults } = await supabase.from('student_homework_result').select('student_id, status').eq('homework_id', selectedItem.id);
          hwResults?.forEach((r: any) => {
             const row = rowsMap.get(String(r.student_id));
             if (row) row.status = r.status || '진행중';
          });

        } else {
          const { data: items } = await supabase.from('exam_item').select('question_id, sort_order').eq('exam_id', selectedItem.id).order('sort_order');
          const qIds = items?.map(i => i.question_id) || [];

          let qDetails: any[] = [];
          for (let i = 0; i < qIds.length; i += 150) {
            const chunk = qIds.slice(i, i + 150);
            const { data } = await supabase.from('question_db').select('*').in('question_id', chunk);
            if (data) qDetails = [...qDetails, ...data];
          }

          const qMap = new Map();
          qDetails.forEach(q => qMap.set(String(q.question_id), q));

          cols = (items || []).map((item: any, idx: number) => {
            const q = qMap.get(String(item.question_id)) || {};
            return {
              qId: String(item.question_id),
              displayNum: `${idx + 1}`,
              page: q.page_number || q.final_printed_page || q.detected_page_num || '',
              number: q.question_number || '',
              questionText: q.question || '',
              imageUrl: q.image_url || '',
              answer: q.answer || ''
            };
          });

          const { data: assigns } = await supabase.from('exam_assignment').select('assignment_id, student_id, status').eq('exam_id', selectedItem.id).eq('class_id', selectedClassId);
          const assignMap = new Map<string, string>();
          
          assigns?.forEach((a: any) => {
            assignMap.set(a.assignment_id, a.student_id);
            const row = rowsMap.get(String(a.student_id));
            if (row) row.status = a.status || '미응시';
          });

          if (assigns && assigns.length > 0) {
            const assignIds = assigns.map((a: any) => a.assignment_id);
            const { data: answers } = await supabase.from('student_answer').select('exam_assignment_id, question_id, grading_code').in('exam_assignment_id', assignIds);

            answers?.forEach((a: any) => {
              const sId = assignMap.get(a.exam_assignment_id);
              if (sId) {
                const row = rowsMap.get(String(sId));
                if (row) row.cells[String(a.question_id)] = a.grading_code;
              }
            });
          }
        }

        const rates: Record<string, number> = {};
        cols.forEach(col => {
          let correctCount = 0;
          let attemptCount = 0;
          rowsMap.forEach(row => {
            const code = row.cells[col.qId];
            if (code && code !== 'B') {
              attemptCount++;
              if (['O', 'TO', 'RO'].includes(code)) correctCount++;
            }
          });
          rates[col.qId] = attemptCount > 0 ? Math.round((correctCount / attemptCount) * 100) : 0;
        });

        const finalRows = Array.from(rowsMap.values()).map(row => {
          let cCount = 0;
          cols.forEach(col => { if (['O', 'TO', 'RO'].includes(row.cells[col.qId])) cCount++; });
          return { ...row, totalCorrect: cCount };
        }).sort((a, b) => a.studentName.localeCompare(b.studentName));

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
  }, [selectedItem, selectedClassId]);

  const filteredAssignments = useMemo(() => {
    if (activeTab === 'ALL') return assignments;
    return assignments.filter(a => a.type === activeTab);
  }, [assignments, activeTab]);

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const getCellUI = (code: string) => {
    if (!code) return <span className="text-slate-300">-</span>;
    if (['O', 'TO', 'RO'].includes(code)) return <span className="text-emerald-500 font-black">{code}</span>;
    if (['X', 'TX'].includes(code)) return <span className="text-rose-500 font-black">{code}</span>;
    if (code === '☆') return <span className="text-amber-500 font-black">☆</span>;
    if (code === 'B') return <span className="text-slate-400 font-black">B</span>;
    return <span className="text-blue-500 font-black">{code}</span>;
  };

  const getTypeBadge = (type: ReportTabType) => {
    switch (type) {
      case 'EXAM': return <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-blue-200">시험</span>;
      case 'HW': return <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-amber-200">과제</span>;
      case 'PRINT': return <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-emerald-200">오답</span>;
      case 'SIMILAR': return <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded text-[10px] font-black shrink-0 border border-violet-200">유사</span>;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative font-pretendard">
      
      {/* 상단 헤더 및 반 선택 가로 스크롤 영역 */}
      <div className="flex flex-col gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-black text-[#002864] tracking-tight flex items-center gap-2">
            <span>📊</span> 반별 문항 분석 및 학습 결과
          </h2>
          <p className="text-sm font-bold text-slate-500 mt-1.5">
            반 전체 학생의 정오답(O, X, ☆ 등) 결과를 문항별로 한눈에 비교하고 취약점을 분석합니다.
          </p>
        </div>

        <div 
          ref={classListRef}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          className={`flex gap-2.5 overflow-x-auto pb-2 pt-1 min-h-[70px] select-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          {classes.length === 0 ? <span className="text-sm font-bold text-slate-400 py-2">배정된 반이 없습니다.</span> :
            classes.map((c) => {
              let scheduleStr = "시간표 미설정";
              
              const scheduleArr = c.class_schedule;
              if (scheduleArr && scheduleArr.length > 0) {
                const days = ["월", "화", "수", "목", "금", "토", "일"];
                const sortedSchedule = [...scheduleArr].sort((a: any, b: any) => days.indexOf(a.day_of_week) - days.indexOf(b.day_of_week));
                scheduleStr = sortedSchedule.map((sc: any) => {
                  const st = sc.start_time?.substring(0, 5) || ""; const et = sc.end_time?.substring(0, 5) || "";
                  return et ? `${sc.day_of_week} ${st}~${et}` : `${sc.day_of_week} ${st}`;
                }).join(", ");
              } else if (c.schedule_days) {
                scheduleStr = c.schedule_days;
              }

              const isActive = selectedClassId === c.class_id;
              return (
                <button 
                  key={c.class_id} 
                  data-class-id={c.class_id} // 🌟 자동 스크롤을 위한 식별자 추가
                  onClick={() => handleClassClick(c.class_id)}
                  className={`px-4 py-2 rounded-xl border-2 shadow-sm flex flex-col items-start transition-all text-left min-w-[140px] max-w-[200px] shrink-0 ${isActive ? "bg-[#002864] text-white border-[#002864] transform scale-[1.02]" : "bg-white text-slate-500 border-transparent hover:border-slate-300 hover:text-slate-700"}`}
                >
                  <span className="text-sm font-extrabold tracking-tight leading-tight truncate w-full">{c.name}</span>
                  <span className="text-[10px] mt-0.5 font-medium opacity-80 leading-none tracking-tight whitespace-nowrap truncate w-full">{scheduleStr}</span>
                </button>
              );
            })
          }
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        
        {/* 좌측 패널 */}
        <div className="w-[340px] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm shrink-0 overflow-hidden">
          <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center gap-1.5 overflow-x-auto custom-scrollbar shrink-0">
            <button onClick={() => setActiveTab('ALL')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${activeTab === 'ALL' ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>전체</button>
            <button onClick={() => setActiveTab('EXAM')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${activeTab === 'EXAM' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>💯 시험</button>
            <button onClick={() => setActiveTab('HW')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${activeTab === 'HW' ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>📝 과제</button>
            <button onClick={() => setActiveTab('PRINT')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${activeTab === 'PRINT' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>❌ 오답</button>
            <button onClick={() => setActiveTab('SIMILAR')} className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${activeTab === 'SIMILAR' ? 'bg-violet-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>🔄 유사</button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5 bg-slate-50/50">
            {isLoading ? (
              <div className="py-10 text-center text-sm font-bold text-slate-400">목록을 불러오는 중...</div>
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
                    {/* 항목 상태 배지 */}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${item.status === '완료' ? 'bg-slate-100 text-slate-400' : 'bg-rose-500 text-white shadow-sm'}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className={`font-extrabold text-[13px] leading-snug line-clamp-2 ${selectedItem?.id === item.id ? 'text-white' : 'text-slate-800'}`}>
                    {item.title.replace(/^\[시스템\]\s*/, '')}
                  </div>
                  <div className={`mt-2 text-[11px] font-bold ${selectedItem?.id === item.id ? 'text-blue-200' : 'text-slate-500'}`}>
                    총 {item.totalQ}문항
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 우측 패널: 분석표 */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          {!selectedItem ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <span className="text-5xl mb-4">👈</span>
              <p className="font-extrabold text-lg">좌측에서 분석할 시험지나 과제를 선택해주세요.</p>
            </div>
          ) : isMatrixLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="font-bold text-sm">학생별 정오답 데이터를 분석 중입니다...</p>
            </div>
          ) : matrixCols.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <p className="font-bold text-sm">해당 문제지에 문항 데이터가 없습니다.</p>
            </div>
          ) : (
            <>
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    {getTypeBadge(selectedItem.type)} {selectedItem.title.replace(/^\[시스템\]\s*/, '')}
                  </h3>
                  <div className="text-xs font-bold text-slate-500 mt-1 flex gap-3">
                    <span>📅 출제일: {formatDateLabel(selectedItem.date)}</span>
                    <span>📝 총 {matrixCols.length}문항</span>
                    <span>👥 수강생 {matrixRows.length}명</span>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-[10px] font-bold text-slate-600">정답</span></div>
                  <div className="flex items-center gap-1 ml-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span><span className="text-[10px] font-bold text-slate-600">오답</span></div>
                  <div className="flex items-center gap-1 ml-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="text-[10px] font-bold text-slate-600">☆ (질문)</span></div>
                  <div className="flex items-center gap-1 ml-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span><span className="text-[10px] font-bold text-slate-600">B (빈칸)</span></div>
                </div>
              </div>

              <div className="flex-1 overflow-auto custom-scroll relative">
                <table className="w-max border-collapse">
                  <thead className="sticky top-0 z-20 shadow-sm">
                    <tr>
                      <th className="sticky left-0 z-30 bg-slate-200 p-3 min-w-[150px] w-[150px] max-w-[150px] border-r border-b text-center align-middle shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                        <span className="text-xs font-extrabold text-slate-600">학생명</span>
                      </th>
                      <th className="bg-slate-100 p-3 min-w-[80px] w-[80px] max-w-[80px] border-r border-b text-center align-middle shadow-sm">
                        <span className="text-xs font-extrabold text-slate-600">정답 수</span>
                      </th>
                      
                      {matrixCols.map(col => (
                        <th key={col.qId} className="bg-[#002864] p-2 min-w-[70px] w-[70px] border-r border-b border-blue-800 text-center align-middle">
                          <div className="flex flex-col items-center justify-center gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-[13px] font-black text-white">{col.displayNum}</span>
                              <button onClick={() => setModalQuestion(col)} className="text-[11px] text-blue-300 hover:text-white transition-colors leading-none" title="문제 상세 보기">🔍</button>
                            </div>
                            {(col.page || col.number) && (
                              <span className="text-[9px] font-bold text-blue-300 whitespace-nowrap tracking-tighter">
                                {col.page ? `p.${col.page}` : ''}{col.page && col.number ? '-' : ''}{col.number ? `${col.number}번` : ''}
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
                      return (
                        <tr key={row.studentId} className={`hover:bg-blue-50/50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                          <td className="sticky left-0 z-10 bg-white p-2 border-r border-b shadow-[2px_0_5px_rgba(0,0,0,0.02)] align-middle text-center font-extrabold text-[13px] text-slate-800 min-w-[150px] w-[150px] max-w-[150px] group-hover:bg-blue-50/50">
                            <div className="flex flex-col items-center justify-center gap-1 w-full">
                              <span className="truncate w-full text-center">{row.studentName}</span>
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${isCompleted ? 'text-slate-400 bg-slate-100' : 'text-rose-500 bg-rose-50 border border-rose-100'}`}>
                                {row.status || '미제출'}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 border-r border-b text-center align-middle min-w-[80px] w-[80px] max-w-[80px]">
                            <span className="text-xs font-black text-[#002864] bg-blue-50 px-2 py-1 rounded border border-blue-100 whitespace-nowrap">
                              {row.totalCorrect} / {matrixCols.length}
                            </span>
                          </td>
                          {matrixCols.map(col => (
                            <td key={col.qId} className="p-2 border-r border-b text-center align-middle text-[13px] min-w-[70px] w-[70px]">
                              {getCellUI(row.cells[col.qId])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
                    <tr>
                      <th colSpan={2} className="sticky left-0 z-30 bg-slate-800 p-3 border-r border-t border-slate-700 text-center align-middle">
                        <span className="text-xs font-black text-white">문항별 정답률</span>
                      </th>
                      {matrixCols.map(col => {
                        const rate = questionRates[col.qId] || 0;
                        let rateColor = "text-white";
                        if (rate < 50) rateColor = "text-rose-400"; 
                        else if (rate >= 80) rateColor = "text-emerald-400"; 

                        return (
                          <th key={col.qId} className="bg-slate-800 p-2 border-r border-t border-slate-700 text-center align-middle min-w-[70px] w-[70px]">
                            <span className={`text-[11px] font-black ${rateColor}`}>{rate}%</span>
                          </th>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
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
    </div>
  );
}