// src/app/(dashboard)/incorrect/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const LEVEL_ORDER = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강', '메이크업/보강', '기타'];

// 💡 1. 명확한 타입(Interface) 정의로 스파게티 코드 방지 및 유지보수성 향상
interface StudentInfo {
  id: string;
  name: string;
  className: string;
}

interface ClassInfo {
  class_id: string;
  name: string;
  level_name: string;
  students: StudentInfo[];
}

interface ViewState {
  type: 'ALL' | 'CLASS' | 'STUDENT';
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
}

export default function IncorrectPage() {
  const router = useRouter();

  // === 데이터 상태 ===
  const [groupedClasses, setGroupedClasses] = useState<Record<string, ClassInfo[]>>({});
  const [allStudentsList, setAllStudentsList] = useState<StudentInfo[]>([]);
  const [incorrectStats, setIncorrectStats] = useState<any[]>([]); 
  const [studentPrints, setStudentPrints] = useState<any[]>([]); 
  const [studentRecords, setStudentRecords] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);

  // === UI 상태 ===
  const [currentView, setCurrentView] = useState<ViewState>({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' });
  const [isFilterActive, setIsFilterActive] = useState(false);
  
  // === 아코디언 상태 ===
  const [expandedLevels, setExpandedLevels] = useState<string[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  useEffect(() => {
    fetchAllData();
  }, []);

  // 💡 2. 데이터 Fetch 로직 통합 (내 학생들을 먼저 찾고, 그 학생들의 오답 기록만 안전하게 가져옴)
  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      const isAdmin = ['ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role.toUpperCase()) || pos.includes('원장') || pos.includes('실장');

      let classQuery = supabase.from('class').select('class_id, name, level_name').order('name');
      if (!isAdmin) classQuery = classQuery.eq('instructor_id', instId);

      const { data: classes } = await classQuery;
      if (!classes || classes.length === 0) {
        setIsLoading(false);
        return;
      }

      const classIds = classes.map(c => c.class_id);
      const studentsByClass: Record<string, StudentInfo[]> = {};
      const allStudents: StudentInfo[] = [];

      const { data: enrollments } = await supabase.from('enrollment')
        .select('class_id, student_id, student(name, status)')
        .in('class_id', classIds);

      enrollments?.forEach((e: any) => {
        if (e.student) {
          if (!studentsByClass[e.class_id]) studentsByClass[e.class_id] = [];
          const studentName = Array.isArray(e.student) ? e.student[0]?.name : e.student.name;
          const studentObj = { 
            id: e.student_id, 
            name: studentName, 
            className: classes.find(c => c.class_id === e.class_id)?.name || '' 
          };
          studentsByClass[e.class_id].push(studentObj);
          allStudents.push(studentObj);
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
      setAllStudentsList(allStudents);

      // 💡 [최적화 & 보안] 전체 DB가 아닌 '내 학생들'의 오답 기록만 200명씩 끊어서 안전하게 가져옴
      const studentIds = allStudents.map(s => s.id);
      let fetchedStats: any[] = [];
      const chunkSize = 200;

      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);
        const { data: stats } = await supabase.from('student_incorrect_record')
          .select('student_id, resolved_at')
          .in('student_id', chunk);

        if (stats) fetchedStats = [...fetchedStats, ...stats];
      }
      
      setIncorrectStats(fetchedStats);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const fetchSpecificStudentIncorrectData = async (studentId: string) => {
    setIsLoading(true);
    // 💡 다른 학생 클릭 시 이전 학생의 잔상이 보이지 않도록 초기화
    setStudentPrints([]); 
    setStudentRecords([]);
    
    try {
      const { data: prints } = await supabase.from('exam_assignment')
        .select('assignment_id, status, created_at, exam_master!inner(exam_id, title)')
        .eq('student_id', studentId)
        .eq('exam_master.exam_type', '오답프린트')
        .order('created_at', { ascending: false });
      setStudentPrints(prints || []);

      const { data: records } = await supabase.from('student_incorrect_record')
        .select(`record_id, source_type, status, retry_count, created_at, resolved_at, tq_id, question_id, question_db(question, source_book_name)`)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });

      let enrichedRecords = records || [];

      if (enrichedRecords.length > 0) {
        const tqIds = enrichedRecords.filter(r => r.tq_id).map(r => r.tq_id);
        if (tqIds.length > 0) {
          const { data: tqData } = await supabase.from('textbook_question').select('tq_id, question_number, textbook(title)').in('tq_id', tqIds);
          if (tqData) {
            const tqMap: any = {};
            tqData.forEach(t => tqMap[t.tq_id] = t);
            enrichedRecords = enrichedRecords.map(r => ({ ...r, tq_info: tqMap[r.tq_id] }));
          }
        }
      }
      setStudentRecords(enrichedRecords);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

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
    setCurrentView({ type: 'CLASS', classId, className, studentId: '', studentName: '' });
  };
  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    setCurrentView({ type: 'STUDENT', classId, className, studentId, studentName });
    fetchSpecificStudentIncorrectData(studentId);
  };

  const handleDeletePrint = async (assignmentId: string, examId: string) => {
    if (!confirm("해당 오답 프린트를 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_item').delete().eq('exam_id', examId);
      await supabase.from('exam_master').delete().eq('exam_id', examId);
      alert("오답 프린트가 삭제되었습니다.");
      fetchSpecificStudentIncorrectData(currentView.studentId);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm("해당 오답 기록을 정말 삭제하시겠습니까?\n(클리닉/보충학습에 배정된 내역도 함께 삭제됩니다.)")) return;
    try {
      await supabase.from('clinic_task').delete().eq('incorrect_record_id', recordId);
      await supabase.from('student_incorrect_record').delete().eq('record_id', recordId);
      alert("오답 기록 및 관련 클리닉 내역이 삭제되었습니다.");
      fetchSpecificStudentIncorrectData(currentView.studentId);
      fetchAllData(); // 삭제 후 전체 통계 리프레시
    } catch (e) { alert("삭제 실패"); }
  };

  // 💡 3. [핵심 최적화] O(N²) 루프 제거 -> 해시맵(Map) 자료구조를 통한 O(1) 캐싱
  const studentStatsMap = useMemo(() => {
    const map: Record<string, { pending: number; done: number }> = {};
    incorrectStats.forEach(e => {
      if (!map[e.student_id]) map[e.student_id] = { pending: 0, done: 0 };
      if (e.resolved_at === null) map[e.student_id].pending++;
      else map[e.student_id].done++;
    });
    return map;
  }, [incorrectStats]);

  const renderStudentCard = (s: StudentInfo, cName: string, showClassNameBadge = false) => {
    // 미리 계산해둔 Map에서 값을 쏙 빼오기만 합니다. (초고속 연산)
    const { pending = 0, done = 0 } = studentStatsMap[s.id] || { pending: 0, done: 0 };

    if (isFilterActive && pending === 0) return null;

    return (
      <div key={s.id} onClick={() => handleStudentClick(s.id, s.name, '', cName)} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-orange-500 hover:shadow-md cursor-pointer transition-all hover:-translate-y-1 group relative">
        {showClassNameBadge && (
          <div className="absolute top-0 right-0 bg-slate-100 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded-bl-lg rounded-tr-xl border-b border-l border-slate-200">
            {cName}
          </div>
        )}
        <div className={`flex justify-between items-center mb-3 ${showClassNameBadge ? 'mt-1.5' : ''}`}>
          <div className="font-extrabold text-base text-slate-800 group-hover:text-orange-600 transition-colors">{s.name}</div>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded transition-colors group-hover:bg-orange-500 group-hover:text-white shadow-sm">상세 ➔</span>
        </div>
        <div className="space-y-1.5 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">해결 필요 (미해결)</span><span className="font-black text-rose-500">{pending}건</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">오답 해결 (완료)</span><span className="font-black text-emerald-500">{done}건</span></div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">전체 반 통합 오답 현황</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학생들의 개별 오답 기록과 자동 생성된 오답 프린트를 확인하고 관리합니다.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        
        {/* 1. 좌측 사이드바 아코디언 메뉴 */}
        <div className="w-[260px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 z-10 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
            <h3 className="text-[13px] font-extrabold text-slate-700 flex items-center gap-1.5 cursor-pointer hover:underline" onClick={() => setCurrentView({type: 'ALL', classId: '', className: '', studentId: '', studentName: ''})}>
              <span>📂 전체 확인 대상</span>
            </h3>
            <button onClick={toggleAllAccordions} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 transition-colors shadow-sm focus:outline-none">
              {isAllExpanded ? "전체 접기" : "전체 펼치기"}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll">
            {isLoading ? <div className="p-10 text-center text-slate-400 font-bold text-sm">목록 로딩 중...</div> : (
              LEVEL_ORDER.map(lvl => {
                const classList = groupedClasses[lvl];
                if (!classList || classList.length === 0) return null;
                const isLvlExpanded = expandedLevels.includes(lvl);
                
                return (
                  <div key={lvl} className="border-b border-slate-200">
                    <button onClick={() => handleLevelClick(lvl)} className="w-full flex justify-between items-center px-4 py-3.5 bg-white hover:bg-slate-50 transition-colors">
                      <span className="font-extrabold text-slate-700 text-xs">{lvl}</span>
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isLvlExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {isLvlExpanded && (
                      <div className="flex flex-col bg-slate-50 border-t border-slate-100">
                        {classList.map(c => {
                          const isClassExpanded = expandedClasses.includes(c.class_id);
                          return (
                            <div key={c.class_id} className="border-b border-slate-200/60 last:border-0">
                              <button onClick={() => handleClassClick(c.class_id, c.name)} className="w-full flex justify-between items-center pl-6 pr-4 py-2.5 hover:bg-orange-50/50 transition-colors">
                                <span className="font-bold text-orange-600 text-[12px] text-left">{c.name}</span>
                                <svg className={`w-3 h-3 text-orange-300 transition-transform ${isClassExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                              </button>
                              {isClassExpanded && (
                                <div className="flex flex-col bg-white">
                                  {c.students.length === 0 ? (
                                    <div className="py-3 text-center text-xs text-slate-400 font-bold bg-slate-50/50">등록된 학생이 없습니다.</div>
                                  ) : (
                                    c.students.map(s => (
                                      <button key={s.id} onClick={() => handleStudentClick(s.id, s.name, c.class_id, c.name)} className={`w-full text-left pl-10 pr-4 py-2 text-[12px] font-bold text-slate-500 hover:bg-slate-50 hover:text-orange-600 transition-colors border-l-4 ${currentView.studentId === s.id ? 'bg-[#fff7ed] border-[#ea580c] text-[#ea580c]' : 'border-transparent'}`}>
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

        {/* 2. 우측 메인 대시보드 영역 */}
        <div className="flex-1 flex flex-col relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          
          {/* === ALL (전체 뷰) === */}
          {currentView.type === 'ALL' && (
            <>
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
                <h2 className="text-lg font-extrabold text-slate-800">전체 요약 대시보드</h2>
                <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-xs font-bold shadow-sm transition-colors ${isFilterActive ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  🚨 미해결 학생만 보기
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                {LEVEL_ORDER.map(lvl => {
                  const classList = groupedClasses[lvl];
                  if (!classList || classList.length === 0) return null;
                  
                  // O(1) Map 참조로 속도 획기적 개선
                  const visibleClasses = classList.filter(c => c.students.some(s => !isFilterActive || (studentStatsMap[s.id]?.pending || 0) > 0));
                  if (visibleClasses.length === 0) return null;

                  return visibleClasses.map(c => (
                    <div key={c.class_id} className="mb-10">
                      <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                        <span className="bg-orange-100 text-orange-600 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">{lvl}</span>
                        <h2 className="text-lg font-extrabold text-slate-800">{c.name}</h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                        {c.students.map(s => renderStudentCard(s, c.name, true))}
                      </div>
                    </div>
                  ));
                })}
              </div>
            </>
          )}

          {/* === CLASS (반 상세 뷰) === */}
          {currentView.type === 'CLASS' && (
            <>
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-800"><span className="text-orange-600">{currentView.className}</span> 반 오답 노트 요약</h2>
                </div>
                <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-xs font-bold shadow-sm transition-colors ${isFilterActive ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  🚨 미해결 학생만 보기
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {Object.values(groupedClasses).flat().find(c => c.class_id === currentView.classId)?.students.map(s => renderStudentCard(s, currentView.className))}
                </div>
              </div>
            </>
          )}

          {/* === STUDENT (학생 개인 상세 뷰) === */}
          {currentView.type === 'STUDENT' && (
            <>
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
                <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                  <span className="bg-orange-100 text-orange-600 text-xs font-bold px-2 py-0.5 rounded border border-orange-200">{currentView.className}</span>
                  <span className="text-orange-600">{currentView.studentName}</span> 학생 오답 노트 현황
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 space-y-8 bg-slate-50/50">
                
                {/* 섹션 1: 자동 생성된 오답 프린트 */}
                <section>
                  <div className="flex items-center gap-2 mb-4"><h3 className="text-lg font-extrabold text-slate-800">🖨️ 자동 생성된 오답 프린트</h3></div>
                  {isLoading ? <div className="text-center font-bold text-slate-400 py-4">불러오는 중...</div>
                  : studentPrints.length === 0 ? <div className="text-sm font-bold text-slate-400 py-4 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50">생성된 오답 프린트가 없습니다.</div>
                  : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {studentPrints.map(p => {
                        const dateStr = p.created_at ? p.created_at.split('T')[0] : '-';
                        const statusBadge = p.status === '미응시' ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
                        return (
                          <div key={p.assignment_id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-orange-300">
                            <div className="flex justify-between items-start mb-3">
                              <div className="min-w-0 pr-4">
                                <span className="text-[11px] font-bold text-slate-400 block mb-1">{dateStr} 자동 생성</span>
                                <h4 className="font-extrabold text-slate-700 text-[15px] truncate" title={p.exam_master?.title}>{p.exam_master?.title || '제목 없음'}</h4>
                              </div>
                              <span className={`${statusBadge} border px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0`}>{p.status}</span>
                            </div>
                            <div className="mt-4 flex justify-end items-center pt-3 border-t border-slate-100">
                              <div className="flex gap-2">
                                <button onClick={() => handleDeletePrint(p.assignment_id, p.exam_master.exam_id)} className="text-[11px] font-bold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">🗑️ 삭제</button>
                                <button onClick={() => router.push(`/exam/review?assignment_id=${p.assignment_id}`)} className="text-[11px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded shadow-sm transition-colors">결과 확인 ➔</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* 섹션 2: 개별 오답 문항 기록 */}
                <section>
                  <div className="flex items-center gap-2 mb-4"><h3 className="text-lg font-extrabold text-slate-800">📊 최근 발생한 개별 오답 문항</h3></div>
                  {isLoading ? <div className="text-center font-bold text-slate-400 py-4">불러오는 중...</div>
                  : studentRecords.length === 0 ? <div className="text-sm font-bold text-slate-400 py-4 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50">발생한 개별 오답 기록이 없습니다. 🎉</div>
                  : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {studentRecords.map(rec => {
                        const dateStr = rec.created_at ? rec.created_at.split('T')[0].replace(/-/g, '.') : '-';
                        const isResolved = rec.resolved_at !== null;
                        const statusBadge = isResolved ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-rose-50 text-rose-500 border border-rose-100";
                        
                        let title = '문제은행 문항';
                        if (rec.source_type === '교재과제' && rec.tq_info) {
                          title = `${rec.tq_info.textbook?.title || '교재'} - ${rec.tq_info.question_number}번`;
                        } else if (rec.question_db?.source_book_name) {
                          title = `${rec.question_db.source_book_name} 출처 문항`;
                        } else if (rec.source_type === '시험지') {
                          title = '시험지 배부 문항';
                        }

                        return (
                          <div key={rec.record_id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-orange-300">
                            <div className="flex justify-between items-start mb-3">
                              <div className="min-w-0 pr-4">
                                <span className="text-[11px] font-bold text-slate-400 block mb-1">{dateStr} 발생 | 출처: {rec.source_type}</span>
                                <h4 className="font-extrabold text-slate-700 text-[15px] truncate" title={title}>{title}</h4>
                              </div>
                              <span className={`${statusBadge} px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0`}>{isResolved ? "해결완료" : "미해결"}</span>
                            </div>
                            <div className="mt-4 flex justify-between items-center pt-3 border-t border-slate-100">
                              <div className="flex gap-3 text-xs font-bold">
                                <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded">최초 오답유형: {rec.status}</span>
                                <span className="flex items-center gap-1"><span className="text-slate-400 font-normal">재시도</span> <span className="text-slate-700 text-sm">{rec.retry_count}회</span></span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleDeleteRecord(rec.record_id)} className="text-[11px] font-bold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">🗑️ 삭제</button>
                                <button onClick={() => alert('오답 상세 확인 및 클리닉 기능은 준비 중입니다.')} className="text-[11px] font-bold text-slate-500 bg-slate-50 hover:bg-slate-200 border border-slate-200 px-3 py-1.5 rounded transition-colors shadow-sm focus:outline-none">상세 보기 ➔</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}