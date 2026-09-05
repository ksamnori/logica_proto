// src/app/(dashboard)/consultation/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AgendaSidebar from "@/components/dashboard/AgendaSidebar";

const getKSTDateStr = (dateString?: string) => {
  if (!dateString) return "기록 없음";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "기록 없음";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

export default function ConsultationManagementPage() {
  const router = useRouter();
  
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "" });
  const [tenantId, setTenantId] = useState("hq");
  const [tenantName, setTenantName] = useState("로딩중...");
  
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // UI 상태 관리
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>(""); 

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id") || "1";
    const name = localStorage.getItem("logica_instructor_name") || "관리자";
    const tId = localStorage.getItem("logica_tenant_id") || "hq"; 
    
    setCurrentUser({ instId, name });
    setTenantId(tId);

    const savedMode = localStorage.getItem("logica_consult_view_mode");
    if (savedMode === "list" || savedMode === "card") setViewMode(savedMode);

    fetchInitialData(tId);
  }, []);

  const handleViewModeChange = (mode: "card" | "list") => {
    setViewMode(mode);
    localStorage.setItem("logica_consult_view_mode", mode);
  };

  const fetchInitialData = async (tId: string) => {
    setIsLoading(true);

    if (tId && tId !== 'hq') {
      const { data } = await supabase.from('academy_tenant').select('name').eq('tenant_id', tId).single();
      if (data) setTenantName(data.name);
    } else {
      setTenantName("본사 (HQ)");
    }

    // 💡 1. 반 목록 조회 시 담당 강사 이름 함께 로드
    let classQuery = supabase.from("class").select("class_id, name, instructor(name)").eq("status", "진행중");
    if (tId && tId !== 'hq') classQuery = classQuery.eq("tenant_id", tId);
    const { data: classData } = await classQuery.order("name");
    
    const formattedClasses = (classData || []).map((c: any) => ({
      class_id: c.class_id,
      name: c.name,
      displayName: `${c.name} (${c.instructor?.name || '미정'})`
    }));
    setClasses(formattedClasses);

    // 💡 2. 재원생 정보 조회 시 반의 강사 이름(instructor.name) 추가 포함
    let stQuery = supabase.from("student").select(`
      student_id, name, parent(name, phone),
      enrollment(class_id, class(name, instructor(name))),
      consultation_log(*, instructor(name)) 
    `).eq("status", "재원");
    
    if (tId && tId !== 'hq') stQuery = stQuery.eq("tenant_id", tId);
    
    const { data: stData, error } = await stQuery;

    if (error) console.error("데이터 로딩 에러:", error);

    if (stData) {
      const now = Date.now();
      const mapped = stData.map((st: any) => {
        const parentInfo = unwrap(st.parent);
        const mainEnroll = unwrap(st.enrollment);
        const classObj = unwrap(mainEnroll?.class);
        
        const className = classObj?.name || "미배정";
        const classInstructor = classObj?.instructor?.name || "미정";
        const classId = mainEnroll?.class_id || "none";

        const logs = st.consultation_log || [];
        logs.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const lastLog = logs[0] || null;

        let daysPassed = 999;
        if (lastLog && lastLog.created_at) {
          const logTime = new Date(lastLog.created_at).getTime();
          daysPassed = Math.floor((now - logTime) / (1000 * 3600 * 24));
        }

        const consultant = lastLog?.instructor?.name || "-";
        const consultType = lastLog?.consultation_type || "-";

        return {
          id: st.student_id,
          name: st.name,
          parentName: parentInfo?.name || "",
          parentPhone: parentInfo?.phone || "",
          classId,
          className,
          classInstructor,
          lastConsultDate: lastLog ? lastLog.created_at : null,
          lastConsultant: consultant,
          lastConsultType: consultType,
          daysPassed,
          isOverdue: daysPassed >= 30 
        };
      });

      setStudents(mapped);
    }
    setIsLoading(false);
  };

  // 💡 데이터 그룹핑 (classId 기준으로 완벽 분리)
  const filteredDisplayGroups = useMemo(() => {
    let filtered = students;
    
    if (selectedClass !== "all") {
      filtered = filtered.filter(s => String(s.classId) === String(selectedClass));
    }
    
    if (overdueOnly) {
      filtered = filtered.filter(s => s.isOverdue);
    }

    if (searchTerm.trim() !== "") {
      filtered = filtered.filter(s => s.name.includes(searchTerm.trim()));
    }

    const groups: Record<string, any[]> = {};
    const groupMeta: Record<string, { cName: string, cInstructor: string }> = {};

    filtered.forEach(st => {
      const key = st.classId;
      if (!groups[key]) {
        groups[key] = [];
        groupMeta[key] = { cName: st.className, cInstructor: st.classInstructor };
      }
      groups[key].push(st);
    });

    const result = Object.entries(groups)
      .map(([key, stList]) => ({
        classId: key,
        cName: groupMeta[key].cName,
        cInstructor: groupMeta[key].cInstructor,
        students: stList.sort((a, b) => a.name.localeCompare(b.name)),
        total: stList.length,
        overdueCount: stList.filter(s => s.isOverdue).length
      }))
      .sort((a, b) => a.cName === '미배정' ? 1 : b.cName === '미배정' ? -1 : a.cName.localeCompare(b.cName));

    return result;
  }, [students, selectedClass, overdueOnly, searchTerm]);

  const totalOverdueCount = useMemo(() => students.filter(s => s.isOverdue).length, [students]);

  if (isLoading) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-500 font-bold text-sm">학생 및 상담 기록을 동기화하는 중입니다...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-pretendard">
      <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scroll relative z-0 -mx-8 -mt-4">
        
        <header className="bg-gradient-to-br from-[#0f172a] to-[#1e1b4b] text-white pt-8 pb-20 px-8 shrink-0 relative z-0">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10 flex justify-between items-center ml-6">
            <div>
              <h1 className="text-3xl font-black tracking-tight font-lexend flex items-center gap-3">
                <span>💬 학부모 정기 상담 관리</span>
                <span className="bg-blue-500/30 text-blue-100 text-[15px] px-3 py-1 rounded-lg font-bold border border-blue-400/30 shadow-sm flex items-center">🏢 {tenantName}</span>
              </h1>
              <p className="text-slate-300 text-sm mt-2 font-medium tracking-tight">전체 재원생 {students.length}명 중 상담 요망(30일 경과) <span className="text-rose-400 font-black">{totalOverdueCount}</span>명</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-visible px-8 pb-10 -mt-10 relative z-10 bg-transparent max-w-[1600px] mx-auto w-full">
          
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            
            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
              <select 
                value={selectedClass} 
                onChange={e => setSelectedClass(e.target.value)}
                className="border border-indigo-300 rounded-lg py-2 px-3 text-sm font-bold text-indigo-900 bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm min-w-[180px]"
              >
                <option value="all">🌐 전체 반 보기</option>
                {/* 💡 담당자 이름이 추가된 displayName 표시 */}
                {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.displayName}</option>)}
              </select>

              <div className="relative flex-1 sm:flex-none">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 text-sm">🔍</span>
                <input 
                  type="text" 
                  placeholder="학생 이름 검색..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-sm font-bold text-slate-700 bg-white focus:outline-none focus:border-indigo-500 shadow-sm w-full sm:w-[180px]"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-lg border border-rose-200 transition-colors shadow-inner shrink-0">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                  checked={overdueOnly}
                  onChange={(e) => setOverdueOnly(e.target.checked)}
                />
                <span className="text-xs font-black text-rose-700 select-none flex items-center gap-1">🚨 30일 경과 미상담자만 보기</span>
              </label>
            </div>

            <div className="bg-slate-100 p-1.5 rounded-xl flex items-center shadow-inner shrink-0 border border-slate-200 w-full xl:w-auto justify-center">
              <button 
                onClick={() => handleViewModeChange('card')} 
                className={`px-5 py-2 text-xs font-bold rounded-lg transition-colors ${viewMode === 'card' ? 'bg-white text-indigo-600 shadow-md border border-slate-200/50' : 'text-slate-400 hover:text-slate-600'}`}
              >
                🗃️ 카드 뷰
              </button>
              <button 
                onClick={() => handleViewModeChange('list')} 
                className={`px-5 py-2 text-xs font-bold rounded-lg transition-colors ${viewMode === 'list' ? 'bg-white text-indigo-600 shadow-md border border-slate-200/50' : 'text-slate-400 hover:text-slate-600'}`}
              >
                🗂️ 리스트 뷰
              </button>
            </div>
          </div>

          {filteredDisplayGroups.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 flex flex-col items-center justify-center text-slate-400 shadow-sm">
              <span className="text-5xl mb-4">☕</span>
              <p className="font-bold text-base">조건에 해당하는 학생이 없습니다.</p>
              {overdueOnly && !searchTerm && <p className="text-sm mt-1">모든 학부모님과 활발히 소통 중이시군요! 훌륭합니다.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              
              {viewMode === "list" ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase w-32">학생 이름</th>
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase w-48">소속 반</th>
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase text-center w-40">최근 상담 기록</th>
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase text-center w-28">담당자</th>
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase text-center w-32">상태</th>
                          <th className="py-3 px-4 text-xs font-extrabold text-slate-500 uppercase text-right">관리 액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDisplayGroups.map(({ cName, cInstructor, students, total, overdueCount }) => (
                          <React.Fragment key={cName}>
                            <tr className="bg-slate-100/80 border-b border-slate-200">
                              <td colSpan={6} className="py-2.5 px-4 text-xs font-black text-indigo-800">
                                <span className="w-2 h-3.5 bg-indigo-500 inline-block align-middle mr-2 rounded-full"></span>
                                {cName} 
                                {/* 💡 리스트 뷰 헤더에 담당자 추가 */}
                                {cName !== '미배정' && <span className="text-indigo-500 font-bold ml-1.5 text-[11px]">({cInstructor})</span>}
                                <span className="text-slate-500 font-bold ml-2 text-[11px]">(총 {total}명)</span>
                                {overdueCount > 0 && <span className="ml-2 bg-rose-100 text-rose-600 text-[10px] px-2 py-0.5 rounded-full border border-rose-200">상담 필요 {overdueCount}명</span>}
                              </td>
                            </tr>
                            {students.map(student => {
                              const isOverdue = student.isOverdue;
                              const rowBg = isOverdue ? "bg-rose-50/30 hover:bg-rose-50" : "hover:bg-slate-50";
                              const statusBadge = isOverdue 
                                ? <span className="bg-rose-100 text-rose-700 border border-rose-300 px-2 py-1 rounded text-[10px] font-black shadow-sm flex items-center justify-center gap-1">🚨 {student.daysPassed === 999 ? '기록 없음' : `${student.daysPassed}일 경과`}</span>
                                : <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-1 rounded text-[10px] font-bold flex items-center justify-center">✓ 정상 관리중</span>;

                              return (
                                <tr key={student.id} className={`border-b border-slate-100 last:border-0 transition-colors ${rowBg}`}>
                                  <td className="py-3 px-4">
                                    <span className={`text-sm font-extrabold ${isOverdue ? 'text-rose-700' : 'text-slate-800'}`}>{student.name}</span>
                                  </td>
                                  <td className="py-3 px-4 text-xs font-bold text-slate-600">{student.className}</td>
                                  <td className="py-3 px-4 text-center">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-xs font-extrabold text-slate-600">{getKSTDateStr(student.lastConsultDate)}</span>
                                      {student.lastConsultType !== '-' && <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 rounded">{student.lastConsultType}</span>}
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-center text-xs font-bold text-slate-500">
                                    <span className="bg-slate-100 px-2 py-1 rounded-md border border-slate-200">{student.lastConsultant}</span>
                                  </td>
                                  <td className="py-3 px-4 flex justify-center">{statusBadge}</td>
                                  <td className="py-3 px-4 text-right">
                                    <button 
                                      onClick={() => router.push(`/student/${student.id}?tab=consult`)} 
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm border ${isOverdue ? 'bg-rose-600 text-white hover:bg-rose-700 border-rose-700' : 'bg-white text-indigo-600 hover:bg-indigo-50 border-indigo-200'}`}
                                    >
                                      상담 일지 열기 ➡️
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-8">
                  {filteredDisplayGroups.map(({ cName, cInstructor, students, total, overdueCount }) => (
                    <div key={cName} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                      <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                          <span className="w-1.5 h-4 bg-indigo-500 rounded-full"></span>
                          {cName}
                          {/* 💡 카드 뷰 헤더에 담당자 추가 */}
                          {cName !== '미배정' && <span className="text-indigo-500 font-bold text-xs">({cInstructor})</span>}
                        </h4>
                        <div className="flex gap-2">
                          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">전체 {total}명</span>
                          {overdueCount > 0 && <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg shadow-sm">🚨 상담 지연 {overdueCount}명</span>}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        {students.map(student => {
                          const isOverdue = student.isOverdue;
                          const cardBg = isOverdue ? "bg-rose-50/50 border-rose-300 hover:border-rose-500" : "bg-white border-slate-200 hover:border-indigo-300";
                          const titleColor = isOverdue ? "text-rose-700" : "text-slate-800";
                          
                          return (
                            <div 
                              key={student.id} 
                              onClick={() => router.push(`/student/${student.id}?tab=consult`)}
                              className={`p-3.5 rounded-xl border flex flex-col gap-2 cursor-pointer transition-all shadow-sm group ${cardBg}`}
                            >
                              <div className="flex justify-between items-start">
                                <span className={`text-sm font-extrabold ${titleColor}`}>{student.name}</span>
                                {isOverdue && <span className="text-[9px] font-black bg-rose-600 text-white px-1.5 py-0.5 rounded shadow-sm animate-pulse">상담요망</span>}
                              </div>

                              <div className="flex flex-col gap-1.5 mt-1 border-t border-slate-100 pt-2">
                                <div className="flex justify-between items-center text-[11px]">
                                  <span className="font-bold text-slate-400">최근 기록</span>
                                  <div className="flex items-center gap-1.5">
                                    {student.lastConsultType !== '-' && <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1 rounded">{student.lastConsultType}</span>}
                                    <span className={`font-extrabold ${isOverdue ? 'text-rose-600' : 'text-slate-600'}`}>
                                      {getKSTDateStr(student.lastConsultDate)}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center text-[11px]">
                                  <span className="font-bold text-slate-400">담당자</span>
                                  <span className="font-extrabold text-slate-600 bg-slate-100 px-1.5 rounded">{student.lastConsultant}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] mt-0.5">
                                  <span className="font-bold text-slate-400">경과 시간</span>
                                  <span className={`font-black ${isOverdue ? 'text-rose-500' : 'text-emerald-500'}`}>
                                    {student.daysPassed === 999 ? '기록없음' : `${student.daysPassed}일 전`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}

        </main>
      </div>

      <AgendaSidebar currentUser={{ instId: currentUser.instId, name: currentUser.name, isSuperLevel: true }} tenantId={tenantId} hasAccess={() => true} />
    </div>
  );
}