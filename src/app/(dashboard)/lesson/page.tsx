// src/app/(dashboard)/lesson/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import EditBookModal from "@/components/lesson/EditBookModal";
import AssignBookModal from "@/components/lesson/AssignBookModal";

export default function LessonPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [masterBooks, setMasterBooks] = useState<any[]>([]);
  const [filterType, setFilterType] = useState("all");
  const [searchKeyword, setSearchKeyword] = useState("");

  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [assignedBooks, setAssignedBooks] = useState<any[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalData, setEditModalData] = useState<any | null>(null);
  
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignModalData, setAssignModalData] = useState<any | null>(null);

  const [canDeleteBook, setCanDeleteBook] = useState(false);

  // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 즉시 권한부터 검사합니다!
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
      if (isGodMode) {
        setIsAuthorized(true);
        setCanDeleteBook(true); // 최고관리자급은 삭제 무조건 허용
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

      // 교재 관리 메뉴 접근 권한이 없다면 쫓아냅니다.
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/lesson"))) {
        alert("⛔ 교재 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        // 삭제 권한이 메뉴 리스트(allowed_menus)에 포함되어 있는지 확인
        if (data.allowed_menus.includes('action_delete_book')) {
          setCanDeleteBook(true);
        }
      }
    };

    checkAccess();
  }, [router]);

  // 권한이 통과되었을 때만 데이터를 불러옵니다.
  useEffect(() => {
    if (isAuthorized) {
      fetchMasterBooks();
      fetchClasses();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (selectedClass) fetchClassAssignedBooks(selectedClass.class_id);
  }, [selectedClass]);

  const fetchMasterBooks = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    
    // 🚨 [보안 강화] 소속 지점 정보가 없으면 조회를 원천 차단합니다.
    if (!tenantId) {
      setMasterBooks([]);
      return;
    }

    // 🌟 오직 내 지점(tenant_id)에 속한 마스터 교재만 불러옵니다.
    const { data } = await supabase
      .from("textbook")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
      
    setMasterBooks(data || []);
  };

  const createDummyBook = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    if (!tenantId) return alert("소속 지점 정보가 없어 교재를 생성할 수 없습니다.");

    const bookName = prompt("새로운 마스터 교재 이름을 입력하세요:\n(예: 개념원리 중1-1)");
    if (!bookName) return;
    try {
      // 🌟 교재 생성 시 내 지점(tenant_id) 꼬리표를 명확히 달아줍니다.
      await supabase.from("textbook").insert({ 
        title: bookName, 
        book_type: "주교재", 
        target_sessions: 12,
        tenant_id: tenantId 
      });
      alert(`[${bookName}] 교재가 생성되었습니다.`);
      fetchMasterBooks();
    } catch (e) {
      alert("교재 생성 실패");
    }
  };

  const deleteMasterBook = async (bookId: string) => {
    if (!confirm("⚠️ 이 마스터 교재를 삭제하시겠습니까?\n(이 교재로 출제된 과제 및 반 배정 내역이 모두 함께 삭제됩니다.)")) return;
    try {
      const { data: hwAssignments } = await supabase.from("homework_assignment").select("homework_id").eq("book_id", bookId);
      if (hwAssignments && hwAssignments.length > 0) {
        const hwIds = hwAssignments.map(hw => hw.homework_id);
        await supabase.from("student_homework_result").delete().in("homework_id", hwIds);
        await supabase.from("homework_assignment").delete().eq("book_id", bookId);
      }
      await supabase.from("class_textbook").delete().eq("book_id", bookId);
      await supabase.from("textbook_question").delete().eq("book_id", bookId);
      await supabase.from("textbook").delete().eq("book_id", bookId);
      
      alert("교재 마스터 및 연관 데이터가 성공적으로 삭제되었습니다.");
      fetchMasterBooks();
      if (selectedClass) fetchClassAssignedBooks(selectedClass.class_id);
    } catch (e) { alert("삭제 실패"); }
  };

  const fetchClasses = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tenantId = localStorage.getItem("logica_tenant_id");
    
    // 🚨 [보안 강화] 소속 지점 정보가 없으면 반 조회를 원천 차단합니다.
    if (!tenantId) {
      setClasses([]);
      return;
    }

    const isAdmin = ["ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("원장") || pos.includes("실장");

    // 🌟 오직 내 지점(tenant_id)에 속한 반만 불러오도록 강제 필터링!
    let query = supabase
      .from("class")
      .select("*, instructor(name), enrollment(student_id), class_schedule(*)")
      .eq("tenant_id", tenantId)
      .order("name");
    
    if (!isAdmin && instId) {
      query = query.eq("instructor_id", instId);
    }

    const { data } = await query;
    setClasses(data || []);
  };

  const fetchClassAssignedBooks = async (classId: string) => {
    try {
      const { data } = await supabase.from("class_textbook").select("*, textbook(*)").eq("class_id", classId).order("start_date", { ascending: true });
      if (!data || data.length === 0) {
        setAssignedBooks([]);
        return;
      }

      const assignedBookIds = data.map(cb => cb.book_id);
      const { data: qData } = await supabase.from("textbook_question").select("tq_id, book_id, page_number").in("book_id", assignedBookIds);
      const questionsData = qData || [];

      const { data: assignments } = await supabase.from("homework_assignment").select("target_student_id, student_homework_result(completed_tq_ids)").eq("class_id", classId);
      let doneTqIds = new Set<number>();
      
      assignments?.forEach(hw => {
        if (hw.target_student_id === null) {
          (hw.student_homework_result || []).forEach((res: any) => {
            let comp = res.completed_tq_ids;
            if (typeof comp === "string") { try { comp = JSON.parse(comp); } catch (e) { comp = []; } }
            if (Array.isArray(comp)) comp.forEach((id: any) => doneTqIds.add(Number(id)));
          });
        }
      });

      const progressStats: any = {};
      assignedBookIds.forEach(bId => {
        const qs = questionsData.filter(q => q.book_id === bId);
        if (qs.length === 0) {
          progressStats[bId] = { maxPage: 0, highestDonePage: 0, percent: 0 };
          return;
        }

        const pages: any = {};
        let maxPage = 0;
        qs.forEach(q => {
          const pNum = Number(q.page_number) || 0;
          if (pNum > maxPage) maxPage = pNum;
          if (!pages[pNum]) pages[pNum] = [];
          pages[pNum].push(q.tq_id);
        });

        let highestDonePage = 0;
        for (const pStr in pages) {
          const p = Number(pStr);
          const allDone = pages[p].every((id: number) => doneTqIds.has(id));
          if (allDone && p > highestDonePage) highestDonePage = p;
        }
        progressStats[bId] = { maxPage, highestDonePage, percent: maxPage > 0 ? Math.round((highestDonePage / maxPage) * 100) : 0 };
      });

      const booksWithStats = data.map(cb => ({ ...cb, stats: progressStats[cb.book_id] || { maxPage: 0, highestDonePage: 0, percent: 0 } }));
      setAssignedBooks(booksWithStats);
    } catch (e) { console.error(e); }
  };

  const deleteClassTextbook = async (mappingId: string) => {
    if (!confirm("이 교재 배정을 취소하시겠습니까? (해당 반의 진도 기록 삭제)")) return;
    try {
      await supabase.from("class_textbook").delete().eq("class_textbook_id", mappingId);
      fetchClassAssignedBooks(selectedClass.class_id);
    } catch (e) { alert("취소 실패"); }
  };

  const handleDragStart = (e: React.DragEvent, bookId: string) => {
    e.dataTransfer.setData("bookId", bookId);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const bookId = e.dataTransfer.getData("bookId");
    if (!bookId || !selectedClass) return;

    const today = new Date().toISOString().split("T")[0];
    let nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 2);
    
    setAssignModalData({
      book_id: bookId,
      status: "진행중",
      start_date: today,
      target_end_date: nextMonth.toISOString().split("T")[0]
    });
    setIsAssignModalOpen(true);
  };
  
  const filteredMasterBooks = useMemo(() => {
    return masterBooks.filter(b => {
      const matchType = filterType === "all" || b.book_type === filterType;
      const matchKw = (b.title || "").toLowerCase().includes(searchKeyword.toLowerCase());
      return matchType && matchKw;
    });
  }, [masterBooks, filterType, searchKeyword]);

  const getGradeWeight = (gradeStr: string) => {
    if (!gradeStr) return 0;
    if (gradeStr.includes("고3")) return 12; if (gradeStr.includes("고2")) return 11; if (gradeStr.includes("고1")) return 10;
    if (gradeStr.includes("중3")) return 9; if (gradeStr.includes("중2")) return 8; if (gradeStr.includes("중1")) return 7;
    if (gradeStr.includes("초6")) return 6; if (gradeStr.includes("초5")) return 5; if (gradeStr.includes("초4")) return 4;
    if (gradeStr.includes("초3")) return 3; if (gradeStr.includes("초2")) return 2; if (gradeStr.includes("초1")) return 1;
    return 0;
  };

  const groupedClasses = useMemo(() => {
    const groups: any = { "Ultimate": [], "Master": [], "Apex": [], "Titan": [], "Horizon": [], "특강/메이크업": [] };
    classes.forEach(c => {
      const prefix2 = (c.name || "").trim().toUpperCase().substring(0, 2);
      let gName = "특강/메이크업";
      if (["Ultimate", "Master", "Apex", "Titan", "Horizon"].includes(c.level_name)) gName = c.level_name;
      else if (["SS", "WS", "MU", "LE"].includes(prefix2) || ["특강", "메이크업"].includes(c.level_name)) gName = "특강/메이크업";
      
      if (gName === "특강/메이크업" && !["진행중", "예정"].includes(c.status)) return;
      if (groups[gName]) groups[gName].push(c);
    });
    return groups;
  }, [classes]);

  // 🌟 권한 확인 중이거나 권한이 없을 경우의 화면 처리
  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; // 이미 useEffect에서 alert 후 home으로 튕겨냅니다.
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📚 전체 교재 및 배정 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학원의 마스터 교재를 등록 및 관리하고, 각 수강반에 교재를 배정하여 진도율을 추적합니다.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        
        <div className="w-[400px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 relative z-10 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[13px] font-extrabold text-[#002864] flex items-center gap-1.5">
                <span>📚</span> 전체 마스터 교재
              </h3>
              <button onClick={createDummyBook} className="bg-[#002864] hover:bg-blue-900 text-white px-3 py-1.5 rounded-md font-bold shadow-sm transition-colors flex items-center gap-1 text-[11px]">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                새 교재 등록
              </button>
            </div>
            <div className="flex gap-2">
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#002864] bg-white shadow-sm shrink-0">
                <option value="all">전체 구분</option>
                <option value="주교재">주교재</option>
                <option value="부교재">부교재</option>
                <option value="연산교재">연산교재</option>
                <option value="워크북">워크북</option>
              </select>
              <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="교재명 검색..." className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#002864] shadow-sm" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 bg-slate-50/50">
            {filteredMasterBooks.length === 0 ? (
              <div className="text-center py-10 text-slate-400 font-bold text-sm">등록된 교재가 없습니다.</div>
            ) : (
              filteredMasterBooks.map(b => {
                let badgeClass = "bg-blue-100 text-blue-700";
                if (b.book_type === "부교재") badgeClass = "bg-emerald-100 text-emerald-700";
                else if (b.book_type === "연산교재") badgeClass = "bg-purple-100 text-purple-700";
                else if (b.book_type === "워크북") badgeClass = "bg-amber-100 text-amber-700";

                return (
                  <div key={b.book_id} draggable onDragStart={(e) => handleDragStart(e, b.book_id)} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-grab flex justify-between items-center group relative hover:border-[#002864]">
                    <div className="flex-1 pr-4 pointer-events-none min-w-0">
                      <span className={`${badgeClass} px-2 py-0.5 rounded text-[10px] font-extrabold mb-1.5 inline-block shadow-sm`}>{b.book_type}</span>
                      <div className="font-bold text-slate-800 text-[14px] leading-snug break-keep">{b.title}</div>
                      <div className="text-[11px] font-bold text-slate-400 mt-1">{b.target_sessions}회차 분량</div>
                    </div>
                    <div className="flex flex-col gap-1.5 z-10 shrink-0">
                      <button onClick={() => {
                        if(!selectedClass) return alert("우측에서 배정할 반을 먼저 선택해주세요.");
                        const today = new Date().toISOString().split("T")[0];
                        let nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 2);
                        setAssignModalData({ book_id: b.book_id, status: "진행중", start_date: today, target_end_date: nextMonth.toISOString().split("T")[0] });
                        setIsAssignModalOpen(true);
                      }} className="px-3 py-1.5 bg-[#002864] text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm text-center hover:bg-blue-900">배정</button>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditModalData(b); setIsEditModalOpen(true); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-bold transition-colors shadow-sm flex-1">수정</button>
                        {/* 🌟 삭제 권한이 있는 사용자에게만 삭제 버튼 노출 */}
                        {canDeleteBook && (
                          <button onClick={() => deleteMasterBook(b.book_id)} className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded text-[10px] font-bold transition-colors shadow-sm flex-1">삭제</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 우측 반 및 교재 현황 패널 */}
        <div className="flex-1 flex flex-col min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0 z-10">
            <h2 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
              {selectedClass ? (
                <><span className="text-[#002864]">📖</span> <span className="text-[#002864]">{selectedClass.name}</span> 배정 현황</>
              ) : (
                <><span className="text-slate-400">📋</span> 전체 수강반 목록</>
              )}
            </h2>
            <div className="flex items-center h-8">
              <button onClick={() => setSelectedClass(null)} className="h-full px-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-[11px] font-extrabold transition-colors shadow-sm whitespace-nowrap">
                목록으로 돌아가기 ↻
              </button>
            </div>
          </div>
          
          <div 
            className={`flex-1 overflow-y-auto custom-scroll p-6 transition-all duration-200 relative bg-slate-50/50 ${isDragOver ? "bg-[#f0f9ff] outline-dashed outline-2 outline-[#38bdf8] outline-offset-[-2px]" : ""}`}
            onDragOver={(e) => { e.preventDefault(); if (selectedClass) setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            {!selectedClass ? (
              <div className="space-y-8 pb-10">
                {Object.keys(groupedClasses).map(g => {
                  const groupItems = groupedClasses[g];
                  if (groupItems.length === 0) return null;
                  groupItems.sort((a: any, b: any) => getGradeWeight(b.target_grade) - getGradeWeight(a.target_grade));

                  return (
                    <div key={g}>
                      <h3 className="text-sm font-extrabold text-slate-800 mb-4 border-b-2 border-slate-200 pb-1.5 flex items-center gap-2">
                        <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded shadow-sm">{g}</span>
                      </h3>
                      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {groupItems.map((c: any) => {
                          const studentCount = new Set((c.enrollment || []).map((e: any) => e.student_id)).size;
                          const instructorName = c.instructor?.name || "미정";
                          let scheduleHtml = <span className="text-slate-400 text-xs">-</span>;
                          
                          if (c.class_schedule?.length > 0) {
                            const days = ['월', '화', '수', '목', '금', '토', '일'];
                            c.class_schedule.sort((a: any, b: any) => days.indexOf(a.day_of_week) - days.indexOf(b.day_of_week));
                            scheduleHtml = (
                              <div className="flex flex-col gap-1.5">
                                {c.class_schedule.map((sc: any, idx: number) => {
                                  const sTime = sc.start_time?.substring(0, 5) || "";
                                  const eTime = sc.end_time?.substring(0, 5) || "";
                                  const colorClass = sc.day_of_week === '토' ? 'text-blue-600' : (sc.day_of_week === '일' ? 'text-red-500' : 'text-slate-700');
                                  return (
                                    <div key={idx} className="flex items-center gap-1.5 text-[10px]">
                                      <span className={`font-extrabold ${colorClass} bg-white border border-slate-200 rounded px-1 w-5 text-center shadow-sm leading-none shrink-0`}>{sc.day_of_week}</span> 
                                      <span className="text-[#002864] font-medium tracking-tighter whitespace-nowrap">{eTime ? `${sTime}~${eTime}` : sTime}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          } else if (c.schedule_days) {
                            scheduleHtml = <span className="font-bold text-slate-700 text-[10px] break-keep leading-tight">{c.schedule_days}</span>;
                          }

                          return (
                            <div key={c.class_id} onClick={() => setSelectedClass(c)} className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-sm hover:shadow-md hover:border-[#0ea5e9] hover:-translate-y-1 cursor-pointer transition-all group flex justify-between items-center gap-2">
                              <div className="flex flex-col h-full justify-center min-w-0 flex-1">
                                <div className="font-extrabold text-[#002864] text-[14px] group-hover:text-[#0ea5e9] transition-colors truncate mb-1">{c.name}</div>
                                <div className="text-[11px] font-bold text-slate-500 mb-2">
                                  <div className="truncate">{instructorName} 선생님</div>
                                  <div className="truncate mt-0.5"><span className="text-sky-600">{studentCount}명</span></div>
                                </div>
                                <div className="mt-auto pt-1">
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 text-[10px] font-extrabold inline-block shadow-sm">{c.target_grade || "무학년"}</span>
                                </div>
                              </div>
                              <div className="shrink-0 bg-slate-50/70 p-2 rounded-xl border border-slate-100 flex items-center justify-center">
                                {scheduleHtml}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                {assignedBooks.length === 0 ? (
                  <div className={`text-center py-20 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl ${isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"} shadow-sm transition-colors pointer-events-none`}>
                    <span className="text-5xl mb-4 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                    <span className="text-slate-600 font-bold text-lg mb-1">이 반에 배정된 교재가 없습니다.</span>
                    <span className="text-slate-400 text-sm font-medium">좌측 마스터 교재를 드래그하여 이곳에 놓아주세요.</span>
                  </div>
                ) : (
                  <>
                    {assignedBooks.map(cb => {
                      let badgeClass = "bg-slate-100 text-slate-600";
                      if (cb.status === "진행중") badgeClass = "bg-blue-100 text-blue-700 border-blue-200";
                      else if (cb.status === "완료") badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";

                      let bookBadgeClass = "bg-slate-50 text-slate-500 border-slate-200";
                      if (cb.textbook.book_type === "주교재") bookBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                      else if (cb.textbook.book_type === "부교재") bookBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                      else if (cb.textbook.book_type === "연산교재") bookBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                      else if (cb.textbook.book_type === "워크북") bookBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";

                      const sDate = cb.start_date ? cb.start_date.substring(5).replace("-","/") : "-";
                      const eDate = cb.target_end_date ? cb.target_end_date.substring(5).replace("-","/") : "-";
                      const { maxPage, highestDonePage, percent } = cb.stats;

                      return (
                        <div key={cb.class_textbook_id} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                          <div className="flex justify-between items-start mb-3 relative z-10">
                            <div>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`${badgeClass} px-2 py-0.5 rounded text-[10px] font-extrabold border shadow-sm`}>{cb.status}</span>
                                <span className={`${bookBadgeClass} px-1.5 py-0.5 rounded text-[10px] font-extrabold border shadow-sm`}>{cb.textbook.book_type}</span>
                              </div>
                              <div className="font-extrabold text-slate-800 text-[16px]">{cb.textbook.title}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">일정: {sDate} ~ {eDate}</div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-4 relative z-10">
                            <div className="flex-1 bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200 relative">
                              <div className="bg-[#002864] h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-[14px] font-black text-[#002864] w-10 text-right">{percent}%</div>
                              <div className="text-[11px] font-bold text-slate-400 w-16 text-right">{highestDonePage} / {maxPage} P</div>
                            </div>
                          </div>
                          
                          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-3 relative z-10">
                            <button onClick={() => window.location.href = `/progress?class_id=${selectedClass.class_id}&book_id=${cb.book_id}`} className="px-3 py-1.5 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-[#002864] rounded-lg font-bold text-xs shadow-sm transition-colors border border-slate-200 hover:border-blue-200 flex items-center gap-1">
                              진도/과제 관리로 이동 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                            {/* 배정 취소 버튼은 반 삭제와 유사하므로 필요하다면 나중에 권한 분리 가능 */}
                            <button onClick={() => deleteClassTextbook(cb.class_textbook_id)} className="ml-auto text-xs font-bold text-rose-400 hover:text-rose-600 underline">배정 취소</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className={`mt-6 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500 font-bold ${isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"} flex flex-col items-center justify-center transition-colors shadow-sm pointer-events-none`}>
                      <span className="text-3xl mb-2 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                      추가로 배정할 교재를 여기에 드래그하여 놓아주세요.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <EditBookModal 
        isOpen={isEditModalOpen} 
        bookData={editModalData} 
        onClose={() => setIsEditModalOpen(false)} 
        onSuccess={() => {
          fetchMasterBooks();
          if (selectedClass) fetchClassAssignedBooks(selectedClass.class_id);
        }} 
      />

      <AssignBookModal 
        isOpen={isAssignModalOpen} 
        assignData={assignModalData} 
        selectedClass={selectedClass} 
        onClose={() => setIsAssignModalOpen(false)} 
        onSuccess={() => fetchClassAssignedBooks(selectedClass.class_id)} 
      />
    </div>
  );
}