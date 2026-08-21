// src/app/clinic/ta/grading/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import GradingBoard from "./GradingBoard";
import TaTopBar from "../TaTopBar";
import { useTaEntry } from "../TaEntryGate";

interface StudentInfo {
  id: string;
  name: string;
  className: string;
  classId: string;
  allClassIds: string[];
  pendingExamQ: number;
  pendingHwQ: number;
  pendingPrintQ: number;
}

interface ClassInfo {
  class_id: string;
  name: string;
  students: StudentInfo[];
  totalPending: number;
  hasPendingExam: boolean;
  hasPendingHw: boolean;
  hasPendingPrint: boolean;
}

interface AssignmentItem {
  key: string;
  kind: 'exam' | 'hw';
  examType?: string;
  totalQ: number;
  title: string;
  subtitle: string;
  date: string;
  status: string;
  assignmentId?: string;
  homeworkId?: string;
}

type Step = 'STUDENT' | 'ITEM';

interface ActiveAssignment {
  mode: 'exam' | 'homework';
  assignmentId?: string;
  homeworkId?: string;
  studentId: string;
  studentName: string;
  gradeAll: boolean; 
}

const STATUS_STYLE: Record<string, string> = {
  '채점완료': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  '완료': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  '제출완료': 'bg-rose-100 text-rose-600 border border-rose-200',
  '응시중': 'bg-blue-100 text-blue-600 border border-blue-200',
  '미응시': 'bg-slate-100 text-slate-500 border border-slate-200',
  '미제출': 'bg-slate-100 text-slate-500 border border-slate-200',
};

