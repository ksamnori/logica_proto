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
  pendingOverdueQ: number;
  pendingPrintQ: number;
  pendingSimilarQ: number;
}

interface ClassInfo {
  class_id: string;
  name: string;
  teacherName?: string;
  students: StudentInfo[];
  totalPending: number;
  hasPendingExam: boolean;
  hasPendingHw: boolean;
  hasPendingOverdue: boolean;
  hasPendingPrint: boolean;
  hasPendingSimilar: boolean;
}

interface AssignmentItem {
  key: string;
  kind: 'exam' | 'hw' | 'hw_exam' | 'print' | 'similar' | 'overdue';
  examType?: string;
  totalQ: number;
  title: string;
  subtitle: string;
  date: string;
  status: string;
  assignmentId?: string;
  homeworkId?: string;
  masterId?: string;
  target_questions?: any[];
}

type Step = 'STUDENT' | 'ITEM';

interface Panel {
  id: string;
  mode: 'exam' | 'homework';
  assignmentId?: string;
  homeworkId?: string;
  studentId: string;
  studentName: string;
  title: string;
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

const purgeOldSession = () => {
  const keysToRemove = [
    'restoreExamQuestions', 'examQuestions', 'examTitle', 'examSubTitle', 'examType',
    'editOriginalType', 'editOriginalId', 'editStudentId', 'editClassId', 'editMasterId',
    'examUserMergedTextQuestions', 'clinicTargetStudentId', 'clinicTargetClassId',
    'editHomeworkId', 'editExamId', 'duplicateExamId'
  ];
  keysToRemove.forEach(k => sessionStorage.removeItem(k));
};

const getKstDateStr = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
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

