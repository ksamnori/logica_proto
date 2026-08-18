// src/components/dashboard/AgendaSidebar.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface AgendaSidebarProps {
  currentUser: {
    instId: string;
    name: string;
    isSuperLevel: boolean;
  };
  tenantId: string;
  hasAccess: (path: string) => boolean;
}

export default function AgendaSidebar({ currentUser, tenantId, hasAccess }: AgendaSidebarProps) {
  const router = useRouter();
  
  const [agendas, setAgendas] = useState<any[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!currentUser.instId) return;

    fetchAgendas();
    fetchGoogleEvents();

    const channelName = `dashboard_agenda_realtime_${tenantId}`;
    const channel = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda' }, () => {
        fetchAgendas();
      }).subscribe();

    return () => { 
      supabase.removeChannel(channel);
    };
  }, [currentUser.instId, tenantId]);

  const fetchAgendas = async () => {
    const { data } = await supabase.from('agenda').select('*').order('created_at', { ascending: false });
    if (data) {
      const safeData = data.filter((a: any) => {
        if (!a.is_secret) return true; 
        if (currentUser.isSuperLevel) return true; 
        const isCreator = a.created_by === currentUser.instId;
        const isAttendee = a.attendees && a.attendees.split(',').map((n: string) => n.trim()).includes(currentUser.name);
        return isCreator || isAttendee;
      });
      setAgendas(safeData);
    }
  };

  const fetchGoogleEvents = async () => {
    try {
      const res = await fetch('/api/calendar', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.events) {
        const external = data.events
          .filter((ev: any) => !ev.summary?.startsWith('[Logica]'))
          .map((ev: any) => {
            const startStr = ev.start?.dateTime || ev.start?.date;
            let endStr = ev.end?.dateTime || ev.end?.date;
            let isMultiDay = false;
            let timeString = "";

            if (ev.start?.dateTime && ev.end?.dateTime) {
              const s = new Date(ev.start.dateTime);
              const e = new Date(ev.end.dateTime);
              const formatTime = (d: Date) => {
                const hours = d.getHours();
                const ampm = hours >= 12 ? '오후' : '오전';
                const h = hours % 12 || 12;
                const m = String(d.getMinutes()).padStart(2, '0');
                return `${ampm} ${h}:${m}`;
              };
              timeString = `${formatTime(s)} ~ ${formatTime(e)}`;
            } else {
              timeString = "종일 일정";
            }

            if (ev.end?.date) {
               const eDate = new Date(ev.end.date);
               eDate.setDate(eDate.getDate() - 1);
               endStr = eDate.toISOString().split('T')[0];
            }
            if (startStr && endStr) {
               const s = new Date(startStr); s.setHours(0,0,0,0);
               const e = new Date(endStr); e.setHours(0,0,0,0);
               if (e.getTime() > s.getTime()) isMultiDay = true;
            }

            const descHtml = ev.description ? `<span class="text-slate-300 mx-1">|</span> ${ev.description}` : '';

            return {
              id: ev.id,
              title: ev.summary || '(제목 없음)',
              content: `<p>🕒 ${timeString}${descHtml}</p>`,
              type: '외부 일정', 
              source: 'Meeting',
              status: '대기중',
              meeting_date: startStr,
              end_date: endStr,
              isMultiDay: isMultiDay,
              created_at: ev.created || new Date().toISOString(),
              attendees: '구글 캘린더',
              isExternal: true
            };
          });
        setExternalEvents(external);
      }
    } catch (e) { console.error('구글 캘린더 로드 실패:', e); }
  };

  const allCombinedAgendas = [...agendas, ...externalEvents];

  const getMeetingTypeTheme = (type: string) => {
    if (type === '주간 회의') return { dot: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: '📁' };
    if (type === '임시 회의') return { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: '📁' };
    if (type === '상담/면담') return { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: '🗣️' };
    if (type === '외부 일정') return { dot: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', icon: '📆' };
    return { dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', icon: '📌' };
  };

  return (
    <aside className="hidden xl:flex w-[320px] shrink-0 border-l border-slate-200 bg-white flex-col h-full shadow-sm z-20">
      <div className="h-[72px] shrink-0 bg-transparent border-b border-slate-200 w-full flex items-center px-5 relative">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>
        <span className="text-sm font-black text-[#002864] relative z-10 flex items-center gap-2">
          <span className="bg-[#002864] text-white text-xs px-2 py-0.5 rounded shadow-sm">AI Minutes</span>
          일정 모니터링
        </span>
      </div>

      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0">
        <h2 className="text-sm font-black text-slate-800 tracking-tighter">{calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월</h2>
        <div className="flex items-center gap-1.5">
          <button onClick={fetchGoogleEvents} className="w-6 h-6 flex items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors rounded text-blue-600 font-bold border border-blue-200" title="구글 캘린더 동기화">🔄</button>
          <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="w-5 h-5 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">◀</button>
          <button onClick={() => {setCalendarMonth(new Date()); setSelectedDate(null);}} className="px-1.5 py-0.5 border border-slate-300 rounded text-[9px] font-bold text-slate-600 bg-white">오늘</button>
          <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="w-5 h-5 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">▶</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 bg-white p-3 border-b border-slate-100 shrink-0">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-bold mb-1 ${i === 0 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
        ))}
        {(() => {
          const year = calendarMonth.getFullYear();
          const month = calendarMonth.getMonth();
          const firstDay = new Date(year, month, 1).getDay();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const days = [];
          
          for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="text-center py-0.5"></div>);
          
          for (let i = 1; i <= daysInMonth; i++) {
            const currentDate = new Date(year, month, i);
            const isToday = new Date().getDate() === i && new Date().getMonth() === month && new Date().getFullYear() === year;
            const isSelected = selectedDate && selectedDate.getDate() === i && selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
            
            const dayEvents = allCombinedAgendas.filter(a => {
              if (a.isMultiDay) {
                const s = new Date(a.meeting_date); s.setHours(0,0,0,0);
                const e = new Date(a.end_date); e.setHours(0,0,0,0);
                return currentDate.getTime() >= s.getTime() && currentDate.getTime() <= e.getTime();
              } else {
                const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
                return d.getFullYear() === year && d.getMonth() === month && d.getDate() === i;
              }
            });

            const dotEvents = dayEvents.filter(a => {
              if (a.isMultiDay) return false;
              if (a.isExternal) return true; 
              return a.source === 'Meeting' && ['주간 회의', '임시 회의', '상담/면담'].includes(a.type);
            });
            const dayTypes = Array.from(new Set(dotEvents.map(a => a.type)));
            
            const multiDayEvents = dayEvents.filter(a => a.isMultiDay);
            let multiDayBg = null;
            
            if (multiDayEvents.length > 0) {
              const ev = multiDayEvents[0];
              const s = new Date(ev.meeting_date); s.setHours(0,0,0,0);
              const e = new Date(ev.end_date); e.setHours(0,0,0,0);
              
              let positionClasses = "left-[-8px] right-[-8px]"; 
              if (currentDate.getTime() === s.getTime() && currentDate.getTime() === e.getTime()) {
                 positionClasses = "left-1 right-1 rounded-lg";
              } else if (currentDate.getTime() === s.getTime()) {
                 positionClasses = "left-1 right-[-8px] rounded-l-full"; 
              } else if (currentDate.getTime() === e.getTime()) {
                 positionClasses = "left-[-8px] right-1 rounded-r-full"; 
              }
              
              multiDayBg = <div className={`absolute top-1/2 -translate-y-1/2 h-6 bg-purple-100 -z-10 ${positionClasses}`}></div>;
            }

            days.push(
              <div key={i} onClick={() => setSelectedDate(isSelected ? null : new Date(year, month, i))} className="text-center py-1.5 flex flex-col items-center justify-center relative cursor-pointer hover:bg-slate-100 rounded-lg transition-colors z-0">
                {multiDayBg}
                <span className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full transition-colors relative z-10 ${isSelected ? 'bg-rose-500 text-white font-black shadow-md' : (isToday ? 'bg-[#002864] text-white font-bold shadow-sm' : 'text-slate-700 font-medium')}`}>
                  {i}
                </span>
                {dayTypes.length > 0 && (
                  <div className="absolute bottom-0 flex gap-[2px] z-10">
                    {dayTypes.map((type, idx) => (
                      <span key={idx} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : getMeetingTypeTheme(type as string).dot}`}></span>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return days;
        })()}
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 p-4">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="font-black text-[12px] text-slate-700">{selectedDate ? '선택한 날짜의 일정' : '다가오는 전체 일정'}</h3>
          <button 
            onClick={() => {
              if (hasAccess('/minutes')) router.push('/minutes');
              else alert('권한이 없습니다.');
            }} 
            className={`text-[10px] font-bold hover:underline ${hasAccess('/minutes') ? 'text-[#002864] cursor-pointer' : 'text-slate-400 cursor-not-allowed'}`}
          >
            상세 보기 ➔
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scroll pr-1 space-y-2 pb-10">
          {(() => {
            let displayItems = selectedDate 
              ? allCombinedAgendas.filter(a => {
                  if (a.isMultiDay) {
                    const s = new Date(a.meeting_date); s.setHours(0,0,0,0);
                    const e = new Date(a.end_date); e.setHours(0,0,0,0);
                    const curr = new Date(selectedDate); curr.setHours(0,0,0,0);
                    return curr.getTime() >= s.getTime() && curr.getTime() <= e.getTime();
                  } else {
                    const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
                    return d.toDateString() === selectedDate.toDateString();
                  }
                })
              : allCombinedAgendas.filter(a => {
                  const d = a.isMultiDay ? new Date(a.end_date) : (a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at));
                  const today = new Date(); today.setHours(0, 0, 0, 0); 
                  return d.getTime() >= today.getTime();
                });

            displayItems.sort((a,b) => {
              const d1 = a.meeting_date ? new Date(a.meeting_date).getTime() : new Date(a.created_at).getTime();
              const d2 = b.meeting_date ? new Date(b.meeting_date).getTime() : new Date(b.created_at).getTime();
              return d1 - d2;
            });

            if (!selectedDate) {
              displayItems = displayItems.slice(0, 15); 
            }

            if (displayItems.length === 0) {
              return (
                <div className="bg-white p-6 rounded-xl border border-slate-200 text-center shadow-sm">
                  <span className="text-[11px] font-bold text-slate-400">일정이 없습니다.</span>
                </div>
              );
            }

            return displayItems.map(item => {
              // 🌟 1. 오늘 날짜 여부 판별 로직 추가
              const today = new Date();
              let isTodayItem = false;

              if (item.isMultiDay && item.end_date) {
                const s = new Date(item.meeting_date); s.setHours(0,0,0,0);
                const e = new Date(item.end_date); e.setHours(0,0,0,0);
                const curr = new Date(today); curr.setHours(0,0,0,0);
                isTodayItem = curr.getTime() >= s.getTime() && curr.getTime() <= e.getTime();
              } else {
                const itemDate = item.meeting_date ? new Date(item.meeting_date) : new Date(item.created_at);
                isTodayItem = itemDate.getDate() === today.getDate() && 
                              itemDate.getMonth() === today.getMonth() && 
                              itemDate.getFullYear() === today.getFullYear();
              }

              const isGoogleEvent = item.isExternal;
              const isMeetingNote = item.source === 'Meeting' && !isGoogleEvent;
              
              let theme: any; 
              if (isGoogleEvent) theme = { bg: 'bg-purple-50', text: 'text-purple-600', icon: '📆', border: 'border-purple-200' };
              else if (isMeetingNote) theme = { bg: 'bg-[#002864]', text: 'text-white', icon: '📁', border: 'border-blue-900' };
              else theme = getMeetingTypeTheme(item.type);
              
              const itemDate = item.meeting_date ? new Date(item.meeting_date) : new Date(item.created_at);

              let badgeText = item.type;
              if (isGoogleEvent) badgeText = '구글 일정';
              else if (isMeetingNote) badgeText = '회의록';
              
              let badgeStyle = `${theme.bg} border-transparent ${theme.text}`;
              if (isMeetingNote) badgeStyle = 'bg-slate-100 border-slate-300 text-slate-600';
              if (isGoogleEvent) badgeStyle = 'bg-purple-100 border-purple-300 text-purple-700';

              let dateDisplay = `${itemDate.getMonth()+1}/${itemDate.getDate()} ${itemDate.getHours()}:${String(itemDate.getMinutes()).padStart(2,'0')}`;
              if (item.isMultiDay && item.end_date) {
                const eDate = new Date(item.end_date);
                dateDisplay = `${itemDate.getMonth()+1}/${itemDate.getDate()} ~ ${eDate.getMonth()+1}/${eDate.getDate()}`;
              }
              
              // 🌟 2. 텍스트 강조 (오늘인 경우 '오늘'로 변경)
              if (isTodayItem && !item.isMultiDay) {
                dateDisplay = `오늘 ${itemDate.getHours()}:${String(itemDate.getMinutes()).padStart(2,'0')}`;
              }

              return (
                <div 
                  key={item.id} 
                  onClick={() => {
                    if (isMeetingNote || isGoogleEvent) {
                      if (hasAccess('/minutes')) router.push('/minutes');
                      else alert('권한이 없습니다.');
                    }
                  }}
                  // 🌟 3. 테두리 강조 스타일 추가
                  className={`bg-white p-3 rounded-xl border shadow-sm flex flex-col gap-1.5 transition-colors ${
                    isTodayItem ? 'border-[#002864] ring-1 ring-[#002864]/20' : 'border-slate-200'
                  } ${
                    isMeetingNote || isGoogleEvent ? (hasAccess('/minutes') ? 'cursor-pointer hover:border-[#002864] hover:bg-slate-50' : 'cursor-not-allowed') : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm ${theme.bg} ${theme.text} ${theme.border}`}>
                      {theme.icon || '📌'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        {item.is_secret && <span className="text-[9px]">🔒</span>}
                        <h4 className="text-[12px] font-black text-slate-800 truncate">{item.title}</h4>
                      </div>
                      <p className="text-[10px] font-medium text-slate-500 truncate">
                        {item.is_secret ? "비밀 안건 (보호됨)" : (item.content ? item.content.replace(/<[^>]+>/g, ' ').trim() : '내용 없음')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-9">
                    <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border ${badgeStyle}`}>
                      {badgeText}
                    </span>
                    {/* 🌟 4. 오늘인 경우 색상 강조 */}
                    <span className={`text-[9px] font-bold ${isTodayItem ? 'text-rose-500' : 'text-slate-400'}`}>
                      {dateDisplay}
                    </span>
                  </div>
                </div>
              );
            })
          })()}
        </div>
      </div>
    </aside>
  );
}