export default function TaGradingPage() {
  const { taName, ready } = useTaEntry();

  const [step, setStep] = useState<Step>('STUDENT');
  const [isLoading, setIsLoading] = useState(true);

  const [groupedClasses, setGroupedClasses] = useState<ClassInfo[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [selectedStudent, setSelectedStudent] = useState<StudentInfo | null>(null);
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  const [activeItem, setActiveItem] = useState<ActiveAssignment | null>(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);
  
  const [confirmGroup, setConfirmGroup] = useState<{ item: AssignmentItem, count: number } | null>(null);

  useEffect(() => { setActiveDirty(false); }, [activeItem]);

  useEffect(() => {
    if (taName) loadStudents();
  }, [taName]);

  const loadStudents = async () => {
    setIsLoading(true);
    try {
      const tenantId = localStorage.getItem("logica_tenant_id") || "";
      if (!tenantId) { setGroupedClasses([]); setIsLoading(false); return; }

      let classQuery = supabase.from('class').select('class_id, name').order('name');
      if (tenantId !== 'hq') classQuery = classQuery.eq('tenant_id', tenantId);
      const { data: classes } = await classQuery;
      if (!classes || classes.length === 0) { setGroupedClasses([]); setIsLoading(false); return; }

      const classIds = classes.map(c => c.class_id);
      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, student(name, status)').in('class_id', classIds);

      const studentClassMap = new Map<string, { classId: string; className: string }[]>();
      const namesMap: Record<string, string> = {};
      enrollments?.forEach((e: any) => {
        const sObj = Array.isArray(e.student) ? e.student[0] : e.student;
        if (!sObj || sObj.status !== '재원') return;
        namesMap[e.student_id] = sObj.name;
        if (!studentClassMap.has(e.student_id)) studentClassMap.set(e.student_id, []);
        const className = classes.find(c => c.class_id === e.class_id)?.name || '';
        studentClassMap.get(e.student_id)!.push({ classId: e.class_id, className });
      });

      const allStudentIds = Object.keys(namesMap);
      const pendingExamMap: Record<string, number> = {};
      const pendingHwMap: Record<string, number> = {};
      const pendingPrintMap: Record<string, number> = {};

      const { data: pendingExams } = await supabase.from('exam_assignment')
        .select('student_id, status, exam_master!inner(exam_type, total_questions)')
        .in('student_id', allStudentIds)
        .neq('exam_master.exam_type', '입학테스트')
        .neq('exam_master.exam_type', '주간테스트');
        
      pendingExams?.forEach((e: any) => {
        if (['채점완료', '완료'].includes(e.status)) return;
        const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master;
        const qCount = m?.total_questions || 0;
        if (m?.exam_type === '오답프린트') pendingPrintMap[e.student_id] = (pendingPrintMap[e.student_id] || 0) + qCount;
        else if (m?.exam_type === '과제') pendingHwMap[e.student_id] = (pendingHwMap[e.student_id] || 0) + qCount;
        else pendingExamMap[e.student_id] = (pendingExamMap[e.student_id] || 0) + qCount;
      });

      const { data: hws } = await supabase.from('homework_assignment')
        .select('homework_id, class_id, target_student_id, target_questions')
        .in('class_id', classIds)
        .neq('homework_title', '[시스템] 수업 진도 완료 기록');
        
      const hwIds = hws?.map(h => h.homework_id) || [];
      let hwRes: any[] = [];
      if (hwIds.length > 0) {
        const { data } = await supabase.from('student_homework_result').select('homework_id, student_id, status').in('homework_id', hwIds).in('student_id', allStudentIds);
        hwRes = data || [];
      }
      
      const hwResMap = new Map();
      hwRes.forEach(r => hwResMap.set(`${r.homework_id}_${r.student_id}`, r.status));
      
      allStudentIds.forEach(sId => {
        const sClasses = studentClassMap.get(sId) || [];
        let hwQCount = 0;
        hws?.forEach((h: any) => {
          if (h.target_student_id && h.target_student_id !== sId) return;
          if (!h.target_student_id && !sClasses.some(cl => cl.classId === h.class_id)) return;
          const status = hwResMap.get(`${h.homework_id}_${sId}`) || '미제출';
          if (!['채점완료', '완료'].includes(status)) {
            let count = 0;
            try {
              const tqs = typeof h.target_questions === 'string' ? JSON.parse(h.target_questions) : (h.target_questions || []);
              count = tqs.length;
            } catch(err) {}
            hwQCount += count;
          }
        });
        if (hwQCount > 0) pendingHwMap[sId] = (pendingHwMap[sId] || 0) + hwQCount;
      });

      const groups: ClassInfo[] = classes.map(c => {
        const studentsInClass: StudentInfo[] = [];
        let hasPendingExam = false; let hasPendingHw = false; let hasPendingPrint = false; let classTotalPending = 0;

        studentClassMap.forEach((classList, studentId) => {
          if (classList.some(cl => cl.classId === c.class_id)) {
            const exQ = pendingExamMap[studentId] || 0;
            const hwQ = pendingHwMap[studentId] || 0;
            const prQ = pendingPrintMap[studentId] || 0;
            const totalQ = exQ + hwQ + prQ;

            if (exQ > 0) hasPendingExam = true;
            if (hwQ > 0) hasPendingHw = true;
            if (prQ > 0) hasPendingPrint = true;
            classTotalPending += totalQ;

            studentsInClass.push({
              id: studentId, name: namesMap[studentId] || '이름없음', classId: c.class_id, className: c.name, allClassIds: classList.map(cl => cl.classId),
              pendingExamQ: exQ, pendingHwQ: hwQ, pendingPrintQ: prQ
            });
          }
        });

        studentsInClass.sort((a, b) => {
          const aTotal = a.pendingExamQ + a.pendingHwQ + a.pendingPrintQ;
          const bTotal = b.pendingExamQ + b.pendingHwQ + b.pendingPrintQ;
          if (bTotal !== aTotal) return bTotal - aTotal;
          return a.name.localeCompare(b.name);
        });

        return { class_id: c.class_id, name: c.name, students: studentsInClass, hasPendingExam, hasPendingHw, hasPendingPrint, totalPending: classTotalPending };
      }).filter(c => c.students.length > 0);

      groups.sort((a, b) => {
        if (b.totalPending !== a.totalPending) return b.totalPending - a.totalPending;
        return a.name.localeCompare(b.name);
      });

      setGroupedClasses(groups);
    } catch (e) { console.error(e); alert("학생 목록을 불러오지 못했습니다."); } finally { setIsLoading(false); }
  };

  const filteredGroups = useMemo(() => {
    const q = search.trim();
    if (!q) return groupedClasses;
    return groupedClasses.map(c => ({ ...c, students: c.students.filter(s => s.name.includes(q)) })).filter(c => c.students.length > 0);
  }, [groupedClasses, search]);

  useEffect(() => { if (search.trim()) setExpandedClasses(filteredGroups.map(c => c.class_id)); }, [search]);

  const toggleClass = (classId: string) => setExpandedClasses(prev => prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]);

  const handleSelectStudent = (student: StudentInfo) => {
    setSelectedStudent(student);
    setStep('ITEM');
    loadItemsForStudent(student);
  };

  const loadItemsForStudent = async (student: StudentInfo) => {
    setIsLoadingItems(true);
    setItems([]);
    try {
      const { data: exams } = await supabase.from('exam_assignment')
        .select('assignment_id, status, total_score, created_at, exam_master!inner(title, sub_title, exam_type, total_questions)')
        .eq('student_id', student.id).neq('exam_master.exam_type', '입학테스트').neq('exam_master.exam_type', '주간테스트')
        .order('created_at', { ascending: false });

      const examItems: AssignmentItem[] = (exams || [])
        .filter((e: any) => { const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master; return m && (m.total_questions || 0) > 0; })
        .map((e: any) => {
          const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master;
          return {
            key: `exam_${e.assignment_id}`, kind: 'exam', examType: m.exam_type, totalQ: m.total_questions || 0,
            title: m?.title || '제목 없음', subtitle: m?.exam_type === '과제' ? '시험지(과제유형)' : (m?.sub_title || '시험'),
            date: e.created_at, status: ['채점완료', '완료'].includes(e.status) ? `채점완료 (${e.total_score ?? 0}점)` : (e.status || '미응시'), assignmentId: String(e.assignment_id),
          };
        });

      const { data: allHws } = await supabase.from('homework_assignment')
        .select('homework_id, class_id, homework_title, target_student_id, target_questions, created_at, due_date, textbook(title)')
        .in('class_id', student.allClassIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');

      const relevantHws = (allHws || []).filter((h: any) => !h.target_student_id || h.target_student_id === student.id);
      const hwIds = relevantHws.map((h: any) => h.homework_id);

      let resultMap = new Map<number, any>();
      if (hwIds.length > 0) {
        const { data: hwResults } = await supabase.from('student_homework_result').select('*').eq('student_id', student.id).in('homework_id', hwIds);
        hwResults?.forEach((r: any) => resultMap.set(r.homework_id, r));
      }

      const hwItems: AssignmentItem[] = relevantHws
        .filter((h: any) => { let targetQs = []; try { targetQs = typeof h.target_questions === 'string' ? JSON.parse(h.target_questions) : (h.target_questions || []); } catch(e){} return targetQs.length > 0; })
        .map((h: any) => {
          let targetQs = []; try { targetQs = typeof h.target_questions === 'string' ? JSON.parse(h.target_questions) : (h.target_questions || []); } catch(e){}
          const res = resultMap.get(h.homework_id); const tb = Array.isArray(h.textbook) ? h.textbook[0] : h.textbook;
          return {
            key: `hw_${h.homework_id}`, kind: 'hw', totalQ: targetQs.length, title: h.homework_title || '교재 과제',
            subtitle: tb?.title || '교재', date: h.due_date || h.created_at, status: res?.status || '미제출', homeworkId: String(h.homework_id),
          };
        });

      setItems([...examItems, ...hwItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (e) { console.error(e); alert("문제지/과제 목록을 불러오지 못했습니다."); } finally { setIsLoadingItems(false); }
  };

  // 🌟 [핵심 수정 1] 인원 수 카운트 오류 해결: 상태(Status)가 동일한 개별 과제들만 그룹으로 묶어 고유 학생 수를 카운트
  const checkGroupGrading = async (item: AssignmentItem) => {
    if (!selectedStudent) return;
    if (activeItem && !confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지를 바꾸시겠습니까?')) return;

    setIsLoadingItems(true);
    try {
      let count = 1;
      if (item.kind === 'exam') {
        const { data: ex } = await supabase.from('exam_assignment').select('exam_id, class_id').eq('assignment_id', item.assignmentId).single();
        if (ex) {
          const { count: c } = await supabase.from('exam_assignment').select('*', { count: 'exact', head: true }).eq('exam_id', ex.exam_id).eq('class_id', ex.class_id);
          count = c || 1;
        }
      } else {
        const { data: hw } = await supabase.from('homework_assignment').select('homework_title, class_id').eq('homework_id', item.homeworkId).single();
        if (hw) {
          const { data: hws } = await supabase.from('homework_assignment').select('homework_id, target_student_id').eq('class_id', hw.class_id).eq('homework_title', hw.homework_title);
          
          if (hws && hws.length > 0) {
            const hwIds = hws.map(h => h.homework_id);
            const { data: res } = await supabase.from('student_homework_result').select('homework_id, status').in('homework_id', hwIds);
            
            // 현재 클릭한 과제 바구니의 상태 파악
            const baseRes = res?.find(r => String(r.homework_id) === String(item.homeworkId));
            const isBaseCompleted = ['채점완료', '제출완료', '완료'].includes(baseRes?.status || '');

            // 동일한 상태(미제출은 미제출끼리, 완료는 완료끼리)인 학생들만 필터링
            const matchingHws = hws.filter(h => {
              const r = res?.find(resItem => resItem.homework_id === h.homework_id);
              const isComp = ['채점완료', '제출완료', '완료'].includes(r?.status || '');
              return isComp === isBaseCompleted;
            });

            // 해당 그룹의 고유 학생 수 계산 (중복 배정 방어)
            const uniqueStudents = new Set(matchingHws.map(h => h.target_student_id).filter(Boolean));
            count = uniqueStudents.size > 0 ? uniqueStudents.size : 1;
          }
        }
      }

      setIsLoadingItems(false);
      if (count > 1) {
        setConfirmGroup({ item, count });
      } else {
        executeSelect(item, false);
      }
    } catch (e) {
      console.error(e);
      setIsLoadingItems(false);
      executeSelect(item, false);
    }
  };

  const executeSelect = (item: AssignmentItem, gradeAll: boolean) => {
    setActiveItem(item.kind === 'exam' 
      ? { mode: 'exam', assignmentId: item.assignmentId, studentId: selectedStudent!.id, studentName: selectedStudent!.name, gradeAll }
      : { mode: 'homework', homeworkId: item.homeworkId, studentId: selectedStudent!.id, studentName: selectedStudent!.name, gradeAll }
    );
    setConfirmGroup(null);
    setPickerOpen(false);
    setStep('STUDENT');
    setSelectedStudent(null);
  };

  const confirmLeaveIfDirty = (message: string) => !activeDirty || confirm(message);

  const openItemPickerForActive = () => {
    if (!confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지 선택 화면으로 이동하시겠습니까?')) return;
    let found: StudentInfo | null = null;
    for (const c of groupedClasses) {
      const s = c.students.find(st => st.id === activeItem?.studentId);
      if (s) { found = s; break; }
    }
    const student: StudentInfo = found || { id: activeItem!.studentId, name: activeItem!.studentName, className: '', classId: '', allClassIds: [], pendingExamQ: 0, pendingHwQ: 0, pendingPrintQ: 0 };
    setSelectedStudent(student);
    setStep('ITEM');
    setPickerOpen(true);
    loadItemsForStudent(student);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  if (!ready) return <div className="h-screen bg-slate-100" />;

  const pickerBlock = (
    <>
      {step === 'STUDENT' && (
        <div className="max-w-2xl mx-auto h-full flex flex-col w-full">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="학생 이름으로 검색..." className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 focus:outline-none focus:border-[#002864] bg-white shadow-sm mb-3" />
          <div className="flex-1 overflow-y-auto custom-scroll bg-white rounded-xl border border-slate-200 shadow-sm">
            {isLoading ? <div className="p-10 text-center text-slate-400 font-bold text-sm">학생 목록을 불러오는 중...</div> : filteredGroups.length === 0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">일치하는 학생이 없습니다.</div> : (
              filteredGroups.map(c => {
                const isOpen = expandedClasses.includes(c.class_id);
                return (
                  <div key={c.class_id} className="border-b border-slate-100 last:border-0">
                    <button onClick={() => toggleClass(c.class_id)} className={`w-full flex justify-between items-center px-4 py-2.5 transition-colors ${isOpen ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                      <span className="font-bold text-[12px] text-[#002864] flex items-center gap-1.5">
                        📁 {c.name}
                        <span className="text-slate-400 font-medium text-[10px]">({c.students.length}명)</span>
                        {(c.hasPendingExam || c.hasPendingHw || c.hasPendingPrint) && (
                          <div className="flex gap-0.5 ml-1">
                            {c.hasPendingExam && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="미채점 시험 있음"></span>}
                            {c.hasPendingHw && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="미채점 과제 있음"></span>}
                            {c.hasPendingPrint && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="미채점 오답프린트 있음"></span>}
                          </div>
                        )}
                      </span>
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col bg-slate-50/50">
                        {c.students.map(s => (
                          <button key={s.id} onClick={() => handleSelectStudent(s)} className="w-full text-left pl-9 pr-4 py-2.5 text-[12px] font-bold text-slate-600 hover:bg-blue-50 hover:text-[#002864] transition-colors border-t border-slate-100/80 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 truncate">
                              👤 {s.name}
                              <div className="flex items-center gap-1 shrink-0">
                                {s.pendingExamQ > 0 && <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 w-5 h-5 rounded-full font-black text-[9px] shadow-sm border border-blue-200">{s.pendingExamQ}</span>}
                                {s.pendingHwQ > 0 && <span className="inline-flex items-center justify-center bg-amber-100 text-amber-700 w-5 h-5 rounded-full font-black text-[9px] shadow-sm border border-amber-200">{s.pendingHwQ}</span>}
                                {s.pendingPrintQ > 0 && <span className="inline-flex items-center justify-center bg-emerald-100 text-emerald-700 w-5 h-5 rounded-full font-black text-[9px] shadow-sm border border-emerald-200">{s.pendingPrintQ}</span>}
                              </div>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {step === 'ITEM' && selectedStudent && (
        <div className="max-w-2xl mx-auto h-full flex flex-col w-full">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex items-center gap-2">
            <span className="text-sm font-black text-[#002864]">👤 {selectedStudent.name}</span>
            <span className="text-[11px] text-slate-400 font-semibold">{selectedStudent.className}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {isLoadingItems ? <div className="p-10 text-center text-slate-400 font-bold text-sm">불러오는 중...</div> : items.length === 0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">이 학생에게 나간 시험지/과제가 없습니다.</div> : (
              items.map(item => {
                let badgeLabel = '시험'; let badgeColor = 'bg-blue-100 text-blue-700';
                if (item.kind === 'hw' || item.examType === '과제') { badgeLabel = '과제'; badgeColor = 'bg-amber-100 text-amber-700'; } 
                else if (item.examType === '오답프린트') { badgeLabel = '오답'; badgeColor = 'bg-emerald-100 text-emerald-700'; }

                return (
                  <button key={item.key} onClick={() => checkGroupGrading(item)} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${badgeColor}`}>{badgeLabel}</span>
                        <span className="text-[13px] font-bold text-slate-700 truncate">{item.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">{item.subtitle} · {formatDate(item.date)} <span className="font-bold text-slate-500 ml-1">· 총 {item.totalQ}문항</span></p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-extrabold px-2 py-1 rounded whitespace-nowrap ${STATUS_STYLE[item.status] || STATUS_STYLE[item.status.split(' ')[0]] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {item.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      <TaTopBar taName={taName} />
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex flex-col">
          <h1 className="font-lexend text-lg font-bold text-[#002864] tracking-tight leading-none">Logica Clinic <span className="text-slate-300 mx-1">·</span> 조교 채점</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
              <button onClick={() => { setStep('STUDENT'); setPickerOpen(true); }} className={`px-2 py-0.5 rounded transition-all ${pickerOpen && step === 'STUDENT' ? 'bg-[#002864] text-white font-bold shadow-sm' : 'hover:bg-slate-100 hover:text-slate-600'}`}>1. 기준 학생 선택</button>
              <span className="text-slate-300">→</span>
              <button onClick={() => { if(!selectedStudent && !activeItem) return alert('먼저 학생을 선택해주세요.'); setStep('ITEM'); setPickerOpen(true); }} className={`px-2 py-0.5 rounded transition-all ${pickerOpen && step === 'ITEM' ? 'bg-[#002864] text-white font-bold shadow-sm' : 'hover:bg-slate-100 hover:text-slate-600'}`}>2. 문제지 선택</button>
              <span className="text-slate-300">→</span>
              <button onClick={() => { if(!activeItem) return alert('선택된 문제지가 없습니다.'); setPickerOpen(false); }} className={`px-2 py-0.5 rounded transition-all ${!pickerOpen ? 'bg-[#002864] text-white font-bold shadow-sm' : 'hover:bg-slate-100 hover:text-slate-600'}`}>3. 스프레드시트 채점</button>
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative flex">
        <div className="flex-1 overflow-hidden relative">
          {!activeItem ? (
            <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm px-6 text-center">
              학생과 문제지를 골라 채점을 시작하세요.
            </div>
          ) : (
            <div className="h-full flex flex-col bg-slate-100">
              <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-black text-[#002864] truncate">
                  👤 {activeItem.studentName} 학생 기준 {activeItem.gradeAll ? '전체 조망 중' : '개별 조회 중'}
                </span>
                <button onClick={openItemPickerForActive} className="shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-1 transition-colors">
                  🔄 다른 문제지 선택
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <GradingBoard
                  mode={activeItem.mode}
                  assignmentId={activeItem.assignmentId}
                  homeworkId={activeItem.homeworkId}
                  studentId={activeItem.studentId}
                  gradeAll={activeItem.gradeAll}
                  onBack={() => { setActiveItem(null); setPickerOpen(true); }}
                  onDirtyChange={setActiveDirty}
                />
              </div>
            </div>
          )}

          {pickerOpen && !confirmGroup && (
            <div className={`absolute inset-0 z-20 flex flex-col ${activeItem ? 'bg-slate-900/40 backdrop-blur-sm p-4 sm:p-6' : ''}`}>
              <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${activeItem ? 'bg-slate-50 rounded-2xl shadow-2xl p-4 sm:p-6 max-w-2xl w-full mx-auto' : 'p-4 sm:p-6'}`}>
                {activeItem && (
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <span className="text-xs font-bold text-slate-400">새롭게 채점할 문제지를 다시 골라주세요</span>
                    <button onClick={() => setPickerOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">닫기 ✕</button>
                  </div>
                )}
                {pickerBlock}
              </div>
            </div>
          )}

          {confirmGroup && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-w-md w-full animate-[fadeIn_0.2s_ease-out]">
                <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
                  <h2 className="font-bold text-lg flex items-center gap-2"><span>👥</span> 채점 방식 선택</h2>
                  <button onClick={() => setConfirmGroup(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
                </div>
                <div className="p-6 text-center flex flex-col gap-4">
                  <div className="text-4xl mb-2">📊</div>
                  <h3 className="text-lg font-black text-slate-800">
                    반 전체 <span className="text-rose-500">{confirmGroup.count}명</span>이 보유한 항목입니다.
                  </h3>
                  <p className="text-sm font-bold text-slate-500 break-keep">
                    선택하신 <span className="text-[#002864] font-extrabold">{confirmGroup.item.title}</span> 항목은 같은 반 내의 다른 학생들에게도 동일하게 나갔습니다.
                    <br/><br/>해당 학생들을 한 화면에 나열하여 한 번에 채점하시겠습니까?
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-center gap-3 shrink-0">
                  <button onClick={() => executeSelect(confirmGroup.item, false)} className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-lg shadow-sm transition-colors text-sm">
                    👤 {selectedStudent?.name} 학생만 채점
                  </button>
                  <button onClick={() => executeSelect(confirmGroup.item, true)} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm transition-colors text-sm">
                    👥 반 전체 동시 채점
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}