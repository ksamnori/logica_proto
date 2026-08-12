// src/app/(dashboard)/makeup/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 분리된 모달 컴포넌트 임포트
import MakeupModal from "@/components/makeup/MakeupModal";

export default function MakeupPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 메뉴 및 세부 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [canEditMakeup, setCanEditMakeup] = useState(false);
  const [canDeleteMakeup, setCanDeleteMakeup] = useState(false);

  // === 기본 데이터 상태 ===
  const [makeups, setMakeups] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // === 필터 상태 ===
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterInstructor, setFilterInstructor] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");

  // === 모달 상태 ===
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMakeup, setSelectedMakeup] = useState<any | null>(null);

  // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 즉시 권한 검사 및 세부 권한 연동
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      // 최고관리자, 원장, 대장급은 모든 권한 프리패스
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
      if (isGodMode) {
        setIsAuthorized(true);
        setCanEditMakeup(true);
        setCanDeleteMakeup(true);
        return;
      }

      if (!tId || !role) {
         alert("권한 정보가 없습니다.");
         router.replace("/home");
         return;
      }

      const { data } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .maybeSingle();

      // 보강 관리 메뉴 전체 접근 권한 확인
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/makeup"))) {
        alert("⛔ 보강 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        // 🌟 [핵심 변경] 권한 관리 페이지에서 설정한 수정/삭제 세부 권한을 읽어서 연동
        setCanEditMakeup(data.allowed_menus.includes("action_edit_makeup"));
        setCanDeleteMakeup(data.allowed_menus.includes("action_delete_makeup"));
      }
    };

    checkAccess();
  }, [router]);

  // 권한이 통과되었을 때만 데이터 페칭을 시작합니다.
  useEffect(() => {
    if (isAuthorized) {
      fetchInitialData();
    }
  }, [isAuthorized]);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const tenantId = localStorage.getItem("logica_tenant_id");
      const validTenantId = tenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : tenantId;

      if (!validTenantId) {
        setIsLoading(false);
        return;
      }

      // 기본 쿼리 셋업
      let makeupQuery = supabase
        .from('individual_makeup')
        .select('*, student(name, grade), instructor(name)')
        .order('schedule_date', { ascending: false })
        .limit(1000);

      let instQuery = supabase.from('instructor').select('instructor_id, name').eq('status', '재직');
      let stuQuery = supabase.from('student').select('student_id, name, grade').eq('status', '재원').order('name').limit(1000);

      // 내 지점의 강사, 학생, 보강 일정만 격리
      if (validTenantId) {
        makeupQuery = makeupQuery.eq('tenant_id', validTenantId);
        instQuery = instQuery.eq('tenant_id', validTenantId);
        stuQuery = stuQuery.eq('tenant_id', validTenantId);
      }

      const [instRes, stuRes, makeupRes] = await Promise.all([
        instQuery,
        stuQuery,
        makeupQuery
      ]);

      if (instRes.data) setInstructors(instRes.data);
      if (stuRes.data) setStudents(stuRes.data);
      if (makeupRes.data) setMakeups(makeupRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMakeups = useMemo(() => {
    const searchLow = filterSearch.trim().toLowerCase();
    return makeups.filter(m => {
      const matchStatus = filterStatus === 'all' || m.status === filterStatus;
      const matchInst = filterInstructor === 'all' || m.instructor_id?.toString() === filterInstructor;
      const matchSearch = searchLow === '' || m.student?.name?.toLowerCase().includes(searchLow);
      return matchStatus && matchInst && matchSearch;
    });
  }, [makeups, filterStatus, filterInstructor, filterSearch]);

  const resetFilters = () => {
    setFilterStatus("all");
    setFilterInstructor("all");
    setFilterSearch("");
  };

  const formatGrade = (grade: any) => {
    if (!grade) return '-';
    if (isNaN(Number(grade))) return grade; 
    const g = parseInt(grade, 10);
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  const openModal = (makeup: any | null = null) => {
    setSelectedMakeup(makeup);
    setIsModalOpen(true);
  };

  const deleteMakeup = async (id: string) => {
    // 🌟 [보안 강화] 강제 삭제 시도 시 백단에서도 한 번 더 권한을 차단합니다.
    if (!canDeleteMakeup) return alert("⛔ 보강 일정을 삭제할 권한이 없습니다.");

    if (!confirm("이 보강 일정을 정말 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase.from('individual_makeup').delete().eq('makeup_id', id);
      if (error) throw error;
      alert("삭제되었습니다.");
      fetchInitialData();
    } catch (e: any) { alert("삭제 실패: " + e.message); }
  };

  // 🌟 권한 확인 중이거나 권한이 없을 경우의 화면 처리
  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">1:1 개별 보강 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학생들의 1:1 개별 보강 일정을 등록하고, 전체 강사 일정을 함께 공유하며 협업합니다.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap">
        <span className="font-bold text-slate-600 text-sm mr-2">🔍 보강 필터</span>
        
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 상태</option>
          <option value="예정">예정</option>
          <option value="진행중">진행중</option>
          <option value="완료">완료</option>
          <option value="취소">취소</option>
        </select>
        
        <select value={filterInstructor} onChange={e => setFilterInstructor(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
          <option value="all">모든 담당 강사</option>
          {instructors.map(inst => <option key={inst.instructor_id} value={inst.instructor_id}>{inst.name} 선생님</option>)}
        </select>
        
        <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="학생 이름 검색" className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864] w-40" />
        
        <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
          🔄 전체보기
        </button>

        {/* 🌟 수정(등록) 권한이 있는 경우에만 새 보강 일정 등록 버튼 노출 */}
        {canEditMakeup && (
          <button onClick={() => openModal()} className="ml-auto bg-[#002864] text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors">
            새 보강 일정 등록
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-y-auto flex-1 custom-scroll">
          <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">예정일</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">시간</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">강의실</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">대상 학생 🔍</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">담당 강사</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">보강 내용(단원)</th>
                <th className="py-3 px-4 font-extrabold text-slate-500 text-center">상태</th>
                {(canEditMakeup || canDeleteMakeup) && (
                  <th className="py-3 px-4 font-extrabold text-slate-500 text-center">관리</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-bold">보강 일정을 불러오는 중입니다...</td></tr>
              ) : filteredMakeups.length === 0 ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-bold">조건에 맞는 보강 일정이 없습니다.</td></tr>
              ) : (
                filteredMakeups.map((m: any) => {
                  const d = new Date(m.schedule_date);
                  const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                  const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                  
                  const roomStr = m.classroom || '-';
                  const instName = m.instructor ? `${m.instructor.name} 선생님` : '미지정';
                  
                  let statusClass = 'bg-slate-100 text-slate-600';
                  if (m.status === '예정') statusClass = 'bg-blue-100 text-blue-700';
                  else if (m.status === '진행중') statusClass = 'bg-amber-100 text-amber-700';
                  else if (m.status === '완료') statusClass = 'bg-emerald-100 text-emerald-700';
                  else if (m.status === '취소') statusClass = 'bg-rose-100 text-rose-700';

                  return (
                    <tr key={m.makeup_id} className="hover:bg-blue-50/50 transition-colors border-b border-slate-100">
                      <td className="py-3 px-4 text-center font-bold text-slate-600">{dateStr}</td>
                      <td className="py-3 px-4 text-center font-extrabold text-[#002864] bg-blue-50/30">{timeStr}</td>
                      <td className="py-3 px-4 text-center font-bold text-slate-700">{roomStr}</td>
                      <td className="py-3 px-4 text-center font-extrabold text-[#002864] cursor-pointer hover:underline">
                        {m.student?.name || '알수없음'} <span className="text-xs text-slate-400 font-medium">({formatGrade(m.student?.grade)})</span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-slate-700">{instName}</td>
                      <td className="py-3 px-4 text-center font-bold text-slate-600 truncate max-w-[200px]" title={m.target_category_id}>{m.target_category_id || '-'}</td>
                      <td className="py-3 px-4 text-center"><span className={`${statusClass} px-2 py-1 rounded text-xs font-bold`}>{m.status || '예정'}</span></td>
                      
                      {/* 🌟 [핵심 변경] 권한에 따라 버튼을 개별적으로 렌더링 */}
                      {(canEditMakeup || canDeleteMakeup) && (
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {canEditMakeup && (
                              <button onClick={() => openModal(m)} className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-xs rounded shadow-sm transition-colors">수정</button>
                            )}
                            {canDeleteMakeup && (
                              <button onClick={() => deleteMakeup(m.makeup_id)} className="px-3 py-1.5 bg-rose-50 hover:bg-rose-500 text-rose-400 hover:text-white font-bold text-xs border border-rose-200 hover:border-rose-400 rounded shadow-sm transition-colors">삭제</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <MakeupModal 
        isOpen={isModalOpen} 
        makeupData={selectedMakeup} 
        students={students} 
        instructors={instructors} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={fetchInitialData} 
      />
    </div>
  );
}