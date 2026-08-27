// src/app/(dashboard)/learning/hooks/useLearningFetch.ts
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { StudentInfo, ClassInfo, TabType } from "../types";

export const LEVEL_ORDER = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강', '메이크업/보강', '기타'];

export const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

export const tallyGrading = (counts: Record<string, { o: number; x: number; helped: number }>, key: any, code: string) => {
  if (!counts[key]) counts[key] = { o: 0, x: 0, helped: 0 };
  if (['O', 'a', 'b', 'c', 'TO', 'RO'].includes(code)) counts[key].o++;
  else if (['X', 'TX', '☆', 'B'].includes(code)) counts[key].x++;
  if (code === 'TO' || code === 'TX') counts[key].helped++;
};

export function useLearningFetch() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [groupedClasses, setGroupedClasses] = useState<Record<string, ClassInfo[]>>({});
  const [allStudentsList, setAllStudentsList] = useState<StudentInfo[]>([]);
  const [currentStats, setCurrentStats] = useState<any[]>([]); 

  const [globalList, setGlobalList] = useState<any[]>([]);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [classCalendarEvents, setClassCalendarEvents] = useState<any[]>([]);

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isTeacherMode = role === 'TEACHER';
      const isGodMode = !isTeacherMode && (
        role === 'SUPER_ADMIN' || role === 'ADMIN' || 
        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장')
      );
      
      if (isGodMode) { setIsAuthorized(true); return; }
      if (!tId || !role) { alert("권한 정보가 없습니다."); router.replace("/home"); return; }

      const { data } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).maybeSingle();
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/learning"))) {
        alert("⛔ 학습 및 평가 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else { setIsAuthorized(true); }
    };
    checkAccess();
  }, [router]);

  const fetchBaseData = async () => {
    setIsLoading(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id') || '';
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      const tenantId = localStorage.getItem('logica_tenant_id') || '';
      
      const isTeacherMode = role === 'TEACHER';
      const isAdmin = !isTeacherMode && (['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role.toUpperCase()) || pos.includes('원장') || pos.includes('실장') || pos.includes('최고관리자'));

      let classQuery = supabase.from('class').select('class_id, name, level_name').order('name');
      if (tenantId && tenantId !== 'hq') classQuery = classQuery.eq('tenant_id', tenantId);
      if (!isAdmin) classQuery = classQuery.eq('instructor_id', instId);

      const { data: classes, error: classErr } = await classQuery;
      if (classErr) throw classErr;
      if (!classes || classes.length === 0) { setIsLoading(false); return; }

      const classIds = classes.map(c => c.class_id).filter(Boolean);
      const studentsByClass: Record<string, StudentInfo[]> = {};
      const allStudents: StudentInfo[] = [];
      const processedStudentIds = new Set<string>();
      const studentClassMap = new Map<string, string[]>();

      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, student(name, status)').in('class_id', classIds);

      enrollments?.forEach((e: any) => {
        const studentObj = Array.isArray(e.student) ? e.student[0] : e.student;
        if (studentObj && studentObj.status === '재원') {
          if (!studentClassMap.has(e.student_id)) studentClassMap.set(e.student_id, []);
          studentClassMap.get(e.student_id)!.push(e.class_id);

          if (!studentsByClass[e.class_id]) studentsByClass[e.class_id] = [];
          const studentNameStr = studentObj.name || '이름없음';
          const matchedClass = classes.find(c => c.class_id === e.class_id);
          const sObj: StudentInfo = { id: e.student_id, name: studentNameStr, className: matchedClass?.name || '반 미지정', classId: e.class_id };
          
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
        if (!c.class_id) return;
        const classNameStr = c.name || '이름없음';
        const levelNameStr = c.level_name || '기타';
        const classStudents = (studentsByClass[c.class_id] || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const classObj: ClassInfo = { class_id: c.class_id, name: classNameStr, level_name: levelNameStr, students: classStudents };
        const prefix2 = classNameStr.substring(0, 2).toUpperCase();
        
        if (['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon'].includes(levelNameStr)) {
          if(groups[levelNameStr]) groups[levelNameStr].push(classObj);
        } else if (levelNameStr === '특강' || ['SS', 'WS'].includes(prefix2)) {
          if(groups['특강']) groups['특강'].push(classObj);
        } else if (levelNameStr === '메이크업' || ['MU', 'LE'].includes(prefix2) || levelNameStr.includes('보강')) {
          if(groups['메이크업/보강']) groups['메이크업/보강'].push(classObj);
        } else {
          if(groups['기타']) groups['기타'].push(classObj);
        }
      });

      setGroupedClasses(groups);
      const uniqueStudentsMap = new Map<string, StudentInfo>();
      allStudents.forEach(s => {
        if (!uniqueStudentsMap.has(s.id)) uniqueStudentsMap.set(s.id, { ...s, allClassIds: studentClassMap.get(s.id) || [s.classId] });
      });
      setAllStudentsList(Array.from(uniqueStudentsMap.values()));
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchStatsForTab = async (students: StudentInfo[]) => {
    setIsLoading(true);
    try {
      const studentIds = students.map(s => s.id);
      const classIds = [...new Set(students.flatMap(s => s.allClassIds || [s.classId]))]; 
      let fetchedStats: any[] = [];
      let allCalEvents: any[] = []; 
      const chunkSize = 200;
      
      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);
        
        const { data: rawExams } = await supabase.from('exam_assignment')
          .select('student_id, status, class_id, created_at, exam_master!inner(exam_type, title, total_questions)')
          .in('student_id', chunk);

        if (rawExams) {
          const examOnly = rawExams.filter((s: any) => !['과제', '과제프린트', '오답프린트', '오답', '오답유사', '과제오답유사'].includes(s.exam_master?.exam_type));
          fetchedStats = [...fetchedStats, ...examOnly.map((s: any) => ({...s, qCount: unwrap(s.exam_master)?.total_questions || 0, type: 'EXAM'}))];
          examOnly.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'exam', isCompleted: ['채점완료', '제출완료', '완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const hwExams = rawExams.filter((s: any) => ['과제', '과제프린트'].includes(s.exam_master?.exam_type));
          fetchedStats = [...fetchedStats, ...hwExams.map((s: any) => ({...s, qCount: unwrap(s.exam_master)?.total_questions || 0, type: 'HW'}))];
          hwExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'hw_exam', isCompleted: ['채점완료', '제출완료', '완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const printExams = rawExams.filter((s: any) => ['오답프린트', '오답'].includes(s.exam_master?.exam_type));
          fetchedStats = [...fetchedStats, ...printExams.map((s: any) => ({...s, qCount: unwrap(s.exam_master)?.total_questions || 0, type: 'PRINT'}))];
          printExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'print', isCompleted: ['채점완료', '제출완료', '완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const similarExams = rawExams.filter((s: any) => ['오답유사', '과제오답유사'].includes(s.exam_master?.exam_type));
          fetchedStats = [...fetchedStats, ...similarExams.map((s: any) => ({...s, qCount: unwrap(s.exam_master)?.total_questions || 0, type: 'SIMILAR'}))];
          similarExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'similar', isCompleted: ['채점완료', '제출완료', '완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));
        }
        
        const { data: allHws } = await supabase.from('homework_assignment').select('homework_id, class_id, homework_title, target_student_id, target_questions, created_at, due_date').in('class_id', classIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');
        const { data: hwStats } = await supabase.from('student_homework_result').select('student_id, status, homework_id').in('student_id', chunk);
        
        const hwResultMap = new Map();
        hwStats?.forEach(r => hwResultMap.set(`${r.student_id}_${r.homework_id}`, r));

        allHws?.forEach(hw => {
          let hwQCount = 0;
          try { const tqs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []); hwQCount = tqs.length; } catch(e){}
          const hwDate = hw.due_date || hw.created_at;

          if (hw.target_student_id) {
             if (chunk.includes(hw.target_student_id)) {
                const res = hwResultMap.get(`${hw.target_student_id}_${hw.homework_id}`);
                fetchedStats.push({ student_id: hw.target_student_id, class_id: hw.class_id, status: res?.status || '미제출', type: 'HW', qCount: hwQCount });
                allCalEvents.push({ date: hwDate, type: 'hw', isCompleted: ['채점완료', '제출완료', '완료'].includes(res?.status), class_id: hw.class_id, student_id: hw.target_student_id });
             }
          } else {
             chunk.forEach(sId => {
                const s = students.find(st => st.id === sId);
                if (s && (s.allClassIds?.includes(hw.class_id) || s.classId === hw.class_id)) {
                   const res = hwResultMap.get(`${sId}_${hw.homework_id}`);
                   fetchedStats.push({ student_id: sId, class_id: hw.class_id, status: res?.status || '미제출', type: 'HW', qCount: hwQCount });
                   allCalEvents.push({ date: hwDate, type: 'hw', isCompleted: ['채점완료', '제출완료', '완료'].includes(res?.status), class_id: hw.class_id, student_id: sId });
                }
             });
          }
        });
      }
      setCurrentStats(fetchedStats);
      setClassCalendarEvents(allCalEvents); 
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchStudentTimeline = async (studentId: string, classId: string, allStudents: StudentInfo[]) => {
    setIsLoading(true);
    try {
      const studentObj = allStudents.find(s => s.id === studentId);
      const targetClassIds = studentObj?.allClassIds && studentObj.allClassIds.length > 0 ? studentObj.allClassIds : [classId];

      const { data: exams } = await supabase.from('exam_assignment').select('assignment_id, status, total_score, created_at, exam_master!inner(exam_id, title, sub_title, exam_type, total_questions)').eq('student_id', studentId).order('created_at', { ascending: false });
      const { data: hws } = await supabase.from('homework_assignment').select('*, textbook(title), student_homework_result(*)').in('class_id', targetClassIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');

      const examIds = exams?.map(e => e.assignment_id) || [];
      const hwIds = hws?.map(h => h.homework_id) || [];
      
      const [{ data: examAns }, { data: hwAns }] = await Promise.all([
        supabase.from('student_answer').select('exam_assignment_id, question_id, grading_code, earned_score').in('exam_assignment_id', examIds),
        supabase.from('student_homework_answer').select('homework_id, tq_id, grading_code, student_id, earned_score').in('homework_id', hwIds).eq('student_id', studentId)
      ]);

      const validHwTqIds = new Set<string>();
      hws?.forEach(hw => {
        let tqs = [];
        try { tqs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions; } catch(e){}
        tqs?.forEach((id: any) => validHwTqIds.add(`${hw.homework_id}_${id}`));
      });

      const masterIds = exams?.map(e => unwrap(e.exam_master)?.exam_id).filter(Boolean) || [];
      const { data: examItems } = await supabase.from('exam_item').select('exam_id, question_id').in('exam_id', masterIds);
      const validExamQIds = new Set<string>();
      examItems?.forEach(item => validExamQIds.add(`${item.exam_id}_${item.question_id}`));

      const assignToMasterMap = new Map<string, string>();
      exams?.forEach(e => assignToMasterMap.set(e.assignment_id, unwrap(e.exam_master)?.exam_id));

      const dedupExamAns = new Map();
      examAns?.forEach(a => {
        const mId = assignToMasterMap.get(a.exam_assignment_id);
        if (!validExamQIds.has(`${mId}_${a.question_id}`)) return; 
        const key = `${a.exam_assignment_id}_${a.question_id}`;
        const existing = dedupExamAns.get(key);
        if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0) || (!existing.grading_code && a.grading_code)) dedupExamAns.set(key, a);
      });

      const dedupHwAns = new Map();
      hwAns?.forEach(a => {
        if (!validHwTqIds.has(`${a.homework_id}_${a.tq_id}`)) return; 
        const key = `${a.homework_id}_${a.tq_id}`;
        const existing = dedupHwAns.get(key);
        if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0) || (!existing.grading_code && a.grading_code)) dedupHwAns.set(key, a);
      });

      const exCounts: Record<string, { o: number; x: number; helped: number }> = {};
      dedupExamAns.forEach(a => tallyGrading(exCounts, a.exam_assignment_id, a.grading_code));

      const hwCounts: Record<string, { o: number; x: number; helped: number }> = {};
      dedupHwAns.forEach(a => tallyGrading(hwCounts, a.homework_id, a.grading_code));

      let combined: any[] = [];
      exams?.forEach(ex => {
        const m = unwrap(ex.exam_master);
        let type = 'exam';
        if (['오답프린트', '오답'].includes(m?.exam_type)) type = 'print';
        else if (['과제', '과제프린트'].includes(m?.exam_type)) type = 'hw_exam';
        else if (['오답유사', '과제오답유사'].includes(m?.exam_type)) type = 'similar';

        combined.push({
          id: `${type}_${ex.assignment_id}`,
          type: type,
          realId: ex.assignment_id, masterId: m?.exam_id, title: m?.title || '제목 없음', subTitle: m?.sub_title, 
          date: ex.created_at, status: ex.status, total: m?.total_questions || 0, score: ex.total_score || 0,
          oCount: exCounts[ex.assignment_id]?.o || 0, xCount: exCounts[ex.assignment_id]?.x || 0, helpedCount: exCounts[ex.assignment_id]?.helped || 0,
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
          id: `hw_${hw.homework_id}`, type: 'hw', realId: hw.homework_id, masterId: hw.homework_id, 
          target_questions: targetQs, title: hw.homework_title, subTitle: tb?.title || '교재과제', source: tb?.title || '교재',
          date: hw.created_at || new Date().toISOString(), status: res?.status || '미제출', total: targetQs?.length || 0,
          oCount: hwCounts[hw.homework_id]?.o || 0, xCount: hwCounts[hw.homework_id]?.x || 0, helpedCount: hwCounts[hw.homework_id]?.helped || 0,
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

      const getStudentName = (sId: string) => { const s = students.find(st => st.id === sId); return s ? s.name : '알수없음'; };

      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);

        if (tab === 'EXAM' || tab === 'INCORRECT' || tab === 'SIMILAR') {
          const { data: rawExams } = await supabase.from('exam_assignment').select('assignment_id, status, created_at, class_id, class(name), student(name), student_id, exam_master!inner(exam_id, title, sub_title, total_questions, exam_type)').in('student_id', chunk);
          
          if (rawExams) {
            let data: any[] = []; 
            if (tab === 'EXAM') {
               data = rawExams.filter((d: any) => !['과제', '과제프린트', '오답프린트', '오답', '오답유사', '과제오답유사'].includes(d.exam_master?.exam_type));
            } else if (tab === 'INCORRECT') {
               data = rawExams.filter((d: any) => ['오답프린트', '오답'].includes(d.exam_master?.exam_type));
            } else if (tab === 'SIMILAR') {
               data = rawExams.filter((d: any) => ['오답유사', '과제오답유사'].includes(d.exam_master?.exam_type));
            }

            const assignIds = data.map((d: any) => d.assignment_id);
            const masterIds = data.map((d: any) => unwrap(d.exam_master)?.exam_id).filter(Boolean);
            const { data: examItems } = await supabase.from('exam_item').select('exam_id, question_id').in('exam_id', masterIds);
            const validExamQIds = new Set<string>();
            examItems?.forEach(item => validExamQIds.add(`${item.exam_id}_${item.question_id}`));

            const assignToMasterMap = new Map<string, string>();
            data.forEach((d: any) => assignToMasterMap.set(d.assignment_id, unwrap(d.exam_master)?.exam_id));

            const { data: ans } = await supabase.from('student_answer').select('exam_assignment_id, question_id, grading_code, earned_score').in('exam_assignment_id', assignIds);
            
            const dedupAns = new Map();
            ans?.forEach(a => {
              const mId = assignToMasterMap.get(a.exam_assignment_id);
              if (!validExamQIds.has(`${mId}_${a.question_id}`)) return; 
              const key = `${a.exam_assignment_id}_${a.question_id}`;
              const existing = dedupAns.get(key);
              if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0) || (!existing.grading_code && a.grading_code)) dedupAns.set(key, a);
            });

            const counts: Record<string, { o: number; x: number; helped: number }> = {};
            dedupAns.forEach(a => tallyGrading(counts, a.exam_assignment_id, a.grading_code));
            
            const enriched = data.map((d: any) => {
               const em = unwrap(d.exam_master); const cls = unwrap(d.class); const stu = unwrap(d.student);
               return {
                 ...d, masterId: em?.exam_id, 
                 type: ['오답프린트', '오답'].includes(em?.exam_type) ? 'print' : (['오답유사', '과제오답유사'].includes(em?.exam_type) ? 'similar' : (['과제', '과제프린트'].includes(em?.exam_type) ? 'hw_exam' : 'exam')), 
                 is_exam_hw: false,
                 oCount: counts[d.assignment_id]?.o || 0, xCount: counts[d.assignment_id]?.x || 0, helpedCount: counts[d.assignment_id]?.helped || 0,
                 totalQ: em?.total_questions || 0, class_name: cls?.name || '반 미지정', student: { name: stu?.name || '알수없음' },
                 title: em?.title || '제목 없음', subTitle: em?.sub_title, sort_date: d.created_at
               };
            });
            list = [...list, ...enriched];
          }
        }
        else if (tab === 'HOMEWORK') {
          const { data: allHws } = await supabase.from('homework_assignment').select('*, textbook(title), class(name)').in('class_id', classIds).neq('homework_title', '[시스템] 수업 진도 완료 기록');
          const { data: hwData } = await supabase.from('student_homework_result').select('*').in('student_id', chunk);
          
          const hwIds = allHws?.map(h => h.homework_id) || [];
          const validHwTqIds = new Set<string>();
          allHws?.forEach(hw => {
            let tqs = [];
            try { tqs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions; } catch(e){}
            tqs?.forEach((id: any) => validHwTqIds.add(`${hw.homework_id}_${id}`));
          });

          const { data: hAns } = await supabase.from('student_homework_answer').select('homework_id, student_id, tq_id, grading_code, earned_score').in('homework_id', hwIds).in('student_id', chunk);
          
          const dedupHAns = new Map();
          hAns?.forEach(a => {
            if (!validHwTqIds.has(`${a.homework_id}_${a.tq_id}`)) return; 
            const key = `${a.homework_id}_${a.student_id}_${a.tq_id}`;
            const existing = dedupHAns.get(key);
            if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0) || (!existing.grading_code && a.grading_code)) dedupHAns.set(key, a);
          });

          const hCounts: Record<string, { o: number; x: number; helped: number }> = {};
          dedupHAns.forEach(a => tallyGrading(hCounts, `${a.homework_id}_${a.student_id}`, a.grading_code));

          const hwResultMap = new Map();
          hwData?.forEach(r => hwResultMap.set(`${r.student_id}_${r.homework_id}`, r));

          allHws?.forEach(hw => {
            let targetQs = [];
            try { targetQs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []); } catch(e){}
            let totalQ = targetQs.length;

            if (hw.target_student_id) {
              if (chunk.includes(hw.target_student_id)) {
                const res = hwResultMap.get(`${hw.target_student_id}_${hw.homework_id}`);
                list.push({
                  type: 'hw', masterId: hw.homework_id, title: hw.homework_title, subTitle: unwrap(hw.textbook)?.title || '교재 과제', target_questions: targetQs,
                  is_exam_hw: false, homework_id: hw.homework_id, student_id: hw.target_student_id, class_id: hw.class_id, class_name: unwrap(hw.class)?.name || '반 미지정',
                  student: { name: getStudentName(hw.target_student_id) }, homework_assignment: hw, status: res?.status || '미제출', sort_date: hw.due_date || hw.created_at,
                  oCount: hCounts[`${hw.homework_id}_${hw.target_student_id}`]?.o || 0, xCount: hCounts[`${hw.homework_id}_${hw.target_student_id}`]?.x || 0, helpedCount: hCounts[`${hw.homework_id}_${hw.target_student_id}`]?.helped || 0, totalQ: totalQ
                });
              }
            } else {
              chunk.forEach(sId => {
                const s = students.find(st => st.id === sId);
                if (s && (s.allClassIds?.includes(hw.class_id) || s.classId === hw.class_id)) {
                  const res = hwResultMap.get(`${sId}_${hw.homework_id}`);
                  list.push({
                    type: 'hw', masterId: hw.homework_id, title: hw.homework_title, subTitle: unwrap(hw.textbook)?.title || '교재 과제', target_questions: targetQs,
                    is_exam_hw: false, homework_id: hw.homework_id, student_id: sId, class_id: hw.class_id, class_name: unwrap(hw.class)?.name || '반 미지정',
                    student: { name: getStudentName(sId) }, homework_assignment: hw, status: res?.status || '미제출', sort_date: hw.due_date || hw.created_at,
                    oCount: hCounts[`${hw.homework_id}_${sId}`]?.o || 0, xCount: hCounts[`${hw.homework_id}_${sId}`]?.x || 0, helpedCount: hCounts[`${hw.homework_id}_${sId}`]?.helped || 0, totalQ: totalQ
                  });
                }
              });
            }
          });

          const { data: rawExamHws } = await supabase.from('exam_assignment')
            .select('assignment_id, status, created_at, student_id, class_id, class(name), student(name), exam_master!inner(exam_id, title, sub_title, total_questions, exam_type)')
            .in('student_id', chunk);

          const examData = rawExamHws?.filter((d: any) => d.exam_master?.exam_type === '과제' || d.exam_master?.exam_type === '과제프린트') || [];

          const exIds = examData.map((e: any) => e.assignment_id);
          const exMasterIds = examData.map((e: any) => unwrap(e.exam_master)?.exam_id).filter(Boolean);

          const { data: exItems } = await supabase.from('exam_item').select('exam_id, question_id').in('exam_id', exMasterIds);
          const validExQIds = new Set<string>();
          exItems?.forEach(item => validExQIds.add(`${item.exam_id}_${item.question_id}`));

          const exAssignToMasterMap = new Map<string, string>();
          examData.forEach((e: any) => exAssignToMasterMap.set(e.assignment_id, unwrap(e.exam_master)?.exam_id));

          const { data: eAns } = await supabase.from('student_answer').select('exam_assignment_id, question_id, grading_code, earned_score').in('exam_assignment_id', exIds);
          
          const dedupEAns = new Map();
          eAns?.forEach(a => {
            const mId = exAssignToMasterMap.get(a.exam_assignment_id);
            if (!validExQIds.has(`${mId}_${a.question_id}`)) return; 
            const key = `${a.exam_assignment_id}_${a.question_id}`;
            const existing = dedupEAns.get(key);
            if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0) || (!existing.grading_code && a.grading_code)) dedupEAns.set(key, a);
          });

          const eCounts: Record<string, { o: number; x: number; helped: number }> = {};
          dedupEAns.forEach(a => tallyGrading(eCounts, a.exam_assignment_id, a.grading_code));

          const formattedExamHws = examData.map((e:any) => {
            const em = unwrap(e.exam_master);
            return {
              ...e, masterId: em?.exam_id, type: 'hw_exam', is_exam_hw: true, sort_date: e.created_at, class_name: unwrap(e.class)?.name || '반 미지정',
              student: { name: unwrap(e.student)?.name || '알수없음' },
              oCount: eCounts[e.assignment_id]?.o || 0, xCount: eCounts[e.assignment_id]?.x || 0, helpedCount: eCounts[e.assignment_id]?.helped || 0, totalQ: em?.total_questions || 0,
              title: em?.title || '제목 없음', subTitle: em?.sub_title
            };
          });
          list = [...list, ...formattedExamHws];
        } 
      }

      list.sort((a, b) => new Date(b.sort_date || b.created_at || 0).getTime() - new Date(a.sort_date || a.created_at || 0).getTime());
      setGlobalList(list);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  return {
    isAuthorized, isLoading, setIsLoading,
    groupedClasses, allStudentsList, currentStats,
    globalList, setGlobalList, timelineData, setTimelineData,
    classCalendarEvents,
    fetchBaseData, fetchStatsForTab, fetchStudentTimeline, fetchGlobalListForTab
  };
}