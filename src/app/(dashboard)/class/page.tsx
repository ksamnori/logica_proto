// src/app/(dashboard)/class/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import ClassEditModal from "@/components/class/ClassEditModal";

export default function ClassPage() {
  // === 데이터 상태 ===
  const [classes, setClasses] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });

  // === 필터 상태 ===
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterInstructor, setFilterInstructor] = useState("all");

  // === 모달 상태 ===
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);

  useEffect(() => {
    // 권한 세팅
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const name = localStorage.getItem("logica_instructor_name") || "관리자";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("최고관리자") || pos.includes("대장") || pos.includes("원장") || pos.includes("실장");
    setCurrentUser({ instId, name, isAdmin });

    fetchInstructors();
    fetchClasses();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "logica_refresh_signal") fetchClasses();
    };
    window.addEventListener("storage", handleStorageChange);
    (window as any).refreshClasses = fetchClasses;

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      delete (window as any).refreshClasses;
    };
  }, []);

  const fetchInstructors = async () => {
    const { data } = await supabase.from("instructor").select("instructor_id, name").eq("status", "재직");
    setInstructors(data || []);
  };

  const fetchClasses = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from("class").select("*, instructor(name), enrollment(student_id), class_schedule(*)");
    if (!error && data) setClasses(data);
    setIsLoading(false);
  };

  // 💡 [핵심 성능 개선] useEffect 제거 및 useMemo 도입으로 리렌더링 버그 차단
  const filteredClasses = useMemo(() => {
    let result = classes.filter((c) => {
      let matchLevel = false;
      const cName = (c.name || "").trim().toUpperCase();
      const prefix2 = cName.substring(0, 2);

      if (filterLevel === "all") matchLevel = true;
      else if (filterLevel === "특강") matchLevel = prefix2 === "SS" || prefix2 === "WS" || c.level_name === "특강";
      else if (filterLevel === "메이크업") matchLevel = prefix2 === "MU" || prefix2 === "LE" || c.level_name === "메이크업";
      else matchLevel = c.level_name === filterLevel;

      let matchGrade = filterGrade === "all" || (c.target_grade && c.target_grade.includes(filterGrade));
      if (filterGrade === "특강, 보강") matchGrade = c.target_grade && (c.target_grade.includes("특강") || c.target_grade.includes("보강"));

      let matchInst = filterInstructor === "all" || c.instructor_id?.toString() === filterInstructor;

      return matchLevel && matchGrade && matchInst;
    });

    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [classes, filterLevel, filterGrade, filterInstructor]);

  const resetFilters = () => {
    setFilterLevel("all"); setFilterGrade("all"); setFilterInstructor("all");
  };

  const openEditModal = (classItem: any) => {
    setSelectedClass(classItem);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setSelectedClass(null);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 overflow-hidden relative">
      <div className="flex justify-between items-end shrink-0 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">학원 반 통합 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학원의 정규반과 특강 및 메이크업반을 개설하고 수강생을 관리합니다.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap mb-4">
        <span className="font-bold text-slate-600 text-sm mr-2">🔍 반 정렬/필터</span>
        
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 레벨</option>
          <option value="Ultimate">Ultimate</option>
          <option value="Master">Master</option>
          <option value="Apex">Apex</option>
          <option value="Titan">Titan</option>
          <option value="Horizon">Horizon</option>
          <option value="특강">특강 (SS, WS)</option>
          <option value="메이크업">메이크업 (MU, LE)</option>
        </select>
        
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 학년</option>
          <option value="초1">초1</option><option value="초2">초2</option><option value="초3">초3</option>
          <option value="초4">초4</option><option value="초5">초5</option><option value="초6">초6</option>
          <option value="중1">중1</option><option value="중2">중2</option><option value="중3">중3</option>
          <option value="특강, 보강">특강, 보강</option>
        </select>
        
        <select value={filterInstructor} onChange={e => setFilterInstructor(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 담당 강사</option>
          {instructors.map(inst => <option key={inst.instructor_id} value={inst.instructor_id}>{inst.name} 선생님</option>)}
        </select>
        
        <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
          🔄 전체보기
        </button>

        <div className="ml-auto flex gap-2 shrink-0">
          <button onClick={() => window.open('/launch-special', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-indigo-600 text-white w-40 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-indigo-700 transition-colors text-center">
            특강/메이크업 개설
          </button>
          <button onClick={() => window.open('/launch-class', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-[#002864] text-white w-40 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors text-center">
            정규반 개설
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-y-auto flex-1 custom-scroll">
          <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">반 코드</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">반 이름 (레벨) 🔍</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">배정 인원</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">대상 학년</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 min-w-[140px]">수업 요일 및 시간</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">담당 강사</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">상태</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr><td colSpan={8} className="py-20 text-center font-bold text-slate-400">데이터를 불러오는 중입니다...</td></tr>
              ) : filteredClasses.length === 0 ? (
                <tr><td colSpan={8} className="py-20 text-center font-bold text-slate-400">조건에 맞는 반이 없습니다.</td></tr>
              ) : (
                filteredClasses.map(c => {
                  const studentCount = new Set((c.enrollment || []).map((e: any) => e.student_id)).size;
                  let statusHtml = c.status === '진행중' ? <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">진행중</span> : <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">{c.status || '-'}</span>;
                  
                  return (
                    <tr key={c.class_id} className="hover:bg-blue-50/50 transition-colors">
                      <td className="py-3 px-4 border-b border-slate-100 font-mono text-slate-400 text-xs">{c.code}</td>
                      <td className="py-3 px-4 border-b border-slate-100 font-extrabold text-[#002864] cursor-pointer hover:text-blue-500 hover:underline" onClick={() => openEditModal(c)}>
                        {c.name} <span className="text-xs font-medium text-slate-400 ml-1">({c.level_name})</span>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 text-center font-bold text-slate-600">{studentCount}명</td>
                      <td className="py-3 px-4 border-b border-slate-100 font-bold">{c.target_grade || '-'}</td>
                      <td className="py-3 px-4 border-b border-slate-100">
                        {c.class_schedule?.length > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            {c.class_schedule.map((sc: any, idx: number) => {
                              const sTime = sc.start_time?.substring(0, 5) || "";
                              const eTime = sc.end_time?.substring(0, 5) || "";
                              const colorClass = sc.day_of_week === '토' ? 'text-blue-600' : (sc.day_of_week === '일' ? 'text-red-500' : 'text-slate-700');
                              return (
                                <div key={idx} className="flex items-center gap-2 text-[13px]">
                                  <span className={`font-extrabold ${colorClass} bg-slate-100 px-1.5 py-0.5 rounded shadow-sm border border-slate-200 w-6 text-center`}>{sc.day_of_week}</span>
                                  <span className="text-slate-600 font-semibold">{eTime ? `${sTime} ~ ${eTime}` : sTime}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 font-bold">{c.instructor?.name ? `${c.instructor.name} 선생님` : '미정'}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-center">{statusHtml}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEditModal(c)} className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-xs rounded shadow-sm transition-colors">상세 보기</button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClassEditModal 
        isOpen={isEditModalOpen} 
        classItem={selectedClass} 
        instructors={instructors} 
        currentUser={currentUser}
        onClose={closeEditModal} 
        onSuccess={fetchClasses} 
      />
    </div>
  );
}