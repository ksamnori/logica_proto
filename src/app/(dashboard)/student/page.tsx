// src/app/(dashboard)/student/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation"; 
import { supabase } from "@/lib/supabase";

export default function StudentPage() {
  const router = useRouter(); 

  // 💡 상태(State) 관리
  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false); // 💡 관리자 여부 상태 추가

  // 💡 필터 상태 관리 (기본값을 '재원'에서 'all'로 변경하여 등록 직후에도 모두 보이게)
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState("all");
  const [grade, setGrade] = useState("all");
  const [status, setStatus] = useState("all"); // 💡 여기를 수정했습니다!
  const [instructorId, setInstructorId] = useState("all");

  // 💡 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 20;

  useEffect(() => {
    // 💡 1. 접속한 사람의 권한 체크 (최고관리자, 원장, 실장인지 확인)
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

  // 💡 [UX 최적화] 검색어나 필터가 바뀌면 무조건 1페이지로 부드럽게 이동
  useEffect(() => {
    setCurrentPage(1);
  }, [keyword, level, grade, status, instructorId]);

  const fetchData = async (isSuper: boolean) => {
    setIsLoading(true);
    try {
      const myId = localStorage.getItem("logica_instructor_id");

      // 1. 강사 목록 불러오기
      const { data: instData } = await supabase
        .from("instructor")
        .select("instructor_id, name")
        .eq("status", "재직");
      if (instData) setInstructors(instData);

      // 2. 전체 학생 목록 불러오기
      const { data: allStuData } = await supabase
        .from("student")
        .select("*, parent(phone), enrollment(class(name, level_name, instructor_id, instructor(name)))")
        .order("created_at", { ascending: false })
        .limit(1000);
      
      if (allStuData) {
        if (isSuper) {
          // 💡 최고관리자/원장/실장은 필터링 없이 모든 학생 열람
          setStudents(allStuData);
        } else {
          // 💡 일반 강사는 본인이 담당하는 반에 속한 학생만 열람
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

  // 💡 [성능 최적화] useEffect에 의한 화면 깜빡임/더블 렌더링 방지 (useMemo 도입)
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const classes = s.enrollment ? s.enrollment.map((e: any) => e.class).filter(Boolean) : [];
      
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
      
      {/* 1. 상단 컨트롤 바 (타이틀 및 설명) */}
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

      {/* 필터 제어 바 및 버튼 통합 */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap mb-4">
        <span className="font-bold text-slate-600 text-sm mr-2">🔍 학생 필터</span>
        
        {/* 검색어 */}
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="이름/연락처 검색"
          className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864] w-40"
        />
        
        {/* 레벨 필터 */}
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 레벨</option>
          <option value="Ultimate">Ultimate</option>
          <option value="Master">Master</option>
          <option value="Apex">Apex</option>
          <option value="Titan">Titan</option>
          <option value="Horizon">Horizon</option>
        </select>

        {/* 상태 필터 */}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 상태</option>
          <option value="재원">재원</option>
          <option value="퇴원">퇴원</option>
          <option value="휴원">휴원</option>
          <option value="입학테스트">입학테스트</option>
        </select>

        {/* 💡 담당 강사 필터 (최고관리자에게만 보임) */}
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

        {/* 전체보기 버튼 */}
        <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
          🔄 전체보기
        </button>

        {/* 신규 학생 등록 버튼 (관리자 전용) */}
        {isSuperAdmin && (
          <div className="ml-auto flex gap-2 shrink-0">
            <button onClick={() => window.open("/student/enroll", "_blank", "width=700,height=800,top=100,left=100")} className="bg-[#002864] text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors text-center">
              신규 학생 등록
            </button>
          </div>
        )}
      </div>

      {/* 2. 학생 데이터 테이블 영역 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-x-auto overflow-y-auto flex-1 custom-scroll">
          <table className="w-full min-w-[1000px] text-left border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="py-3 pl-10 pr-4 border-b border-slate-200 font-extrabold text-slate-500">이름 🔍</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 max-w-[165px]">수강 중인 반 목록</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학교</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학년</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학생 연락처</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학부모 연락처</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">상태</th>
                <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">담당 강사</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-bold">데이터를 불러오는 중입니다...</td></tr>
              ) : currentData.length === 0 ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-bold">조건에 맞는 학생이 없습니다.</td></tr>
              ) : (
                currentData.map((s) => {
                  let statusClass = "bg-slate-100 text-slate-600";
                  if (s.status === "재원") statusClass = "bg-emerald-100 text-emerald-700";
                  if (s.status === "퇴원") statusClass = "bg-rose-100 text-rose-700";
                  if (s.status === "휴원") statusClass = "bg-amber-100 text-amber-700";
                  if (s.status === "입학테스트") statusClass = "bg-indigo-100 text-indigo-700";

                  const classNames: string[] = s.enrollment ? s.enrollment.map((e: any) => e.class?.name).filter(Boolean) : [];
                  const instNames: string[] = s.enrollment ? Array.from(new Set(s.enrollment.map((e: any) => e.class?.instructor?.name).filter(Boolean))) as string[] : [];

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

        {/* 3. 하단 페이지네이션 영역 */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-between items-center shrink-0">
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
  );
}