// src/app/(dashboard)/student/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation"; 
import { supabase } from "@/lib/supabase";

const unwrap = (obj: any) => (Array.isArray(obj) ? obj[0] : obj);
const ensureArray = (obj: any) => {
  if (!obj) return [];
  return Array.isArray(obj) ? obj : [obj];
};

// 🌟 학년 정렬용 헬퍼 함수
const getGradeOrder = (grade: any) => {
  if (!grade) return 999;
  if (typeof grade === 'string' && grade.includes('세')) return 0;
  const num = parseInt(grade.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 999 : num;
};

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

  const [waitingKeyword, setWaitingKeyword] = useState("");
  const [waitingGrade, setWaitingGrade] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [waitingCurrentPage, setWaitingCurrentPage] = useState(1); 
  
  const formalLimit = 15;
  const waitingLimit = 16;

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

  useEffect(() => {
    setWaitingCurrentPage(1);
  }, [waitingKeyword, waitingGrade]);

  const fetchData = async (isSuper: boolean) => {
    setIsLoading(true);
    try {
      const myId = localStorage.getItem("logica_instructor_id");
      const tenantId = localStorage.getItem("logica_tenant_id");

      let instQuery = supabase.from("instructor").select("instructor_id, name").eq("status", "재직");
      if (tenantId) instQuery = instQuery.eq("tenant_id", tenantId);
      const { data: instData } = await instQuery;
      if (instData) setInstructors(instData);

      // 🌟 [수정] exam_assignment 테이블에 존재하지 않는 updated_at 대신 created_at을 요청하여 500 에러 해결
      let stuQuery = supabase
        .from("student")
        .select("*, parent(phone), enrollment(class(name, level_name, instructor_id, status, instructor(name))), exam_assignment(status, created_at, admission_session_id)")
        .order("created_at", { ascending: false })
        .limit(2000); 
      
      if (tenantId) stuQuery = stuQuery.eq("tenant_id", tenantId);

      const { data: allStuData, error } = await stuQuery;
      
      if (error) {
        console.error("데이터베이스 쿼리 에러:", error);
      }

      if (allStuData) {
        if (isSuper) {
          setStudents(allStuData);
        } else {
          const myStudents = allStuData.filter((student: any) => {
            const enrolls = ensureArray(student.enrollment);
            return enrolls.some((e: any) => unwrap(e.class)?.instructor_id === myId);
          });
          setStudents(myStudents);
        }
      } else {
        setStudents([]);
      }

    } catch (error) {
      console.error("데이터 로딩 실패:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const isNewStudent = (createdAtStr: string) => {
    if (!createdAtStr) return false;
    const createdDate = new Date(createdAtStr);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  };

  const waitingStudents = useMemo(() => {
    return students.filter(s => s.status === '입학테스트').filter((s) => {
      const phone = s.phone || "";
      const parentPhone = unwrap(s.parent)?.phone || "";
      const matchKeyword = waitingKeyword === "" || s.name.includes(waitingKeyword) || phone.includes(waitingKeyword) || parentPhone.includes(waitingKeyword);
      const matchGrade = waitingGrade === "all" || s.grade === waitingGrade;
      
      return matchKeyword && matchGrade;
    });
  }, [students, waitingKeyword, waitingGrade]);

  const formalStudents = useMemo(() => {
    return students.filter(s => s.status !== '입학테스트').map(s => {
      const enrolls = ensureArray(s.enrollment);
      const activeEnrollments = enrolls.filter((e: any) => {
        const cls = unwrap(e.class);
        return cls && cls.status !== '예정';
      });
      const classes = activeEnrollments.map((e: any) => unwrap(e.class));
      
      const displayStatus = (activeEnrollments.length === 0 && s.status === '재원') ? '대기' : s.status;

      return { ...s, activeEnrollments, classes, displayStatus };
    }).filter((s) => {
      const isUMATH = (name: string) => ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon'].some(l => name.includes(l));

      const matchLevel = level === "all" || 
        (level === "기타" 
          ? s.classes.some((c: any) => c?.level_name && !isUMATH(c.level_name))
          : s.classes.some((c: any) => c?.level_name?.includes(level)));

      const matchGrade = grade === "all" || s.grade?.toString() === grade;
      const matchStatus = status === "all" || s.displayStatus === status; 
      const matchInst = instructorId === "all" || s.classes.some((c: any) => c?.instructor_id?.toString() === instructorId);
      
      const phone = s.phone || "";
      const matchKeyword = keyword === "" || s.name.includes(keyword) || phone.includes(keyword);

      return matchLevel && matchGrade && matchStatus && matchInst && matchKeyword;
    });
  }, [students, keyword, level, grade, status, instructorId]);

  const uniqueWaitingGrades = Array.from(new Set(students.filter(s => s.status === '입학테스트').map(s => s.grade))).filter(Boolean).sort((a, b) => getGradeOrder(a) - getGradeOrder(b));

  const resetFormalFilters = () => {
    setKeyword("");
    setLevel("all");
    setGrade("all");
    setStatus("all"); 
    setInstructorId("all");
  };

  const totalWaitingPages = Math.max(1, Math.ceil(waitingStudents.length / waitingLimit));
  const currentWaitingData = waitingStudents.slice((waitingCurrentPage - 1) * waitingLimit, waitingCurrentPage * waitingLimit);

  const totalFormalPages = Math.max(1, Math.ceil(formalStudents.length / formalLimit));
  const currentFormalData = formalStudents.slice((currentPage - 1) * formalLimit, currentPage * formalLimit);

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 overflow-y-auto custom-scroll font-pretendard">
      
      <div className="flex justify-between items-end shrink-0 mb-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">
            {isSuperAdmin ? "전체 학생 관리" : "내 수강생 관리"}
          </h2>
          <p className="text-sm font-bold text-slate-400 mt-1">
            우리 학원의 재원생과 입학 대기생을 효율적으로 관리합니다.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-0 shrink-0 mb-6">
        
        {/* ============================================== */}
        {/* 🌟 1. 정규 재원생 목록 (왼쪽 메인 패널) */}
        {/* ============================================== */}
        <div className="xl:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
          <div className="p-4 border-b border-slate-200 bg-emerald-50 shrink-0 flex flex-col gap-3 rounded-t-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-extrabold text-emerald-900 flex items-center gap-2">
                <span>👨‍🎓</span> 정규 재원생 관리 <span className="bg-emerald-200 text-emerald-800 text-xs px-2 py-0.5 rounded-full">{formalStudents.length}명</span>
              </h3>
              {isSuperAdmin && (
                <button onClick={() => window.open("/student/enroll", "_blank", "width=700,height=800,top=100,left=100")} className="bg-[#002864] text-white px-4 py-1.5 rounded-lg font-bold text-xs shadow-sm hover:bg-blue-900 transition-colors">
                  + 신규 등록
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="이름/연락처 검색" className="border border-emerald-200 text-emerald-800 bg-white text-xs font-bold rounded-md px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 w-32 shadow-sm" />
              <select value={level} onChange={(e) => setLevel(e.target.value)} className="border border-emerald-200 text-emerald-800 bg-white text-xs font-bold rounded-md px-2 py-1.5 focus:outline-none focus:border-emerald-500 shadow-sm">
                <option value="all">레벨 전체</option>
                <option value="Ultimate">Ultimate</option>
                <option value="Master">Master</option>
                <option value="Apex">Apex</option>
                <option value="Titan">Titan</option>
                <option value="Horizon">Horizon</option>
                <option value="기타">기타 (특강 등)</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-emerald-200 text-emerald-800 bg-white text-xs font-bold rounded-md px-2 py-1.5 focus:outline-none focus:border-emerald-500 shadow-sm">
                <option value="all">상태 전체</option>
                <option value="재원">재원</option>
                <option value="대기">대기</option>
                <option value="휴원">휴원</option>
                <option value="퇴원">퇴원</option>
              </select>
              {isSuperAdmin && (
                <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} className="border border-emerald-200 text-emerald-800 bg-white text-xs font-bold rounded-md px-2 py-1.5 focus:outline-none focus:border-emerald-500 shadow-sm">
                  <option value="all">담당 강사 전체</option>
                  {instructors.map((inst) => (
                    <option key={inst.instructor_id} value={inst.instructor_id.toString()}>{inst.name} 선생님</option>
                  ))}
                </select>
              )}
              <button onClick={resetFormalFilters} className="px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold text-xs rounded-md transition-colors border border-emerald-200">초기화</button>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scroll">
            <table className="w-full min-w-[800px] text-left border-collapse whitespace-nowrap text-sm">
              <thead className="bg-white sticky top-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <tr>
                  <th className="py-3 pl-6 pr-4 border-b border-slate-200 font-extrabold text-slate-500">이름 🔍</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">수강 중인 반</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학교/학년</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">학부모 연락처</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">상태</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500 text-center">담당 강사</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {isLoading ? (
                  <tr><td colSpan={6} className="py-20 text-center text-slate-400 font-bold">데이터를 불러오는 중입니다...</td></tr>
                ) : currentFormalData.length === 0 ? (
                  <tr><td colSpan={6} className="py-20 text-center text-slate-400 font-bold">조건에 맞는 학생이 없습니다.</td></tr>
                ) : (
                  currentFormalData.map((s) => {
                    let statusClass = "bg-slate-100 text-slate-600";
                    if (s.displayStatus === "재원") statusClass = "bg-emerald-100 text-emerald-700 border border-emerald-200";
                    if (s.displayStatus === "퇴원") statusClass = "bg-rose-100 text-rose-700 border border-rose-200";
                    if (s.displayStatus === "휴원") statusClass = "bg-amber-100 text-amber-700 border border-amber-200";
                    if (s.displayStatus === "대기") statusClass = "bg-indigo-100 text-indigo-700 border border-indigo-200";

                    // 🌟 [수정] 대기 상태인 학생도 NEW 뱃지가 표시되도록 조건 수정!
                    const isNew = (s.displayStatus === "재원" || s.displayStatus === "대기") && isNewStudent(s.created_at);
                    
                    const classNames: string[] = s.classes.map((c: any) => c.name).filter(Boolean);
                    const instNames: string[] = Array.from(new Set(s.classes.map((c: any) => c.instructor?.name).filter(Boolean))) as string[];
                    const parentPhone = unwrap(s.parent)?.phone || "-";

                    return (
                      <tr key={s.student_id} className={`transition-colors ${s.displayStatus === '퇴원' ? 'bg-slate-50/50 opacity-70' : 'hover:bg-emerald-50/40'}`}>
                        <td className="py-3 pl-6 pr-4 border-b border-slate-100 font-extrabold text-[#002864]">
                          <div 
                            onClick={() => router.push(`/student/${s.student_id}`)} 
                            className="flex items-center gap-1.5 cursor-pointer hover:text-emerald-600 hover:underline w-fit"
                          >
                            {s.name}
                            {isNew && <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-black rounded shadow-sm animate-pulse">🔥 NEW</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4 border-b border-slate-100 font-bold">
                          {classNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px] whitespace-normal">
                              {classNames.map((cName, idx) => (
                                <span key={idx} className="bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap">
                                  {cName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">미배정</span>
                          )}
                        </td>
                        <td className="py-3 px-4 border-b border-slate-100 text-slate-500 font-bold text-xs text-center max-w-[120px] truncate">
                          {s.school || "-"} / <span className="text-slate-700">{s.grade || "-"}</span>
                        </td>
                        <td className="py-3 px-4 border-b border-slate-100 text-slate-600 font-bold text-xs text-center">{parentPhone}</td>
                        <td className="py-3 px-4 border-b border-slate-100 text-center">
                          <span className={`${statusClass} px-2 py-1.5 rounded text-[11px] font-bold whitespace-nowrap`}>{s.displayStatus || "-"}</span>
                        </td>
                        <td className="py-3 px-4 border-b border-slate-100 text-center">
                          <div className="flex flex-wrap justify-center gap-1 w-full max-w-[120px] mx-auto">
                            {instNames.length > 0 ? instNames.map((name, idx) => (
                              <span key={idx} className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                                {name} 선생님
                              </span>
                            )) : <span className="text-slate-300 text-xs">-</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-50 border-t border-slate-200 p-3 flex justify-center items-center shrink-0 rounded-b-xl">
            <div className="flex items-center gap-3">
              <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50">이전</button>
              <span className="text-xs font-bold text-slate-600">페이지 {currentPage} / {totalFormalPages}</span>
              <button onClick={() => setCurrentPage((p) => Math.min(totalFormalPages, p + 1))} disabled={currentPage === totalFormalPages} className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50">다음</button>
            </div>
          </div>
        </div>

        {/* ============================================== */}
        {/* 🌟 2. 진단평가 대기생 목록 (오른쪽 보조 패널) */}
        {/* ============================================== */}
        <div className="xl:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[400px]">
          <div className="bg-indigo-50 border-b border-indigo-100 p-4 shrink-0 flex flex-col gap-3 rounded-t-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-extrabold text-indigo-900 flex items-center gap-2">
                <span>📝</span> 진단평가 대기생 <span className="bg-indigo-200 text-indigo-800 text-xs px-2 py-0.5 rounded-full">{waitingStudents.length}명</span>
              </h3>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <input 
                type="text" 
                value={waitingKeyword} 
                onChange={(e) => setWaitingKeyword(e.target.value)} 
                placeholder="이름/연락처" 
                className="border border-indigo-200 text-indigo-800 bg-white text-xs font-bold rounded-md px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 w-28 shadow-sm" 
              />
              <select 
                value={waitingGrade} 
                onChange={(e) => setWaitingGrade(e.target.value)} 
                className="border border-indigo-200 text-indigo-800 bg-white text-xs font-bold rounded-md px-2 py-1.5 focus:outline-none focus:border-indigo-500 shadow-sm"
              >
                <option value="all">학년 전체</option>
                {uniqueWaitingGrades.map(g => (
                  <option key={g} value={g as string}>{g}</option>
                ))}
              </select>
              {(waitingKeyword !== "" || waitingGrade !== "all") && (
                <button onClick={() => { setWaitingKeyword(""); setWaitingGrade("all"); }} className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-500 font-bold text-xs rounded border border-slate-200 transition-colors">초기화</button>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scroll p-2">
            <div className="flex flex-col gap-1.5">
              {isLoading ? (
                <div className="py-10 text-center text-slate-400 font-bold text-sm">불러오는 중...</div>
              ) : currentWaitingData.length === 0 ? (
                <div className="py-10 text-center text-slate-400 font-bold text-sm">입학 대기생이 없습니다.</div>
              ) : (
                currentWaitingData.map(s => {
                  const assignments = ensureArray(s.exam_assignment);
                  // 🌟 [수정] 시험에 응시했는지 여부를 created_at 으로 표시
                  const testAssignment = assignments.find((a: any) => a.admission_session_id && a.status !== '응시전');
                  let testDateBadge = null;
                  
                  if (testAssignment && testAssignment.created_at) {
                    const d = new Date(testAssignment.created_at);
                    const formattedDate = `${d.getMonth() + 1}/${d.getDate()}`;
                    testDateBadge = (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold border border-emerald-200 whitespace-nowrap shrink-0">
                        ✅ {formattedDate} 응시기록
                      </span>
                    );
                  }

                  return (
                    <div key={s.student_id} onClick={() => router.push(`/student/${s.student_id}`)} className="px-3 py-2 border border-slate-200 rounded-lg hover:bg-indigo-50/50 cursor-pointer transition-colors shadow-sm flex justify-between items-center bg-white gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-extrabold text-[#002864] text-[13px] whitespace-nowrap">{s.name}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200 whitespace-nowrap shrink-0">{s.grade || '-'}</span>
                        <span className="text-[11px] text-slate-500 font-medium truncate">📞 {unwrap(s.parent)?.phone || "-"}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {testDateBadge}
                        <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap shrink-0">입학 대기</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {totalWaitingPages > 1 && (
            <div className="bg-slate-50 border-t border-slate-200 p-2.5 flex justify-center items-center shrink-0 rounded-b-xl">
              <div className="flex items-center gap-2">
                <button onClick={() => setWaitingCurrentPage(p => Math.max(1, p - 1))} disabled={waitingCurrentPage === 1} className="px-2 py-1 border border-slate-300 rounded text-xs font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50">◀</button>
                <span className="text-[11px] font-bold text-slate-500">{waitingCurrentPage} / {totalWaitingPages}</span>
                <button onClick={() => setWaitingCurrentPage(p => Math.min(totalWaitingPages, p + 1))} disabled={waitingCurrentPage === totalWaitingPages} className="px-2 py-1 border border-slate-300 rounded text-xs font-bold bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50">▶</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}