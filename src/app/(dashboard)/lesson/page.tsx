// src/app/(dashboard)/lesson/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import EditBookModal from "@/components/lesson/EditBookModal";
import AssignBookModal from "@/components/lesson/AssignBookModal";
import ProgressDetailModal from "@/components/progress/ProgressDetailModal"; 

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

interface StudentBasicInfo {
  id: string;
  name: string;
}

interface IndividualStat {
  student_id: string;
  name: string;
  percent: number;
  donePagesCount: number;
  pageStatuses: Record<number, 'done' | 'homework' | 'none'>; 
}

interface TextbookInfo {
  title: string;
  book_type: string;
}

interface ClassTextbookRow {
  book_id: string; 
  textbook: TextbookInfo | TextbookInfo[] | null;
}

export default function LessonPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [masterBooks, setMasterBooks] = useState<any[]>([]);
  const [filterType, setFilterType] = useState("all");
  const [searchKeyword, setSearchKeyword] = useState("");

  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [assignedBooks, setAssignedBooks] = useState<any[]>([]);
  
  const [attendanceAlerts, setAttendanceAlerts] = useState<any[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalData, setEditModalData] = useState<any | null>(null);
  
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignModalData, setAssignModalData] = useState<any | null>(null);

  const [canDeleteBook, setCanDeleteBook] = useState(false);
  const [canViewAllClasses, setCanViewAllClasses] = useState(false); 

  const [progressModalData, setProgressModalData] = useState<any>(null);

  // 🌟 [핵심 수정] 권한 체크 로직 보강
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isTeacherMode = role === 'TEACHER';

      // 강사 모드가 아닐 때만 텍스트 기반 관리자 권한을 인정합니다.
      const isGodMode = !isTeacherMode && (
        role === 'SUPER_ADMIN' || role === 'ADMIN' || 
        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장')
      );
      
      if (isGodMode) {
        setIsAuthorized(true);
        setCanDeleteBook(true); 
        setCanViewAllClasses(true);
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

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/lesson"))) {
        alert("⛔ 교재 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        if (data.allowed_menus.includes('action_delete_book')) setCanDeleteBook(true);
        if (data.allowed_menus.includes('action_view_all_classes')) setCanViewAllClasses(true); 
      }
    };

    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      fetchMasterBooks();
      fetchClasses();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (selectedClass) {
      fetchClassAssignedBooks(selectedClass);
      fetchAttendanceAlerts(selectedClass.class_id);
    } else {
      setAttendanceAlerts([]);
    }
  }, [selectedClass]);

  const fetchAttendanceAlerts = async (classId: string) => {
    try {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      const mondayStr = monday.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('attendance')
        .select('attendance_date, status, student(name)')
        .eq('class_id', classId)
        .in('status', ['지각', '결석'])
        .gte('attendance_date', mondayStr)
        .order('attendance_date', { ascending: false });

      if (error) throw error;
      setAttendanceAlerts(data || []);
    } catch (e) {
      console.error("출결 알림 로드 실패:", e);
    }
  };

  const fetchMasterBooks = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : tenantId;
    
    if (!validTenantId) {
      setMasterBooks([]);
      return;
    }

    const { data, error } = await supabase
      .from("textbook")
      .select("*")
      .or(`tenant_id.eq.${validTenantId},tenant_id.is.null`)
      .order("created_at", { ascending: false });
      
    if (error) console.error("교재 로드 에러:", error);
    setMasterBooks(data || []);
  };

  const createDummyBook = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : tenantId;

    if (!validTenantId) return alert("소속 지점 정보가 없어 교재를 생성할 수 없습니다.");

    const bookName = prompt("새로운 마스터 교재 이름을 입력하세요:\n(예: 개념원리 중1-1)");
    if (!bookName) return;
    try {
      const { error } = await supabase.from("textbook").insert({ 
        title: bookName, 
        book_type: "주교재", 
        target_sessions: 12,
        tenant_id: validTenantId 
      });
      if (error) throw error;
      alert(`[${bookName}] 교재가 생성되었습니다.`);
      fetchMasterBooks();
    } catch (e: any) {
      alert("교재 생성 실패: " + e.message);
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
      if (selectedClass) fetchClassAssignedBooks(selectedClass);
    } catch (e) { alert("삭제 실패"); }
  };

  // 🌟 [핵심 보강] 목록 조회 시에도 강사 모드일 경우 권한 강제 축소
  const fetchClasses = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : tenantId;
    
    if (!validTenantId) {
      setClasses([]);
      return;
    }

    const isTeacherMode = role === 'TEACHER';

    const isAdminLike = !isTeacherMode && (
      ["ADMIN", "MANAGER", "PRINCIPAL", "SUPER_ADMIN", "VICE_ADMIN"].includes(role.toUpperCase()) || 
      pos.includes("원장") || pos.includes("실장") || pos.includes("최고관리자") || pos.includes("부원장") || pos.includes("대장")
    );

    let query = supabase
      .from("class")
      .select("*, instructor(name), enrollment(student_id, student(name, status)), class_schedule(*)")
      .eq("tenant_id", validTenantId)
      .order("name");
    
    // 권한이 없으면 자신의 반만 조회하도록 쿼리 필터링
    if (!isAdminLike && !canViewAllClasses && instId) {
      query = query.eq("instructor_id", instId);
    }

    const { data } = await query;
    setClasses(data || []);
  };

  const fetchClassAssignedBooks = async (cls: any) => {
    try {
      const classId = cls.class_id;
      
      const { data } = await supabase.from("class_textbook").select("*, textbook(*)").eq("class_id", classId).order("start_date", { ascending: true });
      if (!data || data.length === 0) {
        setAssignedBooks([]);
        return;
      }

      const currentClassStudents: StudentBasicInfo[] = (cls.enrollment || [])
        .filter((e: any) => unwrap(e.student)?.status === '재원')
        .map((e: any) => ({
            id: e.student_id,
            name: unwrap(e.student)?.name || '알수없음'
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      const assignedBookIds = data.map(cb => cb.book_id);
      
      const { data: qData } = await supabase.from("textbook_question").select("tq_id, book_id, page_number, question_number").in("book_id", assignedBookIds);
      const questionsData = qData || [];

      const bookPagesMap: Record<string, number[]> = {};
      const bookPageTqsMap: Record<string, Record<number, number[]>> = {};
      const groupedQsMap: Record<string, Record<number, any[]>> = {};

      assignedBookIds.forEach(bId => { 
        bookPagesMap[bId] = [];
        bookPageTqsMap[bId] = {};
        groupedQsMap[bId] = {};
      });

      questionsData.forEach(q => {
        const pNum = Number(q.page_number) || 0;
        if (!bookPageTqsMap[q.book_id][pNum]) {
          bookPageTqsMap[q.book_id][pNum] = [];
          bookPagesMap[q.book_id].push(pNum);
          groupedQsMap[q.book_id][pNum] = [];
        }
        bookPageTqsMap[q.book_id][pNum].push(q.tq_id);
        groupedQsMap[q.book_id][pNum].push(q); 
      });

      assignedBookIds.forEach(bId => {
        bookPagesMap[bId].sort((a, b) => a - b);
      });

      const studentDoneTqs: Record<string, Record<string, Set<number>>> = {};
      assignedBookIds.forEach(bId => {
        studentDoneTqs[bId] = {};
        currentClassStudents.forEach((stu: StudentBasicInfo) => {
          studentDoneTqs[bId][stu.id] = new Set();
        });
      });

      const globalStatusMap: Record<string, string> = {};

      const { data: assignments } = await supabase.from("homework_assignment")
        .select("book_id, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids)")
        .eq("class_id", classId)
        .in("book_id", assignedBookIds);

      assignments?.forEach(hw => {
        const bId = hw.book_id;
        if (!bId) return;

        const targetQs = safeParseIds(hw.target_questions);
        const isClassWide = !hw.target_student_id;
        const targetStudentIds = isClassWide ? currentClassStudents.map(s => s.id) : [hw.target_student_id];

        targetStudentIds.forEach((sId: string) => {
          if (studentDoneTqs[bId][sId]) {
            targetQs.forEach(tqId => {
              studentDoneTqs[bId][sId].add(tqId);
              globalStatusMap[`${classId}_${tqId}_${sId}`] = 'homework'; 
            });
          }
        });

        hw.student_homework_result?.forEach((res: any) => {
          const sId = res.student_id;
          const completedQs = safeParseIds(res.completed_tq_ids);
          
          if (studentDoneTqs[bId][sId]) {
            completedQs.forEach(tqId => {
              studentDoneTqs[bId][sId].add(tqId);
              globalStatusMap[`${classId}_${tqId}_${sId}`] = 'done'; 
            });
          }
        });
      });

      const booksWithStats = data.map(cb => {
        const bId = cb.book_id;
        const totalPages = bookPagesMap[bId] || [];
        const totalPagesCount = totalPages.length;

        const individualStats: IndividualStat[] = currentClassStudents.map((stu: StudentBasicInfo) => {
           const pageStatuses: Record<number, 'done' | 'homework' | 'none'> = {};
           let donePagesCount = 0;

           totalPages.forEach(p => {
             const tqsOnPage = bookPageTqsMap[bId][p] || [];
             let doneCount = 0;
             let hwCount = 0;

             tqsOnPage.forEach(tqId => {
               const st = globalStatusMap[`${classId}_${tqId}_${stu.id}`];
               if (st === 'done') doneCount++;
               else if (st === 'homework') hwCount++;
             });

             if (tqsOnPage.length > 0 && doneCount === tqsOnPage.length) {
               pageStatuses[p] = 'done';
               donePagesCount++;
             } else if (doneCount > 0 || hwCount > 0) {
               pageStatuses[p] = 'homework';
             } else {
               pageStatuses[p] = 'none';
             }
           });

           const stuPercent = totalPagesCount > 0 ? Math.min(100, Math.round((donePagesCount / totalPagesCount) * 100)) : 0;
           
           return {
             student_id: stu.id,
             name: stu.name,
             donePagesCount,
             percent: stuPercent,
             pageStatuses
           };
        });

        const classPageStatuses: Record<number, 'done' | 'homework' | 'none'> = {};
        let classDonePagesCount = 0;

        if (currentClassStudents.length > 0) {
            totalPages.forEach(p => {
               let allDone = true;
               let anyHwOrPartialDone = false;
               
               currentClassStudents.forEach(stu => {
                  const st = individualStats.find(s => s.student_id === stu.id)?.pageStatuses[p];
                  if (st !== 'done') allDone = false;
                  if (st === 'done' || st === 'homework') anyHwOrPartialDone = true;
               });
               
               if (allDone) {
                  classPageStatuses[p] = 'done';
                  classDonePagesCount++;
               } else if (anyHwOrPartialDone) {
                  classPageStatuses[p] = 'homework';
               } else {
                  classPageStatuses[p] = 'none';
               }
            });
        }

        const classPercent = totalPagesCount > 0 ? Math.min(100, Math.round((classDonePagesCount / totalPagesCount) * 100)) : 0;

        return {
          ...cb,
          stats: {
            bookPages: totalPages,
            maxPageCount: totalPagesCount,
            classPageStatuses,
            classDonePagesCount,
            percent: classPercent,
            individualStats,
            groupedQs: groupedQsMap[bId],
            statusMap: globalStatusMap 
          }
        };
      });

      setAssignedBooks(booksWithStats);
    } catch (e) { console.error("진도율 계산 에러:", e); }
  };

  const deleteClassTextbook = async (mappingId: string) => {
    if (!confirm("이 교재 배정을 취소하시겠습니까? (해당 반의 진도 기록 삭제)")) return;
    try {
      await supabase.from("class_textbook").delete().eq("class_textbook_id", mappingId);
      fetchClassAssignedBooks(selectedClass);
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

  const renderPageBlocks = (bookPages: number[], pageStatuses: Record<number, 'done'|'homework'|'none'>, type: 'class'|'student') => {
    if (!bookPages || bookPages.length === 0) return <span className="text-[10px] font-bold text-slate-400">교재 데이터 없음</span>;
    
    return (
      <div className="flex flex-wrap gap-[3px] items-center">
        {bookPages.map(p => {
          const status = pageStatuses[p] || 'none';
          
          let bgColor = 'bg-slate-200'; // none
          let title = `${p}p 대기`;

          if (status === 'done') {
             bgColor = type === 'class' ? 'bg-[#002864]' : 'bg-emerald-500';
             title = `${p}p 완료`;
          } else if (status === 'homework') {
             bgColor = 'bg-amber-400';
             title = `${p}p 과제 진행중`;
          }

          return (
            <div 
              key={p} 
              title={title} 
              className={`w-[6px] h-[14px] rounded-[1.5px] ${bgColor} transition-colors shadow-sm`} 
            />
          );
        })}
      </div>
    );
  };

  const openProgressModal = (cb: any) => {
    if (!selectedClass) return;
    
    const currentClassStudents = (selectedClass.enrollment || [])
      .filter((e: any) => unwrap(e.student)?.status === '재원')
      .map((e: any) => ({
        id: e.student_id,
        name: unwrap(e.student)?.name || '알수없음'
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const tb = unwrap(cb.textbook);
    
    setProgressModalData({
      bookId: cb.book_id,
      classId: selectedClass.class_id,
      students: currentClassStudents,
      bookTitle: tb?.title || '교재',
      pages: cb.stats.bookPages,
      groupedQs: cb.stats.groupedQs,
      statusMap: cb.stats.statusMap
    });
  };

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  const currentClassStudentCount = selectedClass ? new Set((selectedClass.enrollment || []).filter((e:any) => unwrap(e.student)?.status === '재원').map((e: any) => e.student_id)).size : 0;

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-5 overflow-hidden relative font-pretendard">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">📚 전체 교재 및 배정 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학원의 마스터 교재를 등록 및 관리하고, 각 수강반에 교재를 배정하여 진도율을 추적합니다.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-5 overflow-hidden">
        
        {/* ==============================================
            1열: 마스터 교재
            ============================================== */}
        <div className="w-[340px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 relative z-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] overflow-hidden transition-all">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[13px] font-extrabold text-[#002864] flex items-center gap-1.5">
                <span>📚</span> 전체 마스터 교재
              </h3>
              <button onClick={createDummyBook} className="bg-[#002864] hover:bg-blue-900 text-white px-2.5 py-1.5 rounded-md font-bold shadow-sm transition-colors flex items-center gap-1 text-[11px]">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                새 교재 등록
              </button>
            </div>
            <div className="flex gap-2">
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-2 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#002864] bg-white shadow-sm shrink-0 w-24">
                <option value="all">전체 구분</option>
                <option value="주교재">주교재</option>
                <option value="부교재">부교재</option>
                <option value="연산교재">연산교재</option>
                <option value="워크북">워크북</option>
              </select>
              <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="교재명 검색..." className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#002864] shadow-sm font-medium" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 bg-slate-50/50">
            {filteredMasterBooks.length === 0 ? (
              <div className="text-center py-10 text-slate-400 font-bold text-sm">등록된 교재가 없습니다.</div>
            ) : (
              filteredMasterBooks.map(b => {
                let badgeClass = "bg-blue-100 text-blue-700 border-blue-200";
                if (b.book_type === "부교재") badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
                else if (b.book_type === "연산교재") badgeClass = "bg-purple-100 text-purple-700 border-purple-200";
                else if (b.book_type === "워크북") badgeClass = "bg-amber-100 text-amber-700 border-amber-200";

                return (
                  <div key={b.book_id} draggable onDragStart={(e) => handleDragStart(e, b.book_id)} className="bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-grab flex justify-between items-center group relative hover:border-[#002864]">
                    <div className="flex-1 pr-3 pointer-events-none min-w-0">
                      <span className={`${badgeClass} px-1.5 py-0.5 border rounded text-[9px] font-extrabold mb-1.5 inline-block shadow-sm`}>{b.book_type}</span>
                      <div className="font-extrabold text-slate-800 text-[13px] leading-snug truncate">{b.title}</div>
                      <div className="text-[10px] font-bold text-slate-400 mt-1">{b.target_sessions}회차 분량</div>
                    </div>
                    <div className="flex flex-col gap-1.5 z-10 shrink-0 w-[44px]">
                      <button onClick={() => {
                        if(!selectedClass) return alert("우측에서 배정할 반을 먼저 선택해주세요.");
                        const today = new Date().toISOString().split("T")[0];
                        let nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 2);
                        setAssignModalData({ book_id: b.book_id, status: "진행중", start_date: today, target_end_date: nextMonth.toISOString().split("T")[0] });
                        setIsAssignModalOpen(true);
                      }} className="w-full py-1.5 bg-[#002864] text-white rounded text-[10px] font-bold transition-colors shadow-sm text-center hover:bg-blue-900">배정</button>
                      <button onClick={() => { setEditModalData(b); setIsEditModalOpen(true); }} className="w-full py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[9px] font-bold transition-colors shadow-sm border border-slate-200">수정</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ==============================================
            2열: 교재 배정 및 진도 현황 (중앙) 
            ============================================== */}
        <div className="flex-1 flex flex-col min-w-0 bg-white rounded-xl border border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden transition-all">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0 z-10">
            <h2 className="text-[15px] font-black text-slate-800 flex items-center gap-2">
              {selectedClass ? (
                <><span className="text-[#002864]">📖</span> <span className="text-[#002864]">{selectedClass.name}</span> 교재 배정 현황</>
              ) : (
                <><span className="text-slate-400">📋</span> 전체 수강반 목록</>
              )}
            </h2>
            <div className="flex items-center h-8">
              {selectedClass && (
                <button onClick={() => setSelectedClass(null)} className="h-full px-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-[11px] font-extrabold transition-colors shadow-sm whitespace-nowrap">
                  반 목록으로 ↻
                </button>
              )}
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
                          const studentCount = new Set((c.enrollment || []).filter((e:any) => unwrap(e.student)?.status === '재원').map((e: any) => e.student_id)).size;
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
                
                {assignedBooks.length > 0 && (
                  <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm w-fit mb-2">
                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-[#002864] inline-block shadow-sm"></span>반 완료</span>
                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-emerald-500 inline-block shadow-sm"></span>개인 완료</span>
                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-amber-400 inline-block shadow-sm"></span>과제 배부됨</span>
                  </div>
                )}

                {assignedBooks.length === 0 ? (
                  <div className={`text-center py-20 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl ${isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"} shadow-sm transition-colors pointer-events-none`}>
                    <span className="text-5xl mb-4 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                    <span className="text-slate-600 font-bold text-lg mb-1">이 반에 배정된 교재가 없습니다.</span>
                    <span className="text-slate-400 text-sm font-medium">좌측 마스터 교재를 드래그하여 이곳에 놓아주세요.</span>
                  </div>
                ) : (
                  <>
                    {assignedBooks.map(cb => {
                      const tb = unwrap(cb.textbook);
                      if (!tb) return null;

                      let badgeClass = "bg-slate-100 text-slate-600";
                      if (cb.status === "진행중") badgeClass = "bg-blue-100 text-blue-700 border-blue-200";
                      else if (cb.status === "완료") badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";

                      let bookBadgeClass = "bg-slate-50 text-slate-500 border-slate-200";
                      if (tb.book_type === "주교재") bookBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                      else if (tb.book_type === "부교재") bookBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                      else if (tb.book_type === "연산교재") bookBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                      else if (tb.book_type === "워크북") bookBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";

                      const sDate = cb.start_date ? cb.start_date.substring(5).replace("-","/") : "-";
                      const eDate = cb.target_end_date ? cb.target_end_date.substring(5).replace("-","/") : "-";
                      
                      const stats = cb.stats;
                      const { maxPageCount, classPageStatuses, classDonePagesCount, percent, individualStats, bookPages } = stats;

                      return (
                        <div key={cb.class_textbook_id} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                          <div className="flex justify-between items-start mb-3 relative z-10">
                            <div>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`${badgeClass} px-2 py-0.5 rounded text-[10px] font-extrabold border shadow-sm`}>{cb.status}</span>
                                <span className={`${bookBadgeClass} px-1.5 py-0.5 rounded text-[10px] font-extrabold border shadow-sm`}>{tb.book_type}</span>
                              </div>
                              <div className="font-black text-slate-800 text-[16px] tracking-tight">{tb.title}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] font-bold text-slate-500 bg-slate-50 px-2.5 py-1 rounded border border-slate-100 shadow-sm">일정: {sDate} ~ {eDate}</div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-5 mb-2 relative z-10">
                            <div 
                              className="flex-1 cursor-pointer hover:bg-slate-100 p-2 -ml-2 rounded-lg transition-colors border border-transparent hover:border-slate-200 group relative"
                              onClick={() => openProgressModal(cb)}
                              title="클릭하여 상세 매트릭스 뷰 열기"
                            >
                               {renderPageBlocks(bookPages, classPageStatuses, 'class')}
                               <span className="absolute -top-6 left-2 text-[10px] font-bold text-blue-500 bg-white border border-blue-200 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm whitespace-nowrap z-20">매트릭스 뷰 🔍</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-[16px] font-black text-[#002864] w-12 text-right tracking-tighter">{percent}%</div>
                              <div className="text-[11px] font-bold text-slate-400 w-16 text-right tabular-nums">{classDonePagesCount} / {maxPageCount}p</div>
                            </div>
                          </div>

                          {individualStats && individualStats.length > 0 && (
                            <div className="mt-5 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm relative z-10">
                              <div className="text-[11px] font-extrabold text-slate-600 p-2.5 px-3 flex items-center justify-between border-b border-slate-200 bg-white">
                                <span className="flex items-center gap-1.5"><span>👨‍🎓</span> 학생별 상세 진도율 (전체 보기)</span>
                                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">실시간 연동</span>
                              </div>
                              <div className="p-3 pt-1 flex flex-col gap-2 bg-slate-50/50">
                                {individualStats.map((stat: IndividualStat) => {
                                  const doneCnt = stat.donePagesCount;
                                  return (
                                    <div key={stat.student_id} className="flex items-center gap-3 bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm hover:border-blue-200 transition-colors">
                                      <span className="w-14 text-[12px] font-black text-slate-700 truncate">{stat.name}</span>
                                      <div 
                                        className="flex-1 flex overflow-hidden cursor-pointer hover:opacity-70 transition-opacity" 
                                        onClick={() => openProgressModal(cb)}
                                        title="클릭하여 상세 뷰 보기"
                                      >
                                        {renderPageBlocks(bookPages, stat.pageStatuses, 'student')}
                                      </div>
                                      <div className="w-16 flex justify-end items-center gap-1.5 shrink-0">
                                        <span className="text-[11px] font-black text-slate-700 tabular-nums">{stat.percent}%</span>
                                        <span className="text-[10px] font-bold text-slate-400 w-8 text-right tabular-nums">{doneCnt}p</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          
                          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-3 relative z-10">
                            <button onClick={() => window.location.href = `/progress?class_id=${selectedClass.class_id}&book_id=${cb.book_id}`} className="px-4 py-2 bg-[#002864] text-white hover:bg-blue-900 rounded-lg font-black text-xs shadow-sm transition-colors border flex items-center gap-1.5">
                              진도/과제 관리로 이동 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                            <button onClick={() => deleteClassTextbook(cb.class_textbook_id)} className="ml-auto text-[11px] font-bold text-rose-400 hover:text-rose-600 underline">배정 취소</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className={`mt-6 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500 font-bold ${isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"} flex flex-col items-center justify-center transition-colors shadow-sm pointer-events-none`}>
                      <span className="text-3xl mb-2 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                      좌측 마스터 교재를 이 영역으로 드래그하여 배정하세요.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ==============================================
            3열: 선생님을 위한 [클래스 인사이트] (우측 사이드바) 
            ============================================== */}
        {selectedClass && (
          <div className="w-[300px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 shadow-[0_8px_30px_rgba(0,0,0,0.04)] overflow-hidden z-10 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
               <h3 className="text-[13px] font-extrabold text-[#002864] flex items-center gap-1.5">
                 <span>💡</span> 클래스 인사이트
               </h3>
               <p className="text-[10px] font-bold text-slate-400 mt-1">선택된 수강반의 핵심 정보를 요약합니다.</p>
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-5 bg-slate-50/50">
               
               {/* 1. 수강반 요약 정보 */}
               <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2.5">
                 <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                   <span className="text-[11px] font-bold text-slate-500">담당 강사</span>
                   <span className="text-xs font-black text-slate-800">{selectedClass.instructor?.name || '미배정'}</span>
                 </div>
                 <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                   <span className="text-[11px] font-bold text-slate-500">총 수강 인원</span>
                   <span className="text-xs font-black text-sky-600">{currentClassStudentCount}명</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-[11px] font-bold text-slate-500">대상 학년</span>
                   <span className="text-xs font-black text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{selectedClass.target_grade || '무학년'}</span>
                 </div>
               </div>

               {/* 2. 요주의 학생 알림 */}
               <div className="flex flex-col gap-2">
                 <span className="text-[11px] font-extrabold text-rose-600 flex items-center gap-1">
                   <span>🚨</span> 요주의 학생 알림
                 </span>
                 <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex flex-col gap-2 shadow-sm">
                   <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-rose-100">
                     <span className="text-[10px] font-bold text-slate-600">어제 과제 미제출</span>
                     <span className="text-[11px] font-black text-rose-600">2명</span>
                   </div>
                   
                   {attendanceAlerts.length === 0 ? (
                      <div className="flex justify-center items-center bg-white p-2 rounded-lg border border-rose-100">
                        <span className="text-[10px] font-bold text-slate-400">이번 주 지각/결석 없음</span>
                      </div>
                   ) : (
                     attendanceAlerts.map((alert, idx) => {
                       const stuName = unwrap(alert.student)?.name || '알수없음';
                       let dateStr = '';
                       if (alert.attendance_date) {
                         const parts = alert.attendance_date.split('-');
                         if (parts.length === 3) {
                           dateStr = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                         }
                       }
                       return (
                         <div key={idx} className="flex justify-between items-center bg-white p-2 rounded-lg border border-rose-100">
                           <span className="text-[10px] font-bold text-slate-600 truncate">{stuName} 학생</span>
                           <span className={`text-[10px] font-black ${alert.status === '결석' ? 'text-rose-600' : 'text-amber-600'}`}>{dateStr} {alert.status}</span>
                         </div>
                       );
                     })
                   )}
                   <div className="text-[9px] font-bold text-rose-400 mt-0.5 text-right">* 과제 미제출은 아직 가상 UI입니다.</div>
                 </div>
               </div>

               {/* 3. 퀵 액션 버튼 모음 */}
               <div className="flex flex-col gap-2">
                 <span className="text-[11px] font-extrabold text-slate-700 flex items-center gap-1">
                   <span>⚡</span> 빠른 실행 액션
                 </span>
                 <div className="flex flex-col gap-1.5">
                   <button className="w-full bg-white border border-slate-200 hover:border-[#fef01b] hover:bg-[#fef01b]/10 text-slate-700 p-2.5 rounded-xl text-[11px] font-black transition-colors shadow-sm text-left flex items-center justify-between group">
                     <span>💬 학부모 전체 알림톡 발송</span>
                     <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                   </button>
                   <button className="w-full bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 p-2.5 rounded-xl text-[11px] font-black transition-colors shadow-sm text-left flex items-center justify-between group">
                     <span>🏥 클리닉(보충) 강제 배정</span>
                     <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                   </button>
                   <button className="w-full bg-white border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 p-2.5 rounded-xl text-[11px] font-black transition-colors shadow-sm text-left flex items-center justify-between group">
                     <span>📊 반 전체 성취도 리포트 인쇄</span>
                     <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                   </button>
                 </div>
               </div>

             </div>
          </div>
        )}

      </div>

      <EditBookModal 
        isOpen={isEditModalOpen} 
        bookData={editModalData} 
        onClose={() => setIsEditModalOpen(false)} 
        onSuccess={() => {
          fetchMasterBooks();
          if (selectedClass) fetchClassAssignedBooks(selectedClass);
        }} 
      />

      <AssignBookModal 
        isOpen={isAssignModalOpen} 
        assignData={assignModalData} 
        selectedClass={selectedClass} 
        onClose={() => setIsAssignModalOpen(false)} 
        onSuccess={() => fetchClassAssignedBooks(selectedClass)} 
      />

      {/* 🌟 상세 모달 렌더링 영역 */}
      {progressModalData && (
         <ProgressDetailModal 
            data={progressModalData} 
            onClose={() => setProgressModalData(null)} 
         />
      )}

    </div>
  );
}