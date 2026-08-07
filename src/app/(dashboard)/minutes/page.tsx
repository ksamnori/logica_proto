// src/app/(dashboard)/minutes/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export default function MinutesPage() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "" });
  const [activeFolder, setActiveFolder] = useState("전체 안건");
  const [searchQuery, setSearchQuery] = useState("");
  const [agendas, setAgendas] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [showResolved, setShowResolved] = useState(false); 
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isNewAgendaOpen, setIsNewAgendaModalOpen] = useState(false);
  const [isMeetingOpen, setIsMeetingOpen] = useState(false);
  const [viewNote, setViewNote] = useState<any>(null); 

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const name = localStorage.getItem("logica_instructor_name") || "관리자";
    setCurrentUser({ instId, name });

    fetchAgendas();
    fetchInstructors();

    const channel = supabase.channel('agenda_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda' }, () => {
        fetchAgendas();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchAgendas = async () => {
    const { data } = await supabase.from('agenda').select('*').order('created_at', { ascending: false });
    setAgendas(data || []);
  };

  // 💡 [핵심 해결] HQ 직원 필터링 및 대치 본원 선생님만 불러오기
  const fetchInstructors = async () => {
    const [{ data: insts }, { data: tenants }] = await Promise.all([
      supabase.from('instructor').select('*').eq('status', '재직'),
      supabase.from('academy_tenant').select('*')
    ]);
    
    if (!insts) return;
    
    const validInstructors = insts.filter(inst => {
      const myTenant = tenants?.find(t => t.tenant_id === inst.tenant_id);
      if (!myTenant) return false;
      if (myTenant.tenant_type === 'HQ') return false; // 본사 제외
      if (myTenant.name && myTenant.name.includes('대치')) return true; // 대치 본원만 포함
      return false;
    });

    setInstructors(validInstructors);
  };

  const currentDay = new Date().getDate(); 
  const renderCalendarDays = () => {
    const days = [];
    for (let i = 0; i < 6; i++) days.push(<div key={`empty-${i}`} className="text-center py-1"></div>);
    for (let i = 1; i <= 31; i++) {
      const isToday = i === currentDay;
      const hasEvent = [5, 12, 19, 26].includes(i); 
      days.push(
        <div key={i} className="text-center py-1.5 flex flex-col items-center justify-center relative cursor-pointer hover:bg-slate-50 rounded-full transition-colors">
          <span className={`text-[13px] w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-[#002864] text-white font-bold shadow-sm' : 'text-slate-700 font-medium'}`}>
            {i}
          </span>
          {hasEvent && <span className="absolute bottom-0 w-1 h-1 bg-emerald-500 rounded-full"></span>}
        </div>
      );
    }
    return days;
  };

  const getThemeColor = (type: string, title: string) => {
    if (type === 'CS' || title.includes('긴급')) return { bg: 'bg-rose-100', text: 'text-rose-600', icon: '🚨' };
    if (type === '비품') return { bg: 'bg-blue-100', text: 'text-blue-600', icon: '📦' };
    return { bg: 'bg-emerald-100', text: 'text-emerald-600', icon: '📝' }; 
  };

  const filteredAgendas = agendas.filter(a => {
    const matchSearch = (a.title && a.title.includes(searchQuery)) || (a.content && a.content.includes(searchQuery));
    if (!matchSearch) return false;

    if (activeFolder === '전체 안건') {
      if (a.source === 'Meeting') return false; 
      return showResolved ? true : (a.status === '미해결' || a.status === '진행중');
    } else {
      return a.type === activeFolder;
    }
  });

  const isAllSelected = filteredAgendas.length > 0 && selectedIds.length === filteredAgendas.length;
  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredAgendas.map(a => a.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const deleteAgenda = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("이 기록을 완전히 삭제하시겠습니까?")) return;
    await supabase.from('agenda').delete().eq('id', id);
    setSelectedIds(prev => prev.filter(selId => selId !== id));
    setViewNote(null);
  };

  // 💡 [핵심 해결] 회의록 상태 토글 시 HTML 숨김 데이터에서 원본 ID를 찾아내어 동기화 처리!
  const toggleStatus = async (note: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = (note.status === '미해결' || note.status === '진행중') ? '완료' : '진행중';
    
    try {
      await supabase.from('agenda').update({ status: newStatus }).eq('id', note.id);

      if (note.source === 'Meeting' && note.content) {
        // 본문에 숨겨둔 투명 망토(data-linked-ids)에서 ID들을 쏙 뽑아옵니다.
        const match = note.content.match(/data-linked-ids="([^"]+)"/);
        if (match && match[1]) {
          const linkedIds = match[1].split(',');
          await supabase.from('agenda').update({ status: newStatus }).in('id', linkedIds);
        }
      }
    } catch(err) { alert("상태 변경 실패"); }
  };

  const stripHtml = (html: string) => {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, ' ').trim();
  };

  const handlePrint = () => {
    const content = document.getElementById("meeting-print-area")?.innerHTML;
    if (!content) return;
    const printWindow = window.open('', '', 'width=850,height=900');
    printWindow?.document.write(`
      <html>
        <head>
          <title>회의록 인쇄</title>
          <style>
            body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; color: #333; line-height: 1.6; }
            h1 { color: #002864; border-bottom: 2px solid #002864; padding-bottom: 10px; }
            .participants { background: #f1f5f9; padding: 10px 15px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; font-weight: bold; border: 1px solid #e2e8f0; }
            .content-area { font-size: 14px; }
            .agenda-block { border: 1px solid #cbd5e1; padding: 15px; border-radius: 8px; margin-bottom: 15px; background: white; }
            ul { margin-top: 5px; background: #f8fafc; padding: 10px 10px 10px 25px; border-radius: 5px; border: 1px solid #f1f5f9; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    printWindow?.document.close();
    printWindow?.focus();
    setTimeout(() => { printWindow?.print(); printWindow?.close(); }, 250);
  };

  return (
    <div className="h-full flex flex-col font-pretendard">
      
      <div className="pt-2 pb-4 px-2 shrink-0">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight font-lexend flex items-center gap-2">
          Logica <span className="text-[#002864]">AI Minutes</span>
          <span className="bg-blue-50 text-[#002864] border border-blue-200 text-[10px] px-2 py-0.5 rounded-full font-black ml-2 shadow-sm">Beta</span>
        </h1>
        <p className="text-slate-500 font-bold text-[13px] mt-1">인공지능 회의록 및 안건 관리 시스템</p>
      </div>

      <div className="flex-1 flex bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm min-h-0 relative">
        
        <div className="w-[220px] lg:w-[260px] border-r border-slate-200 bg-slate-50/50 flex flex-col shrink-0">
          <div className="p-5 pb-3">
            <div className="flex gap-2">
              <button className="flex-1 bg-white border border-slate-200 hover:border-[#002864] hover:shadow-md transition-all rounded-2xl flex items-center justify-center py-4 group" title="음성 녹음">
                <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center group-hover:bg-[#002864] transition-colors">
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                </div>
              </button>
              <button onClick={() => setIsNewAgendaModalOpen(true)} className="flex-1 bg-white border border-slate-200 hover:border-[#002864] hover:shadow-md transition-all rounded-2xl flex items-center justify-center py-4 group" title="새 안건 수동 작성">
                <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center group-hover:bg-[#002864] transition-colors">
                  <svg className="w-5 h-5 text-[#002864] group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </div>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-1">
            <p className="px-3 py-2 text-[11px] font-black text-slate-400">내 노트북</p>
            {['전체 안건', '주간 회의', '상담/면담'].map(folder => (
              <button 
                key={folder}
                onClick={() => { setActiveFolder(folder); setSelectedIds([]); }}
                className={`w-full flex items-center px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${activeFolder === folder ? 'bg-white text-[#002864] shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-slate-200/50 border border-transparent'}`}
              >
                {folder === '전체 안건' && <span className="mr-2.5 text-base opacity-70 text-rose-500">🔥</span>}
                {folder === '주간 회의' && <span className="mr-2.5 text-base opacity-70">📁</span>}
                {folder === '상담/면담' && <span className="mr-2.5 text-base opacity-70">📁</span>}
                {folder}
              </button>
            ))}
          </div>
          
          <div className="p-5 border-t border-slate-200 shrink-0">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between shadow-sm">
              <span className="text-[11px] font-bold text-[#002864]">AI 변환 사용량</span>
              <span className="text-[11px] font-black text-[#002864]">0분 <span className="font-normal text-slate-500">/ 600분</span></span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-white relative overflow-hidden">
          <div className="h-16 border-b border-slate-100 flex items-center px-8 shrink-0">
            <div className="relative w-full max-w-2xl flex items-center">
              <svg className="w-5 h-5 text-slate-400 absolute left-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="안건 제목 또는 대화 내용을 검색해보세요." className="w-full pl-8 py-2 text-[15px] font-bold text-slate-700 focus:outline-none placeholder-slate-300" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-8 pb-24">
            {activeFolder === '전체 안건' && (
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-[#002864] text-white p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-sm">스마트폰에서도<br/>편하게 녹음하세요</h3></div>
                  <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-900 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-[24px]">📱</span>
                </div>
                <div className="bg-blue-50 border border-blue-100 text-[#002864] p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-sm">Logica AI 기능으로<br/>요점만 쏙쏙 파악</h3></div>
                  <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-100 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-[24px]">✨</span>
                </div>
                <div className="bg-slate-800 text-white p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-sm">안건을 체크하여<br/>회의록으로 결속!</h3></div>
                  <div className="absolute -bottom-2 -left-2 w-20 h-20 bg-slate-700 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-[24px] text-right">💡</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                {activeFolder === '전체 안건' && (
                  <label className="flex items-center gap-2 cursor-pointer ml-1">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-5 h-5 accent-[#002864] cursor-pointer" />
                    <span className="text-xs font-bold text-slate-500">전체 선택</span>
                  </label>
                )}
                <h2 className="text-lg font-black text-slate-800 tracking-tight ml-2">
                  {activeFolder} <span className="text-sm font-bold text-slate-400 ml-1">{filteredAgendas.length}건</span>
                </h2>
              </div>

              {activeFolder === '전체 안건' && (
                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="w-4 h-4 accent-[#002864]" />
                  <span className="text-xs font-bold text-slate-600">완료(결속)된 안건도 보기</span>
                </label>
              )}
            </div>

            <div className="space-y-2">
              {filteredAgendas.length === 0 ? (
                 <div className="text-center py-20 text-slate-400 font-bold">표시할 기록이 없습니다.</div>
              ) : (
                filteredAgendas.map(note => {
                  const theme = getThemeColor(note.type, note.title);
                  const isChecked = selectedIds.includes(note.id);
                  const isMeetingNote = note.source === 'Meeting';

                  return (
                    <div 
                      key={note.id} 
                      onClick={() => !isMeetingNote && toggleSelect(note.id)}
                      className={`flex items-center gap-4 p-4 rounded-2xl bg-white shadow-sm border transition-colors cursor-pointer group ${isChecked ? 'border-[#002864] bg-blue-50/30' : 'border-slate-200 hover:border-slate-400'}`}
                    >
                      {!isMeetingNote && activeFolder === '전체 안건' && (
                        <div className="shrink-0 flex items-center">
                          <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(note.id)} onClick={(e) => e.stopPropagation()} className="w-5 h-5 accent-[#002864] cursor-pointer" />
                        </div>
                      )}

                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm text-base ${isMeetingNote ? 'bg-slate-100 border border-slate-200' : theme.bg}`}>
                        {isMeetingNote ? '📁' : theme.icon}
                      </div>
      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 
                            onClick={(e) => { e.stopPropagation(); setViewNote(note); }} 
                            className={`text-[15px] font-black truncate transition-colors cursor-pointer hover:underline ${isChecked ? 'text-[#002864]' : 'text-slate-800'}`}
                          >
                            {note.title}
                          </h4>
                          <span className={`px-1.5 py-0.5 text-[9px] font-black rounded text-nowrap border ${isMeetingNote ? 'bg-slate-100 border-slate-300 text-slate-600' : `${theme.bg} border-transparent ${theme.text}`}`}>
                            {isMeetingNote ? '회의록' : note.type}
                          </span>
                        </div>
                        <p className="text-[12px] font-medium text-slate-500 truncate line-clamp-1 break-all">{stripHtml(note.content)}</p>
                      </div>
      
                      <div className="shrink-0 flex items-center gap-4">
                        <button 
                          onClick={(e) => toggleStatus(note, e)} 
                          className={`text-[10px] font-bold px-2 py-1 rounded shadow-sm border transition-colors ${note.status === '완료' ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : (note.status === '진행중' ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100')}`}
                        >
                          {note.status === '완료' ? '완료됨' : (note.status === '진행중' ? '진행중' : '대기중')}
                        </button>
                        
                        <span className="w-28 text-[11px] font-bold text-slate-400 text-right">{new Date(note.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        
                        <button onClick={(e) => deleteAgenda(note.id, e)} className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity" title="삭제">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#002864] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 animate-[slideUp_0.3s_ease-out] border border-blue-900">
              <span className="font-bold text-sm"><span className="text-amber-400">{selectedIds.length}개</span>의 안건이 선택됨</span>
              <div className="w-px h-4 bg-slate-500"></div>
              <button onClick={() => setIsMeetingOpen(true)} className="text-sm font-black bg-white text-[#002864] hover:bg-slate-100 px-4 py-1.5 rounded-full transition-colors shadow-sm">
                이 안건들로 회의록 결속하기 ✨
              </button>
            </div>
          )}

        </div>

        <div className="hidden xl:flex w-[280px] border-l border-slate-200 bg-slate-50/50 flex-col shrink-0 p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tighter">2026.8</h2>
              <button className="px-2 py-0.5 border border-slate-300 rounded-full text-[10px] font-bold text-slate-500 hover:bg-slate-200 transition-colors bg-white shadow-sm">오늘</button>
            </div>
            <div className="flex gap-2">
              <button className="text-slate-400 hover:text-[#002864] transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"></path></svg></button>
              <button className="text-slate-400 hover:text-[#002864] transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg></button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-2 mb-6 border-b border-slate-200 pb-6 bg-white p-3 rounded-2xl shadow-sm border">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`text-center text-[11px] font-bold mb-2 ${i === 0 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
            ))}
            {renderCalendarDays()}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mt-auto">
            <h4 className="text-[12px] font-black text-slate-700 mb-3 border-b border-slate-100 pb-2">💡 유용한 기능 알아보기</h4>
            <ul className="space-y-2.5 text-[11px] font-bold text-slate-500">
              <li className="flex items-center gap-2 hover:text-[#002864] cursor-pointer transition-colors"><span className="text-[#002864]">🌐</span> 다양한 녹음 언어 지원</li>
              <li className="flex items-center gap-2 hover:text-[#002864] cursor-pointer transition-colors"><span className="text-emerald-500">📝</span> 녹음 중 실시간 메모</li>
            </ul>
          </div>
        </div>

      </div>

      {/* ==========================================
          모달 모음 영역
          ========================================== */}

      {isNewAgendaOpen && (
        <NewAgendaModal 
          currentUser={currentUser}
          onClose={() => setIsNewAgendaModalOpen(false)} 
          onSuccess={() => { fetchAgendas(); setIsNewAgendaModalOpen(false); }} 
        />
      )}

      {isMeetingOpen && (
        <CreateMeetingModal 
          selectedIds={selectedIds}
          agendas={agendas}
          instructors={instructors} 
          currentUser={currentUser}
          onClose={() => setIsMeetingOpen(false)} 
          onSuccess={() => { fetchAgendas(); setSelectedIds([]); setIsMeetingOpen(false); setActiveFolder('주간 회의'); }} 
        />
      )}

      {viewNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2">📄 상세 기록 조회</h2>
              <button onClick={() => setViewNote(null)} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
            </div>
            
            <div id="meeting-print-area" className="p-6 bg-slate-50 flex-1 overflow-y-auto custom-scroll">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm min-h-full">
                <div className="mb-4 pb-4 border-b border-slate-200">
                  <div className="flex justify-between items-start mb-2 print:hidden">
                    <span className="px-2 py-1 bg-slate-100 text-[#002864] border-slate-200 text-[11px] font-black rounded border">{viewNote.type}</span>
                    <span className="text-[12px] font-bold text-slate-400">{new Date(viewNote.created_at).toLocaleString('ko-KR')}</span>
                  </div>
                  <h1 className="text-xl font-black text-slate-800 leading-snug">{viewNote.title}</h1>
                </div>
                
                <div className="content-area prose prose-sm max-w-none text-slate-700 font-medium text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: viewNote.content }}></div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              <button 
                onClick={() => alert("마이크 권한을 허용해주세요.\n회의 중 녹음된 음성은 종료 후 AI가 자동으로 분석하여 요약본과 함께 본문에 추가합니다.")} 
                className="px-4 py-2 bg-rose-50 text-rose-600 font-bold text-sm rounded-lg hover:bg-rose-100 transition-colors border border-rose-200 flex items-center gap-2"
              >
                <span>🎙️</span> 실시간 AI 녹음 시작
              </button>
              <div className="flex gap-2">
                <button onClick={handlePrint} className="px-5 py-2.5 bg-blue-50 text-[#002864] font-bold text-sm rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-2 border border-blue-200">
                  <span>🖨️</span> 문서 인쇄하기
                </button>
                <button onClick={() => setViewNote(null)} className="px-6 py-2.5 bg-slate-800 text-white font-bold text-sm rounded-lg hover:bg-slate-900 transition-colors shadow-sm">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ----------------------------------------------------
// 🧩 툴박스 내장형 리치 텍스트 에디터
// ----------------------------------------------------
function SimpleEditor({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = (command: string, arg: string | null = null) => {
    document.execCommand(command, false, arg || undefined);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden flex flex-col h-full bg-white">
      <div className="bg-slate-50 p-2 flex gap-1.5 border-b border-slate-200 flex-wrap shrink-0 items-center">
        <button type="button" onClick={() => exec('bold')} className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 font-black shadow-sm text-[#002864]" title="굵게">B</button>
        <button type="button" onClick={() => exec('italic')} className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 italic font-serif shadow-sm text-[#002864]" title="기울임">I</button>
        <button type="button" onClick={() => exec('underline')} className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 underline shadow-sm text-[#002864]" title="밑줄">U</button>
        <div className="w-px h-5 bg-slate-300 mx-1"></div>
        <button type="button" onClick={() => exec('insertUnorderedList')} className="px-2 h-7 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 text-xs font-bold shadow-sm text-[#002864]" title="글머리 기호">목록</button>
        <div className="w-px h-5 bg-slate-300 mx-1"></div>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500 cursor-pointer">
          색상
          <input type="color" onChange={(e) => exec('foreColor', e.target.value)} className="w-6 h-6 border-0 p-0 rounded cursor-pointer" />
        </label>
        <select onChange={(e) => exec('fontSize', e.target.value)} className="h-7 px-1 border border-slate-200 rounded bg-white text-[11px] font-bold text-[#002864] shadow-sm focus:outline-none ml-1">
          <option value="3">글자 보통</option>
          <option value="4">크게</option>
          <option value="5">더 크게</option>
        </select>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="flex-1 p-4 overflow-y-auto custom-scroll outline-none text-[13px] text-slate-800 font-medium prose prose-sm max-w-none"
        style={{ minHeight: "250px" }}
        data-placeholder={placeholder}
      />
    </div>
  );
}


// ----------------------------------------------------
// 🧩 하위 모달 1: 새 안건 작성
// ----------------------------------------------------
function NewAgendaModal({ currentUser, onClose, onSuccess }: { currentUser: any, onClose: () => void, onSuccess: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("일반");

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return alert("제목과 내용을 입력해주세요.");
    try {
      await supabase.from("agenda").insert({
        title: title, 
        content,
        type: type,
        source: "Manual",
        source_id: crypto.randomUUID(),
        created_by: currentUser.instId
      });
      alert("새 안건이 전체 목록에 상정되었습니다.");
      onSuccess();
    } catch (e) { alert("저장 실패"); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center">
          <h2 className="font-bold text-sm">✏️ 새 회의 안건 수동 작성</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-5 bg-slate-50 flex-1">
          <div className="flex gap-4">
            <div className="w-1/3">
              <label className="block text-xs font-bold text-slate-500 mb-1.5">안건 종류</label>
              <select value={type} onChange={e => setType(e.target.value)} className="w-full text-sm font-bold text-slate-700 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]">
                <option value="일반">일반 업무/공지</option>
                <option value="긴급">긴급/이슈</option>
                <option value="기타">기타 논의</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1.5">안건 제목</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="회의에서 논의할 핵심 주제" className="w-full text-sm font-bold text-slate-800 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]" />
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-[300px]">
            <label className="block text-xs font-bold text-slate-500 mb-1.5">상세 내용 및 의견</label>
            <div className="flex-1 h-full">
              <SimpleEditor value={content} onChange={setContent} />
            </div>
          </div>
        </div>
        <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors">취소</button>
          <button onClick={handleSubmit} className="px-5 py-2.5 bg-[#002864] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm">안건 등록하기</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 🧩 하위 모달 2: 회의록 결속 (참석자 배정 포함 & 숨김 아이디 저장 로직)
// ----------------------------------------------------
function CreateMeetingModal({ selectedIds, agendas, instructors, currentUser, onClose, onSuccess }: { selectedIds: string[], agendas: any[], instructors: any[], currentUser: any, onClose: () => void, onSuccess: () => void }) {
  const [meetingTitle, setMeetingTitle] = useState("");
  const [folder, setFolder] = useState("주간 회의");
  const [meetingResult, setMeetingResult] = useState(""); 
  
  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const selectedItems = agendas.filter(a => selectedIds.includes(a.id));

  const toggleInst = (id: string) => {
    setSelectedInstIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleAllInsts = () => {
    if (selectedInstIds.length === instructors.length) setSelectedInstIds([]);
    else setSelectedInstIds(instructors.map(i => i.instructor_id));
  };

  const insertAgendaContent = async (item: any) => {
    let commentsHtml = "";
    
    if (item.source && item.source !== 'Manual') {
      let table = '', idCol = '';
      if (item.source === 'Task') { table = 'instructor_memo'; idCol = 'memo_id'; }
      else if (item.source === 'CS') { table = 'parent_request_log'; idCol = 'request_id'; }
      else if (item.source === 'Supply') { table = 'supply_request'; idCol = 'request_id'; }

      if (table) {
        try {
          const { data } = await supabase.from(table).select('comments').eq(idCol, item.source_id).single();
          if (data && data.comments && data.comments.length > 0) {
            commentsHtml = data.comments.map((c:any) => `<li><b>${c.authorName}</b>: ${c.text} <span style="color:#94a3b8; font-size:0.85em;">(${c.createdAt})</span></li>`).join('');
            commentsHtml = `<ul style="margin-top:5px; background:#f8fafc; padding:10px 10px 10px 25px; border-radius:5px; list-style-type:disc; border: 1px solid #f1f5f9;">${commentsHtml}</ul>`;
          }
        } catch(e) {}
      }
    }

    if (!commentsHtml) commentsHtml = `<p style="color:#94a3b8; font-size:0.9em; margin-top:5px;">등록된 소통 기록이 없습니다.</p>`;

    // 💡 불필요한 자동 머리말 완전 제거
    const htmlToInsert = `
      <div class="agenda-block" style="border:1px solid #cbd5e1; padding:15px; border-radius:8px; margin-bottom:15px; background:white;">
        <h4 style="color:#002864; margin:0 0 10px 0; font-size:15px; font-weight:bold;">📌 ${item.title}</h4>
        <div style="margin:0; color:#334155; line-height:1.5;">${item.content}</div>
        <div style="margin-top:10px; border-top:1px dashed #e2e8f0; padding-top:10px;">
          <strong style="font-size:12px; color:#475569;">💬 소통 내역 (댓글):</strong>
          ${commentsHtml}
        </div>
      </div>
      <p><br/></p>
    `;
    
    setMeetingResult(prev => prev + htmlToInsert);
  };

  const handleCreateMeeting = async () => {
    if (!meetingTitle.trim()) return alert("회의록 제목을 입력해주세요.");
    
    const participantNames = selectedInstIds.map(id => instructors.find(i => i.instructor_id === id)?.name).join(', ');
    const headerHtml = participantNames ? `<div class="participants" style="background:#f1f5f9; padding:10px 15px; border-radius:8px; margin-bottom:20px; font-size:13px; color:#334155; border:1px solid #e2e8f0;"><b>👥 참석자:</b> ${participantNames} 선생님</div>` : '';
    
    // 💡 [핵심 해결] DB UUID 충돌 방지를 위해 숨김 데이터 영역에 원본 안건 ID 묶음을 몰래 넣어둡니다.
    const meetingId = crypto.randomUUID();
    const hiddenLinkData = `<div data-linked-ids="${selectedIds.join(',')}" style="display:none;"></div>`;

    try {
      await supabase.from("agenda").insert({
        id: meetingId,
        title: meetingTitle,
        content: headerHtml + (meetingResult || '<p>본문 내용 없음</p>') + hiddenLinkData,
        type: folder, 
        source: "Meeting",
        source_id: meetingId, // 자기 자신의 UUID를 넣어 에러 원천 차단
        status: "진행중", 
        created_by: currentUser.instId
      });

      // 묶인 개별 안건들도 '진행중'으로 일괄 변경 (삭제하지 않음!)
      await supabase.from('agenda').update({ status: '진행중' }).in('id', selectedIds);

      alert("회의록 생성이 완료되었으며, 원본 안건들은 '진행중' 상태로 변경되었습니다!");
      onSuccess();
    } catch (e) {
      alert("회의록 생성 실패");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-black text-sm flex items-center gap-2">✨ 여러 안건을 모아서 회의록 결속 (에디터)</h2>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-2xl font-bold leading-none">&times;</button>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          
          <div className="w-[320px] border-r border-slate-200 bg-slate-50 flex flex-col shrink-0">
            <div className="h-1/2 flex flex-col p-4 border-b border-slate-200 bg-white shadow-sm">
              <div className="flex justify-between items-center mb-2 shrink-0">
                <h3 className="text-[13px] font-black text-[#002864] flex items-center gap-1">👥 참석자 배정</h3>
                <button onClick={toggleAllInsts} className="text-[10px] bg-slate-100 border border-slate-200 hover:bg-slate-200 px-2 py-1 rounded font-bold text-slate-600 transition-colors">
                  {selectedInstIds.length === instructors.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll flex flex-col gap-1 pr-1">
                {instructors.map(inst => (
                  <label key={inst.instructor_id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded transition-colors border border-transparent hover:border-slate-100">
                    <input type="checkbox" checked={selectedInstIds.includes(inst.instructor_id)} onChange={() => toggleInst(inst.instructor_id)} className="w-4 h-4 accent-[#002864]" />
                    <span className="text-[12px] font-bold text-slate-700">{inst.name} <span className="text-[10px] text-slate-400 font-normal">{inst.position}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <div className="h-1/2 flex flex-col p-4">
              <h3 className="text-[13px] font-black text-[#002864] mb-3 shrink-0 flex items-center gap-1">📌 상정된 안건 ({selectedItems.length}개)</h3>
              <div className="flex-1 overflow-y-auto custom-scroll space-y-2 pr-1">
                {selectedItems.map(item => (
                  <div key={item.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-2">
                    <div className="text-[12px] font-bold text-slate-700 truncate line-clamp-1">{item.title}</div>
                    <button onClick={() => insertAgendaContent(item)} className="w-full py-1.5 bg-blue-50 hover:bg-blue-100 text-[#002864] border border-blue-200 rounded text-[11px] font-black transition-colors flex items-center justify-center gap-1">
                      <span>📥</span> 본문에 내용+댓글 넣기
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col p-6 bg-white overflow-hidden min-w-0">
            <div className="flex gap-4 shrink-0 mb-3">
              <div className="w-1/4">
                <label className="block text-xs font-bold text-slate-500 mb-1.5">저장할 폴더 위치</label>
                <select value={folder} onChange={e => setFolder(e.target.value)} className="w-full text-sm font-bold text-slate-700 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]">
                  <option value="주간 회의">📁 주간 회의</option>
                  <option value="상담/면담">📁 상담/면담</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 mb-1.5">회의록 제목 <span className="text-rose-500">*</span></label>
                <input type="text" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="예: 8월 2주차 전체 강사 정기 회의" className="w-full text-sm font-black text-slate-800 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]" />
              </div>
            </div>
            
            {selectedInstIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3 shrink-0 bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-xs font-bold text-slate-500 mr-1 mt-0.5">배정된 참석자:</span>
                {selectedInstIds.map(id => {
                  const name = instructors.find(i => i.instructor_id === id)?.name;
                  return <span key={id} className="bg-blue-100 text-[#002864] px-2 py-0.5 rounded text-[11px] font-bold border border-blue-200">👤 {name}</span>;
                })}
              </div>
            )}

            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-xs font-bold text-slate-500 mb-1.5">회의록 본문 작성 (리치 에디터)</label>
              <div className="flex-1 h-full border border-slate-200 rounded-lg overflow-hidden shadow-inner">
                <SimpleEditor value={meetingResult} onChange={setMeetingResult} placeholder="좌측에서 안건 내용을 불러오거나, 회의 결과를 자유롭게 작성하세요." />
              </div>
            </div>
          </div>

        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-xs font-bold text-slate-500">결속이 완료되면 원본 안건들은 삭제되지 않고 '진행중' 상태로 연동됩니다.</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-6 py-2.5 bg-white text-slate-600 border border-slate-300 font-bold text-sm rounded-lg hover:bg-slate-100 transition-colors shadow-sm">취소</button>
            <button onClick={handleCreateMeeting} className="px-6 py-2.5 bg-[#002864] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm flex items-center gap-1.5">
              <span>✨</span> 결속 완료 및 회의록 생성
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}