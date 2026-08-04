// src/app/(dashboard)/progress/page.tsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

// 분리된 모달 컴포넌트 불러오기
import QuestionModal from "@/components/progress/QuestionModal";

// 💡 JSON 파싱 안전망
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
  // === 기본 데이터 상태 ===
  const [classes, setClasses] = useState<any[]>([]);
  const [textbooks, setTextbooks] = useState<any[]>([]);
  const [workbooks, setWorkbooks] = useState<any[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [enrolledStudentIds, setEnrolledStudentIds] = useState<string[]>([]);

  // === 선택 및 탭 상태 ===
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [selectedWbId, setSelectedWbId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [activePageNum, setActivePageNum] = useState<number | null>(null);

  // === 문항 데이터 상태 ===
  const [allQuestions, setAllQuestions] = useState<any[]>([]);
  const [workbookQuestions, setWorkbookQuestions] = useState<any[]>([]);
  const [pages, setPages] = useState<number[]>([]);
  const [groupedMainQs, setGroupedMainQs] = useState<{ [key: number]: any[] }>({});
  const [groupedWbQs, setGroupedWbQs] = useState<{ [parent_id: number]: any[] }>({});
  
  // === 진도 상태 맵 ===
  const [statusMap, setStatusMap] = useState<{ [key: string]: string }>({});

  // === 체크박스 제어 상태 ===
  const [checkedPages, setCheckedPages] = useState<number[]>([]);
  const [checkedMainQs, setCheckedMainQs] = useState<number[]>([]);
  const [checkedWbQs, setCheckedWbQs] = useState<number[]>([]);

  // === 모달 및 토스트 ===
  const [isLoading, setIsLoading] = useState(false);
  const [modalQuestion, setModalQuestion] = useState<any>(null);
  const [toastMsg, setToastMsg] = useState("");
  const mathJaxRef = useRef<boolean>(false);

  // 💡 [핵심 1] 다중 클릭 동시성(Race Condition) 방지를 위한 대기열(Queue) 변수
  const actionQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    fetchInitialClasses();
    loadMathJax();
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;
    fetchClassDetails(selectedClassId);
  }, [selectedClassId]);

  useEffect(() => {
    if (selectedBookId) {
      fetchQuestions(selectedBookId, selectedWbId);
    } else {
      setAllQuestions([]); setPages([]); setGroupedMainQs({}); setActivePageNum(null);
    }
  }, [selectedBookId, selectedWbId]);

  // MathJax 렉 제거
  useEffect(() => {
    if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
      (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
    }
  }, [activePageNum, selectedStudentId, selectedBookId, selectedWbId]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] },
        startup: { typeset: false },
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2500);
  };

  const fetchInitialClasses = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    
    // 최고관리자, SUPER_ADMIN 권한 조건 완벽 포괄
    const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("최고관리자") || pos.includes("원장") || pos.includes("실장");

    let query = supabase.from("class").select("class_id, name, level_name").order("name");
    if (!isAdmin && instId) query = query.eq("instructor_id", instId);
    
    const { data } = await query;
    if (data) setClasses(data);
  };

  const fetchClassDetails = async (classId: string) => {
    try {
      const { data: classBooks } = await supabase.from("class_textbook").select("book_id, textbook(title, book_type)").eq("class_id", classId);
      const mains: any[] = []; const wbs: any[] = [];
      classBooks?.forEach((cb: any) => {
        if (!cb.textbook) return;
        if (cb.textbook.book_type === "워크북") wbs.push(cb);
        else mains.push(cb);
      });
      setTextbooks(mains); setWorkbooks(wbs);
      if (!mains.find(b => b.book_id.toString() === selectedBookId)) setSelectedBookId("");
      if (!wbs.find(b => b.book_id.toString() === selectedWbId)) setSelectedWbId("");

      const { data: enrolls, error } = await supabase.from("enrollment")
        .select("student_id, student(name, status)")
        .eq("class_id", classId);

      if (error) throw error;

      const sMap = new Map();
      enrolls?.forEach((e: any) => {
        if (e.student && e.student.status === '재원') {
          const sName = Array.isArray(e.student) ? e.student[0]?.name : e.student.name;
          sMap.set(e.student_id, sName);
        }
      });

      const sList = Array.from(sMap.entries()).map(([id, name]) => ({ id, name }));
      setStudents(sList);
      
      const sIds = sList.map(s => s.id);
      setEnrolledStudentIds(sIds);
      setSelectedStudentId("all");
      
      await loadStatusMapDB(classId, sIds);
    } catch (e) { 
      console.error("클래스 데이터 페칭 에러:", e); 
    }
  };

  const fetchQuestions = async (bookId: string, wbId: string) => {
    setIsLoading(true);
    try {
      const { data: mainData } = await supabase.from("textbook_question").select("*").eq("book_id", Number(bookId)).order("page_number", { ascending: true }).order("tq_id", { ascending: true });
      const grouped = (mainData || []).reduce((acc: any, q: any) => {
        const pNum = q.page_number || 0;
        if (!acc[pNum]) acc[pNum] = [];
        acc[pNum].push(q); return acc;
      }, {});

      const sortedPages = Object.keys(grouped).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);
      setAllQuestions(mainData || []); setGroupedMainQs(grouped); setPages(sortedPages);
      if (sortedPages.length > 0) setActivePageNum(sortedPages[0]);
      setCheckedPages([]); setCheckedMainQs([]); setCheckedWbQs([]); 

      if (wbId) {
        const { data: wbData } = await supabase.from("textbook_question").select("*").eq("book_id", Number(wbId));
        const wbGrouped = (wbData || []).reduce((acc: any, q: any) => {
          if (q.parent_tq_id) {
            if (!acc[q.parent_tq_id]) acc[q.parent_tq_id] = [];
            acc[q.parent_tq_id].push(q);
          }
          return acc;
        }, {});
        setWorkbookQuestions(wbData || []); setGroupedWbQs(wbGrouped);
      } else {
        setWorkbookQuestions([]); setGroupedWbQs({});
      }
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const getStatusKey = (tq_id: number, sId: string) => `${selectedClassId}_${tq_id}_${sId}`;

  const loadStatusMapDB = async (classId: string, studentIds: string[]) => {
    try {
      const { data: assignments, error } = await supabase
        .from('homework_assignment')
        .select('homework_id, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids)')
        .eq('class_id', classId);
        
      if (error) throw error;

      const newMap: { [key: string]: string } = {};
      const studentCountByTq: any = {};

      assignments?.forEach((hw: any) => {
        const tqIds = safeParseIds(hw.target_questions);

        hw.student_homework_result?.forEach((res: any) => {
          const completed = safeParseIds(res.completed_tq_ids);

          tqIds.forEach((tqId: number) => {
            const isDone = completed.includes(tqId);
            const key = getStatusKey(tqId, res.student_id);
            if (isDone || newMap[key] !== 'done') newMap[key] = isDone ? 'done' : 'homework';

            if (!studentCountByTq[tqId]) studentCountByTq[tqId] = { hwCount: 0, doneCount: 0 };
            studentCountByTq[tqId].hwCount++;
            if (isDone) studentCountByTq[tqId].doneCount++;
          });

          completed.forEach((tqId: number) => {
            if (!tqIds.includes(tqId)) {
              newMap[getStatusKey(tqId, res.student_id)] = 'done';
              if (!studentCountByTq[tqId]) studentCountByTq[tqId] = { hwCount: 0, doneCount: 0 };
              studentCountByTq[tqId].doneCount++;
            }
          });
        });
      });

      const totalStudents = studentIds.length;
      if (totalStudents > 0) {
          Object.entries(studentCountByTq).forEach(([tqIdStr, counts]: [string, any]) => {
              const tqId = Number(tqIdStr);
              if (counts.doneCount >= totalStudents) {
                  newMap[getStatusKey(tqId, 'all')] = 'done';
              } else if (counts.doneCount > 0) {
                  newMap[getStatusKey(tqId, 'all')] = 'partial';
              } else if (counts.hwCount >= totalStudents) {
                  newMap[getStatusKey(tqId, 'all')] = 'homework';
              } else if (counts.hwCount > 0) {
                  newMap[getStatusKey(tqId, 'all')] = 'partial';
              }
          });
      }

      setStatusMap(newMap);
    } catch (e: any) { 
      console.error("loadStatusMapDB 에러:", e.message || e); 
    }
  };

  // 1. [완전 개편] 철저한 "개인 중심" 당일 과제 통합 로직
  const assignHomeworkToStudents = async (targetStudentIds: string[], mainIds: number[], wbIds: number[], titleStr: string) => {
    try {
        const allTqIds = [...mainIds, ...wbIds];
        if (!allTqIds.length || !selectedBookId || !targetStudentIds.length) return;

        const now = new Date();
        const kstOffset = 9 * 60 * 60 * 1000;
        const kstDate = new Date(now.getTime() + kstOffset);
        const dateStr = kstDate.toISOString().split('T')[0];
        
        const startOfTodayKST = new Date(`${dateStr}T00:00:00+09:00`).toISOString();
        const endOfTodayKST = new Date(`${dateStr}T23:59:59.999+09:00`).toISOString();

        // 💡 7명이면 7번, 1명이면 1번. 철저하게 "개별 학생" 단위로 병렬 처리합니다.
        await Promise.all(targetStudentIds.map(async (sId) => {
            try {
                const studentName = students.find(s => s.id === sId)?.name || '학생';

                // [핵심 1] 오늘 이 학생(sId)에게 배부된 과제 묶음이 있는지 확인합니다.
                const { data: existing, error: existErr } = await supabase.from('homework_assignment')
                    .select('homework_id, target_questions, homework_title')
                    .eq('class_id', selectedClassId)
                    .eq('target_student_id', sId) // 철저한 개인 격리
                    .neq('homework_title', '[시스템] 수업 진도 완료 기록')
                    .gte('created_at', startOfTodayKST)
                    .lte('created_at', endOfTodayKST)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (existErr) throw existErr;

                let hwId: number;

                if (existing && existing.length > 0) {
                    // [상황 A] 이미 오늘 만들어진 과제 묶음이 있음 -> 기존 묶음에 문항을 합산(Merge)
                    hwId = existing[0].homework_id;
                    const prevQs = safeParseIds(existing[0].target_questions);
                    const newQs = Array.from(new Set([...prevQs, ...allTqIds])); // 중복 방지 합산

                    let updatedTitle = existing[0].homework_title || '';
                    // 본교재만 있다가 워크북이 추가되거나 하면 이름을 "통합 과제"로 업그레이드
                    if (!updatedTitle.includes('통합')) {
                        if (titleStr.includes('통합') || (updatedTitle.includes('워크북') && mainIds.length > 0) || (updatedTitle.includes('본교재') && wbIds.length > 0)) {
                            updatedTitle = `[${studentName}] 통합 과제 (${dateStr})`;
                        }
                    }
                    
                    await supabase.from('homework_assignment')
                        .update({ target_questions: newQs, homework_title: updatedTitle })
                        .eq('homework_id', hwId);
                } else {
                    // [상황 B] 오늘 처음 나가는 과제임 -> 새로운 묶음(방) 생성
                    let expectedTitle = `[${studentName}] ${titleStr} (${dateStr})`;
                    if (mainIds.length > 0 && wbIds.length > 0) expectedTitle = `[${studentName}] 통합 과제 (${dateStr})`;

                    const { data: hwData, error: insErr } = await supabase.from('homework_assignment').insert({
                        book_id: Number(selectedBookId),
                        target_questions: allTqIds,
                        class_id: selectedClassId,
                        target_student_id: sId, // 철저한 개인 격리
                        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        homework_title: expectedTitle
                    }).select();

                    if (insErr) throw insErr;
                    if (!hwData || hwData.length === 0) return;
                    hwId = hwData[0].homework_id;
                }

                // [핵심 2] 해당 과제 방에 대한 학생의 결과(채점용) 테이블 레코드 확인 및 생성
                const { data: res } = await supabase.from('student_homework_result')
                    .select('hw_result_id')
                    .eq('homework_id', hwId)
                    .eq('student_id', sId)
                    .maybeSingle();
                    
                if (!res) {
                    await supabase.from('student_homework_result').insert({ 
                        homework_id: hwId, student_id: sId, status: '미제출', completed_tq_ids: [] 
                    });
                }
            } catch (err) {
                console.error(`[과제배부 에러] 학생 ID ${sId}:`, err);
            }
        }));
    } catch (e: any) {
        console.error("assignHomeworkToStudents 전체 런타임 에러:", e.message || e);
    }
  };

  // 2. [완전 개편] 진도 완료 기록 역시 철저한 "개인 단위" 처리
  const markProgressAsCompleteInDB = async (tq_ids: number[], targetStudentIds: string[]) => {
    try {
      if (!tq_ids.length || !selectedBookId || !targetStudentIds.length) return;

      await Promise.all(targetStudentIds.map(async (sId) => {
        try {
          // 이 학생만의 진도 완료 기록용 숨김 방(Assignment)이 있는지 확인
          const { data: existing } = await supabase.from('homework_assignment')
            .select('homework_id')
            .eq('class_id', selectedClassId)
            .eq('book_id', Number(selectedBookId))
            .eq('target_student_id', sId) // 철저한 개인 격리
            .eq('homework_title', '[시스템] 수업 진도 완료 기록')
            .limit(1);

          let hwId: number;
          if (existing && existing.length > 0) {
            hwId = existing[0].homework_id;
          } else {
            const { data: ins, error: insErr } = await supabase.from('homework_assignment').insert({
              book_id: Number(selectedBookId), 
              target_questions: [], 
              due_date: '2099-12-31', 
              homework_title: '[시스템] 수업 진도 완료 기록', 
              class_id: selectedClassId, 
              target_student_id: sId // 철저한 개인 격리
            }).select();
            
            if (insErr) throw insErr;
            if (!ins || ins.length === 0) return;
            hwId = ins[0].homework_id;
          }

          // 해당 진도 완료 방에 문항 추가
          const { data: res } = await supabase.from('student_homework_result')
            .select('hw_result_id, completed_tq_ids')
            .eq('homework_id', hwId)
            .eq('student_id', sId)
            .maybeSingle();

          if (res) {
            const comp = safeParseIds(res.completed_tq_ids);
            const newComp = Array.from(new Set([...comp, ...tq_ids]));
            await supabase.from('student_homework_result')
                .update({ completed_tq_ids: newComp, status: '채점완료' })
                .eq('hw_result_id', res.hw_result_id);
          } else {
            await supabase.from('student_homework_result').insert({ 
                homework_id: hwId, student_id: sId, status: '채점완료', completed_tq_ids: tq_ids 
            });
          }
        } catch (err) {
          console.error(`[진도기록 에러] 학생 ID ${sId}:`, err);
        }
      }));
    } catch (e: any) {
      console.error("markProgressAsCompleteInDB 전체 런타임 에러:", e.message || e);
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

        const isTargetingAll = selectedStudentId === 'all';
        const isPersonalHw = hw.target_student_id !== null && targetStudentIds.includes(hw.target_student_id);

        if (isTargetingAll || isPersonalHw) {
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
      console.error("cancelProgressForIds 런타임 에러:", e.message || e);
    }
  };

  const applyActionToIds = async (actionType: string, mainIds: number[], wbIds: number[]) => {
    // 1. 화면(UI) 상태는 클릭 즉시 바로 업데이트 (반응성 보장)
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
    } else if (actionType === 'CANCEL') {
      mainIds.forEach(id => updateMap(id, null));
      wbIds.forEach(id => updateMap(id, null));
    }

    setStatusMap(newMap);

    let tMsg = "선택한 상태가 취소되었습니다.";
    if (actionType === 'DONE_AND_WB_HW') tMsg = `본교재 진도완료 및 워크북 과제(${wbIds.length}문제)가 배부되었습니다!`;
    if (actionType === 'MAIN_HW_AND_WB_HW') tMsg = `과제 배부가 완료되었습니다!`;
    showToast(tMsg);

    // 2. 🌟 [핵심 2] 실제 DB 서버 전송 작업은 대기열(Queue)에 줄을 세워서 순차적으로 실행
    actionQueue.current = actionQueue.current.then(async () => {
      await cancelProgressForIds([...mainIds, ...wbIds], targets);
      
      if (actionType === 'DONE_AND_WB_HW') {
        if (mainIds.length > 0) await markProgressAsCompleteInDB(mainIds, targets);
        if (wbIds.length > 0) await assignHomeworkToStudents(targets, [], wbIds, '워크북 과제');
      } else if (actionType === 'MAIN_HW_AND_WB_HW') {
        const titleStr = (mainIds.length > 0 && wbIds.length === 0) ? '본교재 과제' : ((wbIds.length > 0 && mainIds.length === 0) ? '워크북 과제' : '통합 과제');
        const combinedHwIds = [...mainIds, ...wbIds];
        if (combinedHwIds.length > 0) await assignHomeworkToStudents(targets, mainIds, wbIds, titleStr);
      }
    }).catch(err => {
      console.error("큐(Queue) 처리 중 오류 발생:", err);
    });
  };

  const executeProgressAction = async (actionType: string) => {
    let mIds = [...checkedMainQs]; let wIds = [...checkedWbQs];
    if (checkedPages.length > 0) {
      checkedPages.forEach(pNum => {
        (groupedMainQs[pNum] || []).forEach(mq => {
          if (!mIds.includes(mq.tq_id)) mIds.push(mq.tq_id);
          (groupedWbQs[mq.tq_id] || []).forEach(wq => { if (!wIds.includes(wq.tq_id)) wIds.push(wq.tq_id); });
        });
      });
      setCheckedPages([]);
    }
    if (mIds.length === 0 && wIds.length === 0) return alert("처리할 문항이나 페이지를 선택해주세요.");
    await applyActionToIds(actionType, mIds, wIds);
    setCheckedMainQs([]); setCheckedWbQs([]);
  };

  const markSingleQuestionCompleted = async (tqId: number, type: 'main'|'wb') => {
    const mainIds = type === 'main' ? [tqId] : [];
    const wbIds = type === 'wb' ? [tqId] : [];
    if (type === 'main' && selectedWbId) {
      (groupedWbQs[tqId] || []).forEach(wq => wbIds.push(wq.tq_id));
    }
    await applyActionToIds('DONE_AND_WB_HW', mainIds, wbIds);
  };

  const markSinglePageCompleted = async (pNum: number) => {
    let mainIds: number[] = []; let wbIds: number[] = [];
    (groupedMainQs[pNum] || []).forEach(mq => {
      mainIds.push(mq.tq_id);
      if (selectedWbId) (groupedWbQs[mq.tq_id] || []).forEach(wq => wbIds.push(wq.tq_id));
    });
    await applyActionToIds('DONE_AND_WB_HW', mainIds, wbIds);
  };

  const handleMainQCheck = (tq_id: number, isChecked: boolean) => {
    if (isChecked) {
      setCheckedMainQs(prev => [...prev, tq_id]);
      const linkedWbs = groupedWbQs[tq_id] || [];
      setCheckedWbQs(prev => Array.from(new Set([...prev, ...linkedWbs.map((w: any) => w.tq_id)])));
    } else {
      setCheckedMainQs(prev => prev.filter(id => id !== tq_id));
      const linkedWbs = groupedWbQs[tq_id] || [];
      const wbIdsToRemove = linkedWbs.map((w: any) => w.tq_id);
      setCheckedWbQs(prev => prev.filter(id => !wbIdsToRemove.includes(id)));
    }
  };

  const toggleAllMainQs = (isChecked: boolean) => {
    if (!activePageNum) return;
    (groupedMainQs[activePageNum] || []).forEach((q: any) => handleMainQCheck(q.tq_id, isChecked));
  };

  const handlePageChange = (direction: number) => {
    if (activePageNum === null || pages.length === 0) return;
    const currentIndex = pages.indexOf(activePageNum);
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < pages.length) setActivePageNum(pages[targetIndex]);
    else alert(direction > 0 ? "마지막 페이지입니다." : "첫 페이지입니다.");
  };

  const getPageStatus = (pNum: number) => {
    const qs = groupedMainQs[pNum] || [];
    if (qs.length === 0) return "대기";
    let doneC = 0, hwC = 0;
    qs.forEach((q: any) => {
      const st = statusMap[getStatusKey(q.tq_id, selectedStudentId)];
      if (st === "done") doneC++; if (st === "homework") hwC++;
    });
    if (doneC === qs.length) return "done"; if (hwC === qs.length) return "homework"; if (doneC > 0 || hwC > 0) return "partial";
    return "대기";
  };

  const renderBadge = (tqId: number, type: 'main'|'wb') => {
    const st = statusMap[getStatusKey(tqId, selectedStudentId)];
    if (st === "done") return <span className={`w-16 text-center inline-block text-[10px] font-bold rounded py-0.5 shrink-0 ml-4 ${type==='wb' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-[#e0e7ff] text-[#3730a3] border border-[#818cf8]'}`}>진도완료</span>;
    if (st === "homework") return <span className="w-16 text-center inline-block text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d] shrink-0 ml-4">과제배부</span>;
    if (st === "partial") return <span className="w-16 text-center inline-block text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300 shrink-0 ml-4">진행중</span>;
    
    return (
      <span onClick={(e) => { e.stopPropagation(); markSingleQuestionCompleted(tqId, type); }} className={`group/qbadge cursor-pointer w-16 text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 shrink-0 ml-4 transition-colors ${type==='wb' ? 'hover:bg-emerald-600 hover:text-white hover:border-emerald-600' : 'hover:bg-slate-700 hover:text-white hover:border-slate-700'}`}>
        <span className="group-hover/qbadge:hidden">대기</span>
        <span className="hidden group-hover/qbadge:inline tracking-tighter">진도 체크</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden relative p-4 sm:p-8 gap-6">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">전체 진도 관리</h2>
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
          <span className="text-xs font-bold text-slate-500 ml-2">워크북:</span>
          <select value={selectedWbId} onChange={(e) => setSelectedWbId(e.target.value)} disabled={!selectedClassId} className="px-3 py-1.5 border border-emerald-300 rounded-lg font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-50 w-64 shadow-sm text-sm disabled:opacity-50">
            <option value="">워크북 선택 안함</option>
            {workbooks.map((b: any) => <option key={b.book_id} value={b.book_id}>[워크북] {b.textbook.title}</option>)}
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

        <div className="flex-1 flex overflow-hidden relative">
          <div className="w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 relative z-10">
            <div className="p-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center text-xs font-bold text-slate-500 shrink-0">
              <label className="flex items-center gap-2 cursor-pointer hover:text-slate-700">
                <input type="checkbox" checked={pages.length > 0 && checkedPages.length === pages.length} onChange={(e) => setCheckedPages(e.target.checked ? pages : [])} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                <span>전체 페이지 선택</span>
              </label>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll">
              {isLoading ? <div className="p-10 text-center font-bold text-slate-400">데이터 로딩중...</div>
              : pages.length === 0 ? <div className="p-10 text-center text-slate-400 font-bold">교재를 선택해주세요.</div>
              : pages.map(p => {
                  const status = getPageStatus(p);
                  const isActive = activePageNum === p;
                  return (
                    <div key={p} onClick={() => setActivePageNum(p)} className={`flex items-center p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer group ${isActive ? "bg-[#f1f5f9] border-r-4 border-r-[#002864]" : ""}`}>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={checkedPages.includes(p)} onChange={(e) => { e.stopPropagation(); setCheckedPages(prev => e.target.checked ? [...prev, p] : prev.filter(id => id !== p)); }} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                          <span className={`font-bold text-[14px] ${isActive ? "text-[#002864]" : "text-slate-600 group-hover:text-[#002864]"}`}>{p === 0 ? "미지정" : `${p}P`}</span>
                        </div>
                        {status === "done" && <span className="w-16 text-center text-[10px] font-bold rounded py-0.5 bg-[#e0e7ff] text-[#3730a3] border border-[#818cf8]">진도완료</span>}
                        {status === "homework" && <span className="w-16 text-center text-[10px] font-bold rounded py-0.5 bg-[#fef3c7] text-[#b45309] border border-[#fcd34d]">과제배부</span>}
                        {status === "partial" && <span className="w-16 text-center text-[10px] font-bold rounded py-0.5 bg-blue-100 text-blue-700 border border-blue-300">진행중</span>}
                        {status === "대기" && <span onClick={(e) => { e.stopPropagation(); markSinglePageCompleted(p); }} className="group/badge w-16 text-center inline-block text-[10px] font-bold text-slate-400 bg-slate-100 py-0.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-700 hover:text-white hover:border-slate-700 transition-colors"><span className="group-hover/badge:hidden">대기</span><span className="hidden group-hover/badge:inline tracking-tighter">진도 체크</span></span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="flex-1 flex bg-slate-50 relative z-0">
            <div className="w-1/2 flex flex-col border-r border-slate-200 bg-white">
              <div className="p-3 border-b border-slate-200 bg-[#f8fafc] text-xs flex justify-between items-center shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="bg-[#002864] text-white px-2.5 py-1 rounded text-xs font-bold">본교재</span>
                  <span className="text-[#002864] font-extrabold text-sm">{activePageNum !== null ? `${activePageNum} Page` : "- Page"}</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-md border border-slate-300 shadow-sm">
                  <input type="checkbox" checked={activePageNum !== null && groupedMainQs[activePageNum]?.length > 0 && groupedMainQs[activePageNum]?.every((q:any) => checkedMainQs.includes(q.tq_id))} onChange={(e) => toggleAllMainQs(e.target.checked)} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                  <span className="font-bold text-slate-600">전체 선택</span>
                </label>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-5 pb-32">
                {activePageNum !== null && groupedMainQs[activePageNum]?.length > 0 ? (
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                    {groupedMainQs[activePageNum].map((q: any) => (
                      <div key={q.tq_id} className="flex border-b border-slate-100 hover:bg-blue-50/30 transition-colors items-stretch">
                        <div className="w-12 flex items-center justify-center border-r border-slate-100 shrink-0 bg-slate-50">
                          <input type="checkbox" checked={checkedMainQs.includes(q.tq_id)} onChange={(e) => handleMainQCheck(q.tq_id, e.target.checked)} className="w-[1.1rem] h-[1.1rem] accent-[#002864]" />
                        </div>
                        <div className="w-28 py-2 px-3 flex flex-col justify-center border-r border-slate-100 shrink-0 overflow-hidden">
                          <span className="text-slate-400 font-medium text-[10px] truncate leading-tight">{q.question_category || "일반"}</span>
                          <button onClick={() => setModalQuestion({ ...q, type: 'main' })} className="text-slate-700 font-extrabold text-[14px] text-left hover:text-blue-600 hover:underline">{q.question_number || "-"}</button>
                        </div>
                        <div className="py-2 px-3 flex-1 flex items-center font-bold text-slate-800 text-[14px] justify-between">
                          <span className="text-[#002864] break-all">$ {q.answer} $</span>
                          {renderBadge(q.tq_id, 'main')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-center text-slate-400 font-bold p-10">문항이 없습니다.</div>}
              </div>
            </div>

            <div className="w-1/2 flex flex-col bg-emerald-50/30">
              <div className="p-3 border-b border-slate-200 bg-emerald-50/80 text-xs flex justify-between items-center shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-600 text-white px-2.5 py-1 rounded text-xs font-bold">워크북 연결 문항</span>
                  <span className="text-emerald-700 font-bold text-xs">선택된 본교재 기준</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-5 pb-32">
                {!selectedWbId ? <div className="flex h-full items-center justify-center text-slate-400 font-bold">상단에서 워크북을 선택해주세요.</div>
                : activePageNum !== null && groupedMainQs[activePageNum]?.length > 0 ? (
                  <div className="bg-white border border-emerald-200 shadow-sm rounded-xl overflow-hidden">
                    {groupedMainQs[activePageNum].map((mq: any) => {
                      const linkedWbQs = groupedWbQs[mq.tq_id] || [];
                      if (linkedWbQs.length === 0) return null;
                      return linkedWbQs.map((wq: any) => (
                        <div key={wq.tq_id} className="flex border-b border-emerald-50 hover:bg-emerald-50/50 transition-colors items-stretch">
                          <div className="w-12 flex items-center justify-center border-r border-emerald-50 shrink-0 bg-emerald-50/30">
                            <input type="checkbox" checked={checkedWbQs.includes(wq.tq_id)} onChange={(e) => setCheckedWbQs(prev => e.target.checked ? [...prev, wq.tq_id] : prev.filter(id => id !== wq.tq_id))} className="w-[1.1rem] h-[1.1rem] accent-[#059669]" />
                          </div>
                          <div className="w-24 py-2 px-3 flex flex-col justify-center border-r border-emerald-50 shrink-0">
                            <span className="text-emerald-500 font-medium text-[10px] truncate leading-tight">연결: 본 {mq.question_number}번</span>
                            <button onClick={() => setModalQuestion({ ...wq, type: 'wb' })} className="text-emerald-700 font-extrabold text-[14px] text-left hover:text-emerald-500 hover:underline">{wq.question_number || "-"}</button>
                          </div>
                          <div className="py-2 px-3 flex-1 flex items-center font-bold text-slate-800 text-[14px] justify-between">
                            <span className="text-emerald-800 break-all">$ {wq.answer} $</span>
                            {renderBadge(wq.tq_id, 'wb')}
                          </div>
                        </div>
                      ));
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.15)] flex items-center p-2 z-20 gap-2 w-max">
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
                  본교재 진도완료 + 워크북 과제
                </button>
                <button onClick={() => executeProgressAction("MAIN_HW_AND_WB_HW")} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-sm rounded-xl transition-colors shadow-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477-4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                  본교재 과제 + 워크북 과제
                </button>
                <div className="w-px h-6 bg-slate-300 mx-1"></div>
                <button onClick={() => executeProgressAction("CANCEL")} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-600 font-bold text-sm rounded-xl transition-colors shadow-sm">
                  선택 취소
                </button>
              </div>
          </div>
        </div>
      </div>

      {/* 분리된 문항 상세 보기 모달 */}
      <QuestionModal 
        isOpen={!!modalQuestion} 
        question={modalQuestion} 
        onClose={() => setModalQuestion(null)} 
      />

      {toastMsg && (
        <div className="fixed top-20 right-6 z-[9999] bg-slate-800 text-white font-bold px-6 py-3 rounded-xl shadow-2xl transition-all duration-300 text-sm animate-bounce">
          ✨ {toastMsg}
        </div>
      )}
    </div>
  );
}