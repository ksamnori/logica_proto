// src/app/(dashboard)/minutes/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import NewAgendaModal from "@/components/minutes/NewAgendaModal";
import BindMeetingModal from "@/components/minutes/BindMeetingModal";
import ScheduleMeetingModal from "@/components/minutes/ScheduleMeetingModal";

export default function MinutesPage() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "" });
  const [activeFolder, setActiveFolder] = useState("전체 안건");
  const [searchQuery, setSearchQuery] = useState("");
  const [agendas, setAgendas] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [showResolved, setShowResolved] = useState(false); 
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isNewAgendaOpen, setIsNewAgendaModalOpen] = useState(false);
  const [isBindMeetingOpen, setIsBindMeetingOpen] = useState(false);
  const [isScheduleMeetingOpen, setIsScheduleMeetingOpen] = useState(false);
  
  const [viewNote, setViewNote] = useState<any>(null); 
  const [meetingToEdit, setMeetingToEdit] = useState<any>(null);

  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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

  const fetchInstructors = async () => {
    try {
      const { data: insts } = await supabase.from('instructor').select('*').eq('status', '재직');
      const HQ_TENANT_ID = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc'; 
      const validInstructors = (insts || []).filter(inst => inst.tenant_id !== HQ_TENANT_ID);
      
      if (validInstructors.length === 0) setInstructors(insts || []);
      else setInstructors(validInstructors);
    } catch (error) { console.error("강사 목록 로드 에러"); }
  };

  const getMeetingTypeTheme = (type: string) => {
    if (type === '주간 회의') return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', dot: 'bg-blue-500' };
    if (type === '임시 회의') return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', dot: 'bg-amber-500' };
    if (type === '상담/면담') return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', dot: 'bg-emerald-500' };
    return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', dot: 'bg-slate-500' };
  };

  const getThemeColor = (type: string, title: string) => {
    if (type === 'CS' || (title && title.includes('긴급'))) return { bg: 'bg-rose-100', text: 'text-rose-600', icon: '🚨' };
    if (type === '비품') return { bg: 'bg-blue-100', text: 'text-blue-600', icon: '📦' };
    return { bg: 'bg-emerald-100', text: 'text-emerald-600', icon: '📝' }; 
  };

  // 💡 폴더별 미완료 상태(대기중/진행중) 안건/일정 개수 계산기
  const getUnresolvedCount = (folder: string) => {
    if (folder === '전체 안건') {
      return agendas.filter(a => a.source !== 'Meeting' && a.status !== '완료').length;
    }
    return agendas.filter(a => a.type === folder && a.status !== '완료').length;
  };

  const renderCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const meetingsInMonth = agendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date).getMonth() === month && new Date(a.meeting_date).getFullYear() === year);

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="text-center py-0.5"></div>);
    
    for (let i = 1; i <= daysInMonth; i++) {
      const isToday = new Date().getDate() === i && new Date().getMonth() === month && new Date().getFullYear() === year;
      const isSelected = selectedDate && selectedDate.getDate() === i && selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
      
      const dayMeetings = meetingsInMonth.filter(a => new Date(a.meeting_date).getDate() === i);
      const dayTypes = Array.from(new Set(dayMeetings.map(a => a.type)));
      
      days.push(
        <div key={i} onClick={() => setSelectedDate(isSelected ? null : new Date(year, month, i))} className="text-center py-1 flex flex-col items-center justify-center relative cursor-pointer hover:bg-slate-100 rounded-full transition-colors">
          <span className={`text-[11px] w-6 h-6 flex items-center justify-center rounded-full transition-colors ${isSelected ? 'bg-rose-500 text-white font-black shadow-md' : (isToday ? 'bg-[#002864] text-white font-bold shadow-sm' : 'text-slate-700 font-medium')}`}>
            {i}
          </span>
          {dayTypes.length > 0 && (
            <div className="absolute bottom-0 flex gap-[2px]">
              {dayTypes.map((type, idx) => (
                <span key={idx} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : getMeetingTypeTheme(type as string).dot}`}></span>
              ))}
            </div>
          )}
        </div>
      );
    }
    return days;
  };

  let filteredAgendas = agendas.filter(a => {
    const matchSearch = (a.title && a.title.includes(searchQuery)) || (a.content && a.content.includes(searchQuery));
    if (!matchSearch) return false;

    if (activeFolder === '전체 안건') {
      if (a.source === 'Meeting') return false; 
      return showResolved ? true : (a.status === '미해결' || a.status === '진행중');
    } else {
      return a.type === activeFolder;
    }
  });

  // 💡 회의록 폴더들은 무조건 '가장 빠른 회의 날짜(meeting_date)'가 맨 위로 오도록 오름차순 정렬
  if (activeFolder !== '전체 안건') {
    filteredAgendas.sort((a, b) => {
      const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
      const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
      return dateA - dateB; 
    });
  }

  const isAllSelected = filteredAgendas.length > 0 && selectedIds.length === filteredAgendas.length;
  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredAgendas.map(a => a.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const deleteAgenda = async (note: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("이 기록을 완전히 삭제하시겠습니까?")) return;
    try {
      if (note.source === 'Meeting' && note.source_id) {
        const linkedIds = note.source_id.split(',');
        await supabase.from('agenda').update({ status: '미해결' }).in('id', linkedIds);
      }
      await supabase.from('agenda').delete().eq('id', note.id);
      setSelectedIds(prev => prev.filter(selId => selId !== note.id));
      setViewNote(null);
      fetchAgendas(); 
    } catch (err: any) { alert(`삭제 실패: ${err.message}`); }
  };

  const toggleStatus = async (note: any, e: React.MouseEvent) => {
    e.stopPropagation();
    let newStatus = '미해결';
    if (note.status === '미해결') newStatus = '진행중';
    else if (note.status === '진행중') newStatus = '완료';
    else if (note.status === '완료') newStatus = '미해결';
    try {
      await supabase.from('agenda').update({ status: newStatus }).eq('id', note.id);
      if (note.source === 'Meeting' && note.content) {
        const match = note.content.match(/data-linked-ids="([^"]+)"/);
        if (match && match[1]) {
          const linkedIds = match[1].split(',');
          await supabase.from('agenda').update({ status: newStatus }).in('id', linkedIds);
        }
      }
      fetchAgendas();
    } catch(err) { alert("상태 변경 실패"); }
  };

  const stripHtml = (html: string) => {
    if (!html) return "";
    const cleanHtml = html.replace(/<div class="participants".*?<\/div>/g, '');
    return cleanHtml.replace(/<[^>]+>/g, ' ').trim();
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
            /* 💡 [핵심] 상하 여백 25mm(넉넉하게), 좌우 여백 15mm로 실제 문서처럼 설정 */
            @page { 
              size: A4;
              margin: 25mm 15mm; 
            }
            
            /* body 자체 패딩은 없애서 @page 여백만 깔끔하게 적용되도록 수정 */
            body { 
              font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; 
              color: #1e293b; 
              line-height: 1.5; 
              font-size: 9pt; 
              padding: 0; 
              margin: 0;
            }
            
            h1 { 
              color: #0f172a; 
              border-bottom: 2px solid #cbd5e1; 
              padding-bottom: 8px; 
              font-size: 14pt; 
              margin-top: 0; 
              margin-bottom: 15px; 
            }
            
            .participants { 
              background: #f8fafc; 
              padding: 8px 12px; 
              border-radius: 4px; 
              margin-bottom: 15px; 
              font-size: 8.5pt; 
              font-weight: bold; 
              border: 1px solid #e2e8f0; 
            }
            
            .content-area { font-size: 9pt; }
            
            .agenda-block { 
              border: 1px solid #cbd5e1; 
              padding: 10px; 
              border-radius: 4px; 
              margin-bottom: 12px; 
              background: white; 
              page-break-inside: avoid; /* 박스 중간에 페이지가 잘리는 현상 방지 */
            }
            
            .agenda-block h4 { 
              font-size: 10pt; 
              margin: 0 0 6px 0; 
              color: #0f172a; 
            }
            
            ul { 
              margin-top: 4px; 
              background: #f8fafc; 
              padding: 6px 6px 6px 20px; 
              border-radius: 4px; 
              border: 1px solid #f1f5f9; 
              font-size: 8pt; 
            }
            li { margin-bottom: 3px; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    printWindow?.document.close();
    printWindow?.focus();
    setTimeout(() => { printWindow?.print(); printWindow?.close(); }, 300);
  };

  let displayMeetings = selectedDate 
    ? agendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date).toDateString() === selectedDate.toDateString())
    : agendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date) >= new Date(new Date().setHours(0,0,0,0)));

  displayMeetings.sort((a,b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());
  
  if (!selectedDate) {
    displayMeetings = displayMeetings.slice(0, 5);
  }

  return (
    <div className="h-full flex flex-col font-pretendard">
      
      <div className="pt-2 pb-3 px-2 shrink-0">
        <h1 className="text-2xl font-black text-slate-800 tracking-tight font-lexend flex items-center gap-2">
          Logica <span className="text-[#002864]">AI Minutes</span>
          <span className="bg-blue-50 text-[#002864] border border-blue-200 text-[9px] px-1.5 py-0.5 rounded-full font-black ml-1 shadow-sm">Beta</span>
        </h1>
        <p className="text-slate-500 font-bold text-[11px] mt-0.5">인공지능 회의록 및 안건 관리 시스템</p>
      </div>

      <div className="flex-1 flex bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm min-h-0 relative">
        
        <div className="w-[200px] lg:w-[240px] border-r border-slate-200 bg-slate-50/50 flex flex-col shrink-0">
          <div className="p-4 pb-2">
            <div className="flex gap-2">
              <button className="flex-1 bg-white border border-slate-200 hover:border-[#002864] hover:shadow-md transition-all rounded-xl flex items-center justify-center py-3 group">
                <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center group-hover:bg-[#002864] transition-colors">
                  <svg className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                </div>
              </button>
              <button onClick={() => setIsNewAgendaModalOpen(true)} className="flex-1 bg-white border border-slate-200 hover:border-[#002864] hover:shadow-md transition-all rounded-xl flex items-center justify-center py-3 group">
                <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center group-hover:bg-[#002864] transition-colors">
                  <svg className="w-4 h-4 text-[#002864] group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </div>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-1.5">
            <p className="px-3 py-1.5 text-[10px] font-black text-slate-400">내 노트북</p>
            {/* 💡 각 폴더별로 미완료 안건/일정 개수를 뱃지로 표시합니다. */}
            {['전체 안건', '주간 회의', '임시 회의', '상담/면담'].map(folder => {
              const unresolvedCount = getUnresolvedCount(folder);
              return (
                <button 
                  key={folder}
                  onClick={() => { setActiveFolder(folder); setSelectedIds([]); setSelectedDate(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${activeFolder === folder ? 'bg-white shadow-sm border border-slate-200' : 'hover:bg-slate-200/50 border border-transparent'}`}
                >
                  <div className="flex items-center">
                    {folder === '전체 안건' && <span className="mr-2 text-sm opacity-70 text-rose-500">🔥</span>}
                    {folder === '주간 회의' && <span className="mr-2 text-sm opacity-70">📁</span>}
                    {folder === '임시 회의' && <span className="mr-2 text-sm opacity-70">📁</span>}
                    {folder === '상담/면담' && <span className="mr-2 text-sm opacity-70">📁</span>}
                    <span className={`text-[12px] font-bold ${activeFolder === folder ? 'text-[#002864]' : 'text-slate-600'}`}>{folder}</span>
                  </div>
                  {unresolvedCount > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${activeFolder === folder ? 'bg-[#002864] text-white' : 'bg-slate-200 text-slate-500'}`}>
                      {unresolvedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-white relative overflow-hidden">
          <div className="h-12 border-b border-slate-100 flex items-center px-6 shrink-0">
            <div className="relative w-full max-w-2xl flex items-center">
              <svg className="w-4 h-4 text-slate-400 absolute left-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="안건 제목 또는 내용 검색" className="w-full pl-6 py-1.5 text-[13px] font-bold text-slate-700 focus:outline-none placeholder-slate-300" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 pb-24 bg-slate-50/30">
            {activeFolder === '전체 안건' && (
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-[#002864] text-white p-4 rounded-xl shadow-sm relative overflow-hidden h-24 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-xs">스마트폰에서도 편하게</h3></div>
                  <div className="absolute -bottom-4 -right-4 w-16 h-16 bg-blue-900 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-lg">📱</span>
                </div>
                <div className="bg-blue-50 border border-blue-100 text-[#002864] p-4 rounded-xl shadow-sm relative overflow-hidden h-24 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-xs">AI로 요점만 쏙쏙</h3></div>
                  <div className="absolute -top-4 -right-4 w-16 h-16 bg-blue-100 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-lg">✨</span>
                </div>
                <div className="bg-slate-800 text-white p-4 rounded-xl shadow-sm relative overflow-hidden h-24 flex flex-col justify-between group cursor-pointer hover:shadow-md transition-all">
                  <div className="relative z-10"><h3 className="font-black text-xs">안건 묶어서 회의록 생성</h3></div>
                  <div className="absolute -bottom-2 -left-2 w-12 h-12 bg-slate-700 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                  <span className="relative z-10 text-lg text-right">💡</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                {activeFolder === '전체 안건' && (
                  <label className="flex items-center gap-1.5 cursor-pointer ml-1">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-[#002864] cursor-pointer" />
                    <span className="text-[11px] font-bold text-slate-500">전체 선택</span>
                  </label>
                )}
                <h2 className="text-base font-black text-slate-800 tracking-tight ml-2">
                  {activeFolder} <span className="text-xs font-bold text-slate-400 ml-1">{filteredAgendas.length}건</span>
                </h2>
              </div>
              {activeFolder === '전체 안건' && (
                <label className="flex items-center gap-1.5 cursor-pointer bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
                  <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="w-3 h-3 accent-[#002864]" />
                  <span className="text-[11px] font-bold text-slate-600">완료(결속)된 안건 포함</span>
                </label>
              )}
            </div>

            <div className="space-y-2">
              {filteredAgendas.length === 0 ? (
                 <div className="text-center py-20 text-slate-400 font-bold text-xs">표시할 기록이 없습니다.</div>
              ) : (
                filteredAgendas.map(note => {
                  const theme = getThemeColor(note.type, note.title);
                  const isChecked = selectedIds.includes(note.id);
                  const isMeetingNote = note.source === 'Meeting';

                  return (
                    <div 
                      key={note.id} 
                      onClick={() => isMeetingNote ? setViewNote(note) : toggleSelect(note.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl bg-white shadow-sm border transition-all group ${isMeetingNote ? 'cursor-pointer hover:shadow-md hover:border-slate-300' : 'cursor-pointer hover:bg-slate-50'} ${isChecked ? 'border-[#002864] bg-blue-50/30 ring-1 ring-[#002864]' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      {!isMeetingNote && activeFolder === '전체 안건' && (
                        <div className="shrink-0 flex items-center">
                          <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(note.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-[#002864] cursor-pointer" />
                        </div>
                      )}

                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm text-sm ${isMeetingNote ? 'bg-[#002864] text-white' : theme.bg}`}>
                        {isMeetingNote ? '📁' : theme.icon}
                      </div>
      
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                        <div className="flex items-center gap-2">
                          <h4 
                            onClick={(e) => { if(!isMeetingNote) { e.stopPropagation(); setViewNote(note); } }} 
                            className={`text-[13px] font-black truncate transition-colors ${!isMeetingNote && 'cursor-pointer hover:underline'} ${isChecked ? 'text-[#002864]' : 'text-slate-800'}`}
                          >
                            {note.title}
                          </h4>
                          <span className={`px-1.5 py-0.5 text-[8px] font-black rounded text-nowrap border ${isMeetingNote ? 'bg-slate-100 border-slate-300 text-slate-600' : `${theme.bg} border-transparent ${theme.text}`}`}>
                            {isMeetingNote ? '회의록' : note.type}
                          </span>
                          {isMeetingNote && note.attendees && (
                            <span className="text-[9px] font-bold text-[#002864] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 ml-1 truncate">
                              👥 {note.attendees}
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] font-medium text-slate-500 truncate line-clamp-1`}>{stripHtml(note.content)}</p>
                      </div>
      
                      <div className="shrink-0 flex items-center gap-3">
                        <div className="flex flex-col items-end gap-1">
                          <button 
                            onClick={(e) => toggleStatus(note, e)} 
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm border transition-colors ${note.status === '완료' ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : (note.status === '진행중' ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100')}`}
                          >
                            {note.status === '완료' ? '완료됨' : (note.status === '진행중' ? '진행중' : '대기중')}
                          </button>
                          
                          <div className="text-[9px] font-bold text-slate-400 text-right">
                            {isMeetingNote && note.meeting_date ? (
                              <span className="text-[#002864]">일정: {new Date(note.meeting_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            ) : (
                              <span>생성: {new Date(note.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                        </div>
                        
                        <button onClick={(e) => deleteAgenda(note, e)} className="p-1 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity" title="완전 삭제">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#002864] text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 animate-[slideUp_0.3s_ease-out] border border-blue-900">
              <span className="font-bold text-xs"><span className="text-amber-400">{selectedIds.length}개</span>의 안건이 선택됨</span>
              <div className="w-px h-3 bg-slate-500"></div>
              <button onClick={() => setIsBindMeetingOpen(true)} className="text-xs font-black bg-white text-[#002864] hover:bg-slate-100 px-3 py-1.5 rounded-full transition-colors shadow-sm">
                회의록 결속하기 ✨
              </button>
            </div>
          )}
        </div>

        <div className="hidden xl:flex w-[260px] border-l border-slate-200 bg-slate-50/50 flex-col shrink-0 p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-black text-slate-800 tracking-tighter">{calendarMonth.getFullYear()}.{calendarMonth.getMonth() + 1}</h2>
              <button onClick={() => {setCalendarMonth(new Date()); setSelectedDate(null);}} className="px-2 py-0.5 border border-slate-300 rounded-full text-[9px] font-bold text-slate-500 hover:bg-slate-200 transition-colors bg-white shadow-sm">오늘</button>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="text-slate-400 hover:text-[#002864] transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"></path></svg></button>
              <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="text-slate-400 hover:text-[#002864] transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg></button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-1 mb-4 border-b border-slate-200 pb-4 bg-white p-2 rounded-xl shadow-sm border">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`text-center text-[10px] font-bold mb-1 ${i === 0 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
            ))}
            {renderCalendarDays()}
          </div>

          <div className="mb-4">
            <button 
              onClick={() => { setSelectedIds([]); setIsScheduleMeetingOpen(true); }}
              className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold text-[12px] py-2 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <span>➕</span> 새 일정 예약
            </button>
          </div>

          <div className="mb-4 flex-1 overflow-y-auto custom-scroll pr-1">
            <h3 className="text-[11px] font-black text-slate-500 mb-2">{selectedDate ? `${selectedDate.getDate()}일 예약된 회의` : '다가오는 일정 전체'}</h3>
            <div className="space-y-2">
              {displayMeetings.length === 0 ? (
                <div className="text-[10px] font-bold text-slate-400 text-center py-3 bg-white rounded-lg border border-slate-100">일정이 없습니다.</div>
              ) : (
                displayMeetings.map(m => {
                  const mDate = new Date(m.meeting_date);
                  const theme = getMeetingTypeTheme(m.type);
                  return (
                    <div key={m.id} onClick={() => setViewNote(m)} className={`p-2.5 rounded-xl border shadow-sm cursor-pointer transition-colors group ${theme.bg} ${theme.border} hover:border-[#002864]`}>
                      <div className="flex justify-between items-start mb-0.5 gap-2">
                        <h4 className={`text-[12px] font-black line-clamp-1 group-hover:text-[#002864] ${theme.text}`}>{m.title}</h4>
                        <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded border bg-white opacity-80 ${theme.border} ${theme.text}`}>{m.type}</span>
                      </div>
                      <div className={`text-[10px] font-bold flex items-center gap-1 opacity-70 ${theme.text}`}>
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        {selectedDate ? `${mDate.getHours()}시 ${mDate.getMinutes() === 0 ? '00' : mDate.getMinutes()}분` : `${mDate.getMonth()+1}/${mDate.getDate()} ${mDate.getHours()}:${String(mDate.getMinutes()).padStart(2,'0')}`}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {isNewAgendaOpen && <NewAgendaModal currentUser={currentUser} onClose={() => setIsNewAgendaModalOpen(false)} onSuccess={() => { fetchAgendas(); setIsNewAgendaModalOpen(false); }} />}
      
      {isBindMeetingOpen && (
        <BindMeetingModal 
          selectedIds={selectedIds} 
          agendas={agendas} 
          instructors={instructors} 
          currentUser={currentUser} 
          meetingToEdit={meetingToEdit} 
          onClose={() => { setIsBindMeetingOpen(false); setMeetingToEdit(null); }} 
          onSuccess={(folder) => { fetchAgendas(); setSelectedIds([]); setIsBindMeetingOpen(false); setMeetingToEdit(null); if(folder) setActiveFolder(folder); }} 
        />
      )}
      
      {isScheduleMeetingOpen && <ScheduleMeetingModal agendas={agendas} instructors={instructors} currentUser={currentUser} onClose={() => setIsScheduleMeetingOpen(false)} onSuccess={() => { fetchAgendas(); setIsScheduleMeetingOpen(false); setActiveFolder('주간 회의'); }} />}

      {viewNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-[15px] flex items-center gap-2">📄 상세 기록 조회</h2>
              <button onClick={() => setViewNote(null)} className="text-white hover:text-rose-400 text-xl font-bold leading-none">&times;</button>
            </div>
            
            <div id="meeting-print-area" className="p-5 bg-slate-50 flex-1 overflow-y-auto custom-scroll flex flex-col">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col">
                <div className="mb-4 pb-3 border-b border-slate-200">
                  <div className="flex justify-between items-start mb-2 print:hidden">
                    <span className="px-2 py-0.5 bg-slate-100 text-[#002864] border-slate-200 text-[10px] font-black rounded border">{viewNote.type}</span>
                    <span className="text-[11px] font-bold text-slate-400">
                      {viewNote.source === 'Meeting' && viewNote.meeting_date ? `회의 일정: ${new Date(viewNote.meeting_date).toLocaleString('ko-KR')}` : `등록일: ${new Date(viewNote.created_at).toLocaleString('ko-KR')}`}
                    </span>
                  </div>
                  <h1 className="text-lg font-black text-slate-800 leading-snug mb-2">{viewNote.title}</h1>
                  
                  {viewNote.attendees && (
                    <div className="participants bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 text-[12px] font-bold text-[#002864] mb-2">
                      👥 참석자: {viewNote.attendees}
                    </div>
                  )}
                </div>
                <div className="content-area prose prose-sm max-w-none text-slate-700 font-medium text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: viewNote.content }}></div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              <button onClick={() => alert("마이크 권한을 허용해주세요.\n회의 중 녹음된 음성은 AI가 자동 분석하여 요약본과 함께 본문에 추가합니다.")} className="px-3 py-2 bg-rose-50 text-rose-600 font-bold text-[12px] rounded-lg hover:bg-rose-100 transition-colors border border-rose-200 flex items-center gap-1.5">
                <span>🎙️</span> 실시간 녹음
              </button>
              <div className="flex gap-2">
                {viewNote.source === 'Meeting' && (
                  <button onClick={() => { setMeetingToEdit(viewNote); setViewNote(null); setIsBindMeetingOpen(true); }} className="px-4 py-2 bg-amber-50 text-amber-600 font-bold text-[12px] rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5 border border-amber-200">
                    <span>✏️</span> 상세 편집
                  </button>
                )}
                {/* 💡 복구 완료된 인쇄 버튼 */}
                <button onClick={handlePrint} className="px-4 py-2 bg-blue-50 text-[#002864] font-bold text-[12px] rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5 border border-blue-200">
                  <span>🖨️</span> 인쇄하기
                </button>
                <button onClick={() => setViewNote(null)} className="px-5 py-2 bg-slate-800 text-white font-bold text-[12px] rounded-lg hover:bg-slate-900 transition-colors shadow-sm">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}