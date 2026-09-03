// src/app/(dashboard)/student/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation"; 
import { supabase } from "@/lib/supabase";

export default function StudentPage() {
  const router = useRouter(); 

  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false); 

  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState("all");
  const [grade, setGrade] = useState("all");
  const [status, setStatus] = useState("all"); 
  const [instructorId, setInstructorId] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const limit = 20;

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role");
    const position = localStorage.getItem("logica_instructor_position") || "";
    const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER' || 
                    position.includes('원장') || position.includes('실장') || position.includes('최고관리자');
    setIsSuperAdmin(isSuper);

    fetchData(isSuper);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "logica_refresh_signal") fetchData(isSuper);
    };
    window.addEventListener("storage", handleStorageChange);
    
    (window as any).refreshStudents = () => { fetchData(isSuper); };

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      delete (window as any).refreshStudents;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [keyword, level, grade, status, instructorId]);

  const fetchData = async (isSuper: boolean) => {
    setIsLoading(true);
    try {
      const myId = localStorage.getItem("logica_instructor_id");
      const tenantId = localStorage.getItem("logica_tenant_id");

      let instQuery = supabase.from("instructor").select("instructor_id, name").eq("status", "재직");
      if (tenantId) {
        instQuery = instQuery.eq("tenant_id", tenantId);
      }
      const { data: instData } = await instQuery;
      if (instData) setInstructors(instData);

      let stuQuery = supabase
        .from("student")
        .select("*, parent(phone), enrollment(class(name, level_name, instructor_id, status, instructor(name)))")
        .order("created_at", { ascending: false })
        .limit(1000);
      
      if (tenantId) {
        stuQuery = stuQuery.eq("tenant_id", tenantId);
      }

      const { data: allStuData } = await stuQuery;
      
      if (allStuData) {
        if (isSuper) {
          setStudents(allStuData);
        } else {
          const myStudents = allStuData.filter((student: any) => 
            student.enrollment?.some((e: any) => e.class?.instructor_id === myId)
          );
          setStudents(myStudents);
        }
      }

    } catch (error) {
      console.error("데이터 로딩 실패:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const activeEnrollments = s.enrollment ? s.enrollment.filter((e: any) => e.class && e.class.status !== '예정') : [];
      const classes = activeEnrollments.map((e: any) => e.class);
      
      const matchLevel = level === "all" || classes.some((c: any) => c.level_name === level);
      const matchGrade = grade === "all" || s.grade?.toString() === grade;
      const matchStatus = status === "all" || s.status === status;
      const matchInst = instructorId === "all" || classes.some((c: any) => c.instructor_id?.toString() === instructorId);
      
      const phone = s.phone || "";
      const matchKeyword = keyword === "" || s.name.includes(keyword) || phone.includes(keyword);

      return matchLevel && matchGrade && matchStatus && matchInst && matchKeyword;
    });
  }, [students, keyword, level, grade, status, instructorId]);

  const resetFilters = () => {
    setKeyword("");
    setLevel("all");
    setGrade("all");
    setStatus("all"); 
    setInstructorId("all");
  };

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / limit));
  const currentData = filteredStudents.slice((currentPage - 1) * limit, currentPage * limit);

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 overflow-hidden">
      <div className="flex justify-between items-end shrink-0 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            {isSuperAdmin ? "전체 학생 리스트" : "내 수강생 리스트"}
          </h2>
          <p className="text-sm font-bold text-slate-400 mt-1">
            {isSuperAdmin 
              ? <>학원에 등록된 모든 학생(총 <span className="text-[#002864] font-extrabold">{filteredStudents.length}</span>명)의 정보를 조회하고 관리합니다.</>
              : <>선생님께서 담당하시는 반의 학생(총 <span className="text-[#002864] font-extrabold">{filteredStudents.length}</span>명) 목록입니다.</>
            }
          </p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap mb-4">
        <span className="font-bold text-slate-600 text-sm mr-2">🔍 학생 필터</span>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="이름/연락처 검색"
          className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864] w-40"
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 레벨</option>
          <option value="Ultimate">Ultimate</option>
          <option value="Master">Master</option>
          <option value="Apex">Apex</option>
          <option value="Titan">Titan</option>
          <option value="Horizon">Horizon</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 상태</option>
          <option value="재원">재원</option>
          <option value="퇴원">퇴원</option>
          <option value="휴원">휴원</option>
          <option value="입학테스트">입학테스트</option>
        </select>
        {isSuperAdmin && (
          <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="all">모든 담당 강사</option>
            {instructors.map((inst) => (
              <option key={inst.instructor_id} value={inst.instructor_id.toString()}>
                {inst.name} 선생님
              </option>
            ))}
          </select>
        )}
        <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
          🔄 전체보기
        </button>
        {isSuperAdmin && (
          <div className="ml-auto flex gap-2 shrink-0">
            <button onClick={() => window.open("/student/enroll", "_blank", "width=700,height=800,top=100,left=100")} className="bg-[#002864] text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors text-center">
              신규 학생 등록
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-x-auto overflow-y-auto flex-1 custom-scroll">
          <table className="w-full min-w-[1000px] text-left border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="py-3 pl-10 pr-4 border-b border-slate-200 font-extrabold text-slate-500">이름 🔍</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 max-w-[165px]">수강 중인 반 목록</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학교</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학년</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">성별</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학생 연락처</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학부모 연락처</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">상태</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">담당 강사</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr><td colSpan={9} className="py-20 text-center text-slate-400 font-bold">데이터를 불러오는 중입니다...</td></tr>
              ) : currentData.length === 0 ? (
                <tr><td colSpan={9} className="py-20 text-center text-slate-400 font-bold">조건에 맞는 학생이 없습니다.</td></tr>
              ) : (
                currentData.map((s) => {
                  let statusClass = "bg-slate-100 text-slate-600";
                  if (s.status === "재원") statusClass = "bg-emerald-100 text-emerald-700";
                  if (s.status === "퇴원") statusClass = "bg-rose-100 text-rose-700";
                  if (s.status === "휴원") statusClass = "bg-amber-100 text-amber-700";
                  if (s.status === "입학테스트") statusClass = "bg-indigo-100 text-indigo-700";

                  const activeEnrollments = s.enrollment ? s.enrollment.filter((e: any) => e.class && e.class.status !== '예정') : [];
                  const classNames: string[] = activeEnrollments.map((e: any) => e.class.name);
                  const instNames: string[] = Array.from(new Set(activeEnrollments.map((e: any) => e.class.instructor?.name).filter(Boolean)));

                  return (
                    <tr key={s.student_id} className="hover:bg-blue-50/50 transition-colors">
                      <td 
                        className="py-3 pl-10 pr-4 border-b border-slate-100 font-extrabold text-[#002864] cursor-pointer hover:text-blue-500 hover:underline"
                        onClick={() => router.push(`/student/${s.student_id}`)}
                      >
                        {s.name}
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 font-bold">
                        {classNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[165px] whitespace-normal">
                            {classNames.map((cName, idx) => (
                              <span key={idx} className="bg-blue-50 text-[#002864] border border-blue-200 px-1.5 py-0.5 rounded text-xs whitespace-nowrap">
                                {cName}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">미배정</span>
                        )}
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 text-slate-500 font-bold text-[13px] text-center max-w-[120px] truncate">
                        {s.school_name || s.school || "-"}
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 font-bold text-center">{s.grade || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-slate-500 font-bold text-xs text-center">{s.gender || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-slate-500 text-xs text-center">{s.phone || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-slate-600 font-bold text-xs text-center">{s.parent?.phone || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-center">
                        <span className={`${statusClass} px-2 py-1 rounded text-xs font-bold whitespace-nowrap`}>{s.status || "-"}</span>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 text-center">
                        <div className="flex flex-wrap justify-center gap-1 w-full max-w-[120px] mx-auto">
                          {instNames.length > 0 ? instNames.map((name, idx) => (
                            <span key={idx} className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                              {name} 선생님
                            </span>
                          )) : <span className="text-slate-400 text-xs">-</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 수정된 페이지네이션 영역 */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-center items-center shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} 
              disabled={currentPage === 1}
              className="px-4 py-2 border border-slate-300 rounded text-sm font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              이전
            </button>
            <span className="text-sm font-bold text-slate-600">
              페이지 {currentPage} / {totalPages}
            </span>
            <button 
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} 
              disabled={currentPage === totalPages}
              className="px-4 py-2 border border-slate-300 rounded text-sm font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}