// src/app/(dashboard)/learning/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const LEVEL_ORDER = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강', '메이크업/보강', '기타'];

const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

interface StudentInfo {
  id: string;
  name: string;
  className: string;
  classId: string;
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

  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    handleViewChange({ type: 'STUDENT', classId, className, studentId, studentName });
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

      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, student(name, status)').in('class_id', classIds);

      enrollments?.forEach((e: any) => {
        if (e.student && e.student.status === '재원') {
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
      const uniqueStudents = Array.from(new Map(allStudents.map(s => [s.id, s])).values());
      setAllStudentsList(uniqueStudents);
    } catch (e) { console.error(e); setIsLoading(false); }
  };

  const fetchStatsForTab = async (tab: TabType, students: StudentInfo[]) => {
    setIsLoading(true);
    try {
      const studentIds = students.map(s => s.id);
      const classIds = [...new Set(students.map(s => s.classId))];
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

          allHws?.forEach(hw => {
            students.filter(s => s.classId === hw.class_id && chunk.includes(s.id)).forEach(s => {
              // 💡 1학생 1과제 (Personal Assignment) 타겟팅 보호 로직! 남의 과제는 패스
              if (hw.target_student_id && hw.target_student_id !== s.id) return;
              
              const res = hwResultMap.get(`${s.id}_${hw.homework_id}`);
              fetchedStats.push({
                student_id: s.id,
                class_id: hw.class_id,
                status: res?.status || '미제출',
                homework_assignment: { class_id: hw.class_id, homework_title: hw.homework_title }
              });
            });
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
        // 💡 1학생 1과제 (Personal Assignment) 타겟팅 보호 로직! 남의 과제는 패스
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
      
      const exms = combined.filter(c => c.type === 'exam').map(c => ({...c, assignment_id: c.realId, exam_master: {title: c.title, total_questions: c.total}, created_at: c.date}));
      const hwks = combined.filter(c => c.type.includes('hw')).map(c => ({...c, is_exam_hw: c.type === 'hw_exam', assignment_id: c.realId, homework_id: c.realId, exam_master: {title: c.title, total_questions: c.total}, homework_title: c.title, sort_date: c.date, total_questions: c.total}));
      const prns = combined.filter(c => c.type === 'print').map(c => ({...c, assignment_id: c.realId, exam_master: {title: c.title, total_questions: c.total}, created_at: c.date}));
      setStudentDetails({ exams: exms, hws: hwks, prints: prns, records: [] });
      
    } catch(e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchStudentDetails = async (tab: TabType, studentId: string, classId: string) => {
    fetchStudentTimeline(studentId, classId);
  };

  const fetchGlobalListForTab = async (tab: TabType, students: StudentInfo[]) => {
    setIsLoading(true);
    setGlobalList([]);

    try {
      const studentIds = students.map(s => s.id);
      const classIds = [...new Set(students.map(s => s.classId))];
      let list: any[] = [];
      const chunkSize = 200;

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
            students.filter(s => s.classId === hw.class_id && chunk.includes(s.id)).forEach(s => {
              // 💡 1학생 1과제 (Personal Assignment) 타겟팅 보호 로직! 남의 과제는 패스
              if (hw.target_student_id && hw.target_student_id !== s.id) return;

              const res = hwResultMap.get(`${s.id}_${hw.homework_id}`);
              
              // 💡 [버그 픽스] target_questions가 JSON 배열 객체일 때 발생하는 parse 에러 해결 (안전한 배열 반환)
              let totalQ = 0;
              try { 
                const tQs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []);
                totalQ = tQs.length; 
              } catch(e){}

              list.push({
                is_exam_hw: false,
                homework_id: hw.homework_id,
                student_id: s.id,
                class_id: hw.class_id,
                class_name: hw.class?.name || '반 미지정',
                student: { name: s.name },
                homework_assignment: hw,
                status: res?.status || '미제출',
                sort_date: hw.due_date || hw.created_at,
                oCount: hCounts[`${hw.homework_id}_${s.id}`]?.o || 0,
                xCount: hCounts[`${hw.homework_id}_${s.id}`]?.x || 0,
                totalQ: totalQ
              });
            });
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

  const toggleAllAccordions = () => {
    if (isAllExpanded) { setExpandedLevels([]); setExpandedClasses([]); } 
    else {
      const allLevels = LEVEL_ORDER.filter(l => groupedClasses[l]?.length > 0);
      const allClasses: string[] = []; Object.values(groupedClasses).flat().forEach(c => allClasses.push(c.class_id));
      setExpandedLevels(allLevels); setExpandedClasses(allClasses);
    }
    setIsAllExpanded(!isAllExpanded);
  };

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

  const renderStudentCard = (s: StudentInfo, classId: string, cName: string, showClassNameBadge = false) => {
    const stats = (activeTab === 'INCORRECT' || classId === 'UNKNOWN') 
      ? studentStatsMap[`${s.id}_ALL`] 
      : studentStatsMap[`${s.id}_${classId}`];
      
    const { pending = 0, pendingQ = 0, pendingItems = [] } = stats || { pending: 0, pendingQ: 0, pendingItems: [] };
    
    const displayCount = activeTab === 'INCORRECT' ? pendingQ : pending;
    
    if (isFilterActive && displayCount === 0) return null;

    return (
      <div 
        key={`${s.id}_${classId}`} 
        onClick={() => handleStudentClick(s.id, s.name, classId, cName)} 
        className={`px-4 py-3 rounded-xl border shadow-sm cursor-pointer transition-all flex items-center justify-between ${
          displayCount > 0 
          ? 'bg-rose-50/50 border-rose-300 hover:border-rose-500 hover:-translate-y-0.5' 
          : 'bg-white border-slate-200 hover:border-[#002864] hover:-translate-y-0.5'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {showClassNameBadge && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${displayCount > 0 ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{cName}</span>}
          <div className={`font-extrabold text-[15px] truncate ${displayCount > 0 ? 'text-rose-900' : 'text-slate-800'}`}>{s.name}</div>
        </div>
        
        <div className="flex shrink-0 ml-2">
          {displayCount > 0 && (
             <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full shadow-sm ${activeTab === 'INCORRECT' ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
               {activeTab === 'INCORRECT' ? `오답 ${displayCount}문항` : `미해결 ${displayCount}건`}
             </span>
          )}
        </div>
      </div>
    );
  };

  const renderStudentHeader = () => {
    let titleStr = "전체 활동 타임라인";
    let visibleCount = 0;
    
    if (activeTab === 'DASHBOARD') {
      titleStr = "전체 활동 타임라인";
      visibleCount = filteredTimeline.length;
    } else if (activeTab === 'EXAM') {
      titleStr = "전체 시험 타임라인";
      visibleCount = filteredTimeline.length;
    } else if (activeTab === 'HOMEWORK') {
      titleStr = "전체 과제 타임라인";
      visibleCount = filteredTimeline.length;
    } else if (activeTab === 'INCORRECT') {
      titleStr = "전체 오답 풀이 타임라인";
      visibleCount = filteredTimeline.length;
    }

    const isAllSelected = visibleCount > 0 && selectedBlocks.length === visibleCount;

    return (
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <span className="bg-[#002864] text-white text-xs font-bold px-2 py-0.5 rounded shadow-sm">{currentView.className}</span>
            <span className="text-[#002864]">{currentView.studentName}</span> 학생 {titleStr}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm">
              <button onClick={() => setDateFilter('1W')} className={`px-4 py-2 text-xs font-bold transition-colors ${dateFilter === '1W' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1주일</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('1M')} className={`px-4 py-2 text-xs font-bold transition-colors ${dateFilter === '1M' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1개월</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('ALL')} className={`px-4 py-2 text-xs font-bold transition-colors ${dateFilter === 'ALL' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>전체</button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm mt-1">
          <label className="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked={isAllSelected} onChange={handleSelectAllStudent} className="w-5 h-5 accent-rose-500" />
            <span className="text-sm font-bold text-slate-700">전체 선택</span>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-xs transition-colors disabled:opacity-40">
              ✅ 선택 완료처리 ({selectedBlocks.length})
            </button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-xs transition-colors disabled:opacity-40">
              🗑️ 선택 삭제 ({selectedBlocks.length})
            </button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={handleGenerateIncorrectPrint} disabled={selectedBlocks.length === 0 || isGeneratingPrint} className="px-4 py-1.5 rounded font-black text-xs text-white bg-[#002864] hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1">
              {isGeneratingPrint ? '생성 중...' : `🖨️ 오답 프린트 생성`}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative">
      
      <div className="flex justify-between items-center shrink-0">
        <div className="flex gap-2 p-1.5 bg-slate-200/60 rounded-xl shadow-inner">
          <button onClick={() => handleMainTabClick('DASHBOARD')} className={`px-5 py-2.5 rounded-lg font-black text-sm transition-all ${activeTab === 'DASHBOARD' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📈 학생 대시보드</button>
          <div className="w-px h-8 bg-slate-300 mx-1 my-auto"></div>
          <button onClick={() => handleMainTabClick('EXAM')} className={`px-5 py-2.5 rounded-lg font-black text-sm transition-all ${activeTab === 'EXAM' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>💯 시험</button>
          <button onClick={() => handleMainTabClick('HOMEWORK')} className={`px-5 py-2.5 rounded-lg font-black text-sm transition-all ${activeTab === 'HOMEWORK' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📝 과제</button>
          <button onClick={() => handleMainTabClick('INCORRECT')} className={`px-5 py-2.5 rounded-lg font-black text-sm transition-all ${activeTab === 'INCORRECT' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>❌ 오답 프린트</button>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        
        <div className="w-[280px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 z-10 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
            <h3 className="text-lg font-extrabold text-[#002864] flex items-center gap-1.5 cursor-pointer hover:underline" onClick={() => handleViewChange({type: 'ALL', classId: '', className: '', studentId: '', studentName: ''})}>
              <span>📂 전체 학생 목록</span>
            </h3>
            <button onClick={toggleAllAccordions} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded hover:bg-slate-100 transition-colors shadow-sm focus:outline-none">
              {isAllExpanded ? "접기" : "펼치기"}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll">
            {isLoading ? <div className="p-10 text-center text-slate-400 font-bold text-sm">로딩 중...</div> : (
              LEVEL_ORDER.map(lvl => {
                const classList = groupedClasses[lvl];
                if (!classList || classList.length === 0) return null;
                const isLvlExpanded = expandedLevels.includes(lvl);
                
                return (
                  <div key={lvl} className="border-b border-slate-200">
                    <button onClick={() => setExpandedLevels(p => p.includes(lvl) ? p.filter(l => l !== lvl) : [...p, lvl])} className="w-full flex justify-between items-center px-5 py-4 bg-white hover:bg-slate-50 transition-colors">
                      <span className="font-extrabold text-slate-700 text-[16px]">{lvl}</span>
                      <svg className={`w-4 h-4 text-slate-400 transition-transform ${isLvlExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {isLvlExpanded && (
                      <div className="flex flex-col bg-slate-50 border-t border-slate-100">
                        {classList.map(c => {
                          const isClassExpanded = expandedClasses.includes(c.class_id);
                          return (
                            <div key={c.class_id} className="border-b border-slate-200/60 last:border-0">
                              <button onClick={() => { setExpandedClasses(p => p.includes(c.class_id) ? p.filter(id => id !== c.class_id) : [...p, c.class_id]); handleViewChange({ type: 'CLASS', classId: c.class_id, className: c.name, studentId: '', studentName: '' }); }} className="w-full flex justify-between items-center pl-6 pr-5 py-3 hover:bg-blue-50/50 transition-colors">
                                <span className="font-bold text-[#002864] text-[15px] text-left">{c.name}</span>
                                <svg className={`w-4 h-4 text-blue-300 transition-transform ${isClassExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                              </button>
                              {isClassExpanded && (
                                <div className="flex flex-col bg-white">
                                  {c.students.length === 0 ? <div className="py-4 text-center text-sm text-slate-400 font-bold bg-slate-50/50">학생 없음</div> : (
                                    c.students.map(s => (
                                      <button key={s.id} onClick={() => handleStudentClick(s.id, s.name, c.class_id, c.name)} className={`w-full text-left pl-10 pr-5 py-3 text-[15px] font-bold text-slate-500 hover:bg-slate-50 hover:text-blue-700 transition-colors border-l-4 ${currentView.studentId === s.id && currentView.classId === c.class_id ? 'bg-[#eff6ff] border-[#002864] text-[#002864]' : 'border-transparent'}`}>
                                        {s.name}
                                      </button>
                                    ))
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
          
          {currentView.type === 'ALL' && (
            <>
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800">전체 학생 요약 대시보드</h2>
                  <p className="text-sm font-bold text-slate-400 mt-1">모든 반의 학생들을 한눈에 확인하고 진도 및 미해결 항목을 관리하세요.</p>
                </div>
                <div className="flex items-center gap-3">
                  {activeTab !== 'DASHBOARD' && (
                    <button 
                      onClick={() => handleViewChange({ type: 'GLOBAL_LIST', classId: '', className: '', studentId: '', studentName: '' })}
                      className="px-5 py-2.5 rounded-lg text-sm font-bold bg-white text-[#002864] border border-[#002864] hover:bg-blue-50 transition-colors shadow-sm"
                    >
                      전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'} 보기 ➔
                    </button>
                  )}
                  <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-5 py-2.5 rounded-lg border text-sm font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    🚨 미해결 학생만 보기
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                {LEVEL_ORDER.map(lvl => {
                  const classList = groupedClasses[lvl];
                  if (!classList || classList.length === 0) return null;
                  
                  const visibleClasses = classList.filter(c => c.students.some(s => {
                    const stats = studentStatsMap[`${s.id}_${c.class_id}`] || { pending: 0, pendingQ: 0 };
                    return !isFilterActive || (stats.pending > 0 || stats.pendingQ > 0);
                  }));
                  
                  if (visibleClasses.length === 0) return null;

                  return visibleClasses.map((c, cIdx) => (
                    <div key={`class_group_${c.class_id}_${cIdx}`} className="mb-10">
                      <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                        <span className="bg-[#002864] text-white text-[12px] font-black px-2 py-0.5 rounded tracking-wider">{lvl}</span>
                        <h2 className="text-xl font-extrabold text-slate-800">{c.name}</h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                        {c.students.map((s, sIdx) => renderStudentCard(s, c.class_id, c.name, true))}
                      </div>
                    </div>
                  ));
                })}
              </div>
            </>
          )}

          {currentView.type === 'CLASS' && (
            <>
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800"><span className="text-[#002864]">{currentView.className}</span> 반 학생 목록</h2>
                </div>
                <div className="flex items-center gap-3">
                  {activeTab !== 'DASHBOARD' && (
                    <button 
                      onClick={() => handleViewChange({ type: 'GLOBAL_LIST', classId: '', className: '', studentId: '', studentName: '' })}
                      className="px-5 py-2.5 rounded-lg text-sm font-bold bg-white text-[#002864] border border-[#002864] hover:bg-blue-50 transition-colors shadow-sm"
                    >
                      전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'} 보기 ➔
                    </button>
                  )}
                  <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-5 py-2.5 rounded-lg border text-sm font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    🚨 미해결 학생만 보기
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {Object.values(groupedClasses).flat().find(c => c.class_id === currentView.classId)?.students.map(s => renderStudentCard(s, currentView.classId, currentView.className))}
                </div>
              </div>
            </>
          )}

          {currentView.type === 'STUDENT' && (
            <>
              {renderStudentHeader()}
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                {isLoading ? (
                  <div className="text-center font-bold text-slate-400 py-20">타임라인을 구성하는 중입니다...</div>
                ) : filteredTimeline.length === 0 ? (
                  <div className="text-center font-bold text-slate-400 py-20 border-2 border-dashed border-slate-200 rounded-2xl">해당 기간에 기록된 활동이 없습니다.</div>
                ) : (
                  <div className="space-y-3 pb-20">
                    {filteredTimeline.map((item, idx) => {
                      const isSelected = selectedBlocks.includes(item.id);
                      let badgeColor = "bg-slate-100 text-slate-500";
                      let typeLabel = "";
                      if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 시험"; }
                      else if (item.type === 'hw' || item.type === 'hw_exam') { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
                      else { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "🖨️ 오답프린트"; }

                      return (
                        <div 
                          key={`${item.id}_${idx}`} 
                          className={`bg-white border-2 rounded-xl p-3 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}
                          onClick={() => setSelectedBlocks(p => p.includes(item.id) ? p.filter(id => id !== item.id) : [...p, item.id])}
                        >
                          <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                            <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                            <div className="w-[110px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight">
                              {formatDateLabel(item.date, true)}
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 ${badgeColor}`}>{typeLabel}</span>
                            <div className="flex-1 font-extrabold text-slate-800 text-[14px] truncate" title={item.title}>
                              {item.title}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                            <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {item.total}문항</div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {item.oCount}</span>
                              <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {item.xCount}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                              <button onClick={(e) => handleForceComplete(e, item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : 'exam', item.realId, currentView.studentId)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                                ✅ 완료처리
                              </button>
                              <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${item.isCompleted ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-500 border border-rose-200'}`}>
                                {item.status || '미제출'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
                              {item.type !== 'exam' && (
                                 <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${item.masterId}&${item.type.includes('hw') ? 'homework_id' : 'exam_id'}=${item.masterId}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                              )}
                              <button onClick={(e) => { 
                                e.stopPropagation(); 
                                if(item.type === 'exam' || item.type === 'hw_exam') handleDeleteExam(item.realId, currentView.studentId);
                                else if(item.type === 'hw') handleDeleteHomework(item.realId, currentView.studentId);
                                else if(item.type === 'print') handleDeletePrint(item.realId, item.masterId);
                              }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation(); 
                                  window.location.href = item.type === 'hw' ? `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}` : `/exam/review?assignment_id=${item.realId}`;
                                }}
                                className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-1"
                              >
                                상세/채점 ➔
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {currentView.type === 'GLOBAL_LIST' && (
            <>
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                      <span className="text-[#002864]">🌐 학원 전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'}</span> 
                    </h2>
                    <p className="text-sm font-bold text-slate-500 mt-1">배부된 전체 목록을 최신순으로 확인하고 수정합니다.</p>
                  </div>
                  <button onClick={() => handleViewChange({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' })} className="px-5 py-2.5 border border-slate-300 bg-white hover:bg-slate-100 rounded-lg text-sm font-bold text-slate-600 transition-colors shadow-sm">
                    돌아가기 ↺
                  </button>
                </div>

                <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm mt-1">
                  <label className="flex items-center gap-2 cursor-pointer pl-2">
                    <input type="checkbox" checked={globalList.length > 0 && globalSelectedBlocks.length === globalList.length} onChange={handleSelectAllGlobal} className="w-5 h-5 accent-rose-500" />
                    <span className="text-sm font-bold text-slate-700">전체 선택</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button onClick={handleBulkCompleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-xs transition-colors disabled:opacity-40">
                      ✅ 선택 완료처리 ({globalSelectedBlocks.length})
                    </button>
                    <button onClick={handleBulkDeleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-xs transition-colors disabled:opacity-40">
                      🗑️ 선택 삭제 ({globalSelectedBlocks.length})
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                {isLoading ? (
                  <div className="text-center font-bold text-slate-400 py-10">전체 리스트를 불러오는 중입니다...</div>
                ) : globalList.length === 0 ? (
                  <div className="text-center font-bold text-slate-400 py-10">배부된 기록이 없습니다.</div>
                ) : (
                  <div className="space-y-3 pb-20">
                    
                    {activeTab === 'EXAM' && globalList.map((res: any, idx: number) => {
                      const m = unwrap(res.exam_master) || {};
                      const studentName = unwrap(res.student)?.name || '알수없음';
                      const className = unwrap(res.class)?.name || '반 미지정';
                      const itemId = `exam_${res.assignment_id}_${res.student_id}`;
                      const isSelected = globalSelectedBlocks.includes(itemId);
                      
                      let statusBadge = "bg-slate-100 text-slate-500";
                      if(res.status === '미응시' || res.status === '응시전') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
                      else if(res.status === '채점완료' || res.status === '제출완료' || res.status === '완료') statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                      else statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";

                      return (
                        <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-3 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                          <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                            <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                            <div className="w-[110px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight">
                              {formatDateLabel(res.created_at, true)}
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 bg-blue-100 text-blue-700 border-blue-200">📝 시험</span>
                            <span className="bg-[#002864] text-white text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                            <span className="text-[12px] font-bold text-slate-700 shrink-0 w-[70px] truncate">{studentName}</span>
                            <div className="flex-1 font-extrabold text-slate-800 text-[14px] truncate" title={m.title || '제목 없음'}>
                              {m.title || '제목 없음'}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                            <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {m.total_questions || 0}문항</div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                              <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                              <button onClick={(e) => handleForceComplete(e, 'exam', res.assignment_id, res.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                                ✅ 완료처리
                              </button>
                              <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusBadge}`}>
                                {res.status || '대기'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
                              <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${m.exam_id}&exam_id=${m.exam_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteExam(res.assignment_id, res.student_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                              <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${res.assignment_id}`; }} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-1">상세/수정 ➔</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {activeTab === 'HOMEWORK' && globalList.map((res: any, idx: number) => {
                      const itemId = res.is_exam_hw ? `hw_exam_${res.assignment_id}_${res.student_id}` : `hw_${res.homework_id}_${res.student_id}`;
                      const isSelected = globalSelectedBlocks.includes(itemId);

                      if (res.is_exam_hw) {
                        const m = unwrap(res.exam_master) || {};
                        const studentName = unwrap(res.student)?.name || '알수없음';
                        const className = res.class_name;
                        
                        let statusBadge = "bg-slate-100 text-slate-500";
                        if(res.status === '미응시' || res.status === '응시전') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
                        else if(res.status === '채점완료' || res.status === '제출완료') statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                        else statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";

                        return (
                          <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-3 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                            <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                              <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                              <div className="w-[110px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight">
                                {formatDateLabel(res.sort_date || res.created_at, true)}
                              </div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 bg-amber-100 text-amber-700 border-amber-200">📝 문제지 과제</span>
                              <span className="bg-[#002864] text-white text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                              <span className="text-[12px] font-bold text-slate-700 shrink-0 w-[70px] truncate">{studentName}</span>
                              <div className="flex-1 font-extrabold text-slate-800 text-[14px] truncate" title={m.title || '제목 없음'}>
                                {m.title || '제목 없음'}
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                              <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {res.totalQ}문항</div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                                <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                                <button onClick={(e) => handleForceComplete(e, 'exam', res.assignment_id, res.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                                  ✅ 완료처리
                                </button>
                                <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusBadge}`}>
                                  {res.status || '미제출'}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
                                <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${m.exam_id}&exam_id=${m.exam_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteExam(res.assignment_id, res.student_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                                <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${res.assignment_id}`; }} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-1">상세/채점 ➔</button>
                              </div>
                            </div>
                          </div>
                        );
                      } else {
                        const hw = res.homework_assignment || {};
                        const studentName = unwrap(res.student)?.name || '알수없음';
                        const className = res.class_name;
                        
                        let statusStr = res.status || '미제출';
                        let statusBadge = "bg-slate-100 text-slate-500";
                        if(statusStr === '미제출') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
                        else if(statusStr === '진행중') statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";
                        else statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                        
                        return (
                          <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-3 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                            <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                              <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                              <div className="w-[110px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight">
                                {formatDateLabel(res.sort_date || res.created_at, true)}
                              </div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 bg-amber-100 text-amber-700 border-amber-200">📚 교재 과제</span>
                              <span className="bg-[#002864] text-white text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                              <span className="text-[12px] font-bold text-slate-700 shrink-0 w-[70px] truncate">{studentName}</span>
                              <div className="flex-1 font-extrabold text-slate-800 text-[14px] truncate" title={hw.homework_title}>
                                {hw.homework_title}
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                              <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {res.totalQ}문항</div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                                <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                                <button onClick={(e) => handleForceComplete(e, 'hw', hw.homework_id, res.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                                  ✅ 완료처리
                                </button>
                                <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusBadge}`}>
                                  {statusStr}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
                                <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${hw.homework_id}&homework_id=${hw.homework_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteHomework(hw.homework_id, res.student_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                                <button onClick={(e) => { e.stopPropagation(); window.location.href = `/homework/review?homework_id=${hw.homework_id}&student_id=${res.student_id}`; }} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-1">상세/채점 ➔</button>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    })}

                    {activeTab === 'INCORRECT' && globalList.map((p: any, idx: number) => {
                      const studentName = unwrap(p.student)?.name || '알수없음';
                      const m = unwrap(p.exam_master);
                      const qCount = m?.total_questions || 0;
                      const statusBadge = p.status === '미응시' ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
                      const className = unwrap(p.class)?.name || '반 미지정';
                      
                      const itemId = `print_${p.assignment_id}_${p.student_id}`;
                      const isSelected = globalSelectedBlocks.includes(itemId);

                      return (
                        <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-3 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                          <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                            <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                            <div className="w-[110px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight">
                              {formatDateLabel(p.created_at, true)}
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">🖨️ 오답프린트</span>
                            <span className="bg-[#002864] text-white text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                            <span className="text-[12px] font-bold text-slate-700 shrink-0 w-[70px] truncate">{studentName}</span>
                            <div className="flex-1 font-extrabold text-slate-800 text-[14px] truncate" title={m?.title || '제목 없음'}>
                              {m?.title || '제목 없음'}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                            <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {qCount}문항</div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {p.oCount}</span>
                              <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {p.xCount}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                              <button onClick={(e) => handleForceComplete(e, 'print', p.assignment_id, p.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                                ✅ 완료처리
                              </button>
                              <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusBadge}`}>
                                {p.status || '미응시'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
                              <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${m?.exam_id}&exam_id=${m?.exam_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeletePrint(p.assignment_id, unwrap(p.exam_master)?.exam_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                              <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${p.assignment_id}`; }} className="text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded shadow-sm transition-colors ml-1">프린트 채점 ➔</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}