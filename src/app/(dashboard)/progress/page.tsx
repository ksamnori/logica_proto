// src/app/(dashboard)/progress/page.tsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import QuestionModal from "@/components/progress/QuestionModal";
import ProgressDetailModal from "@/components/progress/ProgressDetailModal";

interface TextbookInfo {
  title: string;
  book_type: string;
}

interface ClassTextbookRow {
  book_id: string; 
  textbook: TextbookInfo | TextbookInfo[] | null;
}

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

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

export default function ProgressPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  
  const [textbooks, setTextbooks] = useState<ClassTextbookRow[]>([]);
  const [workbooks, setWorkbooks] = useState<ClassTextbookRow[]>([]);
  
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [enrolledStudentIds, setEnrolledStudentIds] = useState<string[]>([]);

  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [selectedWbId, setSelectedWbId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  
  const [activeMainPage, setActiveMainPage] = useState<number | null>(null);
  const [activeWbPage, setActiveWbPage] = useState<number | null>(null);

  const [allQuestions, setAllQuestions] = useState<any[]>([]);
  const [workbookQuestions, setWorkbookQuestions] = useState<any[]>([]);
  
  const [mainPages, setMainPages] = useState<number[]>([]);
  const [wbPages, setWbPages] = useState<number[]>([]);
  
  const [groupedMainQs, setGroupedMainQs] = useState<{ [key: number]: any[] }>({});
  const [groupedWbQs, setGroupedWbQs] = useState<{ [key: number]: any[] }>({});
  
  const [statusMap, setStatusMap] = useState<{ [key: string]: string }>({});

  const [isLoading, setIsLoading] = useState(false);
  const [modalQuestion, setModalQuestion] = useState<any>(null);
  const [toastMsg, setToastMsg] = useState("");
  const mathJaxRef = useRef<boolean>(false);

  const [progressModalData, setProgressModalData] = useState<any>(null);
  const [classScheduleInfo, setClassScheduleInfo] = useState<{days: string[], holidays: string[], extras: string[]}>({days: [], holidays: [], extras: []});

  const [checkedMainPages, setCheckedMainPages] = useState<number[]>([]);
  const [checkedWbPages, setCheckedWbPages] = useState<number[]>([]);
  const [checkedMainQs, setCheckedMainQs] = useState<number[]>([]);
  const [checkedWbQs, setCheckedWbQs] = useState<number[]>([]);

  const actionQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isTeacherMode = role === 'TEACHER';
      
      const isGodMode = !isTeacherMode && (
        role === 'SUPER_ADMIN' || role === 'ADMIN' || 
        pos.includes('최고관리자') || pos.includes('원장') || pos.includes('대장')
      );

      if (isGodMode) { setIsAuthorized(true); return; }

      if (!tId || !role) { router.replace("/home"); return; }
      const { data } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).maybeSingle();
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/progress"))) {
        alert("⛔ 진도 관리 페이지에 접근할 권한이 없습니다."); router.replace("/home");
      } else { setIsAuthorized(true); }
    };
    checkAccess();
  }, [router]);

  useEffect(() => { if (isAuthorized) { fetchInitialClasses(); loadMathJax(); } }, [isAuthorized]);
  useEffect(() => { if (!selectedClassId) return; fetchClassDetails(selectedClassId); }, [selectedClassId]);

  useEffect(() => {
    if (selectedBookId || selectedWbId) {
      fetchQuestions(selectedBookId, selectedWbId);
    } else {
      setAllQuestions([]); setWorkbookQuestions([]);
      setMainPages([]); setWbPages([]); 
      setGroupedMainQs({}); setGroupedWbQs({}); 
      setActiveMainPage(null); setActiveWbPage(null);
    }
  }, [selectedBookId, selectedWbId]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [activeMainPage, activeWbPage, selectedStudentId, selectedBookId, selectedWbId]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(""), 2500); };

  const fetchInitialClasses = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tId = localStorage.getItem("logica_tenant_id") || "";

    const isTeacherMode = role === 'TEACHER';

    const isAdmin = !isTeacherMode && (
      ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || 
      pos.includes("최고관리자") || pos.includes("원장") || pos.includes("실장")
    );
    
    let query = supabase.from("class").select("class_id, name, level_name").order("name");
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
    
    if (!isAdmin && instId) query = query.eq("instructor_id", instId);
    
    const { data } = await query;
    if (data) setClasses(data);
  };

  const fetchClassDetails = async (classId: string) => {
    try {
      const [
        { data: classBooks }, 
        { data: directStudents }, 
        { data: enrolls },
        { data: classData },
        { data: holidayData },
        { data: extraData }
      ] = await Promise.all([
        supabase.from("class_textbook").select("book_id, textbook(title, book_type)").eq("class_id", classId),
        supabase.from("student").select("student_id, name").eq("class_id", classId),
        supabase.from("enrollment").select("student_id, student(name, status)").eq("class_id", classId),
        supabase.from("class").select("class_schedule(day_of_week)").eq("class_id", classId).maybeSingle(),
        supabase.from("class_holiday").select("holiday_date").eq("class_id", classId),
        supabase.from("class_extra_session").select("session_date").eq("class_id", classId)
      ]);

      const days = classData?.class_schedule?.map((s: any) => s.day_of_week) || [];
      const hols = holidayData?.map((h: any) => h.holiday_date) || [];
      const extras = extraData?.map((e: any) => e.session_date) || [];
      setClassScheduleInfo({ days, holidays: hols, extras });

      const typedClassBooks = classBooks as unknown as ClassTextbookRow[];
      const mains: ClassTextbookRow[] = []; 
      const wbs: ClassTextbookRow[] = [];
      
      typedClassBooks?.forEach(cb => {
        const tb = unwrap(cb.textbook);
        if (!tb) return;
        if (tb.book_type === "워크북" || tb.book_type === "과제") wbs.push(cb);
        else mains.push(cb);
      });
      
      setTextbooks(mains); setWorkbooks(wbs);
      if (!mains.find(b => b.book_id === selectedBookId)) setSelectedBookId("");
      if (!wbs.find(b => b.book_id === selectedWbId)) setSelectedWbId("");

      const sMap = new Map();
      directStudents?.forEach(s => sMap.set(s.student_id, s.name));
      enrolls?.forEach((e: any) => {
        if (e.student && e.student.status === '재원') {
          const sName = Array.isArray(e.student) ? e.student[0]?.name : e.student.name;
          sMap.set(e.student_id, sName);
        }
      });

      const sList = Array.from(sMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      setStudents(sList);
      setEnrolledStudentIds(sList.map(s => s.id));
      setSelectedStudentId("all");
      
      await loadStatusMapDB(classId, sList.map(s => s.id));
    } catch (e) { console.error("클래스 데이터 페칭 에러:", e); }
  };

  const fetchQuestions = async (bookId: string, wbId: string) => {
    setIsLoading(true);
    try {
      if (bookId) {
        const { data: mainData, error: mainErr } = await supabase.from("textbook_question").select("*").eq("book_id", bookId).order("page_number", { ascending: true }).order("tq_id", { ascending: true });
        if (mainErr) throw mainErr;

        const grouped = (mainData || []).reduce((acc: any, q: any) => {
          const pNum = q.page_number || 0;
          if (!acc[pNum]) acc[pNum] = [];
          acc[pNum].push(q); return acc;
        }, {});

        const sortedPages = Object.keys(grouped).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);
        setAllQuestions(mainData || []); setGroupedMainQs(grouped); setMainPages(sortedPages);
        if (sortedPages.length > 0) setActiveMainPage(sortedPages[0]);
      } else {
        setAllQuestions([]); setGroupedMainQs({}); setMainPages([]); setActiveMainPage(null);
      }
      
      setCheckedMainPages([]); setCheckedMainQs([]);

      if (wbId) {
        const { data: wbData, error: wbErr } = await supabase.from("textbook_question").select("*").eq("book_id", wbId).order("page_number", { ascending: true }).order("tq_id", { ascending: true });
        if (wbErr) throw wbErr;

        const wbGrouped = (wbData || []).reduce((acc: any, q: any) => {
          const pNum = q.page_number || 0;
          if (!acc[pNum]) acc[pNum] = [];
          acc[pNum].push(q); return acc;
        }, {});
        
        const sortedWbPages = Object.keys(wbGrouped).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);
        setWorkbookQuestions(wbData || []); setGroupedWbQs(wbGrouped); setWbPages(sortedWbPages);
        if (sortedWbPages.length > 0) setActiveWbPage(sortedWbPages[0]);
      } else {
        setWorkbookQuestions([]); setGroupedWbQs({}); setWbPages([]); setActiveWbPage(null);
      }

      setCheckedWbPages([]); setCheckedWbQs([]); 

    } catch (e) { console.error("fetchQuestions 에러:", e); } finally { setIsLoading(false); }
  };

  const getStatusKey = (tq_id: number, sId: string) => `${selectedClassId}_${tq_id}_${sId}`;

  const loadStatusMapDB = async (classId: string, studentIds: string[]) => {
    try {
      const { data: assignments, error } = await supabase
        .from('homework_assignment')
        .select('homework_id, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids, status)')
        .eq('class_id', classId);
        
      const { data: examAssignments } = await supabase
        .from('exam_assignment')
        .select(`
          assignment_id, student_id, status,
          exam_master!inner(
            exam_type,
            exam_item(question_id)
          )
        `)
        .eq('class_id', classId)
        .in('exam_master.exam_type', ['과제', '과제프린트']);

      if (error) throw error;

      const newMap: { [key: string]: string } = {};
      const tqStudentStatus: Record<number, Record<string, string>> = {};

      assignments?.forEach((hw: any) => {
        const targetQs = safeParseIds(hw.target_questions);
        
        if (hw.target_student_id) {
          targetQs.forEach((tqId: number) => {
            if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
            if (tqStudentStatus[tqId][hw.target_student_id] !== 'done') {
              tqStudentStatus[tqId][hw.target_student_id] = 'homework';
            }
          });
        } else {
           studentIds.forEach(sId => {
              targetQs.forEach((tqId: number) => {
                if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
                if (tqStudentStatus[tqId][sId] !== 'done') {
                  tqStudentStatus[tqId][sId] = 'homework';
                }
              });
           });
        }

        hw.student_homework_result?.forEach((res: any) => {
          const sId = res.student_id;
          const isFullyDone = ['채점완료', '제출완료', '완료'].includes(res.status);

          if (isFullyDone) {
            targetQs.forEach((tqId: number) => {
              if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
              tqStudentStatus[tqId][sId] = 'done';
            });
          }

          const completedQs = safeParseIds(res.completed_tq_ids);
          completedQs.forEach((tqId: number) => {
            if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
            tqStudentStatus[tqId][sId] = 'done';
          });
        });
      });

      const examQuestionIds = new Set<number>();
      examAssignments?.forEach((ea: any) => {
         const m = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
         const items = m?.exam_item || [];
         items.forEach((item: any) => {
             if (item.question_id) examQuestionIds.add(item.question_id);
         });
      });

      const qIdToTqId = new Map<number, number>();
      if (examQuestionIds.size > 0) {
          const { data: tqMapping } = await supabase
              .from('textbook_question')
              .select('tq_id, question_id')
              .in('question_id', Array.from(examQuestionIds));
          
          tqMapping?.forEach(t => {
              if (t.question_id) qIdToTqId.set(t.question_id, t.tq_id);
          });
      }

      examAssignments?.forEach((ea: any) => {
         const sId = ea.student_id;
         const isDone = ['채점완료', '제출완료', '완료'].includes(ea.status);
         const m = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
         const items = m?.exam_item || [];

         items.forEach((item: any) => {
             const tqId = qIdToTqId.get(item.question_id);
             if (tqId) {
                 if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
                 const currentSt = tqStudentStatus[tqId][sId];
                 if (currentSt !== 'done') {
                     tqStudentStatus[tqId][sId] = isDone ? 'done' : 'homework';
                 }
             }
         });
      });

      const totalStudents = studentIds.length;
      
      Object.keys(tqStudentStatus).forEach(tqIdStr => {
        const tqId = Number(tqIdStr);
        let doneCount = 0;
        let hwCount = 0;
        let partialC = 0;

        studentIds.forEach(sId => {
          const st = tqStudentStatus[tqId]?.[sId];
          if (st) {
            newMap[getStatusKey(tqId, sId)] = st; 
            if (st === 'done') doneCount++;
            else if (st === 'homework') hwCount++;
            else if (st === 'partial') partialC++;
          }
        });

        if (totalStudents > 0) {
          if (doneCount >= totalStudents) {
            newMap[getStatusKey(tqId, 'all')] = 'done';
          } else if (doneCount > 0) {
            newMap[getStatusKey(tqId, 'all')] = 'partial';
          } else if (hwCount >= totalStudents) {
            newMap[getStatusKey(tqId, 'all')] = 'partial';
          } else if (hwCount > 0) {
            newMap[getStatusKey(tqId, 'all')] = 'partial';
          }
        }
      });

      setStatusMap(newMap);
    } catch (e: any) { 
      console.error("loadStatusMapDB 에러:", e.message || e); 
    }
  };

  const saveHomeworkToDB = async (bookId: string, tq_ids: number[], isWorkbook: boolean) => {
    if (!tq_ids.length || !bookId) return;

    const kstNowMs = Date.now() + 9 * 3600000;
    const kstNowDate = new Date(kstNowMs);
    const y = kstNowDate.getUTCFullYear();
    const m = String(kstNowDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kstNowDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const expectedTitle = `[시스템] ${isWorkbook ? '워크북 과제' : '본교재 과제'} (${dateStr})`;

    const getNextSessionDueDate = () => {
      const { days, holidays, extras } = classScheduleInfo;
      
      const getFallback = () => {
        const fbDate = new Date(kstNowMs + 7 * 24 * 3600000);
        return `${fbDate.getUTCFullYear()}-${String(fbDate.getUTCMonth()+1).padStart(2,'0')}-${String(fbDate.getUTCDate()).padStart(2,'0')}T22:00:00+09:00`;
      };

      if (days.length === 0 && extras.length === 0) return getFallback();

      const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
      let cursorMs = kstNowMs;
      
      for (let i = 1; i <= 30; i++) {
        cursorMs += 24 * 3600000;
        const targetDate = new Date(cursorMs);
        const ty = targetDate.getUTCFullYear();
        const tm = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const td = String(targetDate.getUTCDate()).padStart(2, '0');
        const ymd = `${ty}-${tm}-${td}`;
        const dayLabel = DAY_LABELS[targetDate.getUTCDay()];

        if (extras.includes(ymd) || (days.includes(dayLabel) && !holidays.includes(ymd))) {
          return `${ymd}T22:00:00+09:00`;
        }
      }
      return getFallback();
    };

    const nextSessionStr = getNextSessionDueDate();

    const { data: todayHws } = await supabase.from('homework_assignment')
      .select('homework_id, target_questions, target_student_id, homework_title, due_date')
      .eq('class_id', selectedClassId)
      .eq('book_id', bookId)
      .not('homework_title', 'eq', '[시스템] 수업 진도 완료 기록')
      .gte('created_at', `${dateStr}T00:00:00+09:00`)
      .lte('created_at', `${dateStr}T23:59:59.999+09:00`);

    const individualHws = todayHws?.filter(hw => hw.target_student_id !== null) || [];
    let baseDueDate = individualHws.length > 0 ? individualHws[0].due_date : nextSessionStr;

    const targetStudentIds = selectedStudentId === 'all' ? enrolledStudentIds : [selectedStudentId];

    for (const stuId of targetStudentIds) {
      const indHwsForStudent = individualHws.filter(hw => hw.target_student_id === stuId);
      let targetHwToMerge = null;

      for (const hw of indHwsForStudent) {
        const { data: resData } = await supabase.from('student_homework_result')
          .select('status')
          .eq('homework_id', hw.homework_id)
          .eq('student_id', stuId)
          .maybeSingle();
          
        if (resData && !['채점완료', '제출완료', '완료'].includes(resData.status)) {
          targetHwToMerge = hw;
          break; 
        }
      }
      
      if (targetHwToMerge) {
        const existingInd = safeParseIds(targetHwToMerge.target_questions);
        const combinedTqs = Array.from(new Set([...existingInd, ...tq_ids]));
        
        await supabase.from('homework_assignment')
          .update({ target_questions: combinedTqs, due_date: baseDueDate })
          .eq('homework_id', targetHwToMerge.homework_id);
          
      } else {
        const { data: insData, error: insErr } = await supabase.from('homework_assignment').insert({
          book_id: bookId, 
          target_questions: tq_ids, 
          class_id: selectedClassId, 
          target_student_id: stuId,
          due_date: baseDueDate, 
          homework_title: expectedTitle
        }).select('homework_id').single();
        
        if (insErr) throw insErr;

        await supabase.from('student_homework_result').insert({ 
          homework_id: insData.homework_id, 
          student_id: stuId, 
          status: '미제출', 
          completed_tq_ids: [] 
        });
      }
    }
  };

  const markProgressAsCompleteInDB = async (tq_ids: number[], targetStudentIds: string[], bookId: string) => {
    try {
      if (!tq_ids.length || !bookId || !targetStudentIds.length) return;

      await Promise.all(targetStudentIds.map(async (sId) => {
        let { data: existing, error: existingErr } = await supabase.from('homework_assignment')
          .select('homework_id')
          .eq('class_id', selectedClassId)
          .eq('book_id', bookId)
          .eq('target_student_id', sId)
          .eq('homework_title', '[시스템] 수업 진도 완료 기록')
          .limit(1);
          
        if (existingErr) throw existingErr;

        let hwId: number;
        if (existing && existing.length > 0) {
          hwId = existing[0].homework_id;
        } else {
          const { data: ins, error: insErr } = await supabase.from('homework_assignment').insert({
            book_id: bookId, target_questions: [], due_date: '2099-12-31T22:00:00+09:00', homework_title: '[시스템] 수업 진도 완료 기록', class_id: selectedClassId, target_student_id: sId
          }).select('homework_id').single();
          
          if (insErr) throw insErr;
          hwId = ins.homework_id;
        }

        const { data: res } = await supabase.from('student_homework_result').select('hw_result_id, completed_tq_ids').eq('homework_id', hwId).eq('student_id', sId).maybeSingle();
        if (res) {
          const comp = safeParseIds(res.completed_tq_ids);
          const newComp = Array.from(new Set([...comp, ...tq_ids]));
          await supabase.from('student_homework_result').update({ completed_tq_ids: newComp, status: '채점완료' }).eq('hw_result_id', res.hw_result_id);
        } else {
          await supabase.from('student_homework_result').insert({ homework_id: hwId, student_id: sId, status: '채점완료', completed_tq_ids: tq_ids });
        }
      }));
    } catch (e: any) {
      console.error("markProgressAsCompleteInDB 에러:", e.message || e);
    }
  };

  const cancelProgressForIds = async (tqIds: number[], targetStudentIds: string[]) => {
    try {
      if (!tqIds.length || !selectedClassId || !targetStudentIds.length) return;
      
      const { data: assignments, error: getErr } = await supabase.from('homework_assignment')
        .select('homework_id, target_questions, homework_title, target_student_id')
        .eq('class_id', selectedClassId);
      if (getErr) return;
      
      for (const hw of (assignments || [])) {
        if (hw.target_student_id && !targetStudentIds.includes(hw.target_student_id)) continue;

        const { data: results } = await supabase.from('student_homework_result')
          .select('student_id, completed_tq_ids')
          .eq('homework_id', hw.homework_id)
          .in('student_id', targetStudentIds);
          
        if (results) {
          for (const r of results) {
            const comp = safeParseIds(r.completed_tq_ids);
            const newComp = comp.filter((id: number) => !tqIds.includes(id));
            if (newComp.length !== comp.length) {
              await supabase.from('student_homework_result').update({ completed_tq_ids: newComp }).eq('homework_id', hw.homework_id).eq('student_id', r.student_id);
            }
          }
        }

        if (hw.target_student_id !== null && targetStudentIds.includes(hw.target_student_id)) {
            const tqArr = safeParseIds(hw.target_questions);
            const remaining = tqArr.filter((id: number) => !tqIds.includes(id));
            const targetChanged = remaining.length !== tqArr.length;

            const { data: allResultsCheck } = await supabase.from('student_homework_result').select('completed_tq_ids').eq('homework_id', hw.homework_id);
            let allResultsEmpty = true;
            allResultsCheck?.forEach(r => {
                if (safeParseIds(r.completed_tq_ids).length > 0) allResultsEmpty = false;
            });

            if (remaining.length === 0 && allResultsEmpty && hw.homework_title !== '[시스템] 수업 진도 완료 기록') {
              await supabase.from('student_homework_result').delete().eq('homework_id', hw.homework_id);
              await supabase.from('homework_assignment').delete().eq('homework_id', hw.homework_id);
            } else if (targetChanged) {
              await supabase.from('homework_assignment').update({ target_questions: remaining }).eq('homework_id', hw.homework_id);
            }
        }
      }
    } catch (e: any) {
      console.error("cancelProgressForIds 에러:", e.message || e);
    }
  };

  const applyActionToIds = async (actionType: string, mainIds: number[], wbIds: number[]) => {
    const newMap = { ...statusMap };
    const targets = selectedStudentId === 'all' ? enrolledStudentIds : [selectedStudentId];

    const updateMap = (id: number, status: string | null) => {
      if (selectedStudentId === 'all') {
        if (status) { newMap[getStatusKey(id, 'all')] = status; targets.forEach(sId => newMap[getStatusKey(id, sId)] = status); }
        else { delete newMap[getStatusKey(id, 'all')]; targets.forEach(sId => delete newMap[getStatusKey(id, sId)]); }
      } else {
        if (status) newMap[getStatusKey(id, selectedStudentId)] = status;
        else delete newMap[getStatusKey(id, selectedStudentId)];
      }
    };

    if (actionType === 'DONE_AND_WB_HW') {
      mainIds.forEach(id => updateMap(id, 'done'));
      wbIds.forEach(id => updateMap(id, 'homework'));
    } else if (actionType === 'MAIN_HW_AND_WB_HW') {
      mainIds.forEach(id => updateMap(id, 'homework'));
      wbIds.forEach(id => updateMap(id, 'homework'));
    } else if (actionType === 'DONE_ONLY') {
      mainIds.forEach(id => updateMap(id, 'done'));
      wbIds.forEach(id => updateMap(id, 'done'));
    } else if (actionType === 'CANCEL') {
      mainIds.forEach(id => updateMap(id, null));
      wbIds.forEach(id => updateMap(id, null));
    }

    setStatusMap(newMap);

    actionQueue.current = actionQueue.current.then(async () => {
      await cancelProgressForIds([...mainIds, ...wbIds], targets);
      
      if (actionType === 'DONE_AND_WB_HW') {
        if (mainIds.length > 0 && selectedBookId) await markProgressAsCompleteInDB(mainIds, targets, selectedBookId);
        if (wbIds.length > 0 && selectedWbId) await saveHomeworkToDB(selectedWbId, wbIds, true);
      } else if (actionType === 'MAIN_HW_AND_WB_HW') {
        if (mainIds.length > 0 && selectedBookId) await saveHomeworkToDB(selectedBookId, mainIds, false);
        if (wbIds.length > 0 && selectedWbId) await saveHomeworkToDB(selectedWbId, wbIds, true);
      } else if (actionType === 'DONE_ONLY') {
        if (mainIds.length > 0 && selectedBookId) await markProgressAsCompleteInDB(mainIds, targets, selectedBookId);
        if (wbIds.length > 0 && selectedWbId) await markProgressAsCompleteInDB(wbIds, targets, selectedWbId);
      }
    }).catch(err => {
      console.error("큐(Queue) DB 처리 중 오류 발생:", err);
    });
  };

  const executeProgressAction = async (actionType: string) => {
    let mIds = [...checkedMainQs]; let wIds = [...checkedWbQs];
    
    if (checkedMainPages.length > 0) {
      checkedMainPages.forEach(pNum => {
        (groupedMainQs[pNum] || []).forEach(mq => { if (!mIds.includes(mq.tq_id)) mIds.push(mq.tq_id); });
      });
    }
    if (checkedWbPages.length > 0) {
      checkedWbPages.forEach(pNum => {
        (groupedWbQs[pNum] || []).forEach(wq => { if (!wIds.includes(wq.tq_id)) wIds.push(wq.tq_id); });
      });
    }

    if (mIds.length === 0 && wIds.length === 0) return alert("처리할 문항이나 페이지를 선택해주세요.");
    
    await applyActionToIds(actionType, mIds, wIds);
    setCheckedMainQs([]); setCheckedWbQs([]); setCheckedMainPages([]); setCheckedWbPages([]);
    
    let tMsg = "선택한 상태가 취소되었습니다.";
    if (actionType === 'DONE_AND_WB_HW') tMsg = `본교재 진도완료 및 워크북 과제가 배부되었습니다!`;
    if (actionType === 'MAIN_HW_AND_WB_HW') tMsg = `과제 배부가 완료되었습니다!`;
    if (actionType !== 'CANCEL') showToast(tMsg);
  };

  // 🌟 워크북 페이지 단위 일괄 뱃지 순환 처리 (대기 -> 완료 -> 과제 -> 취소)
  const handleWbPageBadgeCycle = async (pNum: number, currentStatus: string) => {
    let wbIds: number[] = [];
    (groupedWbQs[pNum] || []).forEach((wq: any) => wbIds.push(wq.tq_id));
    
    if (currentStatus === "대기" || currentStatus === "partial" || !currentStatus) {
      await applyActionToIds('DONE_ONLY', [], wbIds);
      showToast(`${pNum}P 워크북 진도완료 처리!`);
    } else if (currentStatus === "done") {
      await applyActionToIds('MAIN_HW_AND_WB_HW', [], wbIds);
      showToast(`${pNum}P 워크북 과제 배부 완료!`);
    } else {
      await applyActionToIds('CANCEL', [], wbIds);
      showToast(`${pNum}P 처리가 취소되었습니다.`);
    }
  };

  // 🌟 워크북 단일 문항 뱃지 순환 처리 (대기 -> 완료 -> 과제 -> 취소)
  const handleWbBadgeCycle = async (tqId: number, currentStatus: string) => {
    if (currentStatus === "대기" || currentStatus === "partial" || !currentStatus) {
      await applyActionToIds('DONE_ONLY', [], [tqId]);
      showToast(`워크북 진도완료 처리!`);
    } else if (currentStatus === "done") {
      await applyActionToIds('MAIN_HW_AND_WB_HW', [], [tqId]);
      showToast(`워크북 과제 배부 완료!`);
    } else {
      await applyActionToIds('CANCEL', [], [tqId]);
      showToast(`처리가 취소되었습니다.`);
    }
  };

  const markSingleQuestionCompleted = async (tqId: number, type: 'main'|'wb') => {
    const mainIds = type === 'main' ? [tqId] : [];
    const wbIds = type === 'wb' ? [tqId] : [];
    await applyActionToIds(type === 'main' ? 'DONE_AND_WB_HW' : 'MAIN_HW_AND_WB_HW', mainIds, wbIds);
    showToast(`${type==='main'?'본교재 진도 처리':'워크북 과제 배부'} 완료!`);
  };

  const cancelSingleQuestion = async (tqId: number, type: 'main'|'wb') => {
    const mainIds = type === 'main' ? [tqId] : [];
    const wbIds = type === 'wb' ? [tqId] : [];
    await applyActionToIds('CANCEL', mainIds, wbIds);
    showToast(`처리가 취소되었습니다.`);
  };

  const markSinglePageCompleted = async (pNum: number, type: 'main'|'wb') => {
    let mainIds: number[] = []; let wbIds: number[] = [];
    if (type === 'main') {
      (groupedMainQs[pNum] || []).forEach(mq => mainIds.push(mq.tq_id));
    } else {
      (groupedWbQs[pNum] || []).forEach(wq => wbIds.push(wq.tq_id));
    }
    await applyActionToIds(type === 'main' ? 'DONE_AND_WB_HW' : 'MAIN_HW_AND_WB_HW', mainIds, wbIds);
    showToast(`${pNum}P 일괄 처리 완료!`);
  };

  const cancelSinglePage = async (pNum: number, type: 'main'|'wb') => {
    let mainIds: number[] = []; let wbIds: number[] = [];
    if (type === 'main') {
      (groupedMainQs[pNum] || []).forEach(mq => mainIds.push(mq.tq_id));
    } else {
      (groupedWbQs[pNum] || []).forEach(wq => wbIds.push(wq.tq_id));
    }
    await applyActionToIds('CANCEL', mainIds, wbIds);
    showToast(`${pNum}P 취소 완료!`);
  };

  const getPageStatus = (pNum: number, type: 'main'|'wb') => {
    const qs = type === 'main' ? (groupedMainQs[pNum] || []) : (groupedWbQs[pNum] || []);
    if (qs.length === 0) return "대기";
    let doneC = 0, hwC = 0, partialC = 0;
    qs.forEach((q: any) => {
      const st = statusMap[getStatusKey(q.tq_id, selectedStudentId)];
      if (st === "done") doneC++; 
      else if (st === "homework") hwC++;
      else if (st === "partial") partialC++; 
    });
    
    if (doneC === qs.length) return "done";
    if (hwC === qs.length) return "homework";
    if (doneC > 0 || hwC > 0 || partialC > 0) return "partial";
    return "대기";
  };

  const calculateProgress = (pages: number[], groupedQs: any) => {
    if (pages.length === 0) return { percent: 0, done: 0, total: 0 };
    let doneP = 0;
    pages.forEach(p => {
      const qs = groupedQs[p] || [];
      const allDone = qs.length > 0 && qs.every((q: any) => {
         const st = statusMap[getStatusKey(q.tq_id, selectedStudentId)];
         return st === 'done' || st === 'homework';
      });
      if (allDone) doneP++;
    });
    return { percent: Math.round((doneP / pages.length) * 100), done: doneP, total: pages.length };
  };

  const mainProgress = calculateProgress(mainPages, groupedMainQs);
  const wbProgress = calculateProgress(wbPages, groupedWbQs);

  const selectedMainBook = textbooks.find(b => b.book_id === selectedBookId);
  const mainBookTitle = selectedMainBook ? (unwrap(selectedMainBook.textbook) as TextbookInfo)?.title : '본교재';
  const selectedWbBook = workbooks.find(b => b.book_id === selectedWbId);
  const wbBookTitle = selectedWbBook ? (unwrap(selectedWbBook.textbook) as TextbookInfo)?.title : '워크북/과제';

  const openProgressModal = (type: 'main' | 'wb') => {
    const targetStudents = selectedStudentId === 'all' 
      ? [...students].sort((a, b) => a.name.localeCompare(b.name))
      : students.filter(s => s.id === selectedStudentId);

    const commonData = {
      classId: selectedClassId,
      students: targetStudents,
      statusMap: statusMap
    };

    if (type === 'main' && selectedBookId) {
      setProgressModalData({
        ...commonData,
        bookId: selectedBookId,
        bookTitle: mainBookTitle,
        pages: mainPages,
        groupedQs: groupedMainQs
      });
    } else if (type === 'wb' && selectedWbId) {
      setProgressModalData({
        ...commonData,
        bookId: selectedWbId,
        bookTitle: wbBookTitle,
        pages: wbPages,
        groupedQs: groupedWbQs
      });
    }
  };

  const renderBadge = (tqId: number, type: 'main'|'wb') => {
    const st = statusMap[getStatusKey(tqId, selectedStudentId)];
    
    // 🌟 워크북 우측 문항 뱃지 렌더링 (대기->완료->과제->취소 사이클 적용)
    if (type === 'wb') {
      if (st === "done") {
        return (
          <span onClick={(e) => { e.stopPropagation(); handleWbBadgeCycle(tqId, st); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 shrink-0 ml-4 transition-colors bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-[#fef3c7] hover:text-[#b45309] hover:border-[#fcd34d]">
            <span className="group-hover/qbadge:hidden">완료</span>
            <span className="hidden group-hover/qbadge:inline tracking-tighter">과제</span>
          </span>
        );
      }
      if (st === "homework") {
        return (
          <span onClick={(e) => { e.stopPropagation(); handleWbBadgeCycle(tqId, st); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d] hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 shrink-0 ml-4 transition-colors">
            <span className="group-hover/qbadge:hidden">과제배부</span>
            <span className="hidden group-hover/qbadge:inline tracking-tighter">취소</span>
          </span>
        );
      }
      if (st === "partial") {
        return (
          <span onClick={(e) => { e.stopPropagation(); handleWbBadgeCycle(tqId, st); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shrink-0 ml-4 transition-colors">
            <span className="group-hover/qbadge:hidden">진행중</span>
            <span className="hidden group-hover/qbadge:inline tracking-tighter">완료</span>
          </span>
        );
      }
      return (
        <span onClick={(e) => { e.stopPropagation(); handleWbBadgeCycle(tqId, "대기"); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 shrink-0 ml-4 transition-colors hover:bg-emerald-600 hover:text-white hover:border-emerald-600">
          <span className="group-hover/qbadge:hidden">대기</span>
          <span className="hidden group-hover/qbadge:inline tracking-tighter">완료</span>
        </span>
      );
    }
    
    // 본교재 좌측 문항 뱃지 렌더링 (대기->진도완료->취소)
    if (st === "done") {
      return (
        <span onClick={(e) => { e.stopPropagation(); cancelSingleQuestion(tqId, type); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 shrink-0 ml-4 transition-colors bg-[#e0e7ff] text-[#3730a3] border border-[#818cf8] hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300">
          <span className="group-hover/qbadge:hidden">진도완료</span>
          <span className="hidden group-hover/qbadge:inline tracking-tighter">취소</span>
        </span>
      );
    }
    if (st === "homework") {
      return (
        <span onClick={(e) => { e.stopPropagation(); cancelSingleQuestion(tqId, type); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d] hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 shrink-0 ml-4 transition-colors">
          <span className="group-hover/qbadge:hidden">과제배부</span>
          <span className="hidden group-hover/qbadge:inline tracking-tighter">취소</span>
        </span>
      );
    }
    if (st === "partial") {
      return (
        <span onClick={(e) => { e.stopPropagation(); cancelSingleQuestion(tqId, type); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300 hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 shrink-0 ml-4 transition-colors">
          <span className="group-hover/qbadge:hidden">진행중</span>
          <span className="hidden group-hover/qbadge:inline tracking-tighter">취소</span>
        </span>
      );
    }
    return (
      <span onClick={(e) => { e.stopPropagation(); markSingleQuestionCompleted(tqId, type); }} className="group/qbadge cursor-pointer w-[50px] text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 shrink-0 ml-4 transition-colors hover:bg-[#002864] hover:text-white hover:border-[#002864]">
        <span className="group-hover/qbadge:hidden">대기</span>
        <span className="hidden group-hover/qbadge:inline tracking-tighter">진도처리</span>
      </span>
    );
  };

  const handlePageChange = (direction: number) => {
    if (activeMainPage !== null && mainPages.length > 0) {
      const currentIndex = mainPages.indexOf(activeMainPage);
      const targetIndex = currentIndex + direction;
      if (targetIndex >= 0 && targetIndex < mainPages.length) setActiveMainPage(mainPages[targetIndex]);
    }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden relative p-4 sm:p-8 gap-6 font-pretendard">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">전체 진도 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">
            수강반별 본교재와 워크북의 진도를 관리하고 과제를 배부합니다.
          </p>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl flex flex-col gap-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 w-full">
          <span className="text-xs font-bold text-slate-500 mr-1">수강반:</span>
          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#002864] bg-slate-50 w-48 shadow-sm text-sm">
            <option value="">수강반 선택...</option>
            {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
          </select>
          <div className="w-px h-5 bg-slate-300 mx-2"></div>
          <span className="text-xs font-bold text-slate-500">본교재:</span>
          <select value={selectedBookId} onChange={(e) => setSelectedBookId(e.target.value)} disabled={!selectedClassId} className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-[#002864] focus:outline-none focus:ring-2 focus:ring-[#002864] bg-white w-64 shadow-sm text-sm disabled:opacity-50">
            <option value="">본교재 선택...</option>
            {textbooks.map((b: any) => <option key={b.book_id} value={b.book_id}>[{b.textbook.book_type}] {b.textbook.title}</option>)}
          </select>
          
          <span className="text-xs font-bold text-slate-500 ml-2">워크북/과제:</span>
          <select value={selectedWbId} onChange={(e) => setSelectedWbId(e.target.value)} disabled={!selectedClassId} className="px-3 py-1.5 border border-emerald-300 rounded-lg font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-50 w-64 shadow-sm text-sm disabled:opacity-50">
            <option value="">부교재/과제 선택 안함</option>
            {workbooks.map((b: any) => <option key={b.book_id} value={b.book_id}>[{b.textbook.book_type}] {b.textbook.title}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="bg-white px-6 py-2.5 border-b border-slate-200 flex shrink-0 items-center">
          <span className="text-xs font-bold text-slate-400 mr-2 shrink-0">적용 대상:</span>
          <div className="flex gap-2 flex-1 overflow-x-auto custom-scroll pr-4 items-center">
            <button onClick={() => setSelectedStudentId("all")} className={`px-5 py-1.5 rounded-full border text-sm shrink-0 transition-colors ${selectedStudentId === "all" ? "bg-[#002864] text-white border-[#002864] font-extrabold" : "bg-white text-slate-500 font-bold hover:bg-slate-50"}`}>
              전체 진도
            </button>
            {students.map(s => (
              <button key={s.id} onClick={() => setSelectedStudentId(s.id)} className={`px-5 py-1.5 rounded-full border text-sm shrink-0 transition-colors ${selectedStudentId === s.id ? "bg-[#002864] text-white border-[#002864] font-extrabold" : "bg-white text-slate-500 font-bold hover:bg-slate-50"}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden relative bg-slate-50/50">
          
          <div className="w-1/2 flex border-r border-slate-200 bg-white shadow-[2px_0_10px_rgba(0,0,0,0.02)] z-10 overflow-hidden">
            
            <div className="w-[140px] shrink-0 border-r border-slate-200 bg-blue-50/50 flex flex-col overflow-y-auto custom-scroll shadow-[inset_-2px_0_5px_rgba(0,0,0,0.02)] z-20 select-none pointer-events-auto" draggable={false} onDragStart={(e) => e.preventDefault()}>
              <div className="sticky top-0 bg-blue-50/90 backdrop-blur-sm border-b border-slate-200 p-2 shrink-0 z-30 flex flex-col items-center">
                <label className="flex items-center justify-between gap-1.5 cursor-pointer w-full p-2 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors select-none" draggable={false} onDragStart={(e) => e.preventDefault()} title="모든 페이지 선택">
                  <span className="text-[11px] font-black text-[#002864]">전체선택</span>
                  <input type="checkbox" checked={mainPages.length > 0 && checkedMainPages.length === mainPages.length} onChange={(e) => setCheckedMainPages(e.target.checked ? mainPages : [])} className="w-4 h-4 accent-[#002864]" />
                </label>
              </div>
              
              <div className="flex flex-col gap-2 p-2 pb-10">
                {mainPages.length === 0 && <div className="text-center py-4"><span className="text-[10px] font-bold text-slate-400 italic">교재<br/>미선택</span></div>}
                {mainPages.map(p => {
                  const status = getPageStatus(p, 'main');
                  const isActive = activeMainPage === p;
                  return (
                    <div 
                      key={p} 
                      onClick={() => setActiveMainPage(p)} 
                      draggable={false} 
                      onDragStart={(e) => e.preventDefault()}
                      className={`flex items-center justify-between p-2 rounded-lg border shadow-sm transition-all cursor-pointer group select-none ${isActive ? 'bg-white border-[#002864] ring-1 ring-[#002864]' : 'bg-white/60 border-slate-200 hover:border-blue-300'}`}
                    >
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input type="checkbox" checked={checkedMainPages.includes(p)} onChange={(e) => { e.stopPropagation(); setCheckedMainPages(prev => e.target.checked ? [...prev, p] : prev.filter(id => id !== p)); }} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 accent-[#002864] cursor-pointer" />
                        <span className={`text-[12px] font-black w-6 text-center ${isActive ? "text-[#002864]" : "text-slate-500 group-hover:text-[#002864]"}`}>{p}p</span>
                      </div>
                      
                      <div className="flex items-center shrink-0">
                        {status === "done" && <span onClick={(e) => { e.stopPropagation(); cancelSinglePage(p, 'main'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-[#e0e7ff] text-[#3730a3] border border-[#818cf8] cursor-pointer hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 transition-colors"><span className="group-hover/pbadge:hidden">완료</span><span className="hidden group-hover/pbadge:inline tracking-tighter">취소</span></span>}
                        {status === "homework" && <span onClick={(e) => { e.stopPropagation(); cancelSinglePage(p, 'main'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d] cursor-pointer hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 transition-colors"><span className="group-hover/pbadge:hidden">과제</span><span className="hidden group-hover/pbadge:inline tracking-tighter">취소</span></span>}
                        {status === "partial" && <span onClick={(e) => { e.stopPropagation(); cancelSinglePage(p, 'main'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300 cursor-pointer hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 transition-colors"><span className="group-hover/pbadge:hidden">진행</span><span className="hidden group-hover/pbadge:inline tracking-tighter">취소</span></span>}
                        {status === "대기" && <span onClick={(e) => { e.stopPropagation(); markSinglePageCompleted(p, 'main'); }} className="group/pbadge w-10 text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 cursor-pointer hover:bg-[#002864] hover:text-white transition-colors"><span className="group-hover/pbadge:hidden">대기</span><span className="hidden group-hover/pbadge:inline tracking-tighter">체크</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 relative">
              <div className="p-3 border-b border-slate-200 bg-[#f8fafc] text-xs flex justify-between items-center shadow-sm z-10 shrink-0 select-none">
                <div 
                  className="flex items-center gap-4 cursor-pointer hover:bg-blue-50/50 px-3 py-1.5 rounded-lg border border-transparent hover:border-blue-200 transition-colors group"
                  onClick={() => openProgressModal('main')}
                >
                  <div className="flex items-center gap-2">
                    <span className="bg-[#002864] text-white px-2.5 py-1 rounded text-xs font-bold">📘 본교재</span>
                    <span className="text-[#002864] font-extrabold text-sm">{activeMainPage !== null ? `${activeMainPage} Page` : "- Page"}</span>
                  </div>
                  <div className="flex items-center gap-2 border-l border-slate-300 pl-4" title="클릭하여 상세 매트릭스 뷰 보기">
                    <div className="w-32 h-2.5 bg-slate-200 rounded-full overflow-hidden shadow-inner relative">
                       <div className="absolute top-0 left-0 h-full bg-[#002864] transition-all group-hover:bg-blue-500" style={{ width: `${mainProgress.percent}%` }}></div>
                    </div>
                    <span className="text-xs font-black text-[#002864] group-hover:text-blue-600">{mainProgress.percent}%</span>
                    <span className="text-[10px] font-bold text-blue-500 bg-white border border-blue-200 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm whitespace-nowrap">매트릭스 뷰 🔍</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-md border border-slate-300 shadow-sm hover:bg-slate-50 shrink-0 ml-auto">
                  <input type="checkbox" checked={activeMainPage !== null && groupedMainQs[activeMainPage]?.length > 0 && groupedMainQs[activeMainPage]?.every((q:any) => checkedMainQs.includes(q.tq_id))} onChange={(e) => {
                    const isChecked = e.target.checked;
                    if (!activeMainPage) return;
                    const ids = (groupedMainQs[activeMainPage] || []).map((q: any) => q.tq_id);
                    if (isChecked) setCheckedMainQs(prev => Array.from(new Set([...prev, ...ids])));
                    else setCheckedMainQs(prev => prev.filter(id => !ids.includes(id)));
                  }} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                  <span className="font-bold text-slate-600">현재 페이지 전체 선택</span>
                </label>
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll p-4 pb-6">
                {activeMainPage !== null && groupedMainQs[activeMainPage]?.length > 0 ? (
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                    {groupedMainQs[activeMainPage].map((q: any) => (
                      <div key={q.tq_id} className="flex border-b border-slate-100 hover:bg-blue-50/30 transition-colors items-stretch">
                        <div className="w-12 flex items-center justify-center border-r border-slate-100 shrink-0 bg-slate-50">
                          <input type="checkbox" checked={checkedMainQs.includes(q.tq_id)} onChange={(e) => {
                            if (e.target.checked) setCheckedMainQs(prev => [...prev, q.tq_id]);
                            else setCheckedMainQs(prev => prev.filter(id => id !== q.tq_id));
                          }} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                        </div>
                        <div className="w-28 py-2 px-3 flex flex-col justify-center border-r border-slate-100 shrink-0 overflow-hidden">
                          <span className="text-slate-400 font-medium text-[10px] truncate leading-tight">{q.question_category || "일반"}</span>
                          <button onClick={() => setModalQuestion({ ...q, type: 'main' })} className="text-slate-700 font-extrabold text-[14px] text-left hover:text-blue-600 hover:underline">{q.question_number || "-"}</button>
                        </div>
                        <div className="py-2 px-3 flex-1 flex items-center font-bold text-slate-800 text-[14px] justify-between">
                          <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">
                            {q.question}
                          </div>
                          {renderBadge(q.tq_id, 'main')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-center text-slate-400 font-bold p-10">문항이 없습니다.</div>}
              </div>
            </div>
          </div>

          <div className="w-1/2 flex bg-emerald-50/20 overflow-hidden">
            
            <div className="w-[140px] shrink-0 border-r border-emerald-200 bg-emerald-50/80 flex flex-col overflow-y-auto custom-scroll shadow-[inset_-2px_0_5px_rgba(0,0,0,0.02)] z-20 select-none pointer-events-auto" draggable={false} onDragStart={(e) => e.preventDefault()}>
              <div className="sticky top-0 bg-emerald-50/90 backdrop-blur-sm border-b border-emerald-200 p-2 shrink-0 z-30 flex flex-col items-center">
                <label className="flex items-center justify-between gap-1.5 cursor-pointer w-full p-2 bg-white border border-emerald-300 rounded-lg shadow-sm hover:bg-emerald-50 transition-colors select-none" draggable={false} onDragStart={(e) => e.preventDefault()} title="모든 페이지 선택">
                  <span className="text-[11px] font-black text-[#059669]">전체선택</span>
                  <input type="checkbox" checked={wbPages.length > 0 && checkedWbPages.length === wbPages.length} onChange={(e) => setCheckedWbPages(e.target.checked ? wbPages : [])} className="w-4 h-4 accent-[#059669]" />
                </label>
              </div>
              
              <div className="flex flex-col gap-2 p-2 pb-10">
                {wbPages.length === 0 && <div className="text-center py-4"><span className="text-[10px] font-bold text-emerald-600/60 italic">교재<br/>미선택</span></div>}
                {wbPages.map(p => {
                  const status = getPageStatus(p, 'wb');
                  const isActive = activeWbPage === p;
                  return (
                    <div 
                      key={p} 
                      onClick={() => setActiveWbPage(p)} 
                      draggable={false} 
                      onDragStart={(e) => e.preventDefault()}
                      className={`flex items-center justify-between p-2 rounded-lg border shadow-sm transition-all cursor-pointer group select-none ${isActive ? 'bg-white border-[#059669] ring-1 ring-[#059669]' : 'bg-white/60 border-emerald-200 hover:border-emerald-300'}`}
                    >
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input type="checkbox" checked={checkedWbPages.includes(p)} onChange={(e) => { e.stopPropagation(); setCheckedWbPages(prev => e.target.checked ? [...prev, p] : prev.filter(id => id !== p)); }} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 accent-[#059669] cursor-pointer" />
                        <span className={`text-[12px] font-black w-6 text-center ${isActive ? "text-[#059669]" : "text-emerald-700 group-hover:text-[#059669]"}`}>{p}p</span>
                      </div>
                      
                      {/* 🌟 워크북 좌측 페이지 뱃지 렌더링 (대기->완료->과제->취소 사이클 적용) */}
                      <div className="flex items-center shrink-0">
                        {status === "done" && <span onClick={(e) => { e.stopPropagation(); handleWbPageBadgeCycle(p, 'done'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-300 cursor-pointer hover:bg-[#fef3c7] hover:text-[#b45309] hover:border-[#fcd34d] transition-colors"><span className="group-hover/pbadge:hidden">완료</span><span className="hidden group-hover/pbadge:inline tracking-tighter">과제</span></span>}
                        {status === "homework" && <span onClick={(e) => { e.stopPropagation(); handleWbPageBadgeCycle(p, 'homework'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d] cursor-pointer hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300 transition-colors"><span className="group-hover/pbadge:hidden">과제</span><span className="hidden group-hover/pbadge:inline tracking-tighter">취소</span></span>}
                        {status === "partial" && <span onClick={(e) => { e.stopPropagation(); handleWbPageBadgeCycle(p, 'partial'); }} className="group/pbadge w-10 text-center text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300 cursor-pointer hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors"><span className="group-hover/pbadge:hidden">진행</span><span className="hidden group-hover/pbadge:inline tracking-tighter">완료</span></span>}
                        {status === "대기" && <span onClick={(e) => { e.stopPropagation(); handleWbPageBadgeCycle(p, '대기'); }} className="group/pbadge w-10 text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 cursor-pointer hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors"><span className="group-hover/pbadge:hidden">대기</span><span className="hidden group-hover/pbadge:inline tracking-tighter">완료</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
              <div className="p-3 border-b border-emerald-200 bg-[#f0fdf4] text-xs flex justify-between items-center shadow-sm z-10 shrink-0 select-none">
                <div 
                  className="flex items-center gap-4 cursor-pointer hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-transparent hover:border-emerald-200 transition-colors group"
                  onClick={() => openProgressModal('wb')}
                >
                  <div className="flex items-center gap-2">
                    <span className="bg-[#059669] text-white px-2.5 py-1 rounded text-xs font-bold">📗 워크북/과제</span>
                    <span className="text-[#059669] font-extrabold text-sm">{activeWbPage !== null ? `${activeWbPage} Page` : "- Page"}</span>
                  </div>
                  <div className="flex items-center gap-2 border-l border-slate-300 pl-4" title="클릭하여 상세 매트릭스 뷰 보기">
                    <div className="w-32 h-2.5 bg-slate-200 rounded-full overflow-hidden shadow-inner relative">
                       <div className="absolute top-0 left-0 h-full bg-[#059669] transition-all group-hover:bg-emerald-500" style={{ width: `${wbProgress.percent}%` }}></div>
                    </div>
                    <span className="text-xs font-black text-[#059669] group-hover:text-emerald-600">{wbProgress.percent}%</span>
                    <span className="text-[10px] font-bold text-emerald-500 bg-white border border-emerald-200 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm whitespace-nowrap">매트릭스 뷰 🔍</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-md border border-emerald-300 shadow-sm hover:bg-emerald-50 shrink-0 ml-auto">
                  <input type="checkbox" checked={activeWbPage !== null && groupedWbQs[activeWbPage]?.length > 0 && groupedWbQs[activeWbPage]?.every((q:any) => checkedWbQs.includes(q.tq_id))} onChange={(e) => {
                    const isChecked = e.target.checked;
                    if (!activeWbPage) return;
                    const ids = (groupedWbQs[activeWbPage] || []).map((q: any) => q.tq_id);
                    if (isChecked) setCheckedWbQs(prev => Array.from(new Set([...prev, ...ids])));
                    else setCheckedWbQs(prev => prev.filter(id => !ids.includes(id)));
                  }} className="w-[1.1rem] h-[1.1rem] accent-[#059669]" />
                  <span className="font-bold text-emerald-700">현재 페이지 전체 선택</span>
                </label>
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll p-4 pb-6">
                {!selectedWbId ? <div className="flex h-full items-center justify-center text-slate-400 font-bold">상단에서 워크북/과제를 선택해주세요.</div>
                : activeWbPage !== null && groupedWbQs[activeWbPage]?.length > 0 ? (
                  <div className="bg-white border border-emerald-200 shadow-sm rounded-xl overflow-hidden">
                    {groupedWbQs[activeWbPage].map((wq: any) => (
                      <div key={wq.tq_id} className="flex border-b border-emerald-50 hover:bg-emerald-50/50 transition-colors items-stretch">
                        <div className="w-12 flex items-center justify-center border-r border-emerald-50 shrink-0 bg-emerald-50/30">
                          <input type="checkbox" checked={checkedWbQs.includes(wq.tq_id)} onChange={(e) => {
                            if (e.target.checked) setCheckedWbQs(prev => [...prev, wq.tq_id]);
                            else setCheckedWbQs(prev => prev.filter(id => id !== wq.tq_id));
                          }} className="w-[1.1rem] h-[1.1rem] accent-[#059669]" />
                        </div>
                        <div className="w-24 py-2 px-3 flex flex-col justify-center border-r border-emerald-50 shrink-0">
                          <span className="text-emerald-500 font-medium text-[10px] truncate leading-tight">{wq.question_category || "일반"}</span>
                          <button onClick={() => setModalQuestion({ ...wq, type: 'wb' })} className="text-emerald-700 font-extrabold text-[14px] text-left hover:text-emerald-500 hover:underline">{wq.question_number || "-"}</button>
                        </div>
                        <div className="py-2 px-3 flex-1 flex items-center font-bold text-slate-800 text-[14px] justify-between">
                          <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">
                            {wq.question}
                          </div>
                          {renderBadge(wq.tq_id, 'wb')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-center text-emerald-600/50 font-bold p-10">문항이 없습니다.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border-t border-slate-200 p-4 flex items-center justify-center gap-2 shrink-0 z-20 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-1 mr-2 border-r border-slate-200 pr-3">
            <button onClick={() => handlePageChange(-1)} className="px-4 py-2.5 text-slate-600 font-bold text-sm hover:text-slate-900 transition-colors flex items-center gap-1 rounded-lg hover:bg-slate-100">
                <span>←</span> 이전
            </button>
            <button onClick={() => handlePageChange(1)} className="px-4 py-2.5 text-slate-600 font-bold text-sm hover:text-slate-900 transition-colors flex items-center gap-1 rounded-lg hover:bg-slate-100">
                다음 <span>→</span>
            </button>
          </div>
          <button onClick={() => executeProgressAction("DONE_AND_WB_HW")} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl transition-colors shadow-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            선택항목 진도/과제 일괄 처리
          </button>
          <button onClick={() => executeProgressAction("MAIN_HW_AND_WB_HW")} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-sm rounded-xl transition-colors shadow-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477-4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
            모두 과제 배부
          </button>
          <div className="w-px h-6 bg-slate-300 mx-1"></div>
          <button onClick={() => executeProgressAction("CANCEL")} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-600 font-bold text-sm rounded-xl transition-colors shadow-sm">
            선택 취소
          </button>
        </div>
      </div>

      <QuestionModal 
        isOpen={!!modalQuestion} 
        question={modalQuestion} 
        onClose={() => setModalQuestion(null)} 
      />

      {progressModalData && (
         <ProgressDetailModal 
            data={progressModalData} 
            onClose={() => setProgressModalData(null)} 
         />
      )}

      {toastMsg && (
        <div className="fixed top-20 right-6 z-[9999] bg-slate-800 text-white font-bold px-6 py-3 rounded-xl shadow-2xl transition-all duration-300 text-sm animate-bounce">
          ✨ {toastMsg}
        </div>
      )}
    </div>
  );
}