// src/app/(dashboard)/class/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ClassEditModal from "@/components/class/ClassEditModal";

const DAYS = ['월', '화', '수', '목', '금', '토'];

const parseTime = (t: string) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h + (m / 60);
};

const INSTRUCTOR_COLORS = [
  'bg-red-100 border-red-300 text-red-900',
  'bg-blue-100 border-blue-300 text-blue-900',
  'bg-emerald-100 border-emerald-300 text-emerald-900',
  'bg-orange-100 border-orange-300 text-orange-900',
  'bg-violet-100 border-violet-300 text-violet-900',
  'bg-cyan-100 border-cyan-300 text-cyan-900',
  'bg-amber-100 border-amber-300 text-amber-900',
  'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900',
  'bg-lime-100 border-lime-300 text-lime-900',
  'bg-indigo-100 border-indigo-300 text-indigo-900',
];

const getPositionPriority = (pos: string) => {
  if (!pos) return 99;
  if (pos.includes('원장') && !pos.includes('부원장')) return 1;
  if (pos.includes('부원장')) return 2;
  if (pos.includes('전임')) return 3;
  if (pos.includes('파트')) return 4;
  return 5;
};

export default function ClassPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [classes, setClasses] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });

  const [viewMode, setViewMode] = useState<'timetable' | 'list'>('timetable');
  const [ttFilter, setTtFilter] = useState<'ALL' | 'REGULAR' | 'SPECIAL'>('ALL');
  const [showPlanned, setShowPlanned] = useState(false);

  const [filterLevel, setFilterLevel] = useState("all");
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterInstructor, setFilterInstructor] = useState("all");

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ isDown: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const isDraggingFlag = useRef(false);

  useEffect(() => {
    if (viewMode === 'timetable') {
      const scrollToBottom = () => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      };
      setTimeout(scrollToBottom, 50);
      setTimeout(scrollToBottom, 300);
    }
  }, [viewMode, classes, ttFilter, showPlanned]);

  useEffect(() => {
    const checkAccess = async () => {
      const instId = localStorage.getItem("logica_instructor_id") || "";
      const name = localStorage.getItem("logica_instructor_name") || "관리자";
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      const isAdmin = isGodMode || role === 'MANAGER' || role === 'PRINCIPAL' || pos.includes('실장');
      setCurrentUser({ instId, name, isAdmin });

      if (isGodMode) { setIsAuthorized(true); return; }

      if (!tId || !role) { alert("권한 정보가 없습니다."); router.replace("/home"); return; }

      const { data } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).maybeSingle();

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/class"))) {
        alert("⛔ 반 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      fetchInstructors();
      fetchClasses();
      const handleStorageChange = (e: StorageEvent) => { if (e.key === "logica_refresh_signal") fetchClasses(); };
      window.addEventListener("storage", handleStorageChange);
      (window as any).refreshClasses = fetchClasses;
      return () => { window.removeEventListener("storage", handleStorageChange); delete (window as any).refreshClasses; };
    }
  }, [isAuthorized]);

  const fetchInstructors = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    if (!tenantId) { setInstructors([]); return; }
    const { data } = await supabase.from("instructor").select("instructor_id, name, position").eq("status", "재직").eq("tenant_id", tenantId).order('name');
    setInstructors(data || []);
  };

  const fetchClasses = async () => {
    setIsLoading(true);
    const tenantId = localStorage.getItem("logica_tenant_id");
    if (!tenantId) { setClasses([]); setIsLoading(false); return; }
    
    const { data, error } = await supabase
      .from("class")
      .select("*, instructor(name, position), enrollment(student_id, student(name)), class_schedule(*)")
      .eq("tenant_id", tenantId);

    if (!error && data) setClasses(data);
    setIsLoading(false);
  };

  const timetableBlocks = useMemo(() => {
    const blocks: any[] = [];
    classes.forEach(c => {
      const name = c.name || '';
      if (name.includes('(테스트)')) return;

      const status = c.status || '';
      if (status.includes('종료')) return;
      if (!showPlanned && status !== '진행중') return;

      const isRegular = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon'].includes(c.level_name);
      
      if (ttFilter === 'REGULAR' && !isRegular) return;
      if (ttFilter === 'SPECIAL' && isRegular) return;

      c.class_schedule?.forEach((sch: any) => {
        if (!sch.day_of_week || !sch.start_time || sch.day_of_week === '일') return;

        let finalEndTime = sch.end_time;
        if (!finalEndTime) {
          const [h, m] = sch.start_time.split(':').map(Number);
          finalEndTime = `${String((h + 2) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }

        blocks.push({
          classObj: c,
          day: sch.day_of_week,
          start: sch.start_time,
          end: finalEndTime,
          isRegular
        });
      });
    });
    return blocks;
  }, [classes, ttFilter, showPlanned]);

  // 🌟 평일과 토요일을 각각 계산하여 빈 공간(여백)을 날림
  const { wdStartHour, wdRowCount, wdHours, satStartHour, satRowCount, satHours } = useMemo(() => {
    let wdMin = 14;
    let wdMax = 22;
    let satMin = 9;
    let satMax = 18; // 토요일 기본 종료 시간 18시

    timetableBlocks.forEach(b => {
      const sHour = Math.floor(parseTime(b.start));
      const eHour = Math.ceil(parseTime(b.end));

      if (b.day === '토') {
        if (sHour < satMin) satMin = sHour;
        if (eHour > satMax) satMax = eHour;
      } else if (b.day !== '일') {
        if (sHour < wdMin) wdMin = sHour;
        if (eHour > wdMax) wdMax = eHour;
      }
    });

    const wRowCount = Math.max(1, wdMax - wdMin);
    const wHours = Array.from({ length: wRowCount }, (_, i) => wdMin + i);

    const sRowCount = Math.max(1, satMax - satMin);
    const sHours = Array.from({ length: sRowCount }, (_, i) => satMin + i);

    return {
      wdStartHour: wdMin, wdRowCount: wRowCount, wdHours: wHours,
      satStartHour: satMin, satRowCount: sRowCount, satHours: sHours
    };
  }, [timetableBlocks]);

  const activeInstructors = useMemo(() => {
    const names = new Set<string>();
    timetableBlocks.forEach(b => {
      const instName = b.classObj.instructor?.name;
      if (instName && instName !== '미정') names.add(instName);
    });
    return Array.from(names).sort(); 
  }, [timetableBlocks]);

  const filteredClasses = useMemo(() => {
    let result = classes.filter((c) => {
      const status = c.status || '';
      if (status.includes('종료')) return false;
      if (!showPlanned && status !== '진행중') return false;

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
  }, [classes, filterLevel, filterGrade, filterInstructor, showPlanned]);

  const resetFilters = () => { 
    setFilterLevel("all"); setFilterGrade("all"); setFilterInstructor("all"); setShowPlanned(false); 
  };

  const openEditModal = (classItem: any) => { setSelectedClass(classItem); setIsEditModalOpen(true); };
  const closeEditModal = () => { setIsEditModalOpen(false); setSelectedClass(null); };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    dragState.current.isDown = true;
    scrollRef.current.style.cursor = 'grabbing';
    dragState.current.startX = e.pageX - scrollRef.current.offsetLeft;
    dragState.current.startY = e.pageY - scrollRef.current.offsetTop;
    dragState.current.scrollLeft = scrollRef.current.scrollLeft;
    dragState.current.scrollTop = scrollRef.current.scrollTop;
    isDraggingFlag.current = false;
  };
  const handleMouseLeave = () => {
    dragState.current.isDown = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };
  const handleMouseUp = () => {
    dragState.current.isDown = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
    setTimeout(() => { isDraggingFlag.current = false; }, 50);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.isDown || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const y = e.pageY - scrollRef.current.offsetTop;
    const walkX = (x - dragState.current.startX) * 1.5;
    const walkY = (y - dragState.current.startY) * 1.5;
    if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) isDraggingFlag.current = true;
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - walkX;
    scrollRef.current.scrollTop = dragState.current.scrollTop - walkY;
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 overflow-hidden relative print:static print:overflow-visible print:p-0 print:m-0 print:bg-white print:h-auto print:block">
      
      <style dangerouslySetInnerHTML={{__html: `
        :root { --hour-height: 100px; } 
        @media print {
          @page { size: A4 landscape; margin: 5mm; }
          
          body { 
            visibility: hidden !important; 
            background: white !important; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
          }
          
          #printable-timetable, #printable-timetable * { 
            visibility: visible !important; 
          }
          
          html, body, #__next, [data-reactroot] { 
            overflow: visible !important; position: static !important; height: auto !important; 
          }

          #printable-timetable {
             position: absolute !important; 
             top: 15mm !important; 
             left: 0 !important;
             width: 100vw !important; height: auto !important;
             border: none !important; box-shadow: none !important; border-radius: 0 !important; 
             background: white !important; z-index: 9999 !important; margin: 0 !important; padding: 0 !important;
          }
          
          .no-print, .print-hide, .print-hide * { display: none !important; visibility: hidden !important; }
          
          :root { --hour-height: 65px; } 
          
          #printable-timetable .flex-1.flex { display: flex !important; width: 100% !important; }
          #printable-timetable .overflow-auto { overflow: visible !important; height: auto !important; display: block !important; }
          
          .print-time-col { 
            min-width: 46px !important; width: 46px !important; flex: 0 0 46px !important; 
            border-right: 1px solid #cbd5e1 !important; 
          }
          .print-day-col { 
            min-width: 0 !important; flex: 1 1 0% !important; 
            border-right: 1px dashed #cbd5e1 !important; 
          }
          
          .custom-scroll::-webkit-scrollbar { display: none; }
          
          .print-text {
             white-space: nowrap !important;
             overflow: hidden !important;
             text-overflow: clip !important;
             letter-spacing: -1.2px !important;
             width: 100% !important;
          }
          
          .print-box { padding: 2px 1px !important; }
          
          .print-block-title { font-size: 11px !important; font-weight: 900 !important; margin-bottom: 1px !important; line-height: 1.1 !important; }
          .print-block-inst { font-size: 8px !important; font-weight: 700 !important; margin-bottom: 2px !important; line-height: 1.1 !important; }
          
          .print-block-student { gap: 1px !important; } 
          .print-block-student .print-text { 
             font-size: 7.5px !important; 
             font-weight: 600 !important; 
             letter-spacing: -0.8px !important; 
             line-height: 1.15 !important; 
             margin-bottom: 0px !important;
          }
          
          .print-block-time { display: none !important; }
        }
      `}} />

      <div className="flex justify-between items-end shrink-0 mb-4 no-print">
        <div>
          <h2 className="text-xl font-bold text-slate-800">학원 반 통합 관리</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">학원의 전체 수업 시간표와 개설 반 리스트를 통합 관리합니다.</p>
        </div>
      </div>

      {viewMode === 'list' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap mb-4 no-print">
          <span className="font-bold text-slate-600 text-sm mr-2">🔍 반 정렬/필터</span>
          <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="all">모든 레벨</option><option value="Ultimate">Ultimate</option><option value="Master">Master</option>
            <option value="Apex">Apex</option><option value="Titan">Titan</option><option value="Horizon">Horizon</option>
            <option value="특강">특강 (SS, WS)</option><option value="메이크업">메이크업 (MU, LE)</option>
          </select>
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="all">모든 학년</option><option value="초1">초1</option><option value="초2">초2</option><option value="초3">초3</option>
            <option value="초4">초4</option><option value="초5">초5</option><option value="초6">초6</option><option value="중1">중1</option>
            <option value="중2">중2</option><option value="중3">중3</option><option value="특강, 보강">특강, 보강</option>
          </select>
          <select value={filterInstructor} onChange={e => setFilterInstructor(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="all">모든 담당 강사</option>
            {instructors.map(inst => <option key={inst.instructor_id} value={inst.instructor_id}>{inst.name}</option>)}
          </select>
          
          <label className="flex items-center gap-2 cursor-pointer ml-2 border-l border-slate-300 pl-4">
            <input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)} className="w-4 h-4 accent-[#002864] cursor-pointer" />
            <span className="text-sm font-bold text-slate-600">예정된 반 포함</span>
          </label>

          <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1 ml-2">🔄 초기화</button>
          
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setViewMode('timetable')} className="px-4 py-1.5 rounded-md font-black text-[12px] transition-all text-slate-500 hover:text-slate-700 hover:bg-slate-200/50">📅 시간표</button>
              <button onClick={() => setViewMode('list')} className="px-4 py-1.5 rounded-md font-black text-[12px] transition-all bg-white text-[#002864] shadow-sm">📋 리스트</button>
            </div>
            
            <button onClick={() => window.print()} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-[12px] rounded-lg transition-colors border border-slate-300 flex items-center gap-1.5 shadow-sm">
              🖨️ 시간표 인쇄
            </button>
            
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <button onClick={() => window.open('/launch-special', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-indigo-600 text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-indigo-700 transition-colors text-center">특강/메이크업</button>
            <button onClick={() => window.open('/launch-class', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-[#002864] text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors text-center">정규반 개설</button>
          </div>
        </div>
      )}

      {viewMode === 'timetable' && (
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap mb-4 justify-between no-print">
          <div className="flex gap-2 items-center">
            <button onClick={() => setTtFilter('ALL')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${ttFilter === 'ALL' ? 'bg-[#002864] text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>전체 시간표</button>
            <button onClick={() => setTtFilter('REGULAR')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-1.5 ${ttFilter === 'REGULAR' ? 'bg-[#002864] text-white shadow-sm' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}><span className="w-2 h-2 rounded-full bg-blue-500"></span>정규반</button>
            <button onClick={() => setTtFilter('SPECIAL')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-1.5 ${ttFilter === 'SPECIAL' ? 'bg-[#002864] text-white shadow-sm' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}><span className="w-2 h-2 rounded-full bg-amber-500"></span>특강/메이크업반</button>
            
            <label className="flex items-center gap-2 cursor-pointer ml-3 border-l border-slate-300 pl-4 h-8">
              <input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)} className="w-4 h-4 accent-[#002864] cursor-pointer" />
              <span className="text-sm font-bold text-slate-600 hover:text-slate-800 transition-colors">예정된 반 포함</span>
            </label>
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setViewMode('timetable')} className="px-4 py-1.5 rounded-md font-black text-[12px] transition-all bg-white text-[#002864] shadow-sm">📅 시간표</button>
              <button onClick={() => setViewMode('list')} className="px-4 py-1.5 rounded-md font-black text-[12px] transition-all text-slate-500 hover:text-slate-700 hover:bg-slate-200/50">📋 리스트</button>
            </div>
            
            <button onClick={() => window.print()} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-[12px] rounded-lg transition-colors border border-slate-300 flex items-center gap-1.5 shadow-sm">
              🖨️ 시간표 인쇄
            </button>

            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <button onClick={() => window.open('/launch-special', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-indigo-600 text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-indigo-700 transition-colors text-center">특강/메이크업</button>
            <button onClick={() => window.open('/launch-class', '_blank', 'width=950,height=850,top=100,left=100')} className="bg-[#002864] text-white w-36 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors text-center">정규반 개설</button>
          </div>
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0 no-print">
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
                        <td className="py-3 px-4 border-b border-slate-100 font-bold">{c.instructor?.name ? c.instructor.name : '미정'}</td>
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
      ) : (
        <div id="printable-timetable" className="flex-1 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden shadow-sm relative print:absolute print:inset-0 print:border-none print:shadow-none print:rounded-none">
          
          <div className="hidden print:block text-[22px] font-black text-center py-4 text-slate-800 border-b border-slate-300 w-full shrink-0">
             LOGICA 학원 통합 시간표
          </div>

          <div 
            ref={scrollRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeave}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            className="w-full h-full overflow-auto custom-scroll relative bg-slate-50/30 cursor-grab select-none"
          >
            <div className="flex w-full min-w-max min-h-full">
              
              <div className="w-14 shrink-0 border-r border-slate-200 bg-slate-50 z-30 sticky left-0 pointer-events-none print-time-col">
                <div className="h-10 border-b border-slate-200 bg-slate-100 sticky top-0 z-40 flex items-center justify-center font-extrabold text-[11px] text-slate-500 tracking-tighter whitespace-nowrap">
                  평일시간
                </div>
                <div className="relative border-b border-slate-200/60" style={{ height: `calc(var(--hour-height) * ${wdRowCount})` }}>
                  {wdHours.map(h => (
                    <div key={h} className="absolute w-full text-[11px] font-black text-slate-400 text-center" style={{ top: `calc(var(--hour-height) * ${h - wdStartHour})`, transform: 'translateY(-50%)' }}>
                      {h}:00
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex-1 flex w-full">
                {DAYS.map((day, dayIndex) => {
                  const isSaturday = day === '토';
                  const startHour = isSaturday ? satStartHour : wdStartHour;
                  const currentHours = isSaturday ? satHours : wdHours;
                  const currentRowCount = isSaturday ? satRowCount : wdRowCount;

                  const dayBlocks = timetableBlocks.filter(b => b.day === day).sort((a,b) => {
                    const timeDiff = parseTime(a.start) - parseTime(b.start);
                    if (timeDiff !== 0) return timeDiff;
                    return (a.classObj.name || '').localeCompare(b.classObj.name || '');
                  });
                  
                  const blocksByInst = new Map<string, any[]>();
                  const tbdBlocks: any[] = [];

                  dayBlocks.forEach(b => {
                      const instName = (b.classObj.instructor?.name || '미정').trim();
                      if (instName === '미정') {
                          tbdBlocks.push(b);
                      } else {
                          if (!blocksByInst.has(instName)) blocksByInst.set(instName, []);
                          blocksByInst.get(instName)!.push(b);
                      }
                  });

                  const instList = Array.from(blocksByInst.keys()).sort((a, b) => {
                      const instA = instructors.find(i => i.name === a);
                      const instB = instructors.find(i => i.name === b);
                      
                      const posA = instA?.position || blocksByInst.get(a)![0].classObj.instructor?.position || '';
                      const posB = instB?.position || blocksByInst.get(b)![0].classObj.instructor?.position || '';
                      
                      const diff = getPositionPriority(posA) - getPositionPriority(posB);
                      if (diff !== 0) return diff;
                      return a.localeCompare(b);
                  });

                  const columns: any[][] = []; 

                  instList.forEach(instName => {
                      const instBlocks = blocksByInst.get(instName)!.sort((a, b) => parseTime(a.start) - parseTime(b.start));
                      
                      const instCols: any[][] = [];
                      instBlocks.forEach(b => {
                          const s = parseTime(b.start);
                          let placed = false;
                          for (let i = 0; i < instCols.length; i++) {
                              const lastBlock = instCols[i][instCols[i].length - 1];
                              if (parseTime(lastBlock.end) <= s) {
                                  instCols[i].push(b);
                                  placed = true;
                                  break;
                              }
                          }
                          if (!placed) instCols.push([b]);
                      });

                      instCols.forEach(iCol => {
                          let placedGlobal = false;
                          for (let c = 0; c < columns.length; c++) {
                              const canFit = iCol.every(newBlock => {
                                  const ns = parseTime(newBlock.start);
                                  const ne = parseTime(newBlock.end);
                                  return !columns[c].some(existingBlock => {
                                      const es = parseTime(existingBlock.start);
                                      const ee = parseTime(existingBlock.end);
                                      return Math.max(ns, es) < Math.min(ne, ee);
                                  });
                              });

                              if (canFit) {
                                  columns[c].push(...iCol);
                                  columns[c].sort((a, b) => parseTime(a.start) - parseTime(b.start));
                                  placedGlobal = true;
                                  break;
                              }
                          }
                          if (!placedGlobal) {
                              columns.push([...iCol]);
                          }
                      });
                  });

                  tbdBlocks.sort((a,b) => parseTime(a.start) - parseTime(b.start));
                  tbdBlocks.forEach(b => {
                      let placed = false;
                      const ns = parseTime(b.start);
                      const ne = parseTime(b.end);
                      
                      for (let c = 0; c < columns.length; c++) {
                          const overlap = columns[c].some(existingBlock => {
                              const es = parseTime(existingBlock.start);
                              const ee = parseTime(existingBlock.end);
                              return Math.max(ns, es) < Math.min(ne, ee);
                          });
                          if (!overlap) {
                              columns[c].push(b);
                              columns[c].sort((x, y) => parseTime(x.start) - parseTime(y.start));
                              placed = true;
                              break;
                          }
                      }
                      if (!placed) columns.push([b]);
                  });

                  columns.forEach((colBlocks, cIdx) => {
                      colBlocks.forEach(b => {
                          b.colIdx = cIdx;
                      });
                  });
                  
                  const totalCols = Math.max(1, columns.length);
                  const colWidth = 100 / totalCols;
                  const minWidthFinal = Math.max(100, totalCols * 45); 

                  return (
                    <React.Fragment key={day}>
                      {isSaturday && (
                        <div className="w-14 shrink-0 border-l border-r border-slate-300 bg-slate-50 relative pointer-events-none print-time-col">
                          <div className="h-10 border-b border-slate-300 bg-slate-100 sticky top-0 z-20 flex items-center justify-center font-extrabold text-[11px] text-blue-600 tracking-tighter whitespace-nowrap">
                            토요시간
                          </div>
                          <div className="relative border-b border-slate-200/60" style={{ height: `calc(var(--hour-height) * ${satRowCount})` }}>
                            {satHours.map(h => (
                              <div key={`sat-h-${h}`} className="absolute w-full text-[11px] font-black text-blue-500 text-center" style={{ top: `calc(var(--hour-height) * ${h - satStartHour})`, transform: 'translateY(-50%)' }}>
                                {h}:00
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="print-day-col flex-1 border-r border-slate-200 relative shrink-0" style={{ minWidth: `${minWidthFinal}px` }}>
                        <div className={`h-10 border-b border-slate-200 flex items-center justify-center font-black text-[13px] bg-white sticky top-0 z-20 shadow-sm ${isSaturday ? 'text-blue-500' : 'text-slate-600'}`}>
                          {day}요일
                        </div>
                        
                        <div className="relative w-full border-b border-slate-200/60" style={{ height: `calc(var(--hour-height) * ${currentRowCount})` }}>
                          {currentHours.map(h => (
                            <div key={`grid-${h}`} className="absolute w-full border-t border-slate-200/60 pointer-events-none" style={{ top: `calc(var(--hour-height) * ${h - startHour})` }}></div>
                          ))}
                          
                          {columns.flat().map((b, i) => {
                            const s = parseTime(b.start);
                            const e = parseTime(b.end);
                            
                            const students = (b.classObj.enrollment || [])
                              .map((en: any) => Array.isArray(en.student) ? en.student[0]?.name : en.student?.name)
                              .filter(Boolean);
                            
                            const studentCount = students.length;
                            const studentNamesStr = students.join(', ');
                            const instName = b.classObj.instructor?.name ? b.classObj.instructor.name : '미정';
                            
                            const displayClassName = b.classObj.name ? b.classObj.name.substring(0, 3) : '';
                            
                            let colorClass = 'bg-slate-100 border-slate-300 text-slate-700';
                            if (instName !== '미정') {
                              const instIndex = activeInstructors.indexOf(instName);
                              if (instIndex !== -1) {
                                colorClass = INSTRUCTOR_COLORS[instIndex % INSTRUCTOR_COLORS.length];
                              }
                            }
                            
                            return (
                              <div 
                                key={i} 
                                onClick={(e) => {
                                  if (isDraggingFlag.current) {
                                    e.preventDefault(); e.stopPropagation(); return;
                                  }
                                  openEditModal(b.classObj);
                                }}
                                className={`print-box absolute rounded-lg px-1 py-1.5 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.06)] border transition-transform hover:-translate-y-1 hover:shadow-lg hover:z-[60] flex flex-col items-center text-center group ${colorClass} bg-opacity-95 hover:bg-opacity-100`}
                                style={{ 
                                  top: `calc(var(--hour-height) * ${s - startHour})`, 
                                  height: `calc(var(--hour-height) * ${e - s})`, 
                                  left: `${b.colIdx * colWidth}%`, 
                                  width: `${colWidth}%`,
                                  transform: 'scale(0.96)', 
                                  transformOrigin: 'top left'
                                }}
                              >
                                <div className="print-block-title print-text text-[12px] font-extrabold leading-tight w-full tracking-tighter">{displayClassName}</div>
                                
                                <div className="print-block-inst print-text text-[10px] font-bold opacity-90 w-full tracking-tighter">{instName}</div>
                                
                                {students.length > 0 && (
                                  <div className="print-block-student text-[10px] font-semibold leading-tight opacity-75 mt-0.5 w-full flex flex-col items-center overflow-hidden">
                                    {students.map((sName: string, sIdx: number) => (
                                      <div key={sIdx} className="print-text w-full tracking-tighter">{sName}</div>
                                    ))}
                                  </div>
                                )}

                                <div className="print-block-time print-text text-[9px] font-semibold opacity-60 mt-auto w-full tracking-tighter">{b.start.slice(0,5)} ~ {b.end.slice(0,5)}</div>
                                
                                <div className={`print-hide absolute hidden group-hover:flex flex-col top-full mt-2 p-2.5 bg-slate-800 text-white text-xs rounded-lg shadow-2xl z-[100] w-48 pointer-events-none text-left items-start ${dayIndex >= 4 ? 'right-0' : 'left-0'}`}>
                                   <div className="font-extrabold text-blue-200 text-[13px] mb-1.5 leading-tight">{b.classObj.name}</div>
                                   <div className="text-slate-200 mb-0.5 flex justify-between w-full"><span>강사</span> <span className="font-bold text-white">{instName}</span></div>
                                   <div className="text-slate-200 mb-0.5 flex justify-between w-full"><span>대상</span> <span className="font-bold text-white">{b.classObj.target_grade || '-'}</span></div>
                                   <div className="text-slate-200 mb-0.5 flex justify-between w-full"><span>인원</span> <span className="font-bold text-white">{studentCount}명</span></div>
                                   <div className="text-slate-200 mb-1.5 flex justify-between w-full border-b border-slate-600 pb-1.5"><span>상태</span> <span className={`font-bold ${b.classObj.status === '진행중' ? 'text-emerald-300' : 'text-amber-300'}`}>{b.classObj.status || '-'}</span></div>
                                   
                                   {students.length > 0 && (
                                     <div className="text-[10px] leading-relaxed text-slate-300 break-words mt-1 w-full text-left">
                                       {studentNamesStr}
                                     </div>
                                   )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="print-hide no-print">
        <ClassEditModal isOpen={isEditModalOpen} classItem={selectedClass} instructors={instructors} currentUser={currentUser} onClose={closeEditModal} onSuccess={fetchClasses} />
      </div>
    </div>
  );
}