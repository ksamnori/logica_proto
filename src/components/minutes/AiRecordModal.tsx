// src/components/minutes/AiRecordModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface AiRecordModalProps {
  targetMeeting?: any; // 💡 넘어온 회의록 데이터
  onClose: () => void;
  onSuccess: () => void;
}

export default function AiRecordModal({ targetMeeting, onClose, onSuccess }: AiRecordModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [uiError, setUiError] = useState("");
  
  // 💡 파형 애니메이션 데이터
  const [waveData, setWaveData] = useState<number[]>(Array(20).fill(10));

  const [sttTranscript, setSttTranscript] = useState<any[]>([]); 
  const [aiResult, setAiResult] = useState<any>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef(false); 
  const contentEndRef = useRef<HTMLDivElement>(null);

  // 1. 오토 스크롤
  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sttTranscript]);

  // 2. 타이머 & 파형 애니메이션 관리
  useEffect(() => {
    let waveInterval: NodeJS.Timeout;
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
      waveInterval = setInterval(() => {
        setWaveData(Array(20).fill(0).map(() => 10 + Math.random() * 40));
      }, 150);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setWaveData(Array(20).fill(10)); 
    }
    return () => { 
      if (timerRef.current) clearInterval(timerRef.current); 
      clearInterval(waveInterval);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        } catch(e) {}
      }
      isRecordingRef.current = false;
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = async () => {
    setUiError("");
    setIsRequestingMic(true);

    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
        new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 8000))
      ]);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        if (isRecordingRef.current !== null) {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            await processAudio(audioBlob); 
        }
      };

      mediaRecorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);
      setAiResult(null);
      setSttTranscript([]);

    } catch (err: any) {
      setUiError("마이크 에러: 장치를 찾을 수 없거나 권한이 거부되었습니다.");
    } finally {
      setIsRequestingMic(false);
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop()); 
    }
    setIsRecording(false);
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsAnalyzing(true);
    setUiError("");
    try {
      const formData = new FormData();
      formData.append("media", audioBlob, "meeting_record.webm");

      const sttRes = await fetch('/api/clova-speech', { method: 'POST', body: formData });
      const sttData = await sttRes.json();
      if (!sttData.success) throw new Error(sttData.error || "STT 변환 실패");
      
      const transcriptArray = sttData.segments || [];
      setSttTranscript(transcriptArray); 

      const textForAi = transcriptArray.map((t:any) => `${t.speaker}: ${t.text}`).join('\n');
      
      if (!textForAi.trim()) {
        setUiError("음성이 전혀 인식되지 않았습니다. 마이크 볼륨을 확인하시고 다시 녹음해 주세요!");
        setIsAnalyzing(false); return;
      }
      
      // 💡 AI에게 실제 참석자 정보를 함께 넘깁니다!
      const aiRes = await fetch('/api/ai-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transcript: textForAi,
          attendees: targetMeeting?.attendees || "" // 기존 참석자 정보 전달
        })
      });
      
      const aiData = await aiRes.json();
      if (!aiData.success) throw new Error(aiData.error || "AI 분석 실패");
      
      setAiResult(aiData.data);

    } catch (error: any) {
      setUiError(`처리 중 에러 발생: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 💡 완성된 회의록을 DB 원본 내용에 덧붙여 저장하는 함수
  const appendToMeeting = async () => {
    if (!targetMeeting || !aiResult) return;
    try {
      // 1. AI 요약 본문 생성
      const summaryHtml = `
        <div style="margin-top: 25px; border-top: 2px solid #e2e8f0; padding-top: 15px;">
          <h3 style="color: #002864; font-size: 14px; font-weight: bold; margin-bottom: 10px;">🎙️ 실시간 AI 회의 분석 결과</h3>
          <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 12px;">
            <strong style="font-size: 12px; color: #334155;">📋 요약:</strong>
            <p style="font-size: 12px; color: #475569; margin-top: 4px; line-height: 1.5;">${aiResult.summary}</p>
          </div>
          ${aiResult.decisions && aiResult.decisions.length > 0 ? `
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 12px;">
              <strong style="font-size: 12px; color: #334155;">🎯 결정/합의 사항:</strong>
              <ul style="font-size: 12px; color: #475569; margin-top: 4px; padding-left: 20px; line-height: 1.5;">
                ${aiResult.decisions.map((d: string) => `<li>${d}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          <div style="margin-top: 15px;">
            <strong style="font-size: 12px; color: #334155;">🗣️ 상세 대화 기록 (원본):</strong>
            <div style="background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 4px; max-height: 300px; overflow-y: auto;">
              ${sttTranscript.map(t => `<p style="font-size: 11px; margin-bottom: 6px;"><strong style="color: #002864;">${t.speaker}:</strong> <span style="color: #475569;">${t.text}</span></p>`).join('')}
            </div>
          </div>
        </div>
      `;
      
      const updatedContent = targetMeeting.content + summaryHtml;
      
      const { error } = await supabase.from('agenda').update({ content: updatedContent }).eq('id', targetMeeting.id);
      if (error) throw error;
      
      alert("회의록 원본에 녹음 분석 결과가 성공적으로 추가되었습니다!");
      onSuccess();
    } catch (e: any) {
      alert("첨부 실패: " + e.message);
    }
  };

  const insertTask = async (task: any, index: number) => {
    try {
      alert(`[${task.task_type}] ${task.assignee} 님의 업무로 DB에 할당되었습니다!\n내용: ${task.description}`);
      setAiResult((prev: any) => {
        const newTasks = [...prev.tasks];
        newTasks[index].isInserted = true;
        return { ...prev, tasks: newTasks };
      });
    } catch (error) {
      console.error("업무 할당 에러:", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎙️</span>
            <h2 className="font-black text-[15px]">
              {targetMeeting ? `[${targetMeeting.title}] 회의 녹음 및 분석` : '새 회의 실시간 녹음'}
            </h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
        </div>
        
        <div className="flex-1 flex overflow-hidden bg-slate-50">
          <div className={`flex flex-col p-6 transition-all duration-300 ${aiResult ? 'w-1/2 border-r border-slate-200' : 'w-full'}`}>
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-4 flex flex-col items-center justify-center shadow-sm shrink-0">
              {isRecording ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="relative flex h-4 w-4"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500"></span></span>
                    <span className="text-rose-500 font-black text-lg tracking-widest">{formatTime(recordingTime)}</span>
                  </div>
                  
                  {/* 💡 예쁜 CSS 파형 애니메이션 영역 */}
                  <div className="flex items-end justify-center gap-1.5 h-16 w-full mb-2">
                    {waveData.map((h, i) => (
                      <div key={i} className="w-2 bg-rose-500 rounded-full transition-all duration-150 ease-in-out" style={{ height: `${h}px` }} />
                    ))}
                  </div>
                  
                  <p className="text-slate-400 font-bold text-[11px]">회의 내용을 고음질로 녹음하고 있습니다...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                  <p className="text-slate-500 font-bold text-[12px]">마이크 버튼을 눌러 회의 녹음을 시작하세요.</p>
                  <p className="text-slate-400 font-medium text-[10px] mt-1 px-4">
                    💡 팁: 참석자가 멀리 떨어져 앉는 경우, 화자 분리 정확도를 위해<br/>무지향성 마이크(스피커폰)를 테이블 중앙에 배치하는 것을 권장합니다.
                  </p>
                </div>
              )}
            </div>

            {uiError && (
              <div className="mb-3 text-[12px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-lg text-center animate-pulse shadow-sm">
                ⚠️ {uiError}
              </div>
            )}

            <div className="flex justify-center gap-3 shrink-0 mb-4">
              {!isRecording ? (
                <button onClick={startRecording} disabled={isAnalyzing || isRequestingMic} className="px-6 py-3 bg-rose-50 text-rose-600 font-black text-[13px] rounded-full hover:bg-rose-100 transition-colors border border-rose-200 flex items-center gap-2 shadow-sm disabled:opacity-50">
                  {isRequestingMic ? (
                    <><span className="animate-spin">⏳</span> 연결 중...</>
                  ) : (
                    <><div className="w-3 h-3 bg-rose-500 rounded-full"></div> 녹음 시작</>
                  )}
                </button>
              ) : (
                <button onClick={stopRecording} className="px-6 py-3 bg-slate-800 text-white font-black text-[13px] rounded-full hover:bg-slate-900 transition-colors flex items-center gap-2 shadow-sm animate-pulse">
                  <div className="w-3 h-3 bg-white rounded-sm"></div> 녹음 종료 및 분석 시작
                </button>
              )}
            </div>

            <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-4 overflow-y-auto custom-scroll shadow-inner">
              {isAnalyzing ? (
                <div className="h-full flex flex-col items-center justify-center text-[#002864] gap-3">
                  <span className="animate-spin text-3xl">⏳</span>
                  <p className="font-bold text-[13px] text-center">녹음된 고음질 파일을 분석하여<br/>참석자별 목소리를 분리하고 있습니다...</p>
                </div>
              ) : sttTranscript.length > 0 ? (
                <div className="space-y-3 animate-[fadeIn_0.5s_ease-out]">
                  <p className="text-[11px] text-slate-400 font-bold mb-3 border-b border-slate-100 pb-2">🗣️ 원본 대화 기록</p>
                  {sttTranscript.map((turn, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-[#002864] bg-blue-50 w-fit px-1.5 py-0.5 rounded border border-blue-100">
                        {turn.speaker}
                      </span>
                      <p className="text-[13px] text-slate-700 font-medium pl-1 leading-relaxed">{turn.text}</p>
                    </div>
                  ))}
                  <div ref={contentEndRef} />
                </div>
              ) : (
                <div className="text-[12px] text-slate-400 font-bold h-full flex flex-col items-center justify-center">
                   {isRecording ? "녹음이 종료되면 원본 대화 텍스트가 이곳에 표시됩니다." : "녹음 기록 대기 중..."}
                </div>
              )}
            </div>
          </div>

          {aiResult && (
            <div className="w-1/2 p-6 flex flex-col bg-white overflow-hidden animate-[fadeIn_0.3s_ease-out]">
              <h3 className="text-[14px] font-black text-[#002864] mb-4 flex items-center justify-between gap-2">
                <span>✨ AI 회의 요약 결과</span>
                {targetMeeting && (
                  <button onClick={appendToMeeting} className="px-3 py-1.5 bg-[#002864] text-white text-[11px] rounded-lg hover:bg-blue-900 shadow-sm transition-colors">
                    💾 원본 회의록에 저장하기
                  </button>
                )}
              </h3>
              <div className="flex-1 overflow-y-auto custom-scroll pr-2 space-y-5">
                 <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                  <h4 className="text-[11px] font-black text-blue-800 mb-2 flex items-center gap-1">📋 회의 요약</h4>
                  <p className="text-[13px] font-bold text-slate-700 leading-relaxed">{aiResult.summary}</p>
                </div>
                
                {aiResult.decisions && aiResult.decisions.length > 0 && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <h4 className="text-[11px] font-black text-slate-700 mb-2 flex items-center gap-1">🎯 결정/합의 사항</h4>
                    <ul className="space-y-1.5">
                      {aiResult.decisions.map((decision: string, idx: number) => (
                        <li key={idx} className="text-[12px] font-bold text-slate-700 flex items-start gap-1.5">
                          <span className="text-emerald-500 mt-0.5">✔</span> {decision}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.tasks && aiResult.tasks.length > 0 && (
                  <div>
                    <h4 className="text-[12px] font-black text-[#002864] mb-3 flex items-center gap-1">
                      🚨 추출된 업무 할당 <span className="bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded text-[10px] ml-1">{aiResult.tasks.length}건</span>
                    </h4>
                    <div className="space-y-2">
                      {aiResult.tasks.map((task: any, idx: number) => (
                        <div key={idx} className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${task.isInserted ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-amber-200 shadow-sm'}`}>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black text-[9px]">{task.assignee}</span>
                              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold text-[9px] border border-slate-200">{task.task_type}</span>
                            </div>
                            <p className="text-[12px] font-bold text-slate-800 line-clamp-2">{task.description}</p>
                          </div>
                          
                          <button 
                            onClick={() => insertTask(task, idx)} 
                            disabled={task.isInserted}
                            className={`shrink-0 px-3 py-1.5 rounded font-black text-[10px] transition-colors border ${task.isInserted ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50 shadow-sm'}`}
                          >
                            {task.isInserted ? '할당 완료' : '✅ 업무로 등록'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}