// src/components/minutes/ScheduleMeetingModal.tsx
"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import SimpleEditor from "./SimpleEditor";

interface ScheduleMeetingModalProps {
  agendas: any[];
  instructors: any[];
  currentUser: { instId: string; name: string };
  onClose: () => void;
  onSuccess: () => void;
}

export default function ScheduleMeetingModal({ agendas, instructors, currentUser, onClose, onSuccess }: ScheduleMeetingModalProps) {
  const [meetingTitle, setMeetingTitle] = useState("");
  const [folder, setFolder] = useState("주간 회의");
  const [meetingResult, setMeetingResult] = useState(""); 
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [meetingDateStr, setMeetingDateStr] = useState(tomorrow.toISOString().split('T')[0]);
  const [meetingTimeStr, setMeetingTimeStr] = useState("10:00");
  
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [isSyncGcal, setIsSyncGcal] = useState(true);
  const [isSecret, setIsSecret] = useState(false); 

  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>([]);
  const [showAddList, setShowAddList] = useState(false);
  
  const selectedItems = agendas.filter(a => localSelectedIds.includes(a.id));
  const unselectedAgendas = agendas.filter(a => !localSelectedIds.includes(a.id) && a.status !== '완료' && a.source !== 'Meeting');
  const pastMeetings = agendas.filter(a => a.source === 'Meeting');

  const stripHtml = (html: string) => { if (!html) return ""; return html.replace(/<[^>]+>/g, ' ').trim(); };
  const toggleInst = (id: string) => { setSelectedInstIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const toggleAllInsts = () => { if (selectedInstIds.length === instructors.length) setSelectedInstIds([]); else setSelectedInstIds(instructors.map(i => i.instructor_id)); };

  const loadTemplate = (content: string) => {
    if (confirm("이전 회의록의 본문 내용을 그대로 불러오시겠습니까?\n(현재 작성 중인 내용은 덮어씌워집니다.)")) {
      const cleanContent = content ? content.replace(/<div data-linked-ids="[^"]*" style="display:none;"><\/div>/g, '') : "";
      setMeetingResult(cleanContent);
    }
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
            commentsHtml = data.comments.map((c:any) => `<li style="margin-bottom:2px;"><b>${c.authorName}</b>: ${c.text} <span style="color:#94a3b8; font-size:0.8em;">(${c.createdAt})</span></li>`).join('');
            commentsHtml = `<ul style="margin-top:4px; background:#f8fafc; padding:6px 6px 6px 20px; border-radius:4px; list-style-type:disc; border: 1px solid #f1f5f9; font-size:12px;">${commentsHtml}</ul>`;
          }
        } catch(e) {}
      }
    }
    if (!commentsHtml) commentsHtml = `<p style="color:#94a3b8; font-size:0.85em; margin-top:4px;">등록된 소통 기록이 없습니다.</p>`;

    const htmlToInsert = `
      <div class="agenda-block" style="border:1px solid #cbd5e1; padding:12px; border-radius:6px; margin-bottom:12px; background:white; page-break-inside: avoid;">
        <h4 style="color:#002864; margin:0 0 8px 0; font-size:14px; font-weight:bold;">📌 ${item.title}</h4>
        <div style="margin:0; color:#334155; line-height:1.4; font-size:12px;">${item.content}</div>
        <div style="margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:8px;">
          <strong style="font-size:11px; color:#475569;">💬 소통 내역 (댓글):</strong>
          ${commentsHtml}
        </div>
      </div>
      <p><br/></p>
    `;
    setMeetingResult(prev => { const topSpace = (!prev || prev.trim() === '') ? '<p><br></p>' : ''; return prev + topSpace + htmlToInsert; });
  };

  const syncToGoogleCalendarBackend = async (meetingsArray: any[]) => {
    const events = meetingsArray.map(m => {
      const startTime = new Date(m.meeting_date);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); 
      const plainTextDesc = m.content ? stripHtml(m.content) : '내용 없음';
      return {
        summary: `[Logica] ${m.title}`,
        description: `👥 참석자: ${m.attendees || '없음'}\n\n${plainTextDesc}`,
        start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Seoul' },
        end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Seoul' },
      };
    });

    const res = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events })
    });
    if (!res.ok) throw new Error("API Route 에러");
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data;
  };

  const handleCreateMeeting = async () => {
    if (!meetingTitle.trim()) return alert("회의록/일정 제목을 입력해주세요.");
    if (!meetingDateStr || !meetingTimeStr) return alert("날짜와 시간을 지정해주세요.");

    // 🌟 [추가됨] 새 회의 일정 등록 전 소속 지점 꼬리표 챙기기
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    const participantNames = selectedInstIds.map(id => instructors.find(i => i.instructor_id === id)?.name).join(', ');
    const baseDate = new Date(`${meetingDateStr}T${meetingTimeStr}:00`);
    const hiddenLinkData = localSelectedIds.length > 0 ? `<div data-linked-ids="${localSelectedIds.join(',')}" style="display:none;"></div>` : '';

    const meetingsToInsert = [];
    const totalRuns = isRecurring ? recurringWeeks : 1;

    for (let i = 0; i < totalRuns; i++) {
      const meetingId = crypto.randomUUID();
      const currentMeetingDate = new Date(baseDate.getTime() + (i * 7 * 24 * 60 * 60 * 1000));
      const suffix = isRecurring ? ` (${i+1}주차)` : '';

      meetingsToInsert.push({
        id: meetingId,
        title: meetingTitle + suffix,
        content: (meetingResult || '<p>본문 내용 없음</p>') + hiddenLinkData,
        type: folder, 
        source: "Meeting",
        source_id: meetingId, 
        status: "대기중", 
        created_by: currentUser.instId,
        meeting_date: currentMeetingDate.toISOString(), 
        attendees: participantNames,
        is_secret: isSecret,
        tenant_id: myTenantId // 🌟 [추가됨] 모든 회의록/일정에 꼬리표 부착!
      });
    }

    if (isSyncGcal && !isSecret) { 
      try { 
        await syncToGoogleCalendarBackend(meetingsToInsert); 
      } catch (error) { 
        if (!confirm("백엔드 캘린더 동기화에 실패했습니다. (원장님 권한 확인 필요)\nLogica 시스템에는 그래도 일정을 등록할까요?")) return; 
      }
    }

    try {
      const { error } = await supabase.from("agenda").insert(meetingsToInsert);
      if (error) throw error; 

      if (localSelectedIds.length > 0) {
        await supabase.from('agenda').update({ status: '진행중' }).in('id', localSelectedIds);
      }
      alert(`성공적으로 ${totalRuns}개의 일정이 등록${isSyncGcal && !isSecret ? ' 및 동기화' : ''}되었습니다!`);
      onSuccess();
    } catch (e: any) { alert(`일정 등록 실패: ${e.message || 'DB 에러'}`); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-3 text-white flex justify-between items-center shrink-0">
          <h2 className="font-black text-[13px] flex items-center gap-2">📅 새 회의 / 일정 예약하기</h2>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-xl font-bold leading-none">&times;</button>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[300px] border-r border-slate-200 bg-slate-50 flex flex-col shrink-0">
            <div className="h-[25%] flex flex-col p-3 border-b border-slate-200 bg-white shadow-sm">
              <div className="flex justify-between items-center mb-2 shrink-0">
                <h3 className="text-[12px] font-black text-[#002864] flex items-center gap-1">👥 참석자 배정</h3>
                <button onClick={toggleAllInsts} className="text-[9px] bg-slate-100 border border-slate-200 hover:bg-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-600 transition-colors">전체 선택</button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll flex flex-col gap-0.5 pr-1">
                {instructors.map(inst => (
                  <label key={inst.instructor_id} className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors border border-transparent hover:border-slate-100">
                    <input type="checkbox" checked={selectedInstIds.includes(inst.instructor_id)} onChange={() => toggleInst(inst.instructor_id)} className="w-3.5 h-3.5 accent-[#002864]" />
                    <span className="text-[11px] font-bold text-slate-700">{inst.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col p-3 min-h-0">
              <h3 className="text-[12px] font-black text-[#002864] mb-2 shrink-0 flex items-center gap-1">📚 이전 회의록 (템플릿)</h3>
              <div className="h-[180px] overflow-y-auto custom-scroll space-y-1.5 pr-1 border-b border-slate-200 pb-2 mb-2">
                {pastMeetings.map(item => (
                  <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-1.5 group hover:border-blue-300 transition-colors">
                    <div className="text-[11px] font-bold text-slate-700 truncate"><span className="text-blue-500 mr-1">📁</span>{item.title}</div>
                    <button onClick={() => loadTemplate(item.content)} className="w-full py-1 bg-blue-50 hover:bg-blue-100 text-[#002864] border border-blue-200 rounded text-[9px] font-black transition-colors">내용 가져오기</button>
                  </div>
                ))}
              </div>

              <h3 className="text-[12px] font-black text-[#002864] mb-2 shrink-0 flex items-center gap-1">📌 상정할 안건 ({selectedItems.length}개)</h3>
              <div className="flex-1 overflow-y-auto custom-scroll space-y-1.5 pr-1">
                {selectedItems.map(item => (
                  <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between gap-1.5 group hover:border-blue-300 transition-colors">
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="text-[11px] font-bold text-slate-700 truncate"><span className="text-blue-500 mr-1">📌</span>{item.title}</div>
                      <div className="text-[9px] text-slate-400 truncate pl-4">{stripHtml(item.content)}</div>
                    </div>
                    <button onClick={() => insertAgendaContent(item)} className="shrink-0 px-1.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#002864] border border-blue-200 rounded text-[9px] font-black transition-colors">삽입</button>
                  </div>
                ))}
              </div>
              
              <div className="mt-2 pt-2 border-t border-slate-200 shrink-0">
                <button onClick={() => setShowAddList(!showAddList)} className="text-[10px] text-blue-600 font-bold flex items-center gap-1 w-full justify-center bg-blue-50 py-1.5 rounded hover:bg-blue-100 transition-colors">
                  {showAddList ? '숨기기 닫기' : '➕ 다른 안건 추가하기'}
                </button>
                {showAddList && (
                  <div className="mt-1.5 h-32 overflow-y-auto custom-scroll space-y-1 bg-white p-1 border border-blue-100 rounded shadow-inner">
                    {unselectedAgendas.map(a => (
                      <div key={a.id} className="flex justify-between items-center bg-slate-50 border border-slate-100 p-1.5 rounded text-[10px]">
                        <div className="flex-1 min-w-0 flex flex-col mr-1">
                          <span className="truncate text-slate-700 font-bold">{a.title}</span>
                          <span className="truncate text-[8px] text-slate-400">{stripHtml(a.content)}</span>
                        </div>
                        <button onClick={() => setLocalSelectedIds([...localSelectedIds, a.id])} className="text-blue-600 font-black px-1.5 py-0.5 bg-white border border-blue-200 rounded shadow-sm hover:bg-blue-50 shrink-0">선택</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col p-5 bg-white overflow-hidden min-w-0">
            <div className="flex gap-3 shrink-0 mb-3 bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
              <div className="w-[20%]">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">폴더 위치</label>
                <select value={folder} onChange={e => setFolder(e.target.value)} className="w-full text-[12px] font-bold text-slate-700 border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864] bg-white">
                  <option value="주간 회의">📁 주간 회의</option>
                  <option value="임시 회의">📁 임시 회의</option>
                  <option value="상담/면담">📁 상담/면담</option>
                </select>
              </div>
              <div className="w-[20%]">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">날짜 예약</label>
                <input type="date" value={meetingDateStr} onChange={e => setMeetingDateStr(e.target.value)} className="w-full text-[12px] font-bold text-[#002864] border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864] bg-white" />
              </div>
              <div className="w-[20%]">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">시간 예약</label>
                <input type="time" value={meetingTimeStr} onChange={e => setMeetingTimeStr(e.target.value)} className="w-full text-[12px] font-bold text-[#002864] border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864] bg-white" />
              </div>
              
              <div className="flex-1 border-l border-slate-200 pl-3 flex justify-end items-center gap-3">
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <label className="flex items-center gap-1 text-[11px] font-bold text-[#002864] cursor-pointer">
                    <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} className="w-3.5 h-3.5 accent-[#002864]" />
                    매주 반복
                  </label>
                  {isRecurring && (
                    <select value={recurringWeeks} onChange={e => setRecurringWeeks(Number(e.target.value))} className="text-[10px] font-bold text-rose-600 border border-rose-300 rounded focus:outline-none bg-rose-50">
                      <option value={4}>4주</option>
                      <option value={8}>8주</option>
                      <option value={12}>12주</option>
                    </select>
                  )}
                  <div className="w-px h-4 bg-slate-300 mx-1"></div>
                  
                  <label className="flex items-center gap-1.5 text-[11px] font-black text-blue-600 cursor-pointer hover:bg-blue-50 p-0.5 rounded transition-colors">
                    <input type="checkbox" checked={isSyncGcal} onChange={(e) => setIsSyncGcal(e.target.checked)} disabled={isSecret} className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-30 disabled:cursor-not-allowed" />
                    📆 캘린더 연동
                  </label>

                  <label className="flex items-center gap-1.5 text-[11px] font-black text-slate-700 cursor-pointer hover:bg-slate-200 p-0.5 rounded transition-colors">
                    <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} className="w-3.5 h-3.5 accent-slate-800" />
                    🔒 비밀 회의록 (참석자만)
                  </label>
                </div>
              </div>
            </div>

            <div className="mb-3 shrink-0">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">일정/회의록 제목 <span className="text-rose-500">*</span></label>
              <input type="text" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="예: 8월 정기 주간 회의" className="w-full text-[13px] font-black text-slate-800 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]" />
            </div>

            <div className="flex-1 flex flex-col min-h-0 mt-1">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">회의 내용 및 템플릿 (미리 작성 가능)</label>
              <div className="flex-1 h-full border border-slate-200 rounded-lg overflow-hidden shadow-inner">
                <SimpleEditor value={meetingResult} onChange={setMeetingResult} placeholder="좌측에서 이전 회의록을 불러오거나, 안건을 삽입할 수 있습니다." />
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-[10px] font-bold text-slate-500">지정한 날짜와 시간은 우측 달력(캘린더)에 즉시 연동됩니다.</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-white text-slate-600 border border-slate-300 font-bold text-[12px] rounded-lg hover:bg-slate-100 transition-colors shadow-sm">취소</button>
            <button onClick={handleCreateMeeting} className="px-4 py-2 bg-[#002864] text-white font-bold text-[12px] rounded-lg hover:bg-blue-900 transition-colors shadow-sm flex items-center gap-1.5">
              <span>🗓️</span> 일정 등록 및 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}