  const [panels, setPanels] = useState<Panel[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [isStateLoaded, setIsStateLoaded] = useState(false);

  const [activeDirty, setActiveDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);

  const [confirmGroup, setConfirmGroup] = useState<{ item: AssignmentItem, count: number, student: StudentInfo } | null>(null);

  useEffect(() => {
    const savedPanels = sessionStorage.getItem('logica_ta_panels');
    const savedActive = sessionStorage.getItem('logica_ta_active_panel');
    let loadedPanels = [];
    if (savedPanels) {
      try {
        loadedPanels = JSON.parse(savedPanels);
        setPanels(loadedPanels);
      } catch (e) {}
    }
    if (savedActive) setActivePanelId(savedActive);
    
    if (loadedPanels.length > 0) setPickerOpen(false); 
    
    setIsStateLoaded(true);
  }, []);

  useEffect(() => {
    if (!isStateLoaded) return;
    if (panels.length > 0) sessionStorage.setItem('logica_ta_panels', JSON.stringify(panels));
    else sessionStorage.removeItem('logica_ta_panels');
  }, [panels, isStateLoaded]);

  useEffect(() => {
    if (!isStateLoaded) return;
    if (activePanelId) sessionStorage.setItem('logica_ta_active_panel', activePanelId);
    else sessionStorage.removeItem('logica_ta_active_panel');
    setActiveDirty(false);
  }, [activePanelId, isStateLoaded]);

  useEffect(() => {
    if (taName) loadStudents();
  }, [taName]);

  const loadStudents = async () => {
    setIsLoading(true);
    try {
      const tenantId = localStorage.getItem("logica_tenant_id") || "";
      if (!tenantId) { setGroupedClasses([]); setIsLoading(false); return; }

      // 🌟 class 테이블에서 instructor 테이블을 조인하여 강사 이름을 함께 가져옵니다.
      let classQuery = supabase.from('class').select('*, instructor(name)').order('name');
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
      const pendingOverdueMap: Record<string, number> = {};
      const pendingPrintMap: Record<string, number> = {};
      const pendingSimilarMap: Record<string, number> = {};

      const { data: pendingExams } = await supabase.from('exam_assignment')
        .select('student_id, status, exam_master!inner(exam_type, total_questions)')
        .in('student_id', allStudentIds)
        .neq('exam_master.exam_type', '입학테스트')
        .neq('exam_master.exam_type', '주간테스트');
        
      pendingExams?.forEach((e: any) => {
        if (['채점완료', '완료'].includes(e.status)) return;
        const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master;
        const qCount = m?.total_questions || 0;
        
        if (['오답프린트', '오답'].includes(m?.exam_type)) pendingPrintMap[e.student_id] = (pendingPrintMap[e.student_id] || 0) + qCount;
        else if (['오답유사', '과제오답유사'].includes(m?.exam_type)) pendingSimilarMap[e.student_id] = (pendingSimilarMap[e.student_id] || 0) + qCount;
        else if (m?.exam_type === '미완료과제') pendingOverdueMap[e.student_id] = (pendingOverdueMap[e.student_id] || 0) + qCount;
        else if (['과제', '과제프린트'].includes(m?.exam_type)) pendingHwMap[e.student_id] = (pendingHwMap[e.student_id] || 0) + qCount;
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
        let hasPendingExam = false; let hasPendingHw = false; let hasPendingOverdue = false; let hasPendingPrint = false; let hasPendingSimilar = false; let classTotalPending = 0;

        studentClassMap.forEach((classList, studentId) => {
          if (classList.some(cl => cl.classId === c.class_id)) {
            const exQ = pendingExamMap[studentId] || 0;
            const hwQ = pendingHwMap[studentId] || 0;
            const ovQ = pendingOverdueMap[studentId] || 0;
            const prQ = pendingPrintMap[studentId] || 0;
            const simQ = pendingSimilarMap[studentId] || 0;
            const totalQ = exQ + hwQ + ovQ + prQ + simQ;

            if (exQ > 0) hasPendingExam = true;
            if (hwQ > 0) hasPendingHw = true;
            if (ovQ > 0) hasPendingOverdue = true;
            if (prQ > 0) hasPendingPrint = true;
            if (simQ > 0) hasPendingSimilar = true;
            classTotalPending += totalQ;

            studentsInClass.push({
              id: studentId, name: namesMap[studentId] || '이름없음', classId: c.class_id, className: c.name, allClassIds: classList.map(cl => cl.classId),
              pendingExamQ: exQ, pendingHwQ: hwQ, pendingOverdueQ: ovQ, pendingPrintQ: prQ, pendingSimilarQ: simQ
            });
          }
        });

        studentsInClass.sort((a, b) => {
          const aTotal = a.pendingExamQ + a.pendingHwQ + a.pendingOverdueQ + a.pendingPrintQ + a.pendingSimilarQ;
          const bTotal = b.pendingExamQ + b.pendingHwQ + b.pendingOverdueQ + b.pendingPrintQ + b.pendingSimilarQ;
          if (bTotal !== aTotal) return bTotal - aTotal;
          return a.name.localeCompare(b.name);
        });

        // 🌟 조인된 instructor 객체에서 이름을 추출
        const instObj = Array.isArray(c.instructor) ? c.instructor[0] : c.instructor;
        const extractedTeacherName = instObj?.name || '';

        return { 
          class_id: c.class_id, 
          name: c.name, 
          teacherName: extractedTeacherName,
          students: studentsInClass, 
          hasPendingExam, hasPendingHw, hasPendingOverdue, hasPendingPrint, hasPendingSimilar, 
          totalPending: classTotalPending 
        };
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
        .select('assignment_id, status, total_score, created_at, exam_master!inner(exam_id, title, sub_title, exam_type, total_questions)')
        .eq('student_id', student.id).neq('exam_master.exam_type', '입학테스트').neq('exam_master.exam_type', '주간테스트')
        .order('created_at', { ascending: false });

      const examItems: AssignmentItem[] = (exams || [])
        .filter((e: any) => { const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master; return m && (m.total_questions || 0) > 0; })
        .map((e: any) => {
          const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master;
          
          let kind: 'exam' | 'hw' | 'hw_exam' | 'print' | 'similar' | 'overdue' = 'exam';
          
          if (m?.exam_type === '미완료과제') kind = 'overdue';
          else if (['과제', '과제프린트'].includes(m?.exam_type)) kind = 'hw_exam';
          else if (['오답프린트', '오답'].includes(m?.exam_type)) kind = 'print';
          else if (['오답유사', '과제오답유사'].includes(m?.exam_type)) kind = 'similar';

          let subTitleStr = m?.sub_title || '시험';
          if (kind === 'hw_exam') subTitleStr = '맞춤 과제(프린트)';
          else if (kind === 'overdue') subTitleStr = '미완료 과제';
          
          const rawTitle = m?.title || '제목 없음';
          const cleanTitle = rawTitle.replace(/\[시스템\]\s*/g, '');
          
          return {
            key: `exam_${e.assignment_id}`, kind, examType: m.exam_type, totalQ: m.total_questions || 0,
            title: cleanTitle, subtitle: subTitleStr,
            date: e.created_at, status: ['채점완료', '완료'].includes(e.status) ? `채점완료 (${e.total_score ?? 0}점)` : (e.status || '미응시'), 
            assignmentId: String(e.assignment_id), masterId: m?.exam_id,
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
          
          const rawTitle = h.homework_title || '교재 과제';
          const cleanTitle = rawTitle.replace(/\[시스템\]\s*/g, '');
          
          return {
            key: `hw_${h.homework_id}`, kind: 'hw', totalQ: targetQs.length, title: cleanTitle,
            subtitle: tb?.title || '교재', date: h.due_date || h.created_at, status: res?.status || '미제출', 
            homeworkId: String(h.homework_id), target_questions: targetQs
          };
        });

      setItems([...examItems, ...hwItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (e) { console.error(e); alert("문제지/과제 목록을 불러오지 못했습니다."); } finally { setIsLoadingItems(false); }
  };

  const checkGroupGrading = async (item: AssignmentItem, student: StudentInfo) => {
    if (student.id === activePanelId && !confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지를 바꾸시겠습니까?')) return;

    setIsLoadingItems(true);
    try {
      let count = 1;
      
      if (['exam', 'hw_exam', 'print', 'similar', 'overdue'].includes(item.kind)) {
        const { data: baseEx } = await supabase.from('exam_assignment').select('exam_id, class_id, exam_master!inner(title)').eq('assignment_id', item.assignmentId).single();
        
        if (baseEx && baseEx.class_id) {
          const m = Array.isArray(baseEx.exam_master) ? baseEx.exam_master[0] : baseEx.exam_master;
          const exTitle = m?.title;
          
          const { data: masters } = await supabase.from('exam_master').select('exam_id').eq('title', exTitle);
          const masterIds = masters?.map(x => x.exam_id) || [];
          
          const { data: assigns } = await supabase.from('exam_assignment').select('student_id').in('exam_id', masterIds).eq('class_id', baseEx.class_id);
          
          const { data: enrolls } = await supabase.from('enrollment').select('student_id, student(status)').eq('class_id', baseEx.class_id);
          const currentEnrolledIds = new Set(
            enrolls?.filter((e: any) => (Array.isArray(e.student) ? e.student[0] : e.student)?.status === '재원').map(e => String(e.student_id))
          );
          
          const validStudentIds = new Set(
            assigns?.filter(a => currentEnrolledIds.has(String(a.student_id))).map(a => String(a.student_id))
          );
          
          count = validStudentIds.size || 1;
        }
      } else {
        const { data: baseHw } = await supabase.from('homework_assignment').select('homework_title, class_id').eq('homework_id', item.homeworkId).single();
        
        if (baseHw && baseHw.class_id) {
          const { data: hws } = await supabase.from('homework_assignment').select('target_student_id').eq('homework_title', baseHw.homework_title).eq('class_id', baseHw.class_id);
          
          const { data: enrolls } = await supabase.from('enrollment').select('student_id, student(status)').eq('class_id', baseHw.class_id);
          const currentEnrolledIds = new Set(
            enrolls?.filter((e: any) => (Array.isArray(e.student) ? e.student[0] : e.student)?.status === '재원').map(e => String(e.student_id))
          );
          
          const hasGlobal = hws?.some(h => !h.target_student_id);
          if (hasGlobal) {
            count = currentEnrolledIds.size || 1;
          } else {
            const validStudentIds = new Set(
              hws?.filter(h => h.target_student_id && currentEnrolledIds.has(String(h.target_student_id))).map(h => String(h.target_student_id))
            );
            count = validStudentIds.size || 1;
          }
        }
      }

      setIsLoadingItems(false);
      if (count > 1) {
        setConfirmGroup({ item, count, student });
      } else {
        executeSelect(item, student, false);
      }
    } catch (e) {
      console.error(e);
      setIsLoadingItems(false);
      executeSelect(item, student, false); 
    }
  };

  const executeSelect = (item: AssignmentItem, student: StudentInfo, gradeAll: boolean) => {
    const panelId = gradeAll ? `group_${item.assignmentId || item.homeworkId}` : student.id;

    const panel: Panel = {
      id: panelId,
      mode: ['exam', 'hw_exam', 'print', 'similar', 'overdue'].includes(item.kind) ? 'exam' : 'homework',
      assignmentId: item.assignmentId,
      homeworkId: item.homeworkId,
      studentId: student.id,
      studentName: student.name,
      title: item.title,
      gradeAll
    };

    setPanels(prev => {
      const idx = prev.findIndex(p => p.id === panel.id);
      if (idx === -1) return [...prev, panel];
      const next = [...prev];
      next[idx] = panel;
      return next;
    });
    setActivePanelId(panel.id);
    setConfirmGroup(null);
    setPickerOpen(false);
    setStep('STUDENT');
    setSelectedStudent(null);
  };

  const confirmLeaveIfDirty = (message: string) => !activeDirty || confirm(message);

  const closePanel = (id: string) => {
    if (id === activePanelId && !confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
    const next = panels.filter(p => p.id !== id);
    setPanels(next);
    if (activePanelId === id) setActivePanelId(next[0]?.id ?? null);
  };

  const switchPanel = (id: string) => {
    if (id === activePanelId) return;
    if (!confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 다른 탭으로 이동하시겠습니까?')) return;
    setActivePanelId(id);
  };

  const openPicker = () => {
    setStep('STUDENT');
    setSelectedStudent(null);
    setPickerOpen(true);
  };

  const openItemPickerForPanel = (panel: Panel) => {
    if (!confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지 선택 화면으로 이동하시겠습니까?')) return;
    let found: StudentInfo | null = null;
    for (const c of groupedClasses) {
      const s = c.students.find(st => st.id === panel.studentId);
      if (s) { found = s; break; }
    }
    const student: StudentInfo = found || { id: panel.studentId, name: panel.studentName, className: '', classId: '', allClassIds: [], pendingExamQ: 0, pendingHwQ: 0, pendingPrintQ: 0, pendingSimilarQ: 0, pendingOverdueQ: 0 };
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

  const handleEditExamToStep2 = async (e: React.MouseEvent, assignId: any, masterId: any, title: string, subTitle: string, studentName: string, studentId: string, classId: string, examType: string) => {
    e.stopPropagation();
    if (!masterId || !assignId) return alert('시험지 정보를 찾을 수 없습니다.');
    
    try {
      setIsLoading(true);
      const { data: items, error } = await supabase.from('exam_item').select('question_id').eq('exam_id', masterId).order('sort_order');
      if (error) throw error;
      
      const qIds = items?.map(i => String(i.question_id)) || [];
      if (qIds.length === 0) return alert('연결된 문제 데이터를 찾을 수 없습니다.');

      const { data: masterData } = await supabase.from('exam_master').select('layout_settings').eq('exam_id', masterId).single();

      purgeOldSession();

      const safeStudentName = studentName && studentName !== '알수없음' ? `[${studentName}] ` : '';
      const finalTitle = title.startsWith('[') ? title : `${safeStudentName}${title || '문제지 수정'}`;

      sessionStorage.setItem('restoreExamQuestions', '1');
      sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
      sessionStorage.setItem('examTitle', finalTitle);
      sessionStorage.setItem('examSubTitle', subTitle || '');
      sessionStorage.setItem('examType', examType || '오답프린트');
      
      if (masterData?.layout_settings?.userMergedTextQuestions) {
         sessionStorage.setItem('examUserMergedTextQuestions', JSON.stringify(masterData.layout_settings.userMergedTextQuestions));
      }

      sessionStorage.setItem('editOriginalType', 'exam');
      sessionStorage.setItem('editOriginalId', String(assignId));
      sessionStorage.setItem('editMasterId', String(masterId));
      sessionStorage.setItem('editStudentId', String(studentId));
      sessionStorage.setItem('editClassId', String(classId));

      window.location.href = '/exam/step2?source=edit';
    } catch (err: any) {
      console.error(err);
      alert('문항 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditHomeworkToStep2 = async (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string, subTitle?: string, studentName?: string, studentId?: string, classId?: string) => {
    e.stopPropagation();
    if (!targetQuestions || targetQuestions.length === 0) { alert('수정할 문항이 없습니다.'); return; }

    try {
      setIsLoading(true);
      const tqIds = targetQuestions.map(id => Number(id)).filter(id => !isNaN(id));
      const { data: tqData, error } = await supabase.from('textbook_question').select('tq_id, question_id').in('tq_id', tqIds);
      if (error) throw error;

      const tqMap = new Map();
      tqData?.forEach(item => { if (item.question_id) tqMap.set(item.tq_id, item.question_id); });
      const qIds = tqIds.map(id => tqMap.get(id)).filter(Boolean);

      if (qIds.length === 0) { alert('연결된 문제 데이터를 찾을 수 없습니다.'); return; }

      const safeStudentName = studentName && studentName !== '알수없음' ? `[${studentName}] ` : '';
      const finalTitle = `${safeStudentName}${title || '과제 문항 수정'}`;

      purgeOldSession();

      sessionStorage.setItem('restoreExamQuestions', '1');
      sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
      sessionStorage.setItem('examTitle', finalTitle);
      sessionStorage.setItem('examSubTitle', subTitle || '교재 과제'); 
      sessionStorage.setItem('examType', '과제프린트');

      sessionStorage.setItem('editOriginalType', 'hw');
      sessionStorage.setItem('editOriginalId', String(hwId));
      sessionStorage.setItem('editStudentId', String(studentId));
      sessionStorage.setItem('editClassId', String(classId));

      window.location.href = '/exam/step2?source=edit';

    } catch (err: any) {
      console.error(err);
      alert('문항 정보를 불러오는 중 오류가 발생했습니다.');
    } finally { setIsLoading(false); }
  };

  // 🌟 반 정렬 로직 (U -> M -> A -> T -> H -> 나머지 순)
  const classSort = (a: ClassInfo, b: ClassInfo) => {
    const order: Record<string, number> = { 'U': 1, 'M': 2, 'A': 3, 'T': 4, 'H': 5 };
    const aFirst = a.name.charAt(0).toUpperCase();
    const bFirst = b.name.charAt(0).toUpperCase();

    const aRank = order[aFirst] !== undefined ? order[aFirst] : 99;
    const bRank = order[bFirst] !== undefined ? order[bFirst] : 99;

    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  };

  // 🌟 4분할 레이아웃을 위한 그룹핑 (커스텀 정렬 적용)
  const mfGroups = filteredGroups.filter(c => c.name.includes('MF')).sort(classSort);
  const ttGroups = filteredGroups.filter(c => c.name.includes('TT')).sort(classSort);
  const wsGroups = filteredGroups.filter(c => c.name.includes('WS')).sort(classSort);
  const otherGroups = filteredGroups.filter(c => !c.name.includes('MF') && !c.name.includes('TT') && !c.name.includes('WS')).sort(classSort);

  // 🌟 컬럼 렌더링 헬퍼
  const renderClassColumn = (title: string, groups: ClassInfo[]) => (
    <div className="flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
      <div className="bg-[#002864]/5 border-b border-slate-200 px-3 py-2 shrink-0 flex justify-between items-center">
        <h3 className="font-extrabold text-[12px] text-[#002864]">{title}</h3>
        <span className="text-[10px] font-bold text-[#002864] bg-blue-100/50 border border-blue-200 px-1.5 py-0.5 rounded-full leading-none">{groups.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-2">
        {groups.length === 0 ? (
          <div className="p-4 text-center text-slate-400 text-[11px] font-bold">해당 반이 없습니다.</div>
        ) : groups.map(c => {
          const isOpen = expandedClasses.includes(c.class_id);
          return (
            <div key={c.class_id} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <button onClick={() => toggleClass(c.class_id)} className={`w-full flex flex-col px-3 py-2 transition-colors ${isOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'}`}>
                <div className="w-full flex justify-between items-center mb-1">
                  <span className="font-black text-[12px] text-[#002864] truncate" title={c.name}>📁 {c.name}</span>
                  <svg className={`shrink-0 w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
                <div className="w-full flex justify-between items-center mt-1">
                  {/* 🌟 선생님 이름과 인원수 분리 표시 */}
                  <span className="text-[10px] font-bold text-slate-500 truncate shrink min-w-0" title={c.teacherName || '미지정'}>
                    👨‍🏫 {c.teacherName || '미지정'}
                    <span className="text-slate-300 mx-1.5">|</span>
                    {c.students.length}명
                  </span>
                  {(c.hasPendingExam || c.hasPendingHw || c.hasPendingOverdue || c.hasPendingPrint || c.hasPendingSimilar) && (
                    <div className="flex gap-1 shrink-0 ml-2">
                      {c.hasPendingExam && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="미채점 시험"></span>}
                      {c.hasPendingHw && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="미채점 과제"></span>}
                      {c.hasPendingOverdue && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" title="미완료과제"></span>}
                      {c.hasPendingPrint && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="오답프린트"></span>}
                      {c.hasPendingSimilar && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" title="오답유사"></span>}
                    </div>
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="flex flex-col bg-slate-50 border-t border-slate-100">
                  {c.students.map(s => {
                    const alreadyOpen = panels.some(p => p.studentId === s.id && !p.gradeAll);
                    return (
                      <button key={s.id} onClick={() => handleSelectStudent(s)} className="w-full text-left pl-4 pr-3 py-2.5 text-[11px] font-bold text-slate-700 hover:bg-blue-100 hover:text-[#002864] transition-colors border-b border-slate-100/50 last:border-0 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate">
                          👤 {s.name}
                          <div className="flex items-center gap-0.5 shrink-0">
                            {s.pendingExamQ > 0 && <span className="w-3.5 h-3.5 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-black text-[8px] shadow-sm border border-blue-200" title="시험">{s.pendingExamQ}</span>}
                            {s.pendingHwQ > 0 && <span className="w-3.5 h-3.5 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full font-black text-[8px] shadow-sm border border-amber-200" title="과제">{s.pendingHwQ}</span>}
                            {s.pendingOverdueQ > 0 && <span className="w-3.5 h-3.5 flex items-center justify-center bg-rose-100 text-rose-700 rounded-full font-black text-[8px] shadow-sm border border-rose-200" title="미완료과제">{s.pendingOverdueQ}</span>}
                            {s.pendingPrintQ > 0 && <span className="w-3.5 h-3.5 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full font-black text-[8px] shadow-sm border border-emerald-200" title="오답">{s.pendingPrintQ}</span>}
                            {s.pendingSimilarQ > 0 && <span className="w-3.5 h-3.5 flex items-center justify-center bg-violet-100 text-violet-700 rounded-full font-black text-[8px] shadow-sm border border-violet-200" title="유사">{s.pendingSimilarQ}</span>}
                          </div>
                        </span>
                        {alreadyOpen && <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">열림</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const pickerBlock = (
    <>
      {step === 'STUDENT' && (
        <div className="mx-auto h-full flex flex-col w-full">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="학생 이름으로 검색..." className="max-w-2xl mx-auto w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 focus:outline-none focus:border-[#002864] bg-white shadow-sm mb-4 shrink-0" />
          <div className="flex-1 min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-full bg-white rounded-xl border border-slate-200 shadow-sm text-slate-400 font-bold text-sm">학생 목록을 불러오는 중...</div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex items-center justify-center h-full bg-white rounded-xl border border-slate-200 shadow-sm text-slate-400 font-bold text-sm">일치하는 학생이 없습니다.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 h-full">
                {renderClassColumn('MF 반', mfGroups)}
                {renderClassColumn('TT 반', ttGroups)}
                {renderClassColumn('WS 반', wsGroups)}
                {renderClassColumn('그 외 반', otherGroups)}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'ITEM' && selectedStudent && (
        <div className="max-w-2xl mx-auto h-full flex flex-col w-full">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex items-center gap-2">
            <button onClick={() => { setStep('STUDENT'); setSelectedStudent(null); }} className="text-slate-400 hover:text-slate-600 text-xs font-bold mr-1">←</button>
            <span className="text-sm font-black text-[#002864]">👤 {selectedStudent.name}</span>
            <span className="text-[11px] text-slate-400 font-semibold">{selectedStudent.className}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {isLoadingItems ? <div className="p-10 text-center text-slate-400 font-bold text-sm">불러오는 중...</div> : items.length === 0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">이 학생에게 나간 시험지/과제가 없습니다.</div> : (
              items.map(item => {
                let badgeLabel = '시험'; let badgeColor = 'bg-blue-100 text-blue-700';
                if (item.kind === 'hw' || item.kind === 'hw_exam') { badgeLabel = '과제'; badgeColor = 'bg-amber-100 text-amber-700'; } 
                else if (item.kind === 'print') { badgeLabel = '오답'; badgeColor = 'bg-emerald-100 text-emerald-700'; }
                else if (item.kind === 'similar') { badgeLabel = '유사'; badgeColor = 'bg-violet-100 text-violet-700'; }
                else if (item.kind === 'overdue') { badgeLabel = '미완료'; badgeColor = 'bg-rose-100 text-rose-700 border border-rose-200'; }

                const existingPanel = panels.find(p => p.studentId === selectedStudent.id && !p.gradeAll);
                const isCurrentlyLoaded = !!existingPanel && (
                  (item.kind === 'exam' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId) ||
                  (item.kind === 'hw' && existingPanel.mode === 'homework' && existingPanel.homeworkId === item.homeworkId) ||
                  (item.kind === 'hw_exam' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId) ||
                  (item.kind === 'print' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId) ||
                  (item.kind === 'similar' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId) ||
                  (item.kind === 'overdue' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId)
                );

                return (
                  <div key={item.key} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 group">
                    <button onClick={() => checkGroupGrading(item, selectedStudent)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${badgeColor}`}>{badgeLabel}</span>
                        <span className="text-[13px] font-bold text-slate-700 truncate">{item.title}</span>
                        {isCurrentlyLoaded && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">보는 중</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">{item.subtitle} · {formatDate(item.date)} <span className="font-bold text-slate-500 ml-1">· 총 {item.totalQ}문항</span></p>
                    </button>
                    
                    <div className="flex items-center gap-3 shrink-0">
                       <span className={`shrink-0 text-[10px] font-extrabold px-2 py-1 rounded whitespace-nowrap ${STATUS_STYLE[item.status] || STATUS_STYLE[item.status.split(' ')[0]] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                         {item.status}
                       </span>
                       <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                         {['exam', 'print', 'hw_exam', 'similar', 'overdue'].includes(item.kind) ? (
                            <button onClick={(e) => handleEditExamToStep2(e, item.assignmentId, item.masterId, item.title, item.subtitle, selectedStudent.name, selectedStudent.id, selectedStudent.classId, item.examType || '오답프린트')} className="text-[14px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="문제 수정">✏️</button>
                         ) : (
                            <button onClick={(e) => handleEditHomeworkToStep2(e, item.kind, item.homeworkId, item.target_questions, item.title, item.subtitle, selectedStudent.name, selectedStudent.id, selectedStudent.classId)} className="text-[14px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="과제 문항 수정">✏️</button>
                         )}
                       </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );

  if (!ready || !isStateLoaded) return <div className="h-screen bg-slate-100" />;

  const activePanel = panels.find(p => p.id === activePanelId) || null;
  
  const containerMaxWidth = step === 'STUDENT' ? 'max-w-[95vw] xl:max-w-[1400px]' : 'max-w-2xl';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      <TaTopBar taName={taName} />
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div>
          <h1 className="font-lexend text-lg font-bold text-[#002864] tracking-tight leading-none flex items-center gap-1">
            <button onClick={() => window.location.href = '/clinic/ta'} className="hover:text-blue-600 transition-colors" title="조교패드 메인으로">Logica Clinic</button>
            <span className="text-slate-300 mx-1">·</span>
            <button onClick={openPicker} className="hover:text-blue-600 transition-colors" title="채점 화면 초기화 (학생 선택 열기)">조교 채점</button>
          </h1>
          {panels.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              <span className={step === 'STUDENT' ? 'text-[#002864] font-bold' : ''}>1. 학생 선택</span>
              <span className="mx-1.5">→</span>
              <span className={step === 'ITEM' ? 'text-[#002864] font-bold' : ''}>2. 문제지 선택</span>
              <span className="mx-1.5">→</span>
              <span>3. 채점</span>
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              <span className="text-[#002864] font-bold">{panels.length}개</span> 패널 대기 중 — 왼쪽 바에서 탭을 눌러 전환하세요
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative flex">
        {panels.length > 0 && (
          <div className="w-[180px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="shrink-0 px-3 py-1 border-b border-slate-100">
              <span className="text-[8px] font-black text-slate-400 tracking-wide">열려있는 패널 {panels.length}개</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-1.5 space-y-0.5">
              {panels.map(panel => {
                const isActive = activePanelId === panel.id;
                return (
                  <button
                    key={panel.id}
                    onClick={() => switchPanel(panel.id)}
                    title={`${panel.gradeAll ? '[그룹]' : ''} ${panel.studentName} · ${panel.title || '제목 없음'}`}
                    className={`group relative w-full text-left rounded-md pl-2 pr-5 py-1 transition-colors border-l-[3px] ${isActive ? 'bg-blue-50 border-l-[#002864]' : 'bg-white border-l-transparent hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`shrink-0 text-[7px] font-black px-1 rounded ${panel.gradeAll ? 'bg-rose-100 text-rose-600' : (panel.mode === 'exam' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700')}`}>
                        {panel.gradeAll ? '그룹' : (panel.mode === 'exam' ? '시험' : '과제')}
                      </span>
                      <span className={`shrink-0 max-w-[50px] text-[10px] font-black truncate ${isActive ? 'text-[#002864]' : 'text-slate-700'}`}>
                        {panel.gradeAll ? '👥 반 전체' : `👤 ${panel.studentName}`}
                      </span>
                      <span className="min-w-0 flex-1 text-[8px] text-slate-400 font-semibold truncate">· {panel.title || '제목 없음'}</span>
                    </div>
                    <span
                      onClick={e => { e.stopPropagation(); closePanel(panel.id); }}
                      title="이 탭 닫기"
                      className="absolute top-1/2 -translate-y-1/2 right-1 shrink-0 text-[11px] leading-none font-bold px-0.5 text-slate-300 hover:text-rose-500"
                    >×</span>
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 p-1.5 border-t border-slate-100">
              <button onClick={openPicker} className="w-full text-[9px] font-black bg-[#002864] hover:bg-blue-900 text-white rounded-md px-1.5 py-1 transition-colors">
                + 채점 패널 추가
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative">
          {panels.length === 0 ? (
            /* 🌟 팝업이 닫혀있을 때만 이 텍스트와 버튼이 통째로 렌더링되도록 수정 */
            !pickerOpen && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold text-sm px-6 text-center gap-4">
                <p>학생과 문제지를 골라 채점을 시작하세요.</p>
                <button 
                  onClick={openPicker}
                  className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm transition-colors text-sm flex items-center gap-2"
                >
                  <span>🔍</span> 학생 / 문제지 선택하기
                </button>
              </div>
            )
          ) : activePanel ? (
            <div className="h-full flex flex-col bg-slate-100">
              <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-black text-[#002864] truncate">
                  {activePanel.gradeAll ? `👥 [반 전체] ${activePanel.studentName} 학생 기준 동시 채점 중` : `👤 ${activePanel.studentName} 개별 채점 중`}
                </span>
                {!activePanel.gradeAll && (
                  <button onClick={() => openItemPickerForPanel(activePanel)} className="shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-1 transition-colors">
                    🔄 시험지 바꾸기
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <GradingBoard
                  mode={activePanel.mode}
                  assignmentId={activePanel.assignmentId}
                  homeworkId={activePanel.homeworkId}
                  studentId={activePanel.studentId}
                  gradeAll={activePanel.gradeAll}
                  onBack={() => closePanel(activePanel.id)}
                  onDirtyChange={setActiveDirty}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm px-6 text-center">
              왼쪽에서 채점할 패널을 선택하세요.
            </div>
          )}

          {pickerOpen && !confirmGroup && (
            <div className={`absolute inset-0 z-20 flex flex-col ${panels.length > 0 ? 'bg-slate-900/40 backdrop-blur-sm p-4 sm:p-6' : ''}`}>
              <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${panels.length > 0 ? `bg-slate-50 rounded-2xl shadow-2xl p-4 sm:p-6 w-full mx-auto transition-all duration-300 ${containerMaxWidth}` : 'p-4 sm:p-6'}`}>
                {panels.length > 0 && (
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <span className="text-xs font-bold text-slate-400">채점할 학생 및 항목을 새로 골라주세요</span>
                    <button onClick={() => setPickerOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">닫기 ✕</button>
                  </div>
                )}
                {pickerBlock}
              </div>
            </div>
          )}

          {/* 그룹 채점 모달 */}
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
                    해당 반에서 <span className="text-rose-500">{confirmGroup.count}명</span>이 보유한 항목입니다.
                  </h3>
                  <p className="text-sm font-bold text-slate-500 break-keep">
                    선택하신 <span className="text-[#002864] font-extrabold">{confirmGroup.item.title}</span> 항목은 반 내의 다른 일부 학생들에게도 동일하게 나갔습니다.
                    <br/><br/>해당 학생들을 한 화면에 나열하여 한 번에 채점하시겠습니까?
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-center gap-3 shrink-0">
                  <button onClick={() => executeSelect(confirmGroup.item, confirmGroup.student, false)} className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-lg shadow-sm transition-colors text-sm">
                    👤 {confirmGroup.student.name} 학생만
                  </button>
                  <button onClick={() => executeSelect(confirmGroup.item, confirmGroup.student, true)} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm transition-colors text-sm">
                    👥 그룹 뷰로 열기
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