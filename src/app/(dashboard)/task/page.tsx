// src/app/(dashboard)/task/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TaskModal from "@/components/task/TaskModal";

export default function TaskBoardPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });
  const [isLoading, setIsLoading] = useState(true);
  const [statsMonth, setStatsMonth] = useState("");
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // 🌟 [추가] 완료된 카드의 확장(펼침) 상태를 관리하는 배열
  const [expandedCardIds, setExpandedCardIds] = useState<string[]>([]);

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = ["SUPER_ADMIN", "ADMIN"].includes(role.toUpperCase()) || 
                        ["최고관리자", "대장", "원장"].some(p => pos.includes(p));
      
      if (isGodMode) {
        setIsAuthorized(true);
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

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/task"))) {
        alert("⛔ 업무 공유 보드에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };

    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      const instId = localStorage.getItem("logica_instructor_id") || "";
      const name = localStorage.getItem("logica_instructor_name") || "관리자";
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      
      const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || 
                      ["최고관리자", "대장", "원장", "실장"].some(p => pos.includes(p));
      
      setCurrentUser({ instId, name, isAdmin });
      const now = new Date();
      setStatsMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
      fetchTasks();

      const tenantId = localStorage.getItem("logica_tenant_id");
      const channel = supabase.channel(`task_board_realtime_${tenantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'instructor_memo' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setTasks(prev => {
              if (prev.find(t => t.memo_id === payload.new.memo_id)) return prev;
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            setTasks(prev => prev.map(t => t.memo_id === payload.new.memo_id ? { ...t, ...payload.new } : t));
          } else if (payload.eventType === 'DELETE') {
            setTasks(prev => prev.filter(t => t.memo_id !== payload.old.memo_id));
          }
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [isAuthorized]);

  const fetchTasks = async () => {
    setIsLoading(true);
    const tenantId = localStorage.getItem("logica_tenant_id");
    
    try {
      let query = supabase.from("instructor_memo").select("*").order("created_at", { ascending: false }).limit(1000);
      
      if (tenantId && tenantId !== 'hq') {
         query = query.eq("tenant_id", tenantId);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error("데이터 조회 오류:", error);
        setTasks([]);
        return;
      }

      setTasks(data || []);
    } catch (e) { 
      console.error(e); 
      setTasks([]);
    } finally { 
      setIsLoading(false); 
    }
  };

  const handleDragStart = (e: React.DragEvent, memoId: string) => {
    e.dataTransfer.setData("memoId", memoId);
    setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDragOverCol(null);
  };

  const handleDragOver = (e: React.DragEvent, colName: string) => {
    e.preventDefault();
    if (dragOverCol !== colName) setDragOverCol(colName);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const memoId = e.dataTransfer.getData("memoId");
    if (!memoId) return;

    const targetTask = tasks.find(t => t.memo_id.toString() === memoId);
    if (!targetTask) return;

    const now = new Date().toISOString();

    setTasks(prev => prev.map(t => t.memo_id.toString() === memoId ? { 
      ...t, 
      status: newStatus,
      updated_at: now,
      last_updater_name: currentUser.name
    } : t));

    try {
      await supabase.from("instructor_memo").update({ 
        status: newStatus,
        updated_at: now,
        last_updater_name: currentUser.name,
        memo_type: targetTask.memo_type
      }).eq("memo_id", memoId);
    } catch (err) {
      alert("상태 변경에 실패했습니다.");
      fetchTasks(); 
    }
  };

  const openModal = (task: any | null = null) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedTask(null);
  };

  // 🌟 [추가] 카드 펼쳐보기/접기 토글 함수
  const toggleCardExpand = (e: React.MouseEvent, memoId: string) => {
    e.stopPropagation(); 
    setExpandedCardIds(prev => 
      prev.includes(memoId) ? prev.filter(id => id !== memoId) : [...prev, memoId]
    );
  };

  const todos = useMemo(() => tasks.filter(t => !t.status || t.status === "할일" || t.status === "대기"), [tasks]);
  const inProgress = useMemo(() => tasks.filter(t => t.status === "진행중"), [tasks]);
  const dones = useMemo(() => tasks.filter(t => t.status === "완료"), [tasks]);

  const statsTasks = useMemo(() => tasks.filter(t => {
    if (!t.created_at || !statsMonth) return false;
    const d = new Date(t.created_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === statsMonth;
  }), [tasks, statsMonth]);

  const statsCounts = useMemo(() => {
    const counts = { "긴급공지": 0, "일반공지": 0, "학생인계": 0, "행정요청": 0 };
    statsTasks.forEach(t => { 
      if (counts[t.memo_type as keyof typeof counts] !== undefined) {
        counts[t.memo_type as keyof typeof counts]++; 
      }
    });
    return counts;
  }, [statsTasks]);

  const archivedDones = useMemo(() => statsTasks.filter(t => t.status === "완료"), [statsTasks]);

  const renderCard = (task: any) => {
    const createdDateStr = new Date(task.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const updatedDateStr = task.updated_at ? new Date(task.updated_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : createdDateStr;
    const updaterName = task.last_updater_name || task.author_name || "알수없음";

    let typeColor = "text-slate-600 bg-slate-100 border-slate-200";
    if (task.memo_type === "긴급공지") typeColor = "text-rose-600 bg-rose-50 border-rose-200";
    else if (task.memo_type === "학생인계") typeColor = "text-blue-600 bg-blue-50 border-blue-200";
    else if (task.memo_type === "일반공지") typeColor = "text-emerald-600 bg-emerald-50 border-emerald-200";

    const cmts = task.comments || [];
    const canDrag = currentUser.isAdmin || String(task.instructor_id) === String(currentUser.instId);

    // 🌟 [추가] 완료(Done) 상태이고 명시적으로 펼치지 않았다면 접힌 상태(Collapsed)로 처리
    const isDone = task.status === "완료";
    const isExpanded = expandedCardIds.includes(task.memo_id);
    const isCollapsed = isDone && !isExpanded;

    return (
      <div 
        key={task.memo_id} 
        draggable={canDrag} 
        onDragStart={canDrag ? (e) => handleDragStart(e, task.memo_id) : undefined} 
        onDragEnd={canDrag ? handleDragEnd : undefined}
        onClick={() => openModal(task)} 
        // 🌟 [변경] 접힌 상태 스타일 적용
        className={`task-card p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1.5 transition-all active:scale-95 ${canDrag ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : 'cursor-pointer hover:bg-slate-50 opacity-95'} ${isCollapsed ? 'bg-slate-50/70 opacity-80 hover:opacity-100' : 'bg-white'}`}
      >
        <div className="flex justify-between items-start mb-1">
          <span className={`text-[10px] font-black ${typeColor} px-2 py-0.5 rounded shadow-sm border`}>{task.memo_type}</span>
          {isCollapsed && <span className="text-[9px] font-bold text-slate-400">{updatedDateStr}</span>}
        </div>
        
        {/* 🌟 [변경] 접힌 상태에서는 1줄(line-clamp-1)만 노출되도록 분기 */}
        <div className={`text-[13px] font-bold text-slate-700 whitespace-pre-wrap leading-relaxed break-keep ${isCollapsed ? 'line-clamp-1 px-1 text-xs text-slate-500' : 'line-clamp-3'}`}>
          {task.content}
        </div>

        {/* 🌟 상세 내용은 펼쳐졌을 때만 렌더링 */}
        {!isCollapsed && (
          <>
            {cmts.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
                {cmts.slice(-2).map((c: any) => (
                  <div key={c.id} className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-100 text-slate-600 truncate">
                    <span className="font-bold text-slate-500">{c.authorName}:</span> {c.text}
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col mt-2 pt-2 border-t border-slate-100 gap-1.5">
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-slate-500">최종 수정: {updaterName}</span>
                <span className="text-slate-400">{updatedDateStr}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-blue-500">작성: {task.author_name}</span>
                <span className="text-slate-400">{createdDateStr}</span>
              </div>
            </div>
          </>
        )}

        {/* 🌟 완료(Done) 상태의 카드에만 펼치기/접기 버튼 노출 */}
        {isDone && (
          <div className={`pt-2 flex justify-center ${isCollapsed ? 'mt-0' : 'border-t border-slate-100 mt-1'}`}>
            <button
              onClick={(e) => toggleCardExpand(e, task.memo_id)}
              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 px-3 py-1 rounded hover:bg-slate-200 transition-colors"
            >
              {isExpanded ? "▲ 요약 보기" : "▼ 상세 보기"}
            </button>
          </div>
        )}
      </div>
    );
  };

  if (isAuthorized === null || isLoading) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-500 font-bold text-sm">업무 보드 데이터를 불러오는 중입니다...</span>
        </div>
      </div>
    );
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📌 업무 공유 보드</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">드래그 앤 드롭으로 진행 상태를 변경하고, 업무 카드를 클릭하여 세부 내용 확인 및 소통을 진행하세요.</p>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden pb-2">
        <div className="flex-1 min-w-[250px] bg-slate-100/50 border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-slate-100 border-b border-slate-200 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-slate-700">📑 할 일 (To-Do)</h3>
            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full font-bold">{todos.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "할일" ? "bg-slate-200 border-2 border-dashed border-slate-400" : ""}`}
            onDragOver={(e) => handleDragOver(e, "할일")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "할일")}
          >
            {todos.map(renderCard)}
          </div>
        </div>

        <div className="flex-1 min-w-[250px] bg-blue-50/30 border border-blue-100 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-blue-50 border-b border-blue-100 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-blue-700">🚀 진행 중 (In Progress)</h3>
            <span className="bg-blue-200 text-blue-700 text-xs px-2 py-0.5 rounded-full font-bold">{inProgress.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "진행중" ? "bg-blue-100/50 border-2 border-dashed border-blue-400" : ""}`}
            onDragOver={(e) => handleDragOver(e, "진행중")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "진행중")}
          >
            {inProgress.map(renderCard)}
          </div>
        </div>

        <div className="flex-1 min-w-[250px] bg-emerald-50/30 border border-emerald-100 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-emerald-50 border-b border-emerald-100 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-emerald-700">✅ 완료 (Done)</h3>
            <span className="bg-emerald-200 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-bold">{dones.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "완료" ? "bg-emerald-100/50 border-2 border-dashed border-emerald-400" : ""}`}
            onDragOver={(e) => handleDragOver(e, "완료")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "완료")}
          >
            {dones.map(renderCard)}
          </div>
        </div>

        <div className="w-[300px] shrink-0 flex flex-col gap-4 overflow-hidden">
          <button onClick={() => openModal()} className="w-full bg-[#002864] hover:bg-blue-900 text-white px-5 py-3.5 rounded-xl font-extrabold shadow-sm transition-colors flex items-center justify-center gap-2 shrink-0 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            새 업무 공유 작성하기
          </button>

          <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm min-h-0">
            <div className="p-4 bg-slate-800 text-white shrink-0 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-black text-sm">📊 분류별 통계 및 보관함</h3>
            </div>
            <div className="p-3 border-b border-slate-100 bg-slate-50 shrink-0">
              <input type="month" value={statsMonth} onChange={(e) => setStatsMonth(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-[#002864] shadow-sm cursor-pointer" />
            </div>
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                <div className="bg-rose-50 p-2 rounded border border-rose-100 flex justify-between shadow-sm"><span className="text-rose-600">긴급공지</span><span>{statsCounts["긴급공지"] || 0}건</span></div>
                <div className="bg-emerald-50 p-2 rounded border border-emerald-100 flex justify-between shadow-sm"><span className="text-emerald-600">일반공지</span><span>{statsCounts["일반공지"] || 0}건</span></div>
                <div className="bg-blue-50 p-2 rounded border border-blue-100 flex justify-between shadow-sm"><span className="text-blue-600">학생인계</span><span>{statsCounts["학생인계"] || 0}건</span></div>
                <div className="bg-purple-50 p-2 rounded border border-purple-100 flex justify-between shadow-sm"><span className="text-purple-600">행정요청</span><span>{statsCounts["행정요청"] || 0}건</span></div>
              </div>
            </div>
            <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 shrink-0">
              <span className="text-xs font-bold text-slate-500">해당 월 완료된 업무 목록</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-3 bg-slate-50/50 space-y-2">
              {archivedDones.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-bold text-xs">해당 월에 완료된<br/>업무 내역이 없습니다.</div>
              ) : (
                archivedDones.map(t => {
                  const dateStr = new Date(t.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
                  let typeColor = "text-slate-600 bg-slate-200 border-slate-300";
                  if (t.memo_type === "긴급공지") typeColor = "text-rose-600 bg-rose-100 border-rose-200";
                  else if (t.memo_type === "학생인계") typeColor = "text-blue-600 bg-blue-100 border-blue-200";
                  else if (t.memo_type === "일반공지") typeColor = "text-emerald-600 bg-emerald-100 border-emerald-200";

                  return (
                    <div key={t.memo_id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-slate-400 transition-colors" onClick={() => openModal(t)}>
                      <div className="flex justify-between items-start mb-2">
                        <span className={`text-[9px] font-black ${typeColor} px-1.5 py-0.5 rounded border shadow-sm`}>{t.memo_type}</span>
                        <span className="text-[10px] font-bold text-slate-400">{dateStr}</span>
                      </div>
                      <div className="text-xs font-bold text-slate-700 leading-snug line-clamp-2">{t.content}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <TaskModal isOpen={isModalOpen} task={selectedTask} currentUser={currentUser} onClose={closeModal} onSuccess={fetchTasks} />
    </div>
  );
}