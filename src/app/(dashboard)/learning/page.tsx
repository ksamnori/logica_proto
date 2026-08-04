// src/app/(dashboard)/learning/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import StudentDashboard from "./components/StudentDashboard";
import GlobalList from "./components/GlobalList";
import StudentTimeline from "./components/StudentTimeline";

const LEVEL_ORDER = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강', '메이크업/보강', '기타'];

const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

interface StudentInfo {
  id: string;
  name: string;
  className: string;
  classId: string;
  allClassIds?: string[]; // 💡 다중 수강반 완벽 지원을 위한 필드 추가
}

interface ClassInfo {
  class_id: string;
  name: string;
  level_name: string;
  students: StudentInfo[];
}

interface ViewState {
  type: 'ALL' | 'CLASS' | 'STUDENT' | 'GLOBAL_LIST';
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
}

type TabType = 'DASHBOARD' | 'EXAM' | 'HOMEWORK' | 'INCORRECT';

export default function LearningPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>('DASHBOARD');

  const [groupedClasses, setGroupedClasses] = useState<Record<string, ClassInfo[]>>({});
  const [allStudentsList, setAllStudentsList] = useState<StudentInfo[]>([]);
  const [currentStats, setCurrentStats] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);

  const [studentDetails, setStudentDetails] = useState<any>({ hws: [], exams: [], prints: [], records: [] });
  const [globalList, setGlobalList] = useState<any[]>([]);
  
  const [timelineData, setTimelineData] = useState<any[]>([]);
  
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [globalSelectedBlocks, setGlobalSelectedBlocks] = useState<string[]>([]);

  const [dateFilter, setDateFilter] = useState<'ALL' | '1W' | '1M'>('ALL');
  const [isGeneratingPrint, setIsGeneratingPrint] = useState(false);

  const [currentView, setCurrentView] = useState<ViewState>({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' });
  const [isFilterActive, setIsFilterActive] = useState(false);
  
  const [expandedLevels, setExpandedLevels] = useState<string[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  useEffect(() => {
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (allStudentsList.length > 0) {
      const savedTab = (sessionStorage.getItem('logica_learning_tab') as TabType) || 'DASHBOARD';
      const savedViewStr = sessionStorage.getItem('logica_learning_view');
      let view: ViewState = { type: 'ALL', classId: '', className: '', studentId: '', studentName: '' };
      
      if (savedViewStr) {
        try { view = JSON.parse(savedViewStr); } catch(e){}
      }

      setActiveTab(savedTab);
      setCurrentView(view);
      setIsFilterActive(false);

      if (view.type === 'STUDENT') {
        fetchStudentTimeline(view.studentId, view.classId);
      } else if (view.type === 'GLOBAL_LIST') {
        fetchGlobalListForTab(savedTab, allStudentsList);
      } else {
        fetchStatsForTab(savedTab, allStudentsList);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStudentsList]);

  useEffect(() => {
    if (currentView.type === 'STUDENT' || currentView.type === 'CLASS') {
      const cId = currentView.classId;
      if (cId) {
        setExpandedClasses(prev => prev.includes(cId) ? prev : [...prev, cId]);
        
        for (const [level, classes] of Object.entries(groupedClasses)) {
          if (classes.some(c => c.class_id === cId)) {
            setExpandedLevels(prev => prev.includes(level) ? prev : [...prev, level]);
            break;
          }
        }
      }
    }
  }, [currentView.classId, currentView.type, groupedClasses]);

  const handleMainTabClick = (tab: TabType) => {
    setActiveTab(tab);
    sessionStorage.setItem('logica_learning_tab', tab);
    
    const newView: ViewState = { type: 'ALL', classId: '', className: '', studentId: '', studentName: '' };
    setCurrentView(newView);
    sessionStorage.setItem('logica_learning_view', JSON.stringify(newView));
    
    setSelectedBlocks([]);
    setGlobalSelectedBlocks([]);
    setIsFilterActive(false);
    fetchStatsForTab(tab, allStudentsList);
  };

  const handleViewChange = (view: ViewState) => {
    setCurrentView(view);
    sessionStorage.setItem('logica_learning_view', JSON.stringify(view));
    
    setSelectedBlocks([]);
    setGlobalSelectedBlocks([]);

    if (view.type === 'STUDENT') {
      fetchStudentTimeline(view.studentId, view.classId);
    } else if (view.type === 'GLOBAL_LIST') {
      fetchGlobalListForTab(activeTab, allStudentsList);
    } else {
      fetchStatsForTab(activeTab, allStudentsList);
    }
  };

  const fetchBaseData = async () => {
    setIsLoading(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role.toUpperCase()) || pos.includes('원장') || pos.includes('실장') || pos.includes('최고관리자');

      let classQuery = supabase.from('class').select('class_id, name, level_name').order('name');
      if (!isAdmin) classQuery = classQuery.eq('instructor_id', instId);

      const { data: classes } = await classQuery;
      if (!classes || classes.length === 0) { setIsLoading(false); return; }

      const classIds = classes.map(c => c.class_id);
      const studentsByClass: Record<string, StudentInfo[]> = {};
      const allStudents: StudentInfo[] = [];
      const processedStudentIds = new Set<string>();
      
      const studentClassMap = new Map<string, string[]>(); // 💡 학생이 속한 모든 반 ID 추적

      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, student(name, status)').in('class_id', classIds);

      enrollments?.forEach((e: any) => {
        if (e.student && e.student.status === '재원') {
          if (!studentClassMap.has(e.student_id)) studentClassMap.set(e.student_id, []);
          studentClassMap.get(e.student_id)!.push(e.class_id);

          if (!studentsByClass[e.class_id]) studentsByClass[e.class_id] = [];
          const studentName = Array.isArray(e.student) ? e.student[0]?.name : e.student.name;
          const sObj: StudentInfo = { id: e.student_id, name: studentName, className: classes.find(c => c.class_id === e.class_id)?.name || '', classId: e.class_id };
          studentsByClass[e.class_id].push(sObj);
          
          if (!processedStudentIds.has(`${e.student_id}_${e.class_id}`)) {
            processedStudentIds.add(`${e.student_id}_${e.class_id}`);
            allStudents.push(sObj);
          }
        }
      });

      const groups: Record<string, ClassInfo[]> = {};
      LEVEL_ORDER.forEach(lvl => groups[lvl] = []);

      classes.forEach((c: any) => {
        const classStudents = (studentsByClass[c.class_id] || []).sort((a, b) => a.name.localeCompare(b.name));
        const classObj: ClassInfo = { class_id: c.class_id, name: c.name, level_name: c.level_name, students: classStudents };
        const prefix2 = c.name.substring(0, 2).toUpperCase();
        let lvl = c.level_name;
        
        if (['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon'].includes(lvl)) groups[lvl].push(classObj);
        else if (lvl === '특강' || ['SS', 'WS'].includes(prefix2)) groups['특강'].push(classObj);
        else if (lvl === '메이크업' || ['MU', 'LE'].includes(prefix2) || lvl?.includes('보강')) groups['메이크업/보강'].push(classObj);
        else groups['기타'].push(classObj);
      });

      setGroupedClasses(groups);
      
      const uniqueStudentsMap = new Map<string, StudentInfo>();
      allStudents.forEach(s => {
        if (!uniqueStudentsMap.has(s.id)) {
           uniqueStudentsMap.set(s.id, { ...s, allClassIds: studentClassMap.get(s.id) || [s.classId] });
        }
      });
      setAllStudentsList(Array.from(uniqueStudentsMap.values()));
    } catch (e) { console.error(e); setIsLoading(false); }
  };

  const fetchStatsForTab = async (tab: TabType, students: StudentInfo[]) => {
    setIsLoading(true);
    try {
      const studentIds = students.map(s => s.id);
      // 💡 각 학생이 수강중인 모든 반 ID를 추출하여 데이터 누락 방지
      const classIds = [...new Set(students.flatMap(s => s.allClassIds || [s.classId]))]; 
      let fetchedStats: any[] = [];
      const chunkSize = 200;
      
      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);
        
        if (tab === 'EXAM' || tab === 'DASHBOARD') {
          const { data: stats } = await supabase.from('exam_assignment').select('student_id, status, class_id, exam_master!inner(exam_type, title, total_questions)').in('student_id', chunk).neq('exam_master.exam_type', '과제').neq('exam_master.exam_type', '오답프린트');
          if (stats) fetchedStats = [...fetchedStats, ...stats];
        } 
        
        if (tab === 'HOMEWORK' || tab === 'DASHBOARD') {
          const { data: allHws } = await supabase.from('homework_assignment').select('homework_id, class_id, homework_title, target_student_id').in('class_id', classIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');
          const { data: hwStats } = await supabase.from('student_homework_result').select('student_id, status, homework_id').in('student_id', chunk);
          
          const hwResultMap = new Map();
          hwStats?.forEach(r => hwResultMap.set(`${r.student_id}_${r.homework_id}`, r));

          // 💡 새로 적용된 개인화 과제(target_student_id) 완벽 대응 로직
          allHws?.forEach(hw => {
            if (hw.target_student_id) {
               // 1. 특정 학생 전용 과제일 경우
               if (chunk.includes(hw.target_student_id)) {
                  const res = hwResultMap.get(`${hw.target_student_id}_${hw.homework_id}`);
                  fetchedStats.push({
                    student_id: hw.target_student_id,
                    class_id: hw.class_id,
                    status: res?.status || '미제출',
                    homework_assignment: { class_id: hw.class_id, homework_title: hw.homework_title }
                  });
               }
            } else {
               // 2. 예전 방식(반 전체 배부) 과제일 경우 (다중 반 수강생 완벽 처리)
               chunk.forEach(sId => {
                  const s = students.find(st => st.id === sId);
                  if (s && (s.allClassIds?.includes(hw.class_id) || s.classId === hw.class_id)) {
                     const res = hwResultMap.get(`${sId}_${hw.homework_id}`);
                     fetchedStats.push({
                       student_id: sId,
                       class_id: hw.class_id,
                       status: res?.status || '미제출',
                       homework_assignment: { class_id: hw.class_id, homework_title: hw.homework_title }
                     });
                  }
               });
            }
          });

          const { data: examStats } = await supabase.from('exam_assignment').select('student_id, status, class_id, exam_master!inner(exam_type, title, total_questions)').in('student_id', chunk).eq('exam_master.exam_type', '과제');
          if (examStats) fetchedStats = [...fetchedStats, ...examStats];
        } 
        
        if (tab === 'INCORRECT' || tab === 'DASHBOARD') {
          const { data: printStats } = await supabase.from('exam_assignment')
            .select('student_id, status, class_id, exam_master!inner(exam_type, title, total_questions)')
            .in('student_id', chunk)
            .eq('exam_master.exam_type', '오답프린트');
          
          if (printStats) fetchedStats = [...fetchedStats, ...printStats];
        }
      }
      setCurrentStats(fetchedStats);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchStudentTimeline = async (studentId: string, classId: string) => {
    setIsLoading(true);
    try {
      const { data: exams } = await supabase.from('exam_assignment')
        .select('assignment_id, status, total_score, created_at, exam_master!inner(exam_id, title, exam_type, total_questions)')
        .eq('student_id', studentId).eq('class_id', classId).order('created_at', { ascending: false });

      const { data: hws } = await supabase.from('homework_assignment')
        .select('*, textbook(title), student_homework_result(*)')
        .eq('class_id', classId).neq('homework_title', '[시스템] 수업 진도 완료 기록');

      const examIds = exams?.map(e => e.assignment_id) || [];
      const hwIds = hws?.map(h => h.homework_id) || [];
      
      const [{ data: examAns }, { data: hwAns }] = await Promise.all([
        supabase.from('student_answer').select('exam_assignment_id, grading_code').in('exam_assignment_id', examIds),
        supabase.from('student_homework_answer').select('homework_id, grading_code, student_id').in('homework_id', hwIds).eq('student_id', studentId)
      ]);

      const exCounts: any = {};
      examAns?.forEach(a => {
        if (!exCounts[a.exam_assignment_id]) exCounts[a.exam_assignment_id] = { o: 0, x: 0 };
        if (['O', 'TO', 'a', 'b', 'c'].includes(a.grading_code)) exCounts[a.exam_assignment_id].o++;
        else if (['X', 'TX', '☆', 'B'].includes(a.grading_code)) exCounts[a.exam_assignment_id].x++;
      });

      const hwCounts: any = {};
      hwAns?.forEach(a => {
        if (!hwCounts[a.homework_id]) hwCounts[a.homework_id] = { o: 0, x: 0 };
        if (['O', 'TO', 'a', 'b', 'c'].includes(a.grading_code)) hwCounts[a.homework_id].o++;
        else if (['X', 'TX', '☆', 'B'].includes(a.grading_code)) hwCounts[a.homework_id].x++;
      });

      let combined: any[] = [];

      exams?.forEach(ex => {
        const m = unwrap(ex.exam_master);
        combined.push({
          id: `${m?.exam_type === '오답프린트' ? 'print' : 'exam'}_${ex.assignment_id}`,
          type: m?.exam_type === '오답프린트' ? 'print' : (m?.exam_type === '과제' ? 'hw_exam' : 'exam'),
          realId: ex.assignment_id,
          masterId: m?.exam_id,
          title: m?.title || '제목 없음',
          date: ex.created_at,
          status: ex.status,
          total: m?.total_questions || 0,
          score: ex.total_score || 0,
          oCount: exCounts[ex.assignment_id]?.o || 0,
          xCount: exCounts[ex.assignment_id]?.x || 0,
          isCompleted: ['제출완료', '채점완료', '완료'].includes(ex.status)
        });
      });

      hws?.forEach(hw => {
        if (hw.target_student_id && hw.target_student_id !== studentId) return;

        const resList = Array.isArray(hw.student_homework_result) ? hw.student_homework_result : [hw.student_homework_result].filter(Boolean);
        const res = resList.find((r: any) => String(r.student_id) === String(studentId));
        
        let targetQs = [];
        try { targetQs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions; } catch(e){}
        const tb = unwrap(hw.textbook);
        combined.push({
          id: `hw_${hw.homework_id}`,
          type: 'hw',
          realId: hw.homework_id,
          masterId: hw.homework_id,
          title: hw.homework_title,
          source: tb?.title || '교재',
          date: hw.created_at || new Date().toISOString(),
          status: res?.status || '미제출',
          total: targetQs?.length || 0,
          oCount: hwCounts[hw.homework_id]?.o || 0,
          xCount: hwCounts[hw.homework_id]?.x || 0,
          isCompleted: ['제출완료', '채점완료', '완료'].includes(res?.status)
        });
      });

      combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimelineData(combined);
      
    } catch(e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchGlobalListForTab = async (tab: TabType, students: StudentInfo[]) => {
    setIsLoading(true);
    setGlobalList([]);

    try {
      const studentIds = students.map(s => s.id);
      const classIds = [...new Set(students.flatMap(s => s.allClassIds || [s.classId]))]; 
      let list: any[] = [];
      const chunkSize = 200;

      const getStudentName = (sId: string) => {
        const s = students.find(st => st.id === sId);
        return s ? s.name : '알수없음';
      };

      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);

        if (tab === 'EXAM' || tab === 'INCORRECT') {
          let query = supabase.from('exam_assignment')
            .select('assignment_id, status, created_at, class_id, class(name), student(name), student_id, exam_master!inner(exam_id, title, total_questions, exam_type)')
            .in('student_id', chunk);
            
          if (tab === 'EXAM') query = query.neq('exam_master.exam_type', '과제').neq('exam_master.exam_type', '오답프린트');
          else query = query.eq('exam_master.exam_type', '오답프린트');
          
          const { data } = await query;
          if (data) {
            const assignIds = data.map(d => d.assignment_id);
            const { data: ans } = await supabase.from('student_answer').select('exam_assignment_id, grading_code').in('exam_assignment_id', assignIds);
            const counts: any = {};
            ans?.forEach(a => {
              if(!counts[a.exam_assignment_id]) counts[a.exam_assignment_id] = {o:0, x:0};
              if (['O', 'TO', 'a', 'b', 'c'].includes(a.grading_code)) counts[a.exam_assignment_id].o++;
              else if (['X', 'TX', '☆', 'B'].includes(a.grading_code)) counts[a.exam_assignment_id].x++;
            });
            const enriched = data.map(d => ({ ...d, oCount: counts[d.assignment_id]?.o || 0, xCount: counts[d.assignment_id]?.x || 0 }));
            list = [...list, ...enriched];
          }
        }
        else if (tab === 'HOMEWORK') {
          const { data: allHws } = await supabase.from('homework_assignment').select('*, textbook(title), class(name)').in('class_id', classIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');
          const { data: hwData } = await supabase.from('student_homework_result').select('*').in('student_id', chunk);
          
          const hwIds = allHws?.map(h => h.homework_id) || [];
          const { data: hAns } = await supabase.from('student_homework_answer').select('homework_id, student_id, grading_code').in('homework_id', hwIds).in('student_id', chunk);
          
          const hCounts: any = {};
          hAns?.forEach(a => {
            const k = `${a.homework_id}_${a.student_id}`;
            if(!hCounts[k]) hCounts[k] = {o:0, x:0};
            if (['O', 'TO', 'a', 'b', 'c'].includes(a.grading_code)) hCounts[k].o++;
            else if (['X', 'TX', '☆', 'B'].includes(a.grading_code)) hCounts[k].x++;
          });

          const hwResultMap = new Map();
          hwData?.forEach(r => hwResultMap.set(`${r.student_id}_${r.homework_id}`, r));

          allHws?.forEach(hw => {
            let totalQ = 0;
            try { 
              const tQs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []);
              totalQ = tQs.length; 
            } catch(e){}

            // 💡 글로벌 리스트에도 개인화 과제 완벽 매칭 로직 적용
            if (hw.target_student_id) {
              if (chunk.includes(hw.target_student_id)) {
                const res = hwResultMap.get(`${hw.target_student_id}_${hw.homework_id}`);
                list.push({
                  is_exam_hw: false,
                  homework_id: hw.homework_id,
                  student_id: hw.target_student_id,
                  class_id: hw.class_id,
                  class_name: hw.class?.name || '반 미지정',
                  student: { name: getStudentName(hw.target_student_id) },
                  homework_assignment: hw,
                  status: res?.status || '미제출',
                  sort_date: hw.due_date || hw.created_at,
                  oCount: hCounts[`${hw.homework_id}_${hw.target_student_id}`]?.o || 0,
                  xCount: hCounts[`${hw.homework_id}_${hw.target_student_id}`]?.x || 0,
                  totalQ: totalQ
                });
              }
            } else {
              chunk.forEach(sId => {
                const s = students.find(st => st.id === sId);
                if (s && (s.allClassIds?.includes(hw.class_id) || s.classId === hw.class_id)) {
                  const res = hwResultMap.get(`${sId}_${hw.homework_id}`);
                  list.push({
                    is_exam_hw: false,
                    homework_id: hw.homework_id,
                    student_id: sId,
                    class_id: hw.class_id,
                    class_name: hw.class?.name || '반 미지정',
                    student: { name: getStudentName(sId) },
                    homework_assignment: hw,
                    status: res?.status || '미제출',
                    sort_date: hw.due_date || hw.created_at,
                    oCount: hCounts[`${hw.homework_id}_${sId}`]?.o || 0,
                    xCount: hCounts[`${hw.homework_id}_${sId}`]?.x || 0,
                    totalQ: totalQ
                  });
                }
              });
            }
          });

          const { data: examData } = await supabase.from('exam_assignment').select('assignment_id, status, created_at, student_id, class_id, class(name), student(name), exam_master!inner(exam_id, title, total_questions)').in('student_id', chunk).eq('exam_master.exam_type', '과제');
          const exIds = examData?.map(e => e.assignment_id) || [];
          const { data: eAns } = await supabase.from('student_answer').select('exam_assignment_id, grading_code').in('exam_assignment_id', exIds);
          
          const eCounts: any = {};
          eAns?.forEach(a => {
            if(!eCounts[a.exam_assignment_id]) eCounts[a.exam_assignment_id] = {o:0, x:0};
            if (['O', 'TO', 'a', 'b', 'c'].includes(a.grading_code)) eCounts[a.exam_assignment_id].o++;
            else if (['X', 'TX', '☆', 'B'].includes(a.grading_code)) eCounts[a.exam_assignment_id].x++;
          });

          const formattedExamHws = (examData || []).map((e:any) => ({
            ...e, 
            is_exam_hw: true, 
            sort_date: e.created_at, 
            class_name: unwrap(e.class)?.name || '반 미지정', 
            oCount: eCounts[e.assignment_id]?.o || 0, 
            xCount: eCounts[e.assignment_id]?.x || 0,
            totalQ: unwrap(e.exam_master)?.total_questions || 0
          }));
          list = [...list, ...formattedExamHws];
        } 
      }

      list.sort((a, b) => new Date(b.sort_date || b.created_at || 0).getTime() - new Date(a.sort_date || a.created_at || 0).getTime());
      setGlobalList(list);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const toggleGlobalSelection = (id: string) => {
    setGlobalSelectedBlocks(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const handleSelectAllGlobal = () => {
    if (globalSelectedBlocks.length === globalList.length && globalList.length > 0) {
      setGlobalSelectedBlocks([]);
    } else {
      setGlobalSelectedBlocks(globalList.map(res => {
         if (activeTab === 'EXAM') return `exam_${res.assignment_id}_${res.student_id}`;
         if (activeTab === 'HOMEWORK') return res.is_exam_hw ? `hw_exam_${res.assignment_id}_${res.student_id}` : `hw_${res.homework_id}_${res.student_id}`;
         if (activeTab === 'INCORRECT') return `print_${res.assignment_id}_${res.student_id}`;
         return '';
      }));
    }
  };

  const handleBulkCompleteGlobal = async () => {
    if (globalSelectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${globalSelectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of globalSelectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('hw_exam_')) {
          const aId = block.startsWith('hw_exam_') ? block.split('_')[2] : block.split('_')[1];
          await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', aId);
        } else if (block.startsWith('hw_')) {
          const hwId = Number(block.split('_')[1]);
          const stId = block.split('_')[2];
          const { data: existing } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', hwId).eq('student_id', stId).maybeSingle();
          if (existing) {
            await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
          } else {
            await supabase.from('student_homework_result').insert({ homework_id: hwId, student_id: stId, status: '채점완료', checked_at: new Date().toISOString(), correct_count: 0, incorrect_questions: [] });
          }
        }
      }
      alert("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch(e) {
      alert("처리 중 오류가 발생했습니다.");
      setIsLoading(false);
    }
  };

  const handleBulkDeleteGlobal = async () => {
    if (globalSelectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${globalSelectedBlocks.length}개의 항목을 완전히 삭제하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of globalSelectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_')) {
          const aId = block.startsWith('hw_exam_') ? block.split('_')[2] : block.split('_')[1];
          await supabase.from('student_answer').delete().eq('exam_assignment_id', aId);
          await supabase.from('exam_assignment').delete().eq('assignment_id', aId);
        } else if (block.startsWith('print_')) {
          const assignId = block.split('_')[1];
          const {data} = await supabase.from('exam_assignment').select('exam_id').eq('assignment_id', assignId).single();
          if(data) {
             await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
             await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
             await supabase.from('exam_item').delete().eq('exam_id', data.exam_id);
             await supabase.from('exam_master').delete().eq('exam_id', data.exam_id);
          }
        } else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          const studentId = block.split('_')[2];
          await supabase.from('student_homework_answer').delete().eq('homework_id', hwId).eq('student_id', studentId);
          await supabase.from('student_homework_result').delete().eq('homework_id', hwId).eq('student_id', studentId);
          
          const { count } = await supabase.from('student_homework_result').select('*', { count: 'exact', head: true }).eq('homework_id', hwId);
          if (count === 0) await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
        }
      }
      alert("🗑️ 선택 항목이 삭제되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch(e) {
       alert("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleSelectAllStudent = () => {
    let visibleIds: string[] = [];
    visibleIds = filteredTimeline.map(i => i.id);

    if (selectedBlocks.length === visibleIds.length && visibleIds.length > 0) {
      setSelectedBlocks([]); 
    } else {
      setSelectedBlocks(visibleIds);
    }
  };

  const handleBulkCompleteStudent = async () => {
    if (selectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${selectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('hw_exam_')) {
          const assignId = block.split('_').pop();
          await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', assignId);
        } else if (block.startsWith('hw_')) {
          const hwId = Number(block.split('_')[1]);
          const { data: existing } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', hwId).eq('student_id', currentView.studentId).maybeSingle();
          if (existing) {
            await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
          } else {
            await supabase.from('student_homework_result').insert({ homework_id: hwId, student_id: currentView.studentId, status: '채점완료', checked_at: new Date().toISOString(), correct_count: 0, incorrect_questions: [] });
          }
        }
      }
      alert("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch(e) {
       alert("처리 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleBulkDeleteStudent = async () => {
    if (selectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${selectedBlocks.length}개의 항목을 완전히 삭제하시겠습니까?\n(주의: 교재 과제의 경우 반 전체 기록이 함께 삭제됩니다.)`)) return;
    setIsLoading(true);
    try {
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_')) {
          const assignId = block.split('_').pop();
          await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
          await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
        } else if (block.startsWith('print_')) {
          const assignId = block.split('_')[1];
          const {data} = await supabase.from('exam_assignment').select('exam_id').eq('assignment_id', assignId).single();
          if(data) {
             await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
             await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
             await supabase.from('exam_item').delete().eq('exam_id', data.exam_id);
             await supabase.from('exam_master').delete().eq('exam_id', data.exam_id);
          }
        } else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          await supabase.from('student_homework_answer').delete().eq('homework_id', hwId).eq('student_id', currentView.studentId);
          await supabase.from('student_homework_result').delete().eq('homework_id', hwId).eq('student_id', currentView.studentId);
          const { count } = await supabase.from('student_homework_result').select('*', { count: 'exact', head: true }).eq('homework_id', hwId);
          if (count === 0) await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
        }
      }
      alert("🗑️ 선택 항목이 삭제되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch(e) {
       alert("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleForceComplete = async (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => {
    e.stopPropagation();
    if (!confirm("이 항목을 강제로 '채점완료' 처리하시겠습니까?")) return;
    
    try {
      if (type === 'exam' || type === 'print') {
        await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', id);
      } else if (type === 'hw') {
        const { data: existing } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', id).eq('student_id', targetStudentId).maybeSingle();
        if (existing) {
          await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
        } else {
          await supabase.from('student_homework_result').insert({ homework_id: Number(id), student_id: targetStudentId, status: '채점완료', checked_at: new Date().toISOString(), correct_count: 0, incorrect_questions: [] });
        }
      }
      
      alert("✅ 채점 완료 처리되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId);
      else if (currentView.type === 'GLOBAL_LIST') fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch (err) {
      alert("완료 처리 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteExam = async (assignmentId: string, studentId: string) => {
    if (!confirm("해당 출제를 완전히 취소 및 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId);
      else if (currentView.type === 'GLOBAL_LIST') fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(activeTab, allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleEditHomeworkTitle = async (hwId: string, oldTitle: string) => {
    const newTitle = window.prompt("수정할 과제 제목을 입력하세요:", oldTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
      await supabase.from('homework_assignment').update({ homework_title: newTitle.trim() }).eq('homework_id', hwId);
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId);
      else if (currentView.type === 'GLOBAL_LIST') fetchGlobalListForTab('HOMEWORK', allStudentsList);
    } catch (e) { alert("수정 실패"); }
  };

  const handleDeleteHomework = async (hwId: string, studentId: string) => {
    if (!confirm("이 교재 과제를 완전히 삭제하시겠습니까?\n(주의: 반 전체에 부여된 과제인 경우 모든 학생의 기록이 함께 삭제됩니다.)")) return;
    try {
      await supabase.from('student_homework_answer').delete().eq('homework_id', hwId);
      await supabase.from('student_homework_result').delete().eq('homework_id', hwId);
      await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId);
      else if (currentView.type === 'GLOBAL_LIST') fetchGlobalListForTab('HOMEWORK', allStudentsList);
      fetchStatsForTab('HOMEWORK', allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleDeletePrint = async (assignmentId: string, examId: string) => {
    if (!confirm("해당 오답 프린트를 완전히 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_item').delete().eq('exam_id', examId);
      await supabase.from('exam_master').delete().eq('exam_id', examId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId);
      else if (currentView.type === 'GLOBAL_LIST') fetchGlobalListForTab('INCORRECT', allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleGenerateIncorrectPrint = async () => {
    if (selectedBlocks.length === 0) { alert('오답 프린트로 묶을 블록을 하나 이상 선택해주세요.'); return; }
    setIsGeneratingPrint(true);

    try {
      let targetQIds: number[] = [];

      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_') || block.startsWith('print_')) {
          const assignId = block.split('_').pop();
          const { data: ans } = await supabase.from('student_answer')
            .select('question_id, grading_code')
            .eq('exam_assignment_id', assignId)
            .in('grading_code', ['X', 'TX', '☆', 'B']);
          ans?.forEach(a => { if(a.question_id) targetQIds.push(a.question_id); });
        } 
        else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          const { data: hwAns } = await supabase.from('student_homework_answer')
            .select('tq_id, grading_code')
            .eq('homework_id', hwId)
            .eq('student_id', currentView.studentId)
            .in('grading_code', ['X', 'TX', '☆', 'B']);
            
          if (hwAns && hwAns.length > 0) {
            const tqIds = hwAns.map(a => a.tq_id);
            const { data: tqs } = await supabase.from('textbook_question').select('question_id').in('tq_id', tqIds);
            tqs?.forEach(t => { if(t.question_id) targetQIds.push(t.question_id); });
          }
        }
      }

      targetQIds = [...new Set(targetQIds)];

      if (targetQIds.length > 0) {
        const { data: records } = await supabase.from('student_incorrect_record')
          .select('question_id')
          .eq('student_id', currentView.studentId)
          .is('resolved_at', null)
          .in('question_id', targetQIds);
        
        targetQIds = records?.map(r => r.question_id) || [];
      }

      if (targetQIds.length === 0) {
        alert('선택하신 항목들에는 아직 미해결 상태인 오답 문항(X, TX, 별, 빈칸)이 존재하지 않습니다.\n(모두 해결되었거나 원래 틀린 문제가 없습니다.)');
        setIsGeneratingPrint(false);
        return;
      }

      const todayStr = new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
      const title = `[${currentView.studentName}] 통합 오답 프린트 (${todayStr})`;
      const { data: inst } = await supabase.from('class').select('instructor_id').eq('class_id', currentView.classId).single();
      const instId = inst?.instructor_id || localStorage.getItem('logica_instructor_id');

      const { data: exMaster, error: exErr } = await supabase.from('exam_master').insert({
        title,
        exam_type: '오답프린트',
        instructor_id: instId,
        total_questions: targetQIds.length
      }).select().single();

      if (exErr) throw exErr;

      const items = targetQIds.map((qid, idx) => ({
        exam_id: exMaster.exam_id,
        question_id: qid,
        sort_order: idx + 1,
        assigned_score: Math.round(100 / targetQIds.length)
      }));
      await supabase.from('exam_item').insert(items);

      await supabase.from('exam_assignment').insert({
        exam_id: exMaster.exam_id,
        student_id: currentView.studentId,
        class_id: currentView.classId,
        status: '미응시'
      });

      alert(`🎉 오답 프린트가 완성되었습니다! (총 ${targetQIds.length}문항)\n\n오답 관리 탭이나 문제지 보관함에서 확인 가능합니다.`);
      setSelectedBlocks([]);
      handleMainTabClick('INCORRECT');

    } catch (e: any) {
      console.error(e);
      alert('오답 프린트 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsGeneratingPrint(false);
    }
  };

  const studentStatsMap = useMemo(() => {
    const map: Record<string, { pending: number; pendingQ: number; done: number; pendingItems: string[] }> = {};
    
    currentStats.forEach(e => {
      let statClassId = 'UNKNOWN';
      let title = '';

      const hwAssign = unwrap(e.homework_assignment);
      const exMaster = unwrap(e.exam_master);

      if (hwAssign) {
        statClassId = hwAssign.class_id || 'UNKNOWN';
        title = hwAssign.homework_title;
      } else if (exMaster) {
        statClassId = e.class_id || 'UNKNOWN';
        title = exMaster.title;
      }

      const key = `${e.student_id}_${statClassId}`;
      const globalKey = `${e.student_id}_ALL`;

      if (!map[key]) map[key] = { pending: 0, pendingQ: 0, done: 0, pendingItems: [] };
      if (!map[globalKey]) map[globalKey] = { pending: 0, pendingQ: 0, done: 0, pendingItems: [] };
      
      let isPending = false;
      let isDone = false;
      const statusStr = e.status || '미제출';
      
      if (['미제출', '진행중', '미응시', '응시전', '응시중'].includes(statusStr)) isPending = true;
      if (['제출완료', '채점완료', '완료'].includes(statusStr)) isDone = true;

      if (isPending) { 
        map[key].pending++; 
        map[globalKey].pending++; 
        if (title && !map[key].pendingItems.includes(title)) map[key].pendingItems.push(title);
        if (title && !map[globalKey].pendingItems.includes(title)) map[globalKey].pendingItems.push(title);
        
        if (exMaster && exMaster.exam_type === '오답프린트') {
            const tq = exMaster.total_questions || 0;
            map[key].pendingQ += tq;
            map[globalKey].pendingQ += tq;
        }
      }
      if (isDone) { 
        map[key].done++; 
        map[globalKey].done++; 
      }
    });
    return map;
  }, [currentStats]);

  const formatDateLabel = (dateStr: string, includeTime = false) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const dt = `${d.getMonth()+1}/${d.getDate()}(${['일','월','화','수','목','금','토'][d.getDay()]})`;
    if (includeTime) return `${dt} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return dt;
  };

  const filterByDate = (dateStr: string) => {
    if (dateFilter === 'ALL') return true;
    const diff = new Date().getTime() - new Date(dateStr).getTime();
    return dateFilter === '1W' ? diff <= 7 * 24 * 3600000 : diff <= 30 * 24 * 3600000;
  };

  const filteredTimeline = useMemo(() => {
    return timelineData.filter(item => {
      if (!filterByDate(item.date)) return false;
      if (activeTab === 'EXAM' && item.type !== 'exam') return false;
      if (activeTab === 'HOMEWORK' && !item.type.includes('hw')) return false;
      if (activeTab === 'INCORRECT' && item.type !== 'print') return false;
      return true;
    });
  }, [timelineData, dateFilter, activeTab]);

  const toggleAllAccordions = () => {
    if (isAllExpanded) {
      setExpandedLevels([]); setExpandedClasses([]);
    } else {
      const allLevels = LEVEL_ORDER.filter(l => groupedClasses[l]?.length > 0);
      const allClasses: string[] = [];
      Object.values(groupedClasses).flat().forEach(c => allClasses.push(c.class_id));
      setExpandedLevels(allLevels); setExpandedClasses(allClasses);
    }
    setIsAllExpanded(!isAllExpanded);
  };

  const handleLevelClick = (lvl: string) => setExpandedLevels(prev => prev.includes(lvl) ? prev.filter(l => l !== lvl) : [...prev, lvl]);
  
  const handleClassClick = (classId: string, className: string) => {
    setExpandedClasses(prev => prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]);
    handleViewChange({ type: 'CLASS', classId, className, studentId: '', studentName: '' });
  };

  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    handleViewChange({ type: 'STUDENT', classId, className, studentId, studentName });
  };

  const getTabTitles = () => {
    if (activeTab === 'DASHBOARD') return { title: '대시보드', icon: '📈' };
    if (activeTab === 'EXAM') return { title: '시험 현황', icon: '📝' };
    if (activeTab === 'HOMEWORK') return { title: '과제 현황', icon: '📚' };
    return { title: '오답 현황', icon: '❌' };
  };
  const currentTitles = getTabTitles();

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative">
      
      <div className="flex justify-between items-center shrink-0">
        <div className="flex gap-2 p-1.5 bg-slate-200/60 rounded-xl shadow-inner">
          <button onClick={() => handleMainTabClick('DASHBOARD')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'DASHBOARD' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📈 학생 대시보드</button>
          <div className="w-px h-6 bg-slate-300 mx-0.5 my-auto"></div>
          <button onClick={() => handleMainTabClick('EXAM')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'EXAM' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>💯 시험</button>
          <button onClick={() => handleMainTabClick('HOMEWORK')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'HOMEWORK' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📝 과제</button>
          <button onClick={() => handleMainTabClick('INCORRECT')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'INCORRECT' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>❌ 오답 프린트</button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        
        <div className="w-[240px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 z-10 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
            <h3 className="text-[12px] font-extrabold text-[#002864] flex items-center gap-1.5 cursor-pointer hover:underline" onClick={() => handleViewChange({type: 'ALL', classId: '', className: '', studentId: '', studentName: ''})}>
              <span>📂 전체 학생 목록</span>
            </h3>
            <button onClick={toggleAllAccordions} className="text-[11px] font-bold bg-white border border-slate-300 px-2.5 py-1 rounded hover:bg-slate-100 transition-colors shadow-sm focus:outline-none">
              {isAllExpanded ? "접기" : "펼치기"}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll">
            {isLoading ? <div className="p-8 text-center text-slate-400 font-bold text-xs">로딩 중...</div> : (
              LEVEL_ORDER.map(lvl => {
                const classList = groupedClasses[lvl];
                if (!classList || classList.length === 0) return null;
                const isLvlExpanded = expandedLevels.includes(lvl);
                
                return (
                  <div key={lvl} className="border-b border-slate-200">
                    <button onClick={() => handleLevelClick(lvl)} className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-slate-50 transition-colors">
                      <span className="font-extrabold text-slate-700 text-[13px]">{lvl}</span>
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isLvlExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {isLvlExpanded && (
                      <div className="flex flex-col bg-slate-50 border-t border-slate-100">
                        {classList.map(c => {
                          const isClassExpanded = expandedClasses.includes(c.class_id);
                          return (
                            <div key={c.class_id} className="border-b border-slate-200/60 last:border-0">
                              <button onClick={() => handleClassClick(c.class_id, c.name)} className="w-full flex justify-between items-center pl-5 pr-4 py-2.5 hover:bg-blue-50/50 transition-colors">
                                <span className="font-bold text-[#002864] text-[11px] text-left">{c.name}</span>
                                <svg className={`w-3 h-3 text-blue-300 transition-transform ${isClassExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                              </button>
                              {isClassExpanded && (
                                <div className="flex flex-col bg-white">
                                  {c.students.length === 0 ? <div className="py-3 text-center text-[10px] text-slate-400 font-bold bg-slate-50/50">학생 없음</div> : (
                                    c.students.map(s => {
                                      const stats = (activeTab === 'INCORRECT' || c.class_id === 'UNKNOWN') 
                                        ? studentStatsMap[`${s.id}_ALL`] 
                                        : studentStatsMap[`${s.id}_${c.class_id}`];
                                      const displayCount = activeTab === 'INCORRECT' ? (stats?.pendingQ || 0) : (stats?.pending || 0);

                                      return (
                                        <button key={s.id} onClick={() => handleStudentClick(s.id, s.name, c.class_id, c.name)} className={`w-full flex items-center justify-between pl-8 pr-4 py-2 text-[11px] font-bold transition-colors border-l-4 ${currentView.studentId === s.id && currentView.classId === c.class_id ? 'bg-[#eff6ff] border-[#002864] text-[#002864]' : 'text-slate-500 hover:bg-slate-50 hover:text-blue-700 border-transparent'}`}>
                                          <span className="truncate">{s.name}</span>
                                          {displayCount > 0 && (
                                            <span className={`shrink-0 ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm ${activeTab === 'INCORRECT' ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
                                              {displayCount}
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          
          { (currentView.type === 'ALL' || currentView.type === 'CLASS') && (
            <StudentDashboard currentView={currentView} activeTab={activeTab} isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} handleViewChange={handleViewChange} handleStudentClick={handleStudentClick} groupedClasses={groupedClasses} studentStatsMap={studentStatsMap} LEVEL_ORDER={LEVEL_ORDER} />
          )}  

          {currentView.type === 'GLOBAL_LIST' && (
            <GlobalList 
              activeTab={activeTab} globalList={globalList} isLoading={isLoading} 
              globalSelectedBlocks={globalSelectedBlocks} handleSelectAllGlobal={handleSelectAllGlobal} 
              handleBulkCompleteGlobal={handleBulkCompleteGlobal} handleBulkDeleteGlobal={handleBulkDeleteGlobal} 
              handleViewChange={handleViewChange} toggleGlobalSelection={toggleGlobalSelection} 
              formatDateLabel={formatDateLabel} handleForceComplete={handleForceComplete} 
              handleDeleteExam={handleDeleteExam} handleDeleteHomework={handleDeleteHomework} handleDeletePrint={handleDeletePrint} 
            />
          )}
                    
        </div>
      </div>
    </div>
  );
}