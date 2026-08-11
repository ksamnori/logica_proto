// src/components/minutes/BindMeetingModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import SimpleEditor from "./SimpleEditor";

interface BindMeetingModalProps {
  selectedIds: string[];
  agendas: any[];
  instructors: any[];
  currentUser: { instId: string; name: string };
  meetingToEdit?: any; 
  onClose: () => void;
  onSuccess: (folder?: string) => void;
}

export default function BindMeetingModal({ selectedIds, agendas, instructors, currentUser, meetingToEdit, onClose, onSuccess }: BindMeetingModalProps) {
  const [mode, setMode] = useState<'NEW' | 'EXISTING'>('NEW');
  const [targetMeetingId, setTargetMeetingId] = useState("");

  const [meetingTitle, setMeetingTitle] = useState("");
  const [folder, setFolder] = useState("주간 회의");
  const [meetingResult, setMeetingResult] = useState(""); 
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [meetingDateStr, setMeetingDateStr] = useState(tomorrow.toISOString().split('T')[0]);
  const [meetingTimeStr, setMeetingTimeStr] = useState("10:00");
  
  const [isSyncGcal, setIsSyncGcal] = useState(true);
  const [isSecret, setIsSecret] = useState(false); 

  const [selectedInstIds, setSelectedInstIds] = useState<string[]>([]);
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(selectedIds);
  const [showAddList, setShowAddList] = useState(false); 

  const selectedItems = agendas.filter(a => localSelectedIds.includes(a.id));
  const unselectedAgendas = agendas.filter(a => !localSelectedIds.includes(a.id) && a.status !== '완료' && a.source !== 'Meeting' && !a.isExternal);
  const existingMeetings = agendas.filter(a => a.source === 'Meeting' && !a.isExternal);

  const toggleInst = (id: string) => { setSelectedInstIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const toggleAllInsts = () => { if (selectedInstIds.length === instructors.length) setSelectedInstIds([]); else setSelectedInstIds(instructors.map(i => i.instructor_id)); };

  useEffect(() => {
    if (meetingToEdit) {
      setMode('EXISTING');
      setTargetMeetingId(meetingToEdit.id);
    }
  }, [meetingToEdit]);

  useEffect(() => {
    if (mode === 'EXISTING' && targetMeetingId) {
      const target = agendas.find(a => a.id === targetMeetingId);
      if (target) {
        setMeetingTitle(target.title);
        setFolder(target.type);
        const cleanContent = target.content ? target.content.replace(/<div data-linked-ids="[^"]*" style="display:none;"><\/div>/g, '') : "";
        setMeetingResult(cleanContent);
        setIsSecret(target.is_secret || false); 
        
        if (target.meeting_date) {
          const d = new Date(target.meeting_date);
          setMeetingDateStr(d.toISOString().split('T')[0]);
          setMeetingTimeStr(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
        }
        if (target.attendees) {
          const names = target.attendees.split(',').map((n: string) => n.trim());
          const ids = instructors.filter(i => names.includes(i.name)).map(i => i.instructor_id);
          setSelectedInstIds(ids);
        } else { setSelectedInstIds([]); }
      }
    } else { setMeetingTitle(""); }
  }, [mode, targetMeetingId, agendas, instructors]);

  const stripHtml = (html: string) => { if (!html) return ""; return html.replace(/<[^>]+>/g, ' ').trim(); };

  const insertAgendaContent = async (item: any) => {
    if (item.is_secret) setIsSecret(true);

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
    
    let commentsSection = "";
    if (commentsHtml) {
      commentsSection = `
        <div style="margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:8px;">
          <strong style="font-size:11px; color:#475569;">💬 소통 내역 (댓글):</strong>
          ${commentsHtml}
        </div>
      `;
    }

    let safeContent = item.content;
    if (item.is_secret) {
      safeContent = `<div class="secret-agenda-placeholder" data-agenda-id="${item.id}" style="color:#64748b; font-weight:bold; font-size:12px; background:#f1f5f9; padding:10px; border-radius:6px; border:1px solid #cbd5e1;">🔒 비밀 안건으로 보호되어 상세 내용이 표시되지 않습니다.<br/><span style="font-weight:normal; font-size:11px; margin-top:4px; display:inline-block;">(저장 후 실제 회의록을 열람할 때 참석자에게만 원본 내용이 복호화되어 표시됩니다)</span></div>`;
    }

    const htmlToInsert = `
      <div class="agenda-block" style="border:1px solid #cbd5e1; padding:12px; border-radius:6px; margin-bottom:12px; background:white; page-break-inside: avoid;">
        <h4 style="color:#002864; margin:0 0 8px 0; font-size:14px; font-weight:bold;">📌 ${item.title}</h4>
        <div style="margin:0; color:#334155; line-height:1.4; font-size:12px;">${safeContent}</div>
        ${commentsSection}
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
    if (mode === 'EXISTING' && !targetMeetingId) return alert("수정/추가할 회의 일정을 선택해주세요.");
    if (!meetingTitle.trim()) return alert("회의록 제목을 입력해주세요.");
    
    const participantNames = selectedInstIds.map(id => instructors.find(i => i.instructor_id === id)?.name).join(', ');
    const meetingDateTime = new Date(`${meetingDateStr}T${meetingTimeStr}:00`).toISOString();

    // 🌟 [추가됨] 병합 회의록 생성 전 꼬리표 챙기기
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    try {
      if (mode === 'NEW') {
        const meetingId = crypto.randomUUID();
        const hiddenLinkData = `<div data-linked-ids="${localSelectedIds.join(',')}" style="display:none;"></div>`;
        
        const newMeetingObj = {
          id: meetingId,
          title: meetingTitle,
          content: (meetingResult || '<p>본문 내용 없음</p>') + hiddenLinkData,
          type: folder, 
          source: "Meeting",
          source_id: meetingId, 
          status: "진행중", 
          created_by: currentUser.instId,
          attendees: participantNames,
          meeting_date: meetingDateTime,
          is_secret: isSecret,
          tenant_id: myTenantId // 🌟 [추가됨] 병합 회의록에도 꼬리표 부착!
        };

        if (isSyncGcal && !isSecret) { 
          try { await syncToGoogleCalendarBackend([newMeetingObj]); } 
          catch (error) { if (!confirm("백엔드 캘린더 동기화에 실패했습니다.\nLogica 시스템에는 그래도 일정을 등록할까요?")) return; }
        }

        const { error } = await supabase.from("agenda").insert(newMeetingObj);
        if (error) throw error;

      } else {
        const targetMeeting = agendas.find(a => a.id === targetMeetingId);
        
        if (!targetMeeting.is_secret && isSecret) {
          try {
            await fetch(`/api/calendar?title=${encodeURIComponent('[Logica] ' + targetMeeting.title)}`, { method: 'DELETE' });
          } catch (e) {
            console.error('구글 캘린더 연동 해제(삭제) 실패:', e);
          }
        }

        let existingLinkedIds: string[] = [];
        if (targetMeeting.content) {
          const match = targetMeeting.content.match(/data-linked-ids="([^"]+)"/);
          if (match && match[1]) existingLinkedIds = match[1].split(',');
        }
        
        const mergedIds = Array.from(new Set([...existingLinkedIds, ...localSelectedIds])).filter(Boolean);
        const hiddenLinkData = mergedIds.length > 0 ? `<div data-linked-ids="${mergedIds.join(',')}" style="display:none;"></div>` : '';

        // 수정 시에는 이미 tenant_id가 있으므로 추가 불필요
        const { error } = await supabase.from("agenda").update({
          title: meetingTitle,
          content: meetingResult + hiddenLinkData, 
          type: folder, 
          meeting_date: meetingDateTime,
          attendees: participantNames,
          is_secret: isSecret
        }).eq('id', targetMeetingId);
        if (error) throw error;
      }

      if (localSelectedIds.length > 0) {
        await supabase.from('agenda').update({ status: '진행중' }).in('id', localSelectedIds);
      }

      alert(mode === 'NEW' ? "새 회의록 병합이 완료되었습니다!" : "회의록이 성공적으로 저장(업데이트)되었습니다!");
      onSuccess(folder); 
    } catch (e: any) { alert(`회의록 저장/업데이트 실패: ${e.message || 'DB 에러'}`); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-3 text-white flex justify-between items-center shrink-0">
          <h2 className="font-black text-[13px] flex items-center gap-2">{meetingToEdit ? '✏️ 상세 일정 및 회의록 편집' : '✨ 여러 안건을 모아서 회의록 병합'}</h2>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-xl font-bold leading-none">&times;</button>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[300px] border-r border-slate-200 bg-slate-50 flex flex-col shrink-0">
            <div className="h-[40%] flex flex-col p-3 border-b border-slate-200 bg-white shadow-sm">
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
              <h3 className="text-[12px] font-black text-[#002864] mb-2 shrink-0 flex items-center gap-1">📌 병합/추가할 안건 ({selectedItems.length}개)</h3>
              <div className="flex-1 overflow-y-auto custom-scroll space-y-1.5 pr-1">
                {selectedItems.map(item => (
                  <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between gap-1.5 group hover:border-blue-300 transition-colors">
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="text-[11px] font-bold text-slate-700 truncate"><span className="text-blue-500 mr-1">📌</span>{item.title}</div>
                      <div className="text-[9px] text-slate-400 truncate pl-4">
                        {item.is_secret ? "🔒 비밀 안건 (보호됨)" : stripHtml(item.content)}
                      </div>
                    </div>
                    <button onClick={() => insertAgendaContent(item)} className="shrink-0 px-1.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#002864] border border-blue-200 rounded text-[9px] font-black transition-colors">삽입</button>
                  </div>
                ))}
              </div>
              
              <div className="mt-2 pt-2 border-t border-slate-200 shrink-0">
                <button onClick={() => setShowAddList(!showAddList)} className="text-[10px] text-blue-600 font-bold flex items-center gap-1 w-full justify-center bg-blue-50 py-1.5 rounded hover:bg-blue-100 transition-colors">
                  {showAddList ? '숨기기 닫기' : '➕ 다른 대기 안건 끌어오기'}
                </button>
                {showAddList && (
                  <div className="mt-1.5 h-32 overflow-y-auto custom-scroll space-y-1 bg-white p-1 border border-blue-100 rounded shadow-inner">
                    {unselectedAgendas.map(a => (
                      <div key={a.id} className="flex justify-between items-center bg-slate-50 border border-slate-100 p-1.5 rounded text-[10px]">
                        <div className="flex-1 min-w-0 flex flex-col mr-1">
                          <span className="truncate text-slate-700 font-bold">{a.title}</span>
                          <span className="truncate text-[8px] text-slate-400">
                            {a.is_secret ? "🔒 비밀 안건 (보호됨)" : stripHtml(a.content)}
                          </span>
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
            {!meetingToEdit && (
              <div className="flex bg-slate-100 p-1 rounded-lg shrink-0 mb-4 border border-slate-200">
                <button onClick={() => { setMode('NEW'); setTargetMeetingId(''); }} className={`flex-1 text-[11px] font-bold py-1.5 rounded-md transition-colors ${mode === 'NEW' ? 'bg-white text-[#002864] shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                  ✨ 새 회의 일정으로 병합
                </button>
                <button onClick={() => setMode('EXISTING')} className={`flex-1 text-[11px] font-bold py-1.5 rounded-md transition-colors ${mode === 'EXISTING' ? 'bg-white text-[#002864] shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                  📌 기존 예정된 일정에 꽂아넣기
                </button>
              </div>
            )}

            {mode === 'EXISTING' && !meetingToEdit && (
              <div className="mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 shrink-0">
                <label className="block text-[11px] font-bold text-blue-800 mb-1.5">어떤 회의에 이 안건들을 추가할까요?</label>
                <select value={targetMeetingId} onChange={e => setTargetMeetingId(e.target.value)} className="w-full text-[12px] font-bold text-slate-700 border border-blue-200 rounded-lg p-2 focus:outline-none focus:border-blue-500 bg-white">
                  <option value="">-- 일정을 선택하세요 --</option>
                  {existingMeetings.map(m => (
                    <option key={m.id} value={m.id}>
                      [{m.type}] {m.title} ({m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : '날짜 미정'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 shrink-0 mb-3 bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
              <div className="w-[20%]">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">저장/이동할 폴더</label>
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
                  {mode === 'NEW' && (
                    <label className="flex items-center gap-1.5 text-[11px] font-black text-blue-600 cursor-pointer hover:bg-blue-50 p-0.5 rounded transition-colors">
                      <input type="checkbox" checked={isSyncGcal} onChange={(e) => setIsSyncGcal(e.target.checked)} disabled={isSecret} className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-30 disabled:cursor-not-allowed" />
                      📆 캘린더 연동
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-[11px] font-black text-slate-700 cursor-pointer hover:bg-slate-200 p-0.5 rounded transition-colors">
                    <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} className="w-3.5 h-3.5 accent-slate-800" />
                    🔒 비밀 회의록 (참석자만)
                  </label>
                </div>
              </div>
            </div>
            
            <div className="mb-2 shrink-0">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">회의록 제목 <span className="text-rose-500">*</span></label>
              <input type="text" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="예: 8월 2주차 전체 강사 정기 회의" className="w-full text-[13px] font-black text-slate-800 border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-[#002864]" />
            </div>

            <div className="flex-1 flex flex-col min-h-0 mt-1">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">회의 내용 및 템플릿</label>
              <div className="flex-1 h-full border border-slate-200 rounded-lg overflow-hidden shadow-inner">
                <SimpleEditor value={meetingResult} onChange={setMeetingResult} placeholder="좌측에서 안건 내용을 불러오거나, 회의 결과를 자유롭게 작성하세요." />
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-[10px] font-bold text-slate-500">병합/수정이 완료되면 우측 캘린더에 즉시 연동됩니다.</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-white text-slate-600 border border-slate-300 font-bold text-[12px] rounded-lg hover:bg-slate-100 transition-colors shadow-sm">취소</button>
            <button onClick={handleCreateMeeting} className="px-4 py-2 bg-[#002864] text-white font-bold text-[12px] rounded-lg hover:bg-blue-900 transition-colors shadow-sm flex items-center gap-1.5">
              <span>{mode === 'NEW' ? '✨' : '📌'}</span> {mode === 'NEW' ? '일정 생성 및 병합' : '변경 사항 저장 (업데이트)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}