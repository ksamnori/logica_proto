// src/app/(dashboard)/homework/page.tsx
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

export default function HomeworkPage() {
  const router = useRouter();

  // === 데이터 상태 ===
  const [groupedClasses, setGroupedClasses] = useState<Record<string, ClassInfo[]>>({});
  const [allStudentsList, setAllStudentsList] = useState<StudentInfo[]>([]);
  const [hwStats, setHwStats] = useState<any[]>([]); 
  const [studentHws, setStudentHws] = useState<any[]>([]); 
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

  // 💡 2. 데이터 Fetch 로직 통합 (내 학생들을 먼저 찾고, 그 학생들의 과제만 안전하게 가져옴)
  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      // ⚠️ 보안 Note: localStorage로 어드민을 판별하는 건 UI 트릭입니다. 
      // 실제 데이터 접근은 Supabase RLS 정책으로 보호되어야 합니다.
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

      // 💡 [최적화 & 보안] 전체 DB가 아닌 '내 학생들'의 과제 기록만 200명씩 끊어서 안전하게 가져옴
      const studentIds = allStudents.map(s => s.id);
      let fetchedStats: any[] = [];
      const chunkSize = 200;

      for (let i = 0; i < studentIds.length; i += chunkSize) {
        const chunk = studentIds.slice(i, i + chunkSize);
        const { data: stats } = await supabase.from('student_homework_result')
          .select('student_id, status, homework_assignment(homework_title)')
          .in('student_id', chunk);

        if (stats) {
          const valid = stats.filter((h: any) => h.homework_assignment && h.homework_assignment.homework_title !== '[시스템] 수업 진도 완료 기록');
          fetchedStats = [...fetchedStats, ...valid];
        }
      }
      
      setHwStats(fetchedStats);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const fetchSpecificStudentHomework = async (studentId: string) => {
    setIsLoading(true);
    setStudentHws([]); // 💡 다른 학생 클릭 시 이전 학생의 과제 잔상이 보이지 않도록 초기화
    try {
      const { data } = await supabase.from('homework_assignment')
        .select('*, textbook(title), student_homework_result!inner(*)')
        .eq('student_homework_result.student_id', studentId)
        .neq('homework_title', '[시스템] 수업 진도 완료 기록')
        .order('due_date', { ascending: false });
      setStudentHws(data || []);
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

  const handleLevelClick = (lvl: string) => {
    setExpandedLevels(prev => prev.includes(lvl) ? prev.filter(l => l !== lvl) : [...prev, lvl]);
  };

  const handleClassClick = (classId: string, className: string) => {
    setExpandedClasses(prev => prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]);
    setCurrentView({ type: 'CLASS', classId, className, studentId: '', studentName: '' });
  };

  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    setCurrentView({ type: 'STUDENT', classId, className, studentId, studentName });
    fetchSpecificStudentHomework(studentId);
  };

  const handleEditHomeworkTitle = async (hwId: string, oldTitle: string) => {
    const newTitle = window.prompt("수정할 과제 제목을 입력하세요:", oldTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
      await supabase.from('homework_assignment').update({ homework_title: newTitle.trim() }).eq('homework_id', hwId);
      alert("과제 이름이 성공적으로 수정되었습니다.");
      fetchSpecificStudentHomework(currentView.studentId);
    } catch (e) { alert("수정 실패"); }
  };

  const handleDeleteHomework = async (hwId: string, studentId: string) => {
    if (!confirm("해당 학생의 과제만 삭제하시겠습니까?\n(선택한 학생의 기록만 삭제되며, 같은 반 다른 학생들의 과제는 유지됩니다.)")) return;
    try {
      await supabase.from('student_homework_result').delete().eq('homework_id', hwId).eq('student_id', studentId);
      const { count } = await supabase.from('student_homework_result').select('*', { count: 'exact', head: true }).eq('homework_id', hwId);
      if (count === 0) await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
      
      alert("해당 학생의 과제가 안전하게 삭제되었습니다.");
      fetchSpecificStudentHomework(studentId);
      fetchAllData(); // 통계 재계산
    } catch (e) { alert("삭제 실패"); }
  };

  // 💡 3. [핵심 최적화] O(N²) 루프 제거 -> 해시맵(Map) 자료구조를 통한 O(1) 캐싱
  const studentStatsMap = useMemo(() => {
    const map: Record<string, { pending: number; done: number }> = {};
    hwStats.forEach(h => {
      if (!map[h.student_id]) map[h.student_id] = { pending: 0, done: 0 };
      if (h.status === '미제출' || h.status === '진행중') map[h.student_id].pending++;
      if (h.status === '제출완료' || h.status === '채점완료') map[h.student_id].done++;
    });
    return map;
  }, [hwStats]);

  const renderStudentCard = (s: StudentInfo, cName: string, showClassNameBadge = false) => {
    // 미리 계산해둔 Map에서 값을 바로 꺼냅니다. (초고속 연산)
    const { pending = 0, done = 0 } = studentStatsMap[s.id] || { pending: 0, done: 0 };

    if (isFilterActive && pending === 0) return null;

    return (
      <div key={s.id} onClick={() => handleStudentClick(s.id, s.name, '', cName)} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-[#002864] hover:shadow-md cursor-pointer transition-all hover:-translate-y-1 group relative">
        {showClassNameBadge && (
          <div className="absolute top-0 right-0 bg-slate-100 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded-bl-lg rounded-tr-xl border-b border-l border-slate-200">
            {cName}
          </div>
        )}
        <div className={`flex justify-between items-center mb-3 ${showClassNameBadge ? 'mt-1.5' : ''}`}>
          <div className="font-extrabold text-base text-slate-800 group-hover:text-[#002864] transition-colors">{s.name}</div>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded transition-colors group-hover:bg-[#002864] group-hover:text-white shadow-sm">상세 ➔</span>
        </div>
        <div className="space-y-1.5 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">진행/미제출</span><span className="font-black text-rose-500">{pending}건</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">제출/완료</span><span className="font-black text-emerald-500">{done}건</span></div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">전체 반 통합 과제 현황</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학생들의 과제 제출 상태와 채점 현황을 반별/개인별로 확인하고 관리합니다.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        
        {/* 1. 좌측 사이드바 아코디언 메뉴 */}
        <div className="w-[260px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 z-10 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
            <h3 className="text-[13px] font-extrabold text-slate-700 flex items-center gap-1.5 cursor-pointer hover:underline" onClick={() => {setCurrentView({type: 'ALL', classId: '', className: '', studentId: '', studentName: ''})}}>
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
                              <button onClick={() => handleClassClick(c.class_id, c.name)} className="w-full flex justify-between items-center pl-6 pr-4 py-2.5 hover:bg-blue-50/50 transition-colors">
                                <span className="font-bold text-[#002864] text-[12px] text-left">{c.name}</span>
                                <svg className={`w-3 h-3 text-blue-300 transition-transform ${isClassExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                              </button>
                              {isClassExpanded && (
                                <div className="flex flex-col bg-white">
                                  {c.students.length === 0 ? (
                                    <div className="py-3 text-center text-xs text-slate-400 font-bold bg-slate-50/50">등록된 학생이 없습니다.</div>
                                  ) : (
                                    c.students.map(s => (
                                      <button key={s.id} onClick={() => handleStudentClick(s.id, s.name, c.class_id, c.name)} className={`w-full text-left pl-10 pr-4 py-2 text-[12px] font-bold text-slate-500 hover:bg-slate-50 hover:text-blue-700 transition-colors border-l-4 ${currentView.studentId === s.id ? 'bg-[#eff6ff] border-[#002864] text-[#002864]' : 'border-transparent'}`}>
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
                <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-xs font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  🚨 진행/미제출 학생만 보기
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                {LEVEL_ORDER.map(lvl => {
                  const classList = groupedClasses[lvl];
                  if (!classList || classList.length === 0) return null;
                  
                  // O(1) Map 참조로 속도 개선
                  const visibleClasses = classList.filter(c => c.students.some(s => !isFilterActive || (studentStatsMap[s.id]?.pending || 0) > 0));
                  if (visibleClasses.length === 0) return null;

                  return visibleClasses.map(c => (
                    <div key={c.class_id} className="mb-10">
                      <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                        <span className="bg-blue-100 text-[#002864] text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">{lvl}</span>
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
                  <h2 className="text-lg font-extrabold text-slate-800"><span className="text-[#002864]">{currentView.className}</span> 반 과제 요약</h2>
                </div>
                <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-xs font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  🚨 진행/미제출 학생만 보기
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
                  <span className="bg-blue-100 text-[#002864] text-xs font-bold px-2 py-0.5 rounded border border-blue-200">{currentView.className}</span>
                  <span className="text-[#002864]">{currentView.studentName}</span> 학생 과제 현황
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
                <div className="flex items-center gap-2 mb-4"><h3 className="text-lg font-extrabold text-slate-800">📖 배부된 과제목록</h3></div>
                {isLoading ? (
                  <div className="text-center font-bold text-slate-400 py-10">과제를 불러오는 중입니다...</div>
                ) : studentHws.length === 0 ? (
                  <div className="text-center font-bold text-slate-400 py-10">배부된 과제가 없습니다.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                    {studentHws.map(hw => {
                      const res = hw.student_homework_result[0] || {};
                      return (
                        <div key={hw.homework_id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 flex flex-col justify-between h-full">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex-1 pr-3">
                              <span className="text-[11px] font-bold text-slate-400 block mb-1">{hw.textbook?.title || '교재 정보 없음'}</span>
                              <h4 className="font-extrabold text-slate-700 text-[15px] leading-snug break-keep">{hw.homework_title}</h4>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${res.status === '미제출' ? 'bg-rose-100 text-rose-700' : res.status === '진행중' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {res.status || '상태 없음'}
                            </span>
                          </div>
                          <div className="mt-4 flex justify-between items-center border-t border-slate-100 pt-3">
                            <div className="flex gap-3">
                              <button onClick={() => handleEditHomeworkTitle(hw.homework_id, hw.homework_title)} className="text-[11px] font-bold text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1">✏️ 수정</button>
                              <button onClick={() => handleDeleteHomework(hw.homework_id, currentView.studentId)} className="text-[11px] font-bold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">🗑️ 삭제</button>
                            </div>
                            <button onClick={() => router.push(`/homework/review?id=${hw.homework_id}`)} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm">
                              상세/채점 ➔
                            </button>
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