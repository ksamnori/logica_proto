// src/app/(dashboard)/cs/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CSModal from "@/components/cs/CSModal";

export default function CSBoardPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [requests, setRequests] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });
  const [isLoading, setIsLoading] = useState(true);
  const [statsMonth, setStatsMonth] = useState("");
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<any>(null);

  // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 권한부터 즉시 검사합니다.
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
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

      // CS 관리 메뉴 접근 권한이 없다면 쫓아냅니다.
      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/cs"))) {
        alert("⛔ 학부모 요청/CS 페이지에 접근할 권한이 없습니다.");
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
      fetchInitialData(instId, isAdmin);

      const tenantId = localStorage.getItem("logica_tenant_id");
      const channel = supabase.channel(`cs_board_realtime_${tenantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'parent_request_log' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            fetchInitialData(instId, isAdmin);
          } else if (payload.eventType === 'UPDATE') {
            setRequests(prev => prev.map(r => r.request_id === payload.new.request_id ? { ...r, ...payload.new } : r));
          } else if (payload.eventType === 'DELETE') {
            setRequests(prev => prev.filter(r => r.request_id !== payload.old.request_id));
          }
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [isAuthorized]);

  const fetchInitialData = async (instId: string, isAdmin: boolean) => {
    setIsLoading(true);
    const tenantId = localStorage.getItem("logica_tenant_id");

    try {
      let instQuery = supabase.from("instructor").select("instructor_id, name, position").eq("status", "재직");
      let stuQuery = supabase.from("student").select("student_id, name, grade").eq("status", "재원").order("name");
      
      // 🌟 [보안 강화] 내 지점 데이터만 불러오도록 격리
      if (tenantId && tenantId !== 'hq') {
         instQuery = instQuery.eq("tenant_id", tenantId);
         stuQuery = stuQuery.eq("tenant_id", tenantId);
      }

      const [instRes, stuRes] = await Promise.all([instQuery, stuQuery]);
      if (instRes.data) setInstructors(instRes.data);
      if (stuRes.data) setStudents(stuRes.data);

      let query = supabase.from("parent_request_log").select("*, student(name), author:instructor!parent_request_log_author_id_fkey(name)");

      // 🌟 [보안 강화] 내 지점 데이터만 불러오도록 격리
      if (tenantId && tenantId !== 'hq') {
        query = query.eq("tenant_id", tenantId);
      }

      if (!isAdmin) {
        const { data: myClasses } = await supabase.from("class").select("class_id").eq("instructor_id", instId);
        const myClassIds = myClasses ? myClasses.map(c => c.class_id) : [];
        const { data: enrolls } = await supabase.from("enrollment").select("student_id").in("class_id", myClassIds);
        const myStudentIds = enrolls ? Array.from(new Set(enrolls.map(e => e.student_id))) : [];

        let orStr = `processed_instructor_id.eq.${instId},author_id.eq.${instId}`;
        if (myStudentIds.length > 0) orStr += `,student_id.in.(${myStudentIds.join(',')})`;
        query = query.or(orStr);
      }

      const { data } = await query.order("created_at", { ascending: false }).limit(1000);
      
      const filteredRequests = (data || []).filter((req: any) => {
        if (req.is_private) {
          if (isAdmin) return true;
          if (String(req.author_id) === String(instId)) return true;
          if (String(req.processed_instructor_id) === String(instId)) return true;
          return false;
        }
        return true;
      });

      setRequests(filteredRequests);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const handleDragStart = (e: React.DragEvent, reqId: string) => {
    e.dataTransfer.setData("reqId", reqId);
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
    const reqId = e.dataTransfer.getData("reqId");
    if (!reqId) return;

    const now = new Date().toISOString();

    setRequests(prev => prev.map(r => r.request_id.toString() === reqId ? { 
      ...r, 
      status: newStatus,
      updated_at: now,
      last_updater_name: currentUser.name 
    } : r));

    try {
      await supabase.from("parent_request_log").update({ 
        status: newStatus,
        updated_at: now,
        last_updater_name: currentUser.name 
      }).eq("request_id", reqId);
    } catch (err) {
      alert("상태 변경 실패");
      fetchInitialData(currentUser.instId, currentUser.isAdmin); 
    }
  };

  const openModal = (req: any | null = null) => {
    setSelectedReq(req);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedReq(null);
  };

  const waits = useMemo(() => requests.filter(r => !r.status || r.status === "대기"), [requests]);
  const inProgress = useMemo(() => requests.filter(r => r.status === "처리중"), [requests]);
  const dones = useMemo(() => requests.filter(r => r.status === "완료"), [requests]);

  const statsReqs = useMemo(() => requests.filter(r => {
    if (!r.created_at || !statsMonth) return false;
    const d = new Date(r.created_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === statsMonth;
  }), [requests, statsMonth]);

  const statsCounts = useMemo(() => {
    const counts = { "결석/보강": 0, "상담/기타": 0, "수납/행정": 0, "퇴원요청": 0 };
    statsReqs.forEach(r => { if (counts[r.request_type as keyof typeof counts] !== undefined) counts[r.request_type as keyof typeof counts]++; });
    return counts;
  }, [statsReqs]);

  const archivedDones = useMemo(() => statsReqs.filter(r => r.status === "완료"), [statsReqs]);

  const renderCard = (req: any) => {
    const sName = req.student?.name || "알수없음";
    const authorName = req.author?.name || "알수없음";
    const createdDateStr = new Date(req.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const updatedDateStr = req.updated_at ? new Date(req.updated_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : createdDateStr;
    const updaterName = req.last_updater_name || authorName || "알수없음";
    
    let typeColor = "text-slate-600 bg-slate-100 border-slate-200";
    if (req.request_type.includes("결석") || req.request_type.includes("퇴원")) typeColor = "text-rose-600 bg-rose-50 border-rose-200";
    
    let assigneeName = "미지정";
    if (req.processed_instructor_id) {
      const found = instructors.find(i => i.instructor_id === req.processed_instructor_id);
      if (found) assigneeName = found.name;
    }

    const cmts = req.comments || [];
    const canDrag = currentUser.isAdmin || String(req.author_id) === String(currentUser.instId) || String(req.processed_instructor_id) === String(currentUser.instId);

    return (
      <div 
        key={req.request_id} 
        draggable={canDrag} 
        onDragStart={canDrag ? (e) => handleDragStart(e, req.request_id) : undefined} 
        onDragEnd={canDrag ? handleDragEnd : undefined}
        onClick={() => openModal(req)} 
        className={`req-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1.5 transition-all active:scale-95 ${canDrag ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : 'cursor-pointer hover:bg-slate-50 opacity-95'}`}
      >
        <div className="flex justify-between items-start mb-1">
          <div>
            <span className={`text-[10px] font-black ${typeColor} px-2 py-0.5 rounded shadow-sm border`}>{req.request_type}</span>
            {req.is_private && <span className="bg-slate-700 text-white px-1.5 py-0.5 rounded shadow-sm border border-slate-800 ml-1 text-[10px] font-bold">🔒 비공개</span>}
          </div>
        </div>
        <h4 className="font-extrabold text-sm text-[#002864]">{sName} 학생</h4>
        <div className="text-[13px] font-bold text-slate-700 whitespace-pre-wrap leading-relaxed break-keep bg-slate-50 p-2 rounded-lg border border-slate-100 line-clamp-3">
          {req.reason}
        </div>
        {cmts.length > 0 && (
          <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
            {cmts.slice(-2).map((c: any) => (
              <div key={c.id} className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-100 text-slate-600 truncate">
                <span className="font-bold text-slate-500">{c.authorName}:</span> {c.text}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] font-bold text-slate-500 mb-1.5 mt-1">
          담당: <span className={assigneeName === "미지정" ? "text-rose-400" : "text-[#002864]"}>{assigneeName}</span>
        </div>
        <div className="flex flex-col pt-2 border-t border-slate-100 gap-1.5">
          <div className="flex justify-between items-center text-[10px] font-bold">
            <span className="text-slate-500">최종 수정: {updaterName}</span>
            <span className="text-slate-400">{updatedDateStr}</span>
          </div>
          <div className="flex justify-between items-center text-[10px] font-bold">
            <span className="text-blue-500">작성: {authorName}</span>
            <span className="text-slate-400">{createdDateStr}</span>
          </div>
        </div>
      </div>
    );
  };

  if (isAuthorized === null) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-500 font-bold text-sm">보안 권한을 확인하는 중입니다...</span>
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
          <h2 className="text-xl font-bold text-slate-800">🚨 학부모 요청 및 CS 관리 (Kanban)</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">드래그 앤 드롭으로 요청 처리 상태를 변경하고, CS 카드를 클릭하여 세부 내용 확인 및 담당자 간 소통을 진행하세요.</p>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden pb-2">
        <div className="flex-1 min-w-[250px] bg-rose-50/50 border border-rose-100 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-rose-50 border-b border-rose-100 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-rose-700">🚨 대기 중 (미처리)</h3>
            <span className="bg-rose-200 text-rose-700 text-xs px-2 py-0.5 rounded-full font-bold">{waits.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "대기" ? "bg-rose-100/50 border-2 border-dashed border-rose-300" : ""}`}
            onDragOver={(e) => handleDragOver(e, "대기")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "대기")}
          >
            {waits.map(renderCard)}
          </div>
        </div>

        <div className="flex-1 min-w-[250px] bg-amber-50/50 border border-amber-100 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-amber-50 border-b border-amber-100 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-amber-700">⏳ 처리 중 (진행)</h3>
            <span className="bg-amber-200 text-amber-700 text-xs px-2 py-0.5 rounded-full font-bold">{inProgress.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "처리중" ? "bg-amber-100/50 border-2 border-dashed border-amber-300" : ""}`}
            onDragOver={(e) => handleDragOver(e, "처리중")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "처리중")}
          >
            {inProgress.map(renderCard)}
          </div>
        </div>

        <div className="flex-1 min-w-[250px] bg-emerald-50/50 border border-emerald-100 rounded-2xl flex flex-col overflow-hidden shadow-inner">
          <div className="p-4 bg-emerald-50 border-b border-emerald-100 shrink-0 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-black text-emerald-700">✅ 처리 완료</h3>
            <span className="bg-emerald-200 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-bold">{dones.length}</span>
          </div>
          <div 
            className={`flex-1 p-3 overflow-y-auto custom-scroll space-y-3 transition-colors ${dragOverCol === "완료" ? "bg-emerald-100/50 border-2 border-dashed border-emerald-300" : ""}`}
            onDragOver={(e) => handleDragOver(e, "완료")} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, "완료")}
          >
            {dones.map(renderCard)}
          </div>
        </div>

        <div className="w-[300px] shrink-0 flex flex-col gap-4 overflow-hidden">
          <button onClick={() => openModal()} className="w-full bg-rose-500 hover:bg-rose-600 text-white px-5 py-3.5 rounded-xl font-extrabold shadow-sm transition-colors flex items-center justify-center gap-2 shrink-0 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            새 CS 요청 등록하기
          </button>

          <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm min-h-0">
            <div className="p-4 bg-slate-800 text-white shrink-0 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-black text-sm">📊 유형별 통계 및 보관함</h3>
            </div>
            <div className="p-3 border-b border-slate-100 bg-slate-50 shrink-0">
              <input type="month" value={statsMonth} onChange={(e) => setStatsMonth(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-[#002864] shadow-sm cursor-pointer" />
            </div>
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                <div className="bg-rose-50 p-2 rounded border border-rose-100 flex justify-between shadow-sm"><span className="text-rose-600">결석/보강</span><span>{statsCounts["결석/보강"]}건</span></div>
                <div className="bg-slate-50 p-2 rounded border border-slate-200 flex justify-between shadow-sm"><span className="text-slate-600">상담/기타</span><span>{statsCounts["상담/기타"]}건</span></div>
                <div className="bg-blue-50 p-2 rounded border border-blue-100 flex justify-between shadow-sm"><span className="text-blue-600">수납/행정</span><span>{statsCounts["수납/행정"]}건</span></div>
                <div className="bg-purple-50 p-2 rounded border border-purple-100 flex justify-between shadow-sm"><span className="text-purple-600">퇴원요청</span><span>{statsCounts["퇴원요청"]}건</span></div>
              </div>
            </div>
            <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 shrink-0">
              <span className="text-xs font-bold text-slate-500">해당 월 완료된 CS 목록</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-3 bg-slate-50/50 space-y-2">
              {archivedDones.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-bold text-xs">해당 월에 완료된<br/>CS 내역이 없습니다.</div>
              ) : (
                archivedDones.map(req => {
                  const sName = req.student?.name || "알수없음";
                  const dateStr = new Date(req.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
                  let typeColor = "text-slate-600 bg-slate-200 border-slate-300";
                  if (req.request_type.includes("결석") || req.request_type.includes("퇴원")) typeColor = "text-rose-600 bg-rose-100 border-rose-200";

                  return (
                    <div key={req.request_id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-slate-400 transition-colors" onClick={() => openModal(req)}>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[9px] font-black ${typeColor} px-1.5 py-0.5 rounded border shadow-sm`}>{req.request_type}</span>
                        <span className="text-[10px] font-bold text-slate-400">{dateStr}</span>
                      </div>
                      <h4 className="font-bold text-xs text-[#002864] mb-1">{sName} 학생</h4>
                      <div className="text-[11px] font-medium text-slate-600 leading-snug line-clamp-2">{req.reason}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <CSModal isOpen={isModalOpen} reqData={selectedReq} currentUser={currentUser} students={students} instructors={instructors} onClose={closeModal} onSuccess={() => fetchInitialData(currentUser.instId, currentUser.isAdmin)} />
    </div>
  );
}