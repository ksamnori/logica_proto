// src/app/m/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import FloatingChat from "@/components/FloatingChat";
import AiRecordModal from "@/components/minutes/AiRecordModal";
import ProfileModal from "@/components/ProfileModal"; 

export default function MobileInstructorPortalPage() {
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [authState, setAuthState] = useState<"login" | "dashboard">("login");
  
  // 로그인 상태 관리
  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  
  const [currentUser, setCurrentUser] = useState<{
    instId: string;
    name: string;
    dept: string;
    position: string;
    isSuperLevel: boolean;
    profileImageUrl: string | null;
  }>({ instId: "", name: "", dept: "", position: "", isSuperLevel: false, profileImageUrl: null });

  // 모달 상태
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  
  // 상세 기록 조회 모달 상태
  const [viewNote, setViewNote] = useState<any>(null); 
  const [displayHtml, setDisplayHtml] = useState("");

  // 안건 및 캘린더 상태
  const [agendas, setAgendas] = useState<any[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // 모바일 뒤로가기 방어 로직
  const isExitModalOpenRef = useRef(isExitModalOpen);
  isExitModalOpenRef.current = isExitModalOpen;
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isExitModalOpenRef.current) {
        setIsExitModalOpen(false);
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      } else if (authStateRef.current === "dashboard") {
        setIsExitModalOpen(true);
        window.history.pushState({ app_state: "modal" }, "", window.location.href);
      } else {
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      }
    };
    window.history.replaceState({ app_state: "main" }, "", window.location.href);
    window.history.pushState({ app_state: "trap" }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => { window.removeEventListener("popstate", handlePopState); };
  }, []);

  // 초기 세션 확인
  useEffect(() => {
    const savedInstId = sessionStorage.getItem("logica_instructor_id");
    if (savedInstId) loadDashboard(savedInstId);
  }, []);

  // 대시보드 데이터 로드 (안건 및 캘린더)
  useEffect(() => {
    if (authState === "dashboard" && currentUser.instId) {
      fetchAgendas();
      fetchGoogleEvents();

      const channel = supabase.channel('mobile_agenda_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda' }, () => {
          fetchAgendas();
        }).subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [authState, currentUser.instId]);

  // 비밀 안건 상세 조회 복호화 로직
  useEffect(() => {
    if (viewNote) {
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
  }, [viewNote]);

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
          .map((ev: any) => ({
            id: ev.id,
            title: ev.summary || '(제목 없음)',
            content: ev.description || '<p>상세 내용 없음</p>',
            type: '외부 일정', 
            source: 'Meeting',
            status: '대기중',
            meeting_date: ev.start?.dateTime || ev.start?.date,
            created_at: ev.created || new Date().toISOString(),
            attendees: '구글 캘린더',
            isExternal: true
          }));
        setExternalEvents(external);
      }
    } catch (e) { console.error('구글 캘린더 로드 실패:', e); }
  };

  const handlePhoneInput = (val: string) => {
    const formatted = val
      .replace(/[^0-9]/g, "")
      .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));
    setPhoneInput(formatted);
  };

  const loginInstructor = async () => {
    if (!phoneInput || !pwInput) return alert("연락처와 비밀번호를 모두 입력해주세요.");

    try {
      const rawPhone = phoneInput.replace(/[^0-9]/g, "");
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      const { data, error } = await supabase
        .from("instructor")
        .select("instructor_id, name, department, status, role, position")
        .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`)
        .maybeSingle();

      if (error || !data) return alert("등록된 강사 정보가 없거나 비밀번호가 일치하지 않습니다.");
      if (data.status === "퇴사") return alert("퇴사 처리된 계정입니다.");

      sessionStorage.setItem("logica_instructor_id", data.instructor_id);
      localStorage.setItem("logica_instructor_name", data.name);
      localStorage.setItem("logica_instructor_role", data.role || "");
      localStorage.setItem("logica_instructor_position", data.position || "");
      
      loadDashboard(data.instructor_id);
    } catch (err) { alert("로그인 중 오류가 발생했습니다."); }
  };

  const logout = () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      sessionStorage.clear();
      localStorage.removeItem("logica_instructor_name");
      window.location.reload();
    }
  };

  const loadDashboard = async (id: string) => {
    const { data } = await supabase.from("instructor").select("name, department, role, position, chat_position, profile_image_url").eq("instructor_id", id).maybeSingle();
    if (data) {
      const isSuperLevel = data.role === 'SUPER_ADMIN' || data.role === 'ADMIN' || 
                           String(data.position).includes('최고관리자') || 
                           String(data.position).includes('원장') || 
                           String(data.position).includes('실장');
      
      setCurrentUser({
        instId: id,
        name: data.name || "선생님",
        dept: data.department || "강사",
        position: data.chat_position || data.position || "강사", 
        isSuperLevel,
        profileImageUrl: data.profile_image_url || null 
      });
      setAuthState("dashboard");
    }
  };

  const getProfileImageUrl = (path: string | null | undefined) => {
    if (!path || path.trim() === "") return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("system_images").getPublicUrl(path);
    return data.publicUrl;
  };

  const stripHtml = (html: string) => {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, ' ').trim();
  };

  const getMeetingTypeTheme = (type: string) => {
    if (type === '주간 회의') return { dot: 'bg-blue-500' };
    if (type === '임시 회의') return { dot: 'bg-amber-500' };
    if (type === '상담/면담') return { dot: 'bg-emerald-500' };
    if (type === '외부 일정') return { dot: 'bg-purple-500' };
    return { dot: 'bg-slate-500' };
  };

  const getThemeColor = (type: string, title: string) => {
    if (type === '긴급' || (title && title.includes('긴급')) || type === 'CS') return { bg: 'bg-rose-100', text: 'text-rose-600', icon: '🚨', border: 'border-rose-200' };
    if (type === '일반' || type === '비품') return { bg: 'bg-blue-100', text: 'text-blue-600', icon: '📝', border: 'border-blue-200' };
    if (type === '기타') return { bg: 'bg-emerald-100', text: 'text-emerald-600', icon: '📌', border: 'border-emerald-200' };
    return { bg: 'bg-slate-100', text: 'text-slate-600', icon: '📄', border: 'border-slate-200' }; 
  };

  const allCombinedAgendas = [...agendas, ...externalEvents];

  const renderCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const meetingsInMonth = allCombinedAgendas.filter(a => a.source === 'Meeting' && a.meeting_date && new Date(a.meeting_date).getMonth() === month && new Date(a.meeting_date).getFullYear() === year);

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="text-center py-0.5"></div>);
    
    for (let i = 1; i <= daysInMonth; i++) {
      const isToday = new Date().getDate() === i && new Date().getMonth() === month && new Date().getFullYear() === year;
      const isSelected = selectedDate && selectedDate.getDate() === i && selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
      
      const dayMeetings = meetingsInMonth.filter(a => new Date(a.meeting_date).getDate() === i);
      const dayTypes = Array.from(new Set(dayMeetings.map(a => a.type)));
      
      days.push(
        <div key={i} onClick={() => setSelectedDate(isSelected ? null : new Date(year, month, i))} className="text-center py-1.5 flex flex-col items-center justify-center relative cursor-pointer hover:bg-slate-100 rounded-lg transition-colors">
          <span className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full transition-colors ${isSelected ? 'bg-rose-500 text-white font-black shadow-md' : (isToday ? 'bg-[#002864] text-white font-bold shadow-sm' : 'text-slate-700 font-medium')}`}>
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

  let displayItems = selectedDate 
    ? allCombinedAgendas.filter(a => {
        const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
        return d.toDateString() === selectedDate.toDateString();
      })
    : allCombinedAgendas.filter(a => {
        const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0); 
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

  const checkAccessAndOpen = (note: any) => {
    if (note.is_secret && !currentUser.isSuperLevel) {
      const isCreator = note.created_by === currentUser.instId;
      const isAttendee = note.attendees && note.attendees.split(',').map((n: string) => n.trim()).includes(currentUser.name);
      
      if (!isCreator && !isAttendee) {
        alert("🔒 비밀 회의록입니다. 회의 참석자만 열람할 수 있습니다.");
        return;
      }
    }
    setViewNote(note);
  };

  // 렌더링 - 로그인 화면
  const renderAuthSection = () => {
    return (
      <div className="flex-1 flex items-center justify-center p-4 h-full bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100 animate-[fadeIn_0.3s_ease-out]">
          <div className="text-center mb-6 flex flex-col items-center justify-center">
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-10 object-contain mb-2" alt="Logica" />
            <span className="text-sm font-black text-[#002864] bg-blue-50 px-3 py-1 rounded-full">강사 전용 포털</span>
          </div>
          
          <input 
            type="text" 
            maxLength={13} 
            value={phoneInput} 
            onChange={e => handlePhoneInput(e.target.value)} 
            className="w-full px-4 py-3 mb-3 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" 
            placeholder="등록된 연락처 (아이디)" 
          />
          <input 
            type="password" 
            value={pwInput} 
            onChange={e => setPwInput(e.target.value)} 
            onKeyPress={e => e.key === 'Enter' && loginInstructor()}
            className="w-full px-4 py-3 mb-5 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" 
            placeholder="비밀번호" 
          />
          <button onClick={loginInstructor} className="w-full bg-[#002864] text-white font-bold py-3.5 rounded-xl hover:bg-blue-900 transition-colors shadow-md">
            로그인
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="text-slate-800 relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-slate-50 overscroll-none">
      
      {/* 🚨 앱 종료 확인 모달 */}
      {isExitModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[280px] rounded-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="p-6 text-center space-y-2">
              <div className="text-4xl mb-3">👋</div>
              <h2 className="font-bold text-lg text-slate-800">앱을 종료하시겠습니까?</h2>
            </div>
            <div className="flex border-t border-slate-200">
              <button onClick={() => { setIsExitModalOpen(false); window.history.replaceState({ app_state: "trap" }, "", window.location.href); }} className="flex-1 py-3.5 text-slate-500 font-bold border-r border-slate-200">취소</button>
              <button onClick={() => window.history.go(-2)} className="flex-1 py-3.5 text-rose-500 font-bold">종료하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 🚨 AI 회의록 녹음 모달 */}
      {isAiModalOpen && (
        <AiRecordModal 
          onClose={() => setIsAiModalOpen(false)} 
          onSuccess={() => {
            alert("회의록 저장이 완료되었습니다!");
            setIsAiModalOpen(false);
            fetchAgendas();
          }} 
        />
      )}

      {/* 🚨 정보수정 모달 */}
      <ProfileModal 
        isOpen={isProfileModalOpen} 
        onClose={() => setIsProfileModalOpen(false)} 
        instId={currentUser.instId} 
        instructorName={currentUser.name} 
      />

      {/* 🌟 상세 기록 조회 모달 */}
      {viewNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center sm:p-4">
          <div className="bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[85vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-[15px] flex items-center gap-2">
                📄 상세 기록 조회 {viewNote.is_secret && <span className="text-amber-300 ml-1 text-xs">🔒 비밀 회의록</span>}
              </h2>
              <button onClick={() => setViewNote(null)} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
            </div>
            
            <div className="p-5 bg-slate-50 flex-1 overflow-y-auto custom-scroll flex flex-col">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col relative">
                {viewNote.isExternal && (
                  <div className="absolute top-4 right-4 bg-purple-100 text-purple-700 text-[10px] px-2 py-1 rounded font-black border border-purple-200">
                    🔄 구글 캘린더에서 등록됨
                  </div>
                )}
                <div className="mb-4 pb-3 border-b border-slate-200">
                  <div className="flex justify-between items-start mb-2">
                    <span className="px-2 py-0.5 bg-slate-100 text-[#002864] border-slate-200 text-[10px] font-black rounded border">{viewNote.type}</span>
                    <span className="text-[11px] font-bold text-slate-400">
                      {viewNote.meeting_date ? `일정: ${new Date(viewNote.meeting_date).toLocaleString('ko-KR')}` : `등록일: ${new Date(viewNote.created_at).toLocaleString('ko-KR')}`}
                    </span>
                  </div>
                  <h1 className="text-lg font-black text-slate-800 leading-snug mb-2">{viewNote.title}</h1>
                  
                  {viewNote.attendees && (
                    <div className="bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 text-[12px] font-bold text-[#002864] mb-2">
                      👥 참석자: {viewNote.attendees}
                    </div>
                  )}
                </div>
                <div className="prose prose-sm max-w-none text-slate-700 font-medium text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: displayHtml }}></div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              <button 
                onClick={() => { setViewNote(null); setIsAiModalOpen(true); }} 
                className="px-4 py-2.5 bg-rose-50 text-rose-600 font-bold text-[13px] rounded-xl hover:bg-rose-100 transition-colors border border-rose-200 flex items-center gap-1.5 shadow-sm"
              >
                <span>🎙️</span> 실시간 녹음
              </button>
              <button onClick={() => setViewNote(null)} className="px-6 py-2.5 bg-slate-800 text-white font-bold text-[13px] rounded-xl hover:bg-slate-900 transition-colors shadow-sm">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          <header className="bg-[#002864] px-5 py-3.5 flex justify-between items-center shadow-md shrink-0 z-20">
            <div className="flex items-center gap-2">
              <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-4 sm:h-5 object-contain brightness-0 invert" alt="Logica" />
              <span className="text-white font-black text-xs opacity-80 border-l border-white/30 pl-2">{currentUser.position || '강사'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setIsProfileModalOpen(true)} className="text-[11px] font-bold text-white bg-blue-800 hover:bg-blue-700 px-3 py-1.5 rounded-lg border border-blue-600 transition-colors shadow-sm">
                정보수정
              </button>
              <button onClick={logout} className="text-[11px] font-bold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1.5 rounded-lg border border-rose-600 transition-colors shadow-sm">
                로그아웃
              </button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto custom-scroll w-full mx-auto p-4 pb-32 overscroll-contain bg-slate-50">
            <div className="w-full max-w-lg mx-auto space-y-4">
              
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-600 mb-0.5">{currentUser.dept}</div>
                  <h1 className="text-lg font-black text-slate-800"><span className="text-[#002864]">{currentUser.name}</span> 선생님, 환영합니다!</h1>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">오늘도 즐거운 하루 되세요.</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-full flex justify-center items-center text-blue-500 font-black text-xl shrink-0 overflow-hidden shadow-sm border border-slate-100">
                  {currentUser.profileImageUrl ? (
                    <img src={getProfileImageUrl(currentUser.profileImageUrl) || ''} alt="profile" className="w-full h-full object-cover" />
                  ) : (
                    currentUser.name.charAt(0)
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-[13px] font-black text-[#002864]">{calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월</h2>
                  <div className="flex items-center gap-1.5">
                    <button onClick={fetchGoogleEvents} className="w-6 h-6 flex items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors rounded text-blue-600 font-bold border border-blue-200" title="구글 캘린더 동기화">🔄</button>
                    <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="w-6 h-6 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">◀</button>
                    <button onClick={() => {setCalendarMonth(new Date()); setSelectedDate(null);}} className="px-2 py-0.5 border border-slate-300 rounded text-[10px] font-bold text-slate-600 bg-white">오늘</button>
                    <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="w-6 h-6 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">▶</button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-1 bg-slate-50 p-2 rounded-xl border border-slate-100">
                  {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                    <div key={d} className={`text-center text-[10px] font-bold mb-1 ${i === 0 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
                  ))}
                  {renderCalendarDays()}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between ml-1 mb-1 mt-6">
                  <h3 className="font-black text-[13px] text-slate-700">{selectedDate ? '선택한 날짜의 일정' : '다가오는 전체 일정'}</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={fetchGoogleEvents} className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded font-bold hover:bg-blue-100 transition-colors">🔄 동기화</button>
                    <span className="text-[10px] font-bold text-slate-400">{displayItems.length}건</span>
                  </div>
                </div>
                
                {displayItems.length === 0 ? (
                  <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center shadow-sm">
                    <span className="text-[11px] font-bold text-slate-400">등록된 안건이나 일정이 없습니다.</span>
                  </div>
                ) : (
                  displayItems.map(item => {
                    // 🌟 [핵심 변경] 구글 캘린더 일정과 회의록 시각적 분리 적용
                    const isGoogleEvent = item.isExternal;
                    const isMeetingNote = item.source === 'Meeting' && !isGoogleEvent;
                    
                    let theme;
                    if (isGoogleEvent) {
                      theme = { bg: 'bg-purple-50', text: 'text-purple-600', icon: '📆', border: 'border-purple-200' };
                    } else if (isMeetingNote) {
                      theme = { bg: 'bg-[#002864]', text: 'text-white', icon: '📁', border: 'border-blue-900' };
                    } else {
                      theme = getThemeColor(item.type, item.title);
                    }
                    
                    const itemDate = item.meeting_date ? new Date(item.meeting_date) : new Date(item.created_at);

                    let badgeText = item.type;
                    if (isGoogleEvent) badgeText = '구글 일정';
                    else if (isMeetingNote) badgeText = '회의록';
                    
                    let badgeStyle = `${theme.bg} border-transparent ${theme.text}`;
                    if (isMeetingNote) badgeStyle = 'bg-slate-100 border-slate-300 text-slate-600';
                    if (isGoogleEvent) badgeStyle = 'bg-purple-100 border-purple-300 text-purple-700';

                    return (
                      <div 
                        key={item.id} 
                        onClick={() => checkAccessAndOpen(item)}
                        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-3 cursor-pointer hover:bg-slate-50 transition-colors active:scale-[0.98]"
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm text-base ${theme.bg} ${theme.text} ${theme.border}`}>
                          {theme.icon}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="flex items-center gap-1.5 mb-1">
                            {item.is_secret && <span className="text-[10px]">🔒</span>}
                            <h4 className="text-[13px] font-black text-slate-800 truncate">{item.title}</h4>
                          </div>
                          <p className="text-[11px] font-medium text-slate-500 truncate mb-1.5">
                            {item.is_secret ? "비밀 안건으로 보호됨" : stripHtml(item.content)}
                          </p>
                          <div className="flex items-center justify-between mt-auto">
                            <span className={`px-1.5 py-0.5 text-[9px] font-black rounded border ${badgeStyle}`}>
                              {badgeText}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400">
                              {itemDate.getMonth()+1}/{itemDate.getDate()} {itemDate.getHours()}:{String(itemDate.getMinutes()).padStart(2,'0')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </main>

          {/* 메신저/녹음 위젯 연동 */}
          {currentUser.instId && (
            <FloatingChat 
              instId={currentUser.instId} 
              onMicClick={() => setIsAiModalOpen(true)} 
            />
          )}
          
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}