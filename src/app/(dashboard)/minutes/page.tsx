// src/app/(dashboard)/minutes/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import NewAgendaModal from "@/components/minutes/NewAgendaModal";
import BindMeetingModal from "@/components/minutes/BindMeetingModal";
import ScheduleMeetingModal from "@/components/minutes/ScheduleMeetingModal";
import AiRecordModal from "@/components/minutes/AiRecordModal";
import SimpleEditor from "@/components/minutes/SimpleEditor";

export default function MinutesPage() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isSuperLevel: false });
  const [activeFolder, setActiveFolder] = useState("전체 안건");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [agendas, setAgendas] = useState<any[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);

  const [instructors, setInstructors] = useState<any[]>([]);
  const [showResolved, setShowResolved] = useState(false); 
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isNewAgendaOpen, setIsNewAgendaModalOpen] = useState(false);
  const [isBindMeetingOpen, setIsBindMeetingOpen] = useState(false);
  const [isScheduleMeetingOpen, setIsScheduleMeetingOpen] = useState(false);
  const [isAiRecordOpen, setIsAiRecordOpen] = useState(false);
  
  const [viewNote, setViewNote] = useState<any>(null); 
  const [meetingToEdit, setMeetingToEdit] = useState<any>(null);

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [editNoteContent, setEditNoteContent] = useState("");
  
  const [displayHtml, setDisplayHtml] = useState("");

  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const name = localStorage.getItem("logica_instructor_name") || "관리자";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const position = localStorage.getItem("logica_instructor_position") || "";
    
    const isSuperLevel = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                         String(position).includes('최고관리자') || 
                         String(position).includes('원장') || 
                         String(position).includes('실장');
                         
    setCurrentUser({ instId, name, isSuperLevel });

    fetchAgendas();
    fetchGoogleEvents();
    fetchInstructors();

    const channel = supabase.channel('agenda_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda' }, () => {
        fetchAgendas();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchAgendas = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const myName = localStorage.getItem("logica_instructor_name") || "관리자";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const position = localStorage.getItem("logica_instructor_position") || "";
    const isSuperLevel = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                         String(position).includes('최고관리자') || 
                         String(position).includes('원장') || 
                         String(position).includes('실장');

    const { data } = await supabase.from('agenda').select('*').order('created_at', { ascending: false });
    
    if (data) {
      const safeData = data.filter((a: any) => {
        if (!a.is_secret) return true; 
        if (isSuperLevel) return true; 
        
        const isCreator = a.created_by === instId;
        const isAttendee = a.attendees && a.attendees.split(',').map((n: string) => n.trim()).includes(myName);
        
        return isCreator || isAttendee;
      });
      setAgendas(safeData);
    } else {
      setAgendas([]);
    }
  };

  const fetchGoogleEvents = async () => {
    try {
      const res = await fetch('/api/calendar');
      const data = await res.json();
      if (data.success && data.events) {
        const external = data.events
          .filter((ev: any) => !ev.summary?.startsWith('[Logica]'))
          .map((ev: any) => ({
            id: ev.id,
            title: ev.summary || '(제목 없음)',
            content: ev.description || '<p>상세 내용 없음 (구글 캘린더에서 작성됨)</p>',
            type: '외부 일정', 
            source: 'Meeting',
            status: '대기중',
            meeting_date: ev.start?.dateTime || ev.start?.date,
            created_at: ev.created || new Date().toISOString(),
            attendees: '구글 캘린더 외부 등록',
            isExternal: true
          }));
        setExternalEvents(external);
      }
    } catch (e) {
      console.error('구글 캘린더 로드 실패:', e);
    }
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

  const getInstructorName = (id: string, isExternal: boolean) => {
    if (isExternal) return "Google 캘린더";
    if (!id) return "알 수 없음";
    const inst = instructors.find(i => i.instructor_id === id);
    return inst ? inst.name : "알 수 없음";
  };

  const allAgendas = [...agendas, ...externalEvents];

  useEffect(() => {
    if (viewNote && !isEditingNote) {
      const loadHtml = async () => {
        if (!viewNote.content) {
          setDisplayHtml("");
          return;
        }
        let html = viewNote.content;
        
        if (html.includes('secret-agenda-placeholder')) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const blocks = doc.querySelectorAll('.secret-agenda-placeholder');
          const ids: string[] = [];
          blocks.forEach(b => {
            const id = b.getAttribute('data-agenda-id');
            if (id) ids.push(id);
          });
          
          if (ids.length > 0) {
            const { data } = await supabase.from('agenda').select('id, content').in('id', ids);
            if (data) {
              blocks.forEach(b => {
                const id = b.getAttribute('data-agenda-id');
                const agenda = data.find((a: any) => a.id === id);
                if (agenda) {
                  b.innerHTML = agenda.content;
                  b.setAttribute('style', 'margin:0; color:#334155; line-height:1.4; font-size:12px;');
                  b.classList.remove('secret-agenda-placeholder');
                }
              });
              html = doc.body.innerHTML;
            }
          }
        }
        setDisplayHtml(html);
      };
      loadHtml();
    }
  }, [viewNote, isEditingNote]);

  const getMeetingTypeTheme = (type: string) => {
    if (type === '주간 회의') return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', dot: 'bg-blue-500' };
    if (type === '임시 회의') return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', dot: 'bg-amber-500' };
    if (type === '상담/면담') return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', dot: 'bg-emerald-500' };
    if (type === '외부 일정') return { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', dot: 'bg-purple-500' };
    return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', dot: 'bg-slate-500' };
  };

  const getThemeColor = (type: string, title: string) => {
    if (type === '긴급' || (title && title.includes('긴급')) || type === 'CS') return { bg: 'bg-rose-100', text: 'text-rose-600', icon: '🚨' };
    if (type === '일반' || type === '비품') return { bg: 'bg-blue-100', text: 'text-blue-600', icon: '📝' };
    if (type === '기타') return { bg: 'bg-emerald-100', text: 'text-emerald-600', icon: '📌' };
    return { bg: 'bg-slate-100', text: 'text-slate-600', icon: '📄' }; 
  };

  const getUnresolvedCount = (folder: string) => {
    if (folder === '전체 안건') return agendas.filter(a => a.source !== 'Meeting' && a.status !== '완료').length;
    return agendas.filter(a => a.type === folder && a.status !== '완료').length;
  };

  const renderCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const meetingsInMonth = allAgendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date).getMonth() === month && new Date(a.meeting_date).getFullYear() === year);

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

  if (activeFolder !== '전체 안건') {
    filteredAgendas.sort((a, b) => {
      const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
      const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
      return dateA - dateB; 
    });
  }

  const isAllSelected = filteredAgendas.length > 0 && selectedIds.length === filteredAgendas.length;
  const toggleSelectAll = () => { if (isAllSelected) setSelectedIds([]); else setSelectedIds(filteredAgendas.map(a => a.id)); };
  const toggleSelect = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };

  const handleBindClick = () => {
    if (selectedIds.length === 0) {
      alert("병합할 안건을 먼저 체크박스로 선택해주세요.");
      return;
    }
    setIsBindMeetingOpen(true);
  };

  const checkAccessAndOpen = (note: any) => {
    if (note.is_secret && !currentUser.isSuperLevel) {
      const isCreator = note.created_by === currentUser.instId;
      const isAttendee = note.attendees && note.attendees.split(',').map((n: string) => n.trim()).includes(currentUser.name);
      
      if (!isCreator && !isAttendee) {
        alert("🔒 비밀 회의록입니다. 관리자 및 회의 참석자만 열람할 수 있습니다.");
        return;
      }
    }
    setViewNote(note);
  };

  const startEditNote = () => {
    setEditNoteTitle(viewNote.title);
    setEditNoteContent(viewNote.content);
    setIsEditingNote(true);
  };

  const saveEditedNote = async () => {
    if (!editNoteTitle.trim()) return alert("안건 제목을 입력해주세요.");
    try {
      await supabase.from('agenda').update({
        title: editNoteTitle,
        content: editNoteContent
      }).eq('id', viewNote.id);
      
      setViewNote({ ...viewNote, title: editNoteTitle, content: editNoteContent });
      setIsEditingNote(false);
      fetchAgendas();
      alert("안건 내용이 성공적으로 수정되었습니다.");
    } catch (e) {
      alert("수정 실패");
    }
  };

  const deleteAgenda = async (note: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (note.isExternal) return alert("구글 캘린더에서 직접 생성된 외부 일정은 로지카에서 삭제할 수 없습니다.\n구글 캘린더에서 직접 삭제해주세요.");
    
    const isCreator = note.created_by === currentUser.instId;
    if (!currentUser.isSuperLevel && !isCreator) {
      return alert("⛔ 삭제 권한이 없습니다. (작성자 본인 또는 관리자만 삭제 가능)");
    }

    if (!confirm("이 기록을 완전히 삭제하시겠습니까?")) return;
    try {
      if (note.source === 'Meeting' && !note.isExternal && !note.is_secret) {
        await fetch(`/api/calendar?title=${encodeURIComponent('[Logica] ' + note.title)}`, { method: 'DELETE' }).catch(console.error);
      }

      if (note.source === 'Meeting' && note.source_id) {
        const linkedIds = note.source_id.split(',');
        await supabase.from('agenda').update({ status: '미해결' }).in('id', linkedIds);
      }
      await supabase.from('agenda').delete().eq('id', note.id);
      setSelectedIds(prev => prev.filter(selId => selId !== note.id));
      setViewNote(null);
      setIsEditingNote(false); 
      fetchAgendas(); 
    } catch (err: any) { alert(`삭제 실패: ${err.message}`); }
  };

  const toggleStatus = async (note: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (note.isExternal) return;
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
            @page { size: A4; margin: 25mm 15mm; }
            body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #1e293b; line-height: 1.5; font-size: 9pt; padding: 0; margin: 0; }
            h1 { color: #0f172a; border-bottom: 2px solid #cbd5e1; padding-bottom: 8px; font-size: 14pt; margin-top: 0; margin-bottom: 15px; }
            .participants { background: #f8fafc; padding: 8px 12px; border-radius: 4px; margin-bottom: 15px; font-size: 8.5pt; font-weight: bold; border: 1px solid #e2e8f0; }
            .content-area { font-size: 9pt; }
            .agenda-block { border: 1px solid #cbd5e1; padding: 10px; border-radius: 4px; margin-bottom: 12px; background: white; page-break-inside: avoid; }
            .agenda-block h4 { font-size: 10pt; margin: 0 0 6px 0; color: #0f172a; }
            ul { margin-top: 4px; background: #f8fafc; padding: 6px 6px 6px 20px; border-radius: 4px; border: 1px solid #f1f5f9; font-size: 8pt; }
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
    ? allAgendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date).toDateString() === selectedDate.toDateString())
    : allAgendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date) >= new Date(new Date().setHours(0,0,0,0)));

  displayMeetings.sort((a,b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());
  
  if (!selectedDate) {
    displayMeetings = displayMeetings.slice(0, 7);
  }

  return (
    <div className="h-full flex flex-col font-pretendard">
      
      <div className="pt-2 pb-3 px-2 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight font-lexend flex items-center gap-2">
              Logica <span className="text-[#002864]">AI Minutes</span>
              <span className="bg-blue-50 text-[#002864] border border-blue-200 text-[9px] px-1.5 py-0.5 rounded-full font-black ml-1 shadow-sm">Beta</span>
            </h1>
            <p className="text-slate-500 font-bold text-[11px] mt-0.5">인공지능 회의록 및 안건 관리 시스템</p>
          </div>
          <button onClick={fetchGoogleEvents} className="mt-1 text-[10px] text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1.5 rounded-lg font-bold border border-blue-100 shadow-sm flex items-center gap-1.5 transition-colors">
            🔄 캘린더 동기화
          </button>
        </div>
      </div>

      <div className="flex-1 flex bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm min-h-0 relative">
        
        <div className="w-[200px] lg:w-[240px] border-r border-slate-200 bg-slate-50/50 flex flex-col shrink-0">
          <div className="p-4 pb-2">
            <div className="flex gap-2">
              <button 
                onClick={() => setIsAiRecordOpen(true)} 
                className="flex-1 bg-white border border-slate-200 hover:border-rose-400 hover:shadow-md transition-all rounded-xl flex items-center justify-center py-3 group" 
                title="AI 실시간 음성 녹음"
              >
                <div className="w-8 h-8 bg-rose-50 rounded-full flex items-center justify-center group-hover:bg-rose-500 transition-colors">
                  <svg className="w-4 h-4 text-rose-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                </div>
              </button>

              <button 
                onClick={() => setIsNewAgendaModalOpen(true)} 
                className="flex-1 bg-white border border-slate-200 hover:border-[#002864] hover:shadow-md transition-all rounded-xl flex items-center justify-center py-3 group"
                title="새 안건 수동 작성"
              >
                <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center group-hover:bg-[#002864] transition-colors">
                  <svg className="w-4 h-4 text-[#002864] group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </div>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-1.5">
            <p className="px-3 py-1.5 text-[10px] font-black text-slate-400">내 노트북</p>
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
          <div className="flex-1 overflow-y-auto custom-scroll bg-slate-50/30 relative">
            {activeFolder === '전체 안건' && (
              <div className="p-6 pb-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-emerald-400 to-teal-500 text-white p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group transition-all">
                    <div className="relative z-10">
                      <h3 className="font-black text-lg drop-shadow-sm leading-tight">스마트폰에서도<br/>편하게</h3>
                      <span className="inline-block mt-1 bg-white/20 px-2 py-0.5 rounded text-[11px] font-bold">(공사중)</span>
                    </div>
                    <div className="absolute -bottom-6 -right-4 w-28 h-28 bg-white/20 rounded-full group-hover:scale-110 transition-transform"></div>
                    <div className="absolute bottom-4 right-5 z-10 text-5xl drop-shadow-md">📱</div>
                  </div>

                  <div onClick={() => setIsAiRecordOpen(true)} className="bg-gradient-to-br from-blue-400 to-indigo-500 text-white p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all">
                    <div className="relative z-10">
                      <h3 className="font-black text-lg drop-shadow-sm leading-tight">AI 실시간 녹음<br/>및 요약</h3>
                    </div>
                    <div className="absolute -top-4 -right-4 w-28 h-28 bg-white/20 rounded-full group-hover:scale-110 transition-transform"></div>
                    <div className="absolute bottom-4 right-5 z-10 text-5xl drop-shadow-md">🎙️</div>
                  </div>

                  <div onClick={handleBindClick} className="bg-gradient-to-br from-violet-400 to-purple-500 text-white p-5 rounded-2xl shadow-sm relative overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all">
                    <div className="relative z-10">
                      <h3 className="font-black text-lg drop-shadow-sm leading-tight">안건 병합하여<br/>회의록 생성</h3>
                    </div>
                    <div className="absolute -bottom-4 -left-4 w-28 h-28 bg-white/20 rounded-full group-hover:scale-110 transition-transform"></div>
                    <div className="absolute bottom-4 right-5 z-10 text-5xl drop-shadow-md">💡</div>
                  </div>
                </div>
              </div>
            )}

            <div className="px-6 py-3 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-20 shadow-sm flex items-center">
              <div className="relative w-full max-w-2xl flex items-center">
                <svg className="w-4 h-4 text-slate-400 absolute left-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="안건 제목 또는 내용 검색" className="w-full pl-6 py-1.5 text-[13px] font-bold text-slate-700 focus:outline-none placeholder-slate-400 bg-transparent" />
              </div>
            </div>

            <div className="p-6 pb-24">
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
                    <span className="text-[11px] font-bold text-slate-600">완료(병합)된 안건 포함</span>
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
                    
                    // 🌟 [핵심 변경] 삭제 권한 판별 변수
                    const canDelete = currentUser.isSuperLevel || note.created_by === currentUser.instId;

                    return (
                      <div 
                        key={note.id} 
                        onClick={() => isMeetingNote ? checkAccessAndOpen(note) : toggleSelect(note.id)} 
                        className={`flex items-center gap-3 p-3 rounded-xl bg-white shadow-sm border transition-all group ${isMeetingNote ? 'cursor-pointer hover:shadow-md hover:border-slate-300' : 'cursor-pointer hover:bg-slate-50'} ${isChecked ? 'border-[#002864] bg-blue-50/30 ring-1 ring-[#002864]' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        {!isMeetingNote && activeFolder === '전체 안건' && (
                          <div className="shrink-0 flex items-center mt-1.5">
                            <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(note.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-[#002864] cursor-pointer" />
                          </div>
                        )}

                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm text-sm ${isMeetingNote ? 'bg-[#002864] text-white' : `${theme.bg} border ${theme.bg.replace('100','200')}`}`}>
                          {isMeetingNote ? '📁' : theme.icon}
                        </div>
        
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                          <div className="flex items-center gap-2">
                            {note.is_secret && <span className="text-[10px]" title="비밀 회의록">🔒</span>}
                            <h4 
                              onClick={(e) => { if(!isMeetingNote) { e.stopPropagation(); checkAccessAndOpen(note); } }} 
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
                          <p className={`text-[11px] font-medium text-slate-500 truncate line-clamp-1`}>
                            {note.is_secret ? "비밀 안건으로 보호됨" : stripHtml(note.content)}
                          </p>
                        </div>
        
                        <div className="shrink-0 flex items-center gap-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <button 
                              onClick={(e) => toggleStatus(note, e)} 
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm border transition-colors ${note.status === '완료' ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : (note.status === '진행중' ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100')}`}
                            >
                              {note.status === '완료' ? '완료됨' : (note.status === '진행중' ? '진행중' : '대기중')}
                            </button>
                            
                            <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 text-right">
                              <span className="text-slate-500">✍️ {getInstructorName(note.created_by, note.isExternal)}</span>
                              <span className="text-slate-300">|</span>
                              {isMeetingNote && note.meeting_date ? (
                                <span className="text-[#002864]">일정: {new Date(note.meeting_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              ) : (
                                <span>생성: {new Date(note.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              )}
                            </div>
                          </div>
                          
                          {/* 🌟 [핵심 변경] 삭제 권한이 없어도 공간 유지를 위해 흐릿한 회색 아이콘으로 보여줌 */}
                          <button 
                            onClick={(e) => {
                              if (canDelete) deleteAgenda(note, e);
                              else e.stopPropagation(); 
                            }} 
                            className={`p-1 transition-opacity ${canDelete ? 'text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 cursor-pointer' : 'text-slate-200 opacity-0 group-hover:opacity-40 cursor-not-allowed'}`} 
                            title={canDelete ? "완전 삭제" : "삭제 권한 없음"}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#002864] text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 animate-[slideUp_0.3s_ease-out] border border-blue-900 z-30">
              <span className="font-bold text-xs"><span className="text-amber-400">{selectedIds.length}개</span>의 안건이 선택됨</span>
              <div className="w-px h-3 bg-slate-500"></div>
              <button onClick={() => setIsBindMeetingOpen(true)} className="text-xs font-black bg-white text-[#002864] hover:bg-slate-100 px-3 py-1.5 rounded-full transition-colors shadow-sm">
                회의록 병합하기 ✨
              </button>
            </div>
          )}
        </div>

        <div className="hidden xl:flex w-[300px] border-l border-slate-200 bg-slate-50/50 flex-col shrink-0 p-4">
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
                    <div key={m.id} onClick={() => checkAccessAndOpen(m)} className={`p-2.5 rounded-xl border shadow-sm cursor-pointer transition-colors group ${theme.bg} ${theme.border} hover:border-[#002864] relative`}>
                      {m.isExternal && (
                        <div className="absolute -top-2 -right-2 bg-purple-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black shadow-sm">Google</div>
                      )}
                      <div className="flex justify-between items-start mb-0.5 gap-2">
                        <div className="flex items-center gap-1 min-w-0">
                          {m.is_secret && <span className="text-[10px]">🔒</span>}
                          <h4 className={`text-[12px] font-black line-clamp-1 group-hover:text-[#002864] ${theme.text}`}>{m.title}</h4>
                        </div>
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

      {isAiRecordOpen && (
        <AiRecordModal 
          onClose={() => setIsAiRecordOpen(false)} 
          onSuccess={() => { setIsAiRecordOpen(false); fetchAgendas(); }} 
        />
      )}

      {viewNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-[15px] flex items-center gap-2">
                {isEditingNote ? '📝 안건 내용 수정' : `📄 상세 기록 조회`}
                {viewNote.is_secret && !isEditingNote && <span className="text-amber-300 ml-1 text-xs">🔒 비밀 회의록</span>}
              </h2>
              <button onClick={() => { setViewNote(null); setIsEditingNote(false); }} className="text-white hover:text-rose-400 text-xl font-bold leading-none">&times;</button>
            </div>
            
            <div id="meeting-print-area" className="p-5 bg-slate-50 flex-1 overflow-y-auto custom-scroll flex flex-col">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col relative">
                {isEditingNote ? (
                  <div className="flex-1 flex flex-col h-full">
                    <label className="text-[11px] font-bold text-slate-500 mb-1">안건 제목 수정</label>
                    <input 
                      type="text" 
                      value={editNoteTitle} 
                      onChange={e => setEditNoteTitle(e.target.value)} 
                      className="w-full text-[13px] font-black text-slate-800 border border-slate-300 rounded-lg p-2.5 mb-3 focus:outline-none focus:border-[#002864]" 
                    />
                    <label className="text-[11px] font-bold text-slate-500 mb-1">상세 내용 수정</label>
                    <div className="flex-1 border border-slate-200 rounded-lg overflow-hidden shadow-inner min-h-[300px]">
                      <SimpleEditor value={editNoteContent} onChange={setEditNoteContent} />
                    </div>
                  </div>
                ) : (
                  <>
                    {viewNote.isExternal && (
                      <div className="absolute top-4 right-4 bg-purple-100 text-purple-700 text-[10px] px-2 py-1 rounded font-black border border-purple-200">
                        🔄 구글 캘린더에서 등록됨
                      </div>
                    )}
                    <div className="mb-4 pb-3 border-b border-slate-200">
                      <div className="flex justify-between items-start mb-2 print:hidden">
                        <span className="px-2 py-0.5 bg-slate-100 text-[#002864] border-slate-200 text-[10px] font-black rounded border">{viewNote.type}</span>
                        <span className="text-[11px] font-bold text-slate-400">
                          {viewNote.meeting_date ? `회의 일정: ${new Date(viewNote.meeting_date).toLocaleString('ko-KR')}` : `등록일: ${new Date(viewNote.created_at).toLocaleString('ko-KR')}`}
                        </span>
                      </div>
                      <h1 className="text-lg font-black text-slate-800 leading-snug mb-2">{viewNote.title}</h1>
                      
                      {viewNote.attendees && (
                        <div className="participants bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 text-[12px] font-bold text-[#002864] mb-2">
                          👥 참석자: {viewNote.attendees}
                        </div>
                      )}
                    </div>
                    <div className="content-area prose prose-sm max-w-none text-slate-700 font-medium text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: displayHtml }}></div>
                  </>
                )}
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              {isEditingNote ? (
                <>
                  <span className="text-[11px] text-slate-500 font-bold">내용을 수정 중입니다...</span>
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditingNote(false)} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-[12px] rounded-lg hover:bg-slate-200 transition-colors">수정 취소</button>
                    <button onClick={saveEditedNote} className="px-5 py-2 bg-[#002864] text-white font-bold text-[12px] rounded-lg hover:bg-blue-900 transition-colors shadow-sm">변경사항 저장</button>
                  </div>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => { setViewNote(null); setIsAiRecordOpen(true); }} 
                    className="px-3 py-2 bg-rose-50 text-rose-600 font-bold text-[12px] rounded-lg hover:bg-rose-100 transition-colors border border-rose-200 flex items-center gap-1.5"
                  >
                    <span>🎙️</span> 실시간 녹음
                  </button>
                  <div className="flex gap-2">
                    {viewNote.source !== 'Meeting' && !viewNote.isExternal && (
                      <button onClick={startEditNote} className="px-4 py-2 bg-emerald-50 text-emerald-600 font-bold text-[12px] rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5 border border-emerald-200">
                        <span>📝</span> 안건 수정
                      </button>
                    )}
                    
                    {viewNote.source === 'Meeting' && !viewNote.isExternal && (
                      <button onClick={() => { setMeetingToEdit(viewNote); setViewNote(null); setIsBindMeetingOpen(true); }} className="px-4 py-2 bg-amber-50 text-amber-600 font-bold text-[12px] rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5 border border-amber-200">
                        <span>✏️</span> 상세 편집
                      </button>
                    )}
                    <button onClick={handlePrint} className="px-4 py-2 bg-blue-50 text-[#002864] font-bold text-[12px] rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5 border border-blue-200">
                      <span>🖨️</span> 인쇄하기
                    </button>
                    <button onClick={() => setViewNote(null)} className="px-5 py-2 bg-slate-800 text-white font-bold text-[12px] rounded-lg hover:bg-slate-900 transition-colors shadow-sm">닫기</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}