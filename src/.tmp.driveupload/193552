import { healStudentIncorrectRecordsAction } from '@/app/actions/clinicActions';
// src/app/(dashboard)/learning/hooks/useLearningFetch.ts
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { StudentInfo, ClassInfo, TabType } from "../types";
import { getPointBalance } from "@/app/actions/shopPoints";

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

export const LEVEL_ORDER = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강', '메이크업/보강', '기타'];

export const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

// Supabase PostgREST 기본 1,000행 제한으로 인해 최근 배부된 오답프린트/시험지/과제 결과가 누락되는 현상 방지
async function fetchAllRows<T = any>(buildQuery: () => any, pageSize = 1000): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// O, RO, TO만 정답 카운트 / X, TX만 오답 카운트
export const tallyGrading = (counts: Record<string, { o: number; x: number; helped: number }>, key: any, code: string) => {
  if (!counts[key]) counts[key] = { o: 0, x: 0, helped: 0 };
  if (['O', 'RO', 'TO'].includes(code)) counts[key].o++;
  else if (['X', 'TX'].includes(code)) counts[key].x++;
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

      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, status, end_date, student(name, status)').in('class_id', classIds);

      enrollments?.forEach((e: any) => {
        if (isEndedEnrollment(e)) return;
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

  const fetchStatsForTab = async (students: StudentInfo[], targetStudentIds?: string[]) => {
    if (!targetStudentIds) setIsLoading(true); 
    try {
      const studentIds = targetStudentIds ? targetStudentIds : students.map(s => s.id);
      if (studentIds.length === 0) return;

      const classIds = [...new Set(students.filter(s => studentIds.includes(s.id)).flatMap(s => s.allClassIds || [s.classId]))]; 
      let fetchedStats: any[] = [];
      let allCalEvents: any[] = []; 
      const chunkSize = 200;

      const mapExamStat = (s: any, type: string) => {
        const fallbackStu = students.find(st => st.id === s.student_id);
        return {
          ...s,
          class_id: s.class_id || fallbackStu?.classId,
          qCount: unwrap(s.exam_master)?.total_questions || 0,
          type
        };
      };
      
      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);
        
        const rawExams = await fetchAllRows(() =>
          supabase.from('exam_assignment')
            .select('assignment_id, student_id, status, class_id, created_at, exam_master!inner(exam_type, title, total_questions)')
            .in('student_id', chunk)
            .order('assignment_id', { ascending: true })
        );

        if (rawExams && rawExams.length > 0) {
          const examOnly = rawExams.filter((s: any) => ['주간테스트', '중간테스트', '중간평가'].includes(unwrap(s.exam_master)?.exam_type));
          fetchedStats = [...fetchedStats, ...examOnly.map((s: any) => mapExamStat(s, 'EXAM'))];
          examOnly.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'exam', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const quarterlyExams = rawExams.filter((s: any) => ['분기테스트', '분기평가'].includes(unwrap(s.exam_master)?.exam_type));
          quarterlyExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'quarterly', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const hwExams = rawExams.filter((s: any) => ['과제', '과제프린트'].includes(unwrap(s.exam_master)?.exam_type));
          fetchedStats = [...fetchedStats, ...hwExams.map((s: any) => mapExamStat(s, 'HW'))];
          hwExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'hw_exam', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const printExams = rawExams.filter((s: any) => ['오답프린트', '오답'].includes(unwrap(s.exam_master)?.exam_type));
          fetchedStats = [...fetchedStats, ...printExams.map((s: any) => mapExamStat(s, 'PRINT'))];
          printExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'print', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const similarExams = rawExams.filter((s: any) => ['오답유사', '과제오답유사'].includes(unwrap(s.exam_master)?.exam_type));
          fetchedStats = [...fetchedStats, ...similarExams.map((s: any) => mapExamStat(s, 'SIMILAR'))];
          similarExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'similar', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));

          const overdueExams = rawExams.filter((s: any) => unwrap(s.exam_master)?.exam_type === '미완료과제');
          fetchedStats = [...fetchedStats, ...overdueExams.map((s: any) => mapExamStat(s, 'OVERDUE'))];
          overdueExams.forEach((s: any) => allCalEvents.push({ date: s.created_at, type: 'overdue', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(s.status), class_id: s.class_id, student_id: s.student_id }));
        }
        
        const [allHws, hwStats] = await Promise.all([
          fetchAllRows(() =>
            supabase.from('homework_assignment')
              .select('homework_id, class_id, homework_title, target_student_id, target_questions, created_at, due_date')
              .in('class_id', classIds)
              .neq('homework_title', '[시스템] 수업 진도 완료 기록')
              .order('homework_id', { ascending: true })
          ),
          fetchAllRows(() =>
            supabase.from('student_homework_result')
              .select('hw_result_id, student_id, status, homework_id')
              .in('student_id', chunk)
              .order('hw_result_id', { ascending: true })
          ),
        ]);
        
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
                allCalEvents.push({ date: hwDate, type: 'hw', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(res?.status), class_id: hw.class_id, student_id: hw.target_student_id });
             }
          } else {
             chunk.forEach(sId => {
                const s = students.find(st => st.id === sId);
                if (s && (s.allClassIds?.includes(hw.class_id) || s.classId === hw.class_id)) {
                   const res = hwResultMap.get(`${sId}_${hw.homework_id}`);
                   fetchedStats.push({ student_id: sId, class_id: hw.class_id, status: res?.status || '미제출', type: 'HW', qCount: hwQCount });
                   allCalEvents.push({ date: hwDate, type: 'hw', isCompleted: ['채점완료', '제출완료', '완료', '최종완료'].includes(res?.status), class_id: hw.class_id, student_id: sId });
                }
             });
          }
        });
      }
      
      if (targetStudentIds) {
        setCurrentStats(prev => {
          const filtered = prev.filter(p => !targetStudentIds.includes(p.student_id));
          return [...filtered, ...fetchedStats];
        });
        setClassCalendarEvents(prev => {
          const filtered = prev.filter(p => !targetStudentIds.includes(p.student_id));
          return [...filtered, ...allCalEvents];
        });
      } else {
        setCurrentStats(fetchedStats);
        setClassCalendarEvents(allCalEvents);
      }
    } catch (e) { console.error(e); } finally { if (!targetStudentIds) setIsLoading(false); }
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
        let type = 'other';
        if (['주간테스트', '중간테스트', '중간평가'].includes(m?.exam_type)) type = 'exam';
        else if (['분기테스트', '분기평가'].includes(m?.exam_type)) type = 'quarterly';
        else if (['오답프린트', '오답'].includes(m?.exam_type)) type = 'print';
        else if (['과제', '과제프린트'].includes(m?.exam_type)) type = 'hw_exam';
        else if (['오답유사', '과제오답유사'].includes(m?.exam_type)) type = 'similar';
        else if (m?.exam_type === '미완료과제') type = 'overdue'; 

        const totalQ = m?.total_questions || 0;
        const oCnt = exCounts[ex.assignment_id]?.o || 0;
        const xCnt = exCounts[ex.assignment_id]?.x || 0;
        let finalExStatus = ex.status;
        if (totalQ > 0 && oCnt >= totalQ && xCnt === 0 && !['제출완료', '채점완료', '완료', '최종완료'].includes(finalExStatus)) {
          finalExStatus = '최종완료';
          supabase.from('exam_assignment').update({ status: '최종완료' }).eq('assignment_id', ex.assignment_id).then();
        }

        combined.push({
          id: `${type}_${ex.assignment_id}`,
          type: type,
          realId: ex.assignment_id, masterId: m?.exam_id, title: m?.title || '제목 없음', subTitle: m?.sub_title, 
          date: ex.created_at, status: finalExStatus, total: totalQ, score: ex.total_score || 0,
          oCount: oCnt, xCount: xCnt, helpedCount: exCounts[ex.assignment_id]?.helped || 0,
          isCompleted: ['제출완료', '채점완료', '완료', '최종완료'].includes(finalExStatus)
        });
      });

      hws?.forEach(hw => {
        if (hw.target_student_id && hw.target_student_id !== studentId) return;
        const resList = Array.isArray(hw.student_homework_result) ? hw.student_homework_result : [hw.student_homework_result].filter(Boolean);
        const res = resList.find((r: any) => String(r.student_id) === String(studentId));
        let targetQs = [];
        try { targetQs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions; } catch(e){}
        const tb = unwrap(hw.textbook);
        const totalHwQ = targetQs?.length || 0;
        const hwOCnt = hwCounts[hw.homework_id]?.o || 0;
        const hwXCnt = hwCounts[hw.homework_id]?.x || 0;
        let finalHwStatus = res?.status || '미제출';
        if (totalHwQ > 0 && hwOCnt >= totalHwQ && hwXCnt === 0 && !['제출완료', '채점완료', '완료', '최종완료'].includes(finalHwStatus)) {
          finalHwStatus = '채점완료';
          if (res?.hw_result_id) {
            supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', res.hw_result_id).then();
          } else {
            supabase.from('student_homework_result').insert({ homework_id: hw.homework_id, student_id: studentId, status: '채점완료', completed_tq_ids: targetQs || [], checked_at: new Date().toISOString() }).then();
          }
        }
        combined.push({
          id: `hw_${hw.homework_id}`, type: 'hw', realId: hw.homework_id, masterId: hw.homework_id, 
          target_questions: targetQs, title: hw.homework_title, subTitle: tb?.title || '교재과제', source: tb?.title || '교재',
          date: hw.created_at || new Date().toISOString(), status: finalHwStatus, total: totalHwQ,
          oCount: hwOCnt, xCount: hwXCnt, helpedCount: hwCounts[hw.homework_id]?.helped || 0,
          isCompleted: ['제출완료', '채점완료', '완료', '최종완료'].includes(finalHwStatus)
        });
      });

      const { data: archives } = await supabase.from('student_incorrect_record')
        .select('record_id, source_type, status, resolved_at, created_at, question_id, tq_id')
        .eq('student_id', studentId)
        .not('resolved_at', 'is', null);

      if (archives) {
        const groupedArchive = archives.reduce((acc: any, curr: any) => {
          const month = curr.resolved_at ? curr.resolved_at.substring(0, 7) : 'Unknown';
          if (!acc[month]) acc[month] = [];
          acc[month].push(curr);
          return acc;
        }, {});

        Object.keys(groupedArchive).forEach(month => {
          const items = groupedArchive[month];
          const qIds = Array.from(new Set(items.map((i:any) => i.question_id).filter(Boolean)));

          combined.push({
             id: `archive_${month}`, type: 'archive', realId: month,
             title: `📦 ${month.replace('-', '년 ')}월 해결된 오답`,
             subTitle: `해당 월에 극복 완료한 오답 (총 ${items.length}문항)`,
             date: `${month}-28T23:59:59.000Z`, status: '채점완료', total: items.length,
             oCount: items.length, xCount: 0, helpedCount: items.filter((a:any) => ['TO', 'RO'].includes(a.status)).length,
             isCompleted: true,
             target_questions: qIds 
          });
        });
      }

      const { data: rawIncs } = await supabase.from('student_incorrect_record')
        .select('record_id, source_type, status, created_at, question_id, tq_id')
        .eq('student_id', studentId)
        .is('resolved_at', null);

      if (rawIncs) {
        const groupedRaw = rawIncs.reduce((acc: any, curr: any) => {
          const month = curr.created_at ? curr.created_at.substring(0, 7) : 'Unknown';
          if (!acc[month]) acc[month] = [];
          acc[month].push(curr);
          return acc;
        }, {});

        Object.keys(groupedRaw).forEach(month => {
          const items = groupedRaw[month];
          const qIds = Array.from(new Set(items.map((i:any) => i.question_id).filter(Boolean)));
          
          combined.push({
             id: `raw_inc_${month}`, type: 'raw_inc', realId: month,
             title: `🔥 ${month.replace('-', '년 ')}월 누적 미해결 오답`,
             subTitle: `아직 극복하지 못한 순수 원본 오답 기록`,
             date: `${month}-28T23:59:58.000Z`, status: '미응시', total: items.length,
             oCount: 0, xCount: items.length, helpedCount: 0,
             isCompleted: false,
             target_questions: qIds
          });
        });
      }

      combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimelineData(combined);

      // 학생 타임라인 조회 시 좌측 사이드바 버블(currentStats)도 해당 학생의 최신 상태로 즉시 동기화
      const syncedStudentStats: any[] = [];
      combined.forEach((item: any) => {
        const statType =
          item.type === 'exam' ? 'EXAM' :
          item.type === 'hw' || item.type === 'hw_exam' ? 'HW' :
          item.type === 'print' ? 'PRINT' :
          item.type === 'similar' ? 'SIMILAR' :
          item.type === 'overdue' ? 'OVERDUE' : null;
        if (!statType) return;
        syncedStudentStats.push({
          student_id: studentId,
          class_id: classId || studentObj?.classId,
          status: item.status,
          type: statType,
          qCount: item.total || 0,
        });
      });
      setCurrentStats(prev => [
        ...prev.filter(p => p.student_id !== studentId),
        ...syncedStudentStats,
      ]);
    } catch(e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchGlobalListForTab = async (tab: any, students: StudentInfo[]) => {
    setIsLoading(true);
    setGlobalList([]);
    try {
      const studentIds = students.map(s => s.id);
      const classIds = [...new Set(students.flatMap(s => s.allClassIds || [s.classId]))]; 
      let list: any[] = [];
      const chunkSize = 200;

      const getStudentName = (sId: string) => { const s = students.find(st => st.id === sId); return s ? s.name : '알수없음'; };

      if (tab === 'ARCHIVE' || tab === 'RAW_INCORRECT') {
        const isArchive = tab === 'ARCHIVE';
        for (let i = 0; i < studentIds.length; i += chunkSize) {
          const chunk = studentIds.slice(i, i + chunkSize);
          
          let query = supabase.from('student_incorrect_record')
             .select('record_id, source_type, status, resolved_at, created_at, student_id, question_id, tq_id')
             .in('student_id', chunk);
             
          if (isArchive) query = query.not('resolved_at', 'is', null).order('resolved_at', { ascending: false });
          else query = query.is('resolved_at', null).order('created_at', { ascending: false });

          const { data: records } = await query;

          if (records) {
             const grouped = records.reduce((acc: any, curr: any) => {
                const dateTarget = isArchive ? curr.resolved_at : curr.created_at;
                const month = dateTarget ? dateTarget.substring(0, 7) : 'Unknown';
                const key = `${curr.student_id}_${month}`;
                if (!acc[key]) acc[key] = { month, student_id: curr.student_id, items: [] };
                acc[key].items.push(curr);
                return acc;
             }, {});

             const enriched = Object.values(grouped).map((group: any) => {
                const stuFallback = students.find(s => s.id === group.student_id);
                const items = group.items;
                const qIds = Array.from(new Set(items.map((i:any) => i.question_id).filter(Boolean)));
                
                return {
                   type: isArchive ? 'archive' : 'raw_inc', 
                   realId: group.month, 
                   student_id: group.student_id,
                   class_id: stuFallback?.classId, 
                   class_name: stuFallback?.className || '반 미지정',
                   student: { name: stuFallback?.name || '알수없음' },
                   title: isArchive ? `📦 ${group.month.replace('-', '년 ')}월 해결된 오답` : `🔥 ${group.month.replace('-', '년 ')}월 누적 미해결 오답`, 
                   subTitle: `총 ${items.length}문항`,
                   sort_date: `${group.month}-28T23:59:59.000Z`, 
                   status: isArchive ? '채점완료' : '미응시',
                   oCount: isArchive ? items.length : 0, 
                   xCount: isArchive ? 0 : items.length, 
                   helpedCount: isArchive ? items.filter((a:any) => ['TO', 'RO'].includes(a.status)).length : 0, 
                   totalQ: items.length,
                   target_questions: qIds
                };
             });
             list = [...list, ...enriched];
          }
        }
      } else {
        for (let i = 0; i < studentIds.length; i += chunkSize) {
          const chunk = studentIds.slice(i, i + chunkSize);

          if (tab === 'EXAM' || tab === 'QUARTERLY' || tab === 'INCORRECT' || tab === 'SIMILAR' || tab === 'OVERDUE') {
            const rawExams = await fetchAllRows(() =>
              supabase.from('exam_assignment')
                .select('assignment_id, status, created_at, class_id, class(name), student(name), student_id, exam_master!inner(exam_id, title, sub_title, total_questions, exam_type)')
                .in('student_id', chunk)
                .order('assignment_id', { ascending: true })
            );
            
            if (rawExams) {
              let data: any[] = []; 
              if (tab === 'EXAM') {
                 data = rawExams.filter((d: any) => ['주간테스트', '중간테스트', '중간평가'].includes(d.exam_master?.exam_type));
              } else if (tab === 'QUARTERLY') {
                 data = rawExams.filter((d: any) => ['분기테스트', '분기평가'].includes(d.exam_master?.exam_type));
              } else if (tab === 'INCORRECT') {
                 data = rawExams.filter((d: any) => ['오답프린트', '오답'].includes(d.exam_master?.exam_type));
              } else if (tab === 'SIMILAR') {
                 data = rawExams.filter((d: any) => ['오답유사', '과제오답유사'].includes(d.exam_master?.exam_type));
              } else if (tab === 'OVERDUE') {
                 data = rawExams.filter((d: any) => d.exam_master?.exam_type === '미완료과제');
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
                 const stuFallback = students.find(s => s.id === d.student_id);
                 return {
                   ...d, 
                   class_id: d.class_id || stuFallback?.classId, 
                   masterId: em?.exam_id, 
                   type: ['오답프린트', '오답'].includes(em?.exam_type) ? 'print' : 
                         (['오답유사', '과제오답유사'].includes(em?.exam_type) ? 'similar' : 
                         (em?.exam_type === '미완료과제' ? 'overdue' : 
                         (['분기테스트', '분기평가'].includes(em?.exam_type) ? 'quarterly' : 
                         (['과제', '과제프린트'].includes(em?.exam_type) ? 'hw_exam' : 'exam')))), 
                   is_exam_hw: false,
                   oCount: counts[d.assignment_id]?.o || 0, xCount: counts[d.assignment_id]?.x || 0, helpedCount: counts[d.assignment_id]?.helped || 0,
                   totalQ: em?.total_questions || 0, 
                   class_name: cls?.name || stuFallback?.className || '반 미지정', 
                   student: { name: stu?.name || stuFallback?.name || '알수없음' },
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
                  const sFallback = students.find(st => st.id === hw.target_student_id);
                  list.push({
                    type: 'hw', masterId: hw.homework_id, title: hw.homework_title, subTitle: unwrap(hw.textbook)?.title || '교재 과제', target_questions: targetQs,
                    is_exam_hw: false, homework_id: hw.homework_id, student_id: hw.target_student_id, class_id: hw.class_id, 
                    class_name: unwrap(hw.class)?.name || sFallback?.className || '반 미지정',
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
                      is_exam_hw: false, homework_id: hw.homework_id, student_id: sId, class_id: hw.class_id, 
                      class_name: unwrap(hw.class)?.name || s?.className || '반 미지정',
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
              const stuFallback = students.find(s => s.id === e.student_id);
              return {
                ...e, 
                class_id: e.class_id || stuFallback?.classId, 
                masterId: em?.exam_id, type: 'hw_exam', is_exam_hw: true, sort_date: e.created_at, 
                class_name: unwrap(e.class)?.name || stuFallback?.className || '반 미지정',
                student: { name: unwrap(e.student)?.name || stuFallback?.name || '알수없음' },
                oCount: eCounts[e.assignment_id]?.o || 0, xCount: eCounts[e.assignment_id]?.x || 0, helpedCount: eCounts[e.assignment_id]?.helped || 0, totalQ: em?.total_questions || 0,
                title: em?.title || '제목 없음', subTitle: em?.sub_title
              };
            });
            list = [...list, ...formattedExamHws];
          } 
        }
      }

      list.sort((a, b) => new Date(b.sort_date || b.created_at || 0).getTime() - new Date(a.sort_date || a.created_at || 0).getTime());
      setGlobalList(list);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  // 🌟 클리닉 미리보기를 위한 학생 포털 상태 집계 (실제 학생 포털 /student/portal 과 로직 100% 동일화)
  const fetchStudentClinicPreview = async (
    studentId: string,
    classId: string,
    studentNameParam?: string,
    classNameParam?: string
  ) => {
    const getKSTDateString = () =>
      new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

    const cleanTitle = (raw: string, studentName: string) => {
      if (!raw) return '제목 없음';
      let t = raw;

      if (studentName) {
        const nameTag = `[${studentName}]`;
        t = t.split(nameTag).join('').trim();
      }

      const overdueMatches = t.match(/(미완료\s*프린트\s*)+/);
      if (overdueMatches) {
        const count = overdueMatches[0].match(/미완료\s*프린트/g)?.length || 1;
        t = t.replace(
          /(미완료\s*프린트\s*)+/,
          count > 1 ? `미완료 프린트 (${count}차) ` : '미완료 프린트 '
        );
      }

      const wrongMatches = t.match(/(오답\s*프린트\s*)+/);
      if (wrongMatches) {
        const count = wrongMatches[0].match(/오답\s*프린트/g)?.length || 1;
        t = t.replace(
          /(오답\s*프린트\s*)+/,
          count > 1 ? `오답 프린트 (${count}차) ` : '오답 프린트 '
        );
      }

      return t.replace(/\s+/g, ' ').trim() || '제목 없음';
    };

    try {
      const today = getKSTDateString();
      let sName = studentNameParam || '';
      let classes: string[] = [];
      const nameToId: Record<string, string> = {};

      try {
        const { data: stuData } = await supabase
          .from('student')
          .select('name, enrollment(status, end_date, class(class_id, name))')
          .eq('student_id', studentId)
          .maybeSingle();

        if (stuData) {
          if (!sName && stuData.name) sName = stuData.name;
          const activeEnrolls = (stuData.enrollment || []).filter(
            (e: any) => !isEndedEnrollment(e)
          );
          activeEnrolls.forEach((e: any) => {
            const clsObj = unwrap(e.class);
            if (clsObj?.name) {
              if (!classes.includes(clsObj.name)) classes.push(clsObj.name);
              if (clsObj.class_id) nameToId[clsObj.name] = clsObj.class_id;
            }
          });
        }
      } catch (e) {}

      if (classNameParam && !classes.includes(classNameParam)) {
        classes.unshift(classNameParam);
      }
      if (classNameParam && classId && !nameToId[classNameParam]) {
        nameToId[classNameParam] = classId;
      }
      if (classes.length === 0) {
        classes = [classNameParam || '반 미배정'];
      }

      const { data: cData } = await supabase
        .from('class')
        .select('class_id, name')
        .in('name', classes);
      cData?.forEach((c: any) => {
        nameToId[c.name] = c.class_id;
      });

      const selectedClass =
        classNameParam && classes.includes(classNameParam)
          ? classNameParam
          : classes[0];

      const newBlockStates: Record<string, any> = {};
      const newHwProgress: Record<string, any> = {};

      classes.forEach((c) => {
        newBlockStates[c] = {
          exam: 'NO_DATA',
          hw: 'NO_DATA',
          print: 'NO_DATA',
          overdue: 'NO_DATA',
        };
        newHwProgress[c] = {
          activeExamMode: 'DONE',
          hasAnyExamClearedToday: false,
          examList: [],
          hwList: [],
          overdueList: [],
          printTitles: [],
          examQCount: 0,
          hwQCount: 0,
          printQCount: 0,
          overdueQCount: 0,
          examPendingCount: 0,
          hwPendingCount: 0,
          printPendingCount: 0,
          overduePendingCount: 0,
          examStatus: '대기',
          examInitialScore: null,
          examType: '',
        };
      });

      const [
        pointsBalance,
        { data: sessionRow },
        { data: rData },
        { data: incData },
        { data: hwAnsData },
        { data: examAnsData },
        { data: examsData },
      ] = await Promise.all([
        getPointBalance(studentId).catch(() => 0),
        supabase
          .from('clinic_session_state')
          .select(
            'id, session_date, duration_ms, seat, manual_seat, started_at, ended_at, end_request_status, end_request_cooldown_until, active_calls, away_since'
          )
          .eq('student_id', studentId)
          .eq('session_date', today)
          .is('ended_at', null)
          .order('session_no', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('clinic_round_result')
          .select('*')
          .eq('student_id', studentId),
        supabase
          .from('student_incorrect_record')
          .select('record_id, question_id, tq_id, status')
          .eq('student_id', studentId)
          .in('status', ['X', 'TX', 'TO', 'B'])
          .is('resolved_at', null),
        supabase
          .from('student_homework_answer')
          .select('homework_id, tq_id, grading_code')
          .eq('student_id', studentId)
          .in('grading_code', ['O', 'TO', 'RO']),
        supabase
          .from('student_answer')
          .select('exam_assignment_id, question_id, grading_code')
          .eq('student_id', studentId)
          .in('grading_code', ['O', 'TO', 'RO']),
        supabase
          .from('exam_assignment')
          .select(
            'assignment_id, status, total_score, class_id, created_at, exam_master!inner(exam_type, title, sub_title, total_questions)'
          )
          .eq('student_id', studentId),
      ]);

      const roundResults: Record<string, any> = {};
      rData?.forEach((r: any) => {
        roundResults[`${r.class_name}::${r.round}`] = r;
      });

      const rawTqIds = (incData || []).map((r: any) => r.tq_id).filter(Boolean);
      const tqToQidMap = new Map();
      if (rawTqIds.length > 0) {
        const safeTqIds = rawTqIds.filter((id: any) => !isNaN(Number(id)));
        if (safeTqIds.length > 0) {
          const { data: tqRows } = await supabase
            .from('textbook_question')
            .select('tq_id, question_id')
            .in('tq_id', safeTqIds);
          tqRows?.forEach((t: any) => {
            if (t.question_id) tqToQidMap.set(t.tq_id, t.question_id);
          });
        }
      }

      const recordsToHealMissingQid = (incData || []).filter(
        (r: any) => !r.question_id && r.tq_id && tqToQidMap.has(r.tq_id)
      );
      if (recordsToHealMissingQid.length > 0) {
        const healPayload = recordsToHealMissingQid
          .map((r: any) => ({
            record_id: r.record_id,
            tq_id: r.tq_id,
            target_qid: String(tqToQidMap.get(r.tq_id) || ''),
            status: r.status,
          }))
          .filter((it: any) => it.target_qid);
        healStudentIncorrectRecordsAction(studentId, healPayload).catch(() => {});
      }

      const resolvedQids = (incData || [])
        .map((r: any) => r.question_id || tqToQidMap.get(r.tq_id))
        .filter(Boolean);
      let uniqueIncIds = Array.from(new Set(resolvedQids)) as any[];

      const printExamIds = new Set(
        (examsData || [])
          .filter((ex: any) =>
            ['오답프린트', '오답'].includes(unwrap(ex.exam_master)?.exam_type)
          )
          .map((ex: any) => ex.assignment_id)
      );

      const fullyResolvedQids = new Set<any>();
      examAnsData?.forEach((a: any) => {
        if (
          printExamIds.has(a.exam_assignment_id) &&
          ['O', 'RO'].includes(a.grading_code)
        ) {
          fullyResolvedQids.add(a.question_id);
        }
      });

      const recordsToHealResolved = (incData || []).filter((r: any) => {
        const qid = r.question_id || tqToQidMap.get(r.tq_id);
        return qid && fullyResolvedQids.has(qid);
      });

      if (recordsToHealResolved.length > 0) {
        const rIdsToHeal = recordsToHealResolved.map((r: any) => r.record_id);
        supabase
          .from('student_incorrect_record')
          .update({ resolved_at: new Date().toISOString(), status: 'RO' })
          .in('record_id', rIdsToHeal)
          .then(() => {});
      }
      uniqueIncIds = uniqueIncIds.filter((id) => !fullyResolvedQids.has(id));

      const fixingQids = new Set<any>();
      const fixingExamIds = (examsData || [])
        .filter((ex: any) => ex.status === '채점확정')
        .map((ex: any) => ex.assignment_id);

      if (fixingExamIds.length > 0) {
        const { data: fixingAnswers } = await supabase
          .from('student_answer')
          .select('question_id')
          .in('exam_assignment_id', fixingExamIds);
        fixingAnswers?.forEach((a: any) => fixingQids.add(a.question_id));
      }

      uniqueIncIds = uniqueIncIds.filter((id) => !fixingQids.has(id));
      const totalPrintQCount = uniqueIncIds.length;

      const hwResolvedMap = new Map<number, Set<number>>();
      hwAnsData?.forEach((a: any) => {
        if (!hwResolvedMap.has(a.homework_id))
          hwResolvedMap.set(a.homework_id, new Set());
        hwResolvedMap.get(a.homework_id)!.add(a.tq_id);
      });

      const examResolvedMap = new Map<number, Set<any>>();
      examAnsData?.forEach((a: any) => {
        if (!examResolvedMap.has(a.exam_assignment_id))
          examResolvedMap.set(a.exam_assignment_id, new Set());
        examResolvedMap.get(a.exam_assignment_id)!.add(a.question_id);
      });

      const classIds = Object.values(nameToId).filter(Boolean);
      const hwFilters: string[] = [];
      if (classIds.length > 0) hwFilters.push(`class_id.in.(${classIds.join(',')})`);
      hwFilters.push(`target_student_id.eq.${studentId}`);

      const [{ data: hwAssignments }, { data: hwResData }] = await Promise.all([
        supabase
          .from('homework_assignment')
          .select(
            'homework_id, class_id, target_student_id, due_date, homework_title, target_questions'
          )
          .or(hwFilters.join(','))
          .neq('homework_title', '[시스템] 수업 진도 완료 기록'),
        supabase
          .from('student_homework_result')
          .select('homework_id, status, completed_tq_ids')
          .eq('student_id', studentId),
      ]);

      const hwsData = hwAssignments || [];
      const hwResMap = new Map();
      hwResData?.forEach((r: any) => hwResMap.set(r.homework_id, r));

      const activeClassIdSet = new Set(Object.values(nameToId).filter(Boolean));

      classes.forEach((c) => {
        const cid = nameToId[c];

        const hwExams: any[] = [];
        const similarExams: any[] = [];
        const overdueExams: any[] = [];
        const regularExams: any[] = [];
        let hasAnyExamClearedToday = false;

        examsData?.forEach((ex: any) => {
          const master = unwrap(ex.exam_master);
          const type = master?.exam_type;
          const rawTitle = master?.title;
          const rawSubTitle = master?.sub_title;
          const tq = master?.total_questions;

          const isWeeklyIncorrect = (() => {
            const t = String(rawTitle || '').trim();
            const ty = String(type || '').trim();
            const sub = String(rawSubTitle || '').trim();
            if (t.includes('[통합]') || sub === '누적 오답 모음') return false;
            if (ty === '오답프린트' || ty === '오답') return true;
            const hasWeekAndWrong = (s: string) =>
              /([0-9xX]+\s*주차|주차)/.test(s) && /오답\s*(프린트)?/.test(s);
            return hasWeekAndWrong(t) || hasWeekAndWrong(ty);
          })();

          const isPersonalClinicExam =
            isWeeklyIncorrect ||
            ['오답유사', '과제오답유사', '오답프린트', '오답', '미완료과제'].includes(type);
          const isOrphanClassId = ex.class_id && !activeClassIdSet.has(ex.class_id);

          if (ex.class_id && cid && ex.class_id !== cid && !isPersonalClinicExam && !isOrphanClassId) return;

          const resolved = examResolvedMap.get(ex.assignment_id)?.size || 0;
          const remain = Math.max(0, (tq || 0) - resolved);

          if (
            ex.status === '채점확정' &&
            (ex.total_score === 100 || (tq > 0 && remain === 0))
          ) {
            supabase
              .from('exam_assignment')
              .update({ status: '최종완료' })
              .eq('assignment_id', ex.assignment_id)
              .then();
            ex.status = '최종완료';
          }

          if (
            (type === '오답유사' || type === '과제오답유사' || type === '과제' || type === '과제프린트' || type === '미완료과제' || isWeeklyIncorrect) &&
            tq > 0 &&
            remain === 0 &&
            !['최종완료', '완료', '채점완료', '제출완료'].includes(ex.status)
          ) {
            supabase
              .from('exam_assignment')
              .update({ status: '최종완료' })
              .eq('assignment_id', ex.assignment_id)
              .then();
            ex.status = '최종완료';
          }

          const isFinalDone = ['최종완료', '완료', '채점완료'].includes(
            ex.status
          );

          const isTestType =
            ![
              '과제',
              '과제프린트',
              '미완료과제',
              '오답프린트',
              '오답',
            ].includes(type) || isWeeklyIncorrect;
          if (
            isTestType &&
            !['미응시', '진행중', '대기'].includes(ex.status)
          ) {
            hasAnyExamClearedToday = true;
          }

          const cleanedTitle = cleanTitle(rawTitle, sName);
          const item = {
            id: ex.assignment_id,
            title: cleanedTitle,
            remain,
            status: ex.status,
            score: ex.total_score,
            type: 'exam',
            exType: type,
          };

          if (type === '오답유사' || type === '과제오답유사' || isWeeklyIncorrect) {
            if (!isFinalDone && (!tq || remain > 0)) similarExams.push(item);
          } else if (type === '오답프린트' || type === '오답') {
          } else if (type === '과제' || type === '과제프린트') {
            if (!isFinalDone && remain > 0) hwExams.push(item);
          } else if (type === '미완료과제') {
            if (!isFinalDone && remain > 0) overdueExams.push(item);
          } else {
            if (!isFinalDone) regularExams.push(item);
          }
        });

        const normalHws: any[] = [];
        const overdueNormalHws: any[] = [];

        hwsData?.forEach((hw: any) => {
          if (hw.class_id && cid && hw.class_id !== cid) return;
          if (hw.target_student_id && hw.target_student_id !== studentId)
            return;

          const resObj = hwResMap.get(hw.homework_id);
          const status = resObj?.status || '미제출';
          if (['제출완료', '채점완료', '완료'].includes(status)) return;

          let tqLen = 0;
          try {
            tqLen =
              typeof hw.target_questions === 'string'
                ? JSON.parse(hw.target_questions).length
                : hw.target_questions?.length || 0;
          } catch (e) {}

          const resolved = hwResolvedMap.get(hw.homework_id)?.size || 0;
          const remain = Math.max(0, tqLen - resolved);
          if (remain === 0) return;

          const cleanedTitle = cleanTitle(hw.homework_title, sName);
          const item = {
            id: hw.homework_id,
            title: cleanedTitle,
            remain,
            status,
            score: null,
            type: 'hw',
          };

          if (hw.due_date && hw.due_date < today) {
            overdueNormalHws.push(item);
          } else {
            normalHws.push(item);
          }
        });

        const hasSimilar = similarExams.length > 0;
        const hasRegular = regularExams.length > 0;

        let finalExamList: any[] = [];
        let activeExamMode = 'DONE';

        if (hasRegular) {
          activeExamMode = 'TEST';
          finalExamList = regularExams;
        } else if (hasSimilar) {
          activeExamMode = 'SIMILAR';
          finalExamList = similarExams;
        }

        const finalHwList = [...hwExams, ...normalHws];
        const finalOverdueList = [...overdueExams, ...overdueNormalHws];

        const eCount = finalExamList.reduce((acc, it) => acc + it.remain, 0);
        const hCount = finalHwList.reduce((acc, it) => acc + it.remain, 0);
        const oCount = finalOverdueList.reduce((acc, it) => acc + it.remain, 0);

        const firstExam = finalExamList[0] || {};

        newBlockStates[c].exam =
          finalExamList.length > 0 ? '미응시' : '최종완료';
        newBlockStates[c].hw = finalHwList.length > 0 ? '미응시' : '최종완료';
        newBlockStates[c].print =
          totalPrintQCount > 0 ? '미응시' : '최종완료';
        newBlockStates[c].overdue =
          finalOverdueList.length > 0 ? '미응시' : '최종완료';

        if (finalExamList.length === 0 && roundResults[`${c}::1`]) newBlockStates[c].exam = '최종완료';
        if (finalHwList.length === 0 && roundResults[`${c}::2`]) newBlockStates[c].hw = '최종완료';
        if (totalPrintQCount === 0 && roundResults[`${c}::3`]) newBlockStates[c].print = '최종완료';

        newHwProgress[c] = {
          activeExamMode,
          hasAnyExamClearedToday,
          examList: finalExamList,
          hwList: finalHwList,
          overdueList: finalOverdueList,
          printTitles: totalPrintQCount > 0 ? ['[통합] 누적 오답 클리닉'] : [],

          examQCount: eCount,
          hwQCount: hCount,
          printQCount: totalPrintQCount,
          overdueQCount: oCount,
          examPendingCount: finalExamList.length,
          hwPendingCount: finalHwList.length,
          printPendingCount: totalPrintQCount > 0 ? 1 : 0,
          overduePendingCount: finalOverdueList.length,
          examStatus: firstExam.status || '대기',
          examInitialScore: firstExam.score ?? null,
          examType:
            activeExamMode === 'SIMILAR'
              ? firstExam.exType || '오답유사'
              : firstExam.exType || '',
        };
      });

      const primaryProg = newHwProgress[selectedClass] || {};

      return {
        classes,
        selectedClass,
        blockStates: newBlockStates,
        hwProgress: newHwProgress,
        points: pointsBalance || 0,
        clinicSession: sessionRow || null,
        examCount: primaryProg.examQCount || 0,
        hwCount: primaryProg.hwQCount || 0,
        overdueCount: primaryProg.overdueQCount || 0,
        printCount: totalPrintQCount,
      };
    } catch (e) {
      console.error(e);
      const fallbackClass = classNameParam || '반 미배정';
      return {
        classes: [fallbackClass],
        selectedClass: fallbackClass,
        blockStates: {
          [fallbackClass]: {
            exam: '최종완료',
            hw: '최종완료',
            print: '최종완료',
            overdue: '최종완료',
          },
        },
        hwProgress: {
          [fallbackClass]: {
            activeExamMode: 'DONE',
            hasAnyExamClearedToday: false,
            examList: [],
            hwList: [],
            overdueList: [],
            printTitles: [],
            examQCount: 0,
            hwQCount: 0,
            printQCount: 0,
            overdueQCount: 0,
            examPendingCount: 0,
            hwPendingCount: 0,
            printPendingCount: 0,
            overduePendingCount: 0,
            examStatus: '대기',
            examInitialScore: null,
            examType: '',
          },
        },
        points: 0,
        clinicSession: null,
        examCount: 0,
        hwCount: 0,
        overdueCount: 0,
        printCount: 0,
      };
    }
  };

  return {
    isAuthorized, isLoading, setIsLoading,
    groupedClasses, allStudentsList, currentStats,
    globalList, setGlobalList, timelineData, setTimelineData,
    classCalendarEvents,
    fetchBaseData, fetchStatsForTab, fetchStudentTimeline, fetchGlobalListForTab, fetchStudentClinicPreview
  };
}