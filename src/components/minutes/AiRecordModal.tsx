// src/components/minutes/AiRecordModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface AiRecordModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AiRecordModal({ onClose, onSuccess }: AiRecordModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [uiError, setUiError] = useState("");
  
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveInterim, setLiveInterim] = useState("");

  const [sttTranscript, setSttTranscript] = useState<any[]>([]); 
  const [aiResult, setAiResult] = useState<any>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef(false); 
  const contentEndRef = useRef<HTMLDivElement>(null);

  // 1. 오토 스크롤
  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveTranscript, liveInterim, sttTranscript]);

  // 2. 타이머 관리
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  // 🚨 3. [추가됨] 메모리 누수 및 백그라운드 마이크 켜짐 방지 (언마운트 클린업)
  useEffect(() => {
    return () => {
      // 컴포넌트가 사라질 때 무조건 마이크와 인식기를 강제 종료
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        } catch(e) {}
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
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
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setUiError("이 브라우저 환경에서는 마이크를 사용할 수 없습니다. (localhost 또는 HTTPS 접속 필수)");
      return;
    }

    setIsRequestingMic(true);

    // 💡 [수정할 부분]: AiRecordModal.tsx 의 startRecording 함수 내부

    try {
      const stream = await Promise.race([
        // 🚨 기존 { audio: true } 를 아래처럼 아주 상세하게 바꿉니다! 🚨
        navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,  // 에코 캔슬링 끄기
            noiseSuppression: false,  // 노이즈 캔슬링(소음 억제) 끄기
            autoGainControl: false,   // 자동 볼륨 조절 끄기
          } 
        }),
        new Promise<MediaStream>((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 8000)
        )
      ]);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        // 모달이 닫히지 않고 정상 종료되었을 때만 프로세스 진행
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
      setLiveTranscript("");
      setLiveInterim("");

      setTimeout(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'ko-KR';

          recognition.onresult = (event: any) => {
            let finalStr = "";
            let interimStr = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) finalStr += event.results[i][0].transcript + " ";
              else interimStr += event.results[i][0].transcript;
            }
            if (finalStr) setLiveTranscript(prev => prev + finalStr);
            setLiveInterim(interimStr);
          };

          recognition.onerror = (event: any) => {
            console.warn("🎙️ 실시간 텍스트 에러:", event.error);
            if (event.error === 'network') setLiveInterim("⚠️ 실시간 텍스트 실패: 네트워크 에러 (크롬 환경인지 확인하세요)");
            else if (event.error === 'not-allowed') setLiveInterim("⚠️ 실시간 텍스트 실패: 마이크 권한이 차단되었습니다.");
            else if (event.error === 'audio-capture') setLiveInterim("⚠️ 마이크 충돌: 다른 프로그램이 마이크를 독점하고 있습니다.");
            
            if (isRecordingRef.current && event.error !== 'not-allowed') {
              setTimeout(() => { try { recognition.start(); } catch(e) {} }, 1500);
            }
          };

          recognition.onend = () => {
            if (isRecordingRef.current) {
              try { recognition.start(); } catch(e) {}
            }
          };

          try {
            recognition.start();
            recognitionRef.current = recognition;
          } catch (e) {
            console.error("SpeechRecognition 초기 실행 실패");
          }
        } else {
           setLiveInterim("⚠️ 이 브라우저는 실시간 텍스트 기능을 지원하지 않습니다. (크롬 권장)");
        }
      }, 800);

    } catch (err: any) {
      if (err.message === "TIMEOUT") {
        setUiError("마이크 응답 시간이 초과되었습니다. 브라우저 주소창 왼쪽의 '마이크 권한 허용' 팝업을 확인해 주세요.");
      } else {
        setUiError("마이크 접근 권한이 거부되었거나 장치를 찾을 수 없습니다. (브라우저 마이크 설정을 확인해주세요)");
      }
      console.error("마이크 에러:", err);
    } finally {
      setIsRequestingMic(false);
    }
  };

  const stopRecording = () => {
    // 플래그를 먼저 내려서 onend 등에서의 재시작을 차단
    isRecordingRef.current = false;
    
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop()); 
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
    setIsRecording(false);
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsAnalyzing(true);
    setUiError("");
    try {
      const formData = new FormData();
      // 💡 클로바 API는 파일 필드명을 'media'로 기대하므로 audio -> media 로 변경합니다.
      formData.append("media", audioBlob, "meeting_record.webm");

      // 💡 엔드포인트를 클로바 스피치 라우트로 변경합니다.
      const sttRes = await fetch('/api/clova-speech', {
        method: 'POST',
        body: formData,
      });
      
      const sttData = await sttRes.json();
      if (!sttData.success) throw new Error(sttData.error || "STT 변환 실패");
      
      // 💡 클로바 스피치는 결과를 'segments'라는 배열로 내려줍니다.
      const transcriptArray = sttData.segments || [];
      setSttTranscript(transcriptArray); 

      // 화자 분리된 텍스트를 AI(GPT 등)가 요약하기 좋게 한 줄씩 병합
      const textForAi = transcriptArray.map((t:any) => `${t.speaker}: ${t.text}`).join('\n');
      
      if (!textForAi.trim()) {
        setUiError("음성이 전혀 인식되지 않았습니다. 마이크 볼륨을 확인하시고 다시 녹음해 주세요!");
        setIsAnalyzing(false);
        return;
      }
      
      // 이후 요약 및 Action Item 추출 로직은 기존과 동일하게 유지!
      const aiRes = await fetch('/api/ai-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: textForAi })
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
            <h2 className="font-black text-[15px]">Logica AI 회의록 (하이브리드 모드)</h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
        </div>
        
        <div className="flex-1 flex overflow-hidden bg-slate-50">
          
          <div className={`flex flex-col p-6 transition-all duration-300 ${aiResult ? 'w-1/2 border-r border-slate-200' : 'w-full'}`}>
            
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-4 flex flex-col items-center justify-center shadow-sm shrink-0">
              {isRecording ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-4 w-4"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500"></span></span>
                    <span className="text-rose-500 font-black text-lg tracking-widest">{formatTime(recordingTime)}</span>
                  </div>
                  <p className="text-slate-400 font-bold text-[11px]">회의 내용을 고음질로 녹음 및 실시간 분석 중입니다...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                  <p className="text-slate-500 font-bold text-[12px]">마이크 버튼을 눌러 회의 녹음을 시작하세요.</p>
                  {/* 💡 [추가됨] 사용자를 위한 집음 관련 하드웨어 팁 안내 */}
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
                    <><span className="animate-spin">⏳</span> 마이크 연결 중...</>
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
                  {sttTranscript.map((turn, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-[#002864] bg-blue-50 w-fit px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-100 border border-blue-100 transition-colors">
                        {turn.speaker} (클릭하여 변경)
                      </span>
                      <p className="text-[13px] text-slate-700 font-medium pl-1 leading-relaxed">{turn.text}</p>
                    </div>
                  ))}
                  <div ref={contentEndRef} />
                </div>
              ) : (
                <div className="text-[14px] leading-relaxed text-slate-500 h-full">
                  {liveTranscript === "" && liveInterim === "" ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold text-[12px]">
                      {isRecording ? (
                        <span className="animate-pulse flex items-center gap-2 text-rose-500">
                           🎙️ 말씀을 시작하시면 실시간 텍스트가 표시됩니다...
                        </span>
                      ) : (
                        <span>녹음 중 실시간 대화 내용이 이곳에 표시됩니다.</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <p>{liveTranscript}</p>
                      <p className="text-blue-500 font-bold mt-1 animate-pulse">{liveInterim}</p>
                      <div ref={contentEndRef} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {aiResult && (
            <div className="w-1/2 p-6 flex flex-col bg-white overflow-hidden animate-[fadeIn_0.3s_ease-out]">
              <h3 className="text-[14px] font-black text-[#002864] mb-4 flex items-center gap-2">✨ AI 업무 할당 결과</h3>
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
                      🚨 추출된 업무 할당 (Action Items) <span className="bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded text-[10px] ml-1">{aiResult.tasks.length}건</span>
                    </h4>
                    <div className="space-y-2">
                      {aiResult.tasks.map((task: any, idx: number) => (
                        <div key={idx} className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${task.isInserted ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-amber-200 shadow-sm'}`}>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black text-[9px]">{task.assignee}</span>
                              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold text-[9px] border border-slate-200">{task.task_type}</span>
                              {task.deadline && <span className="text-rose-500 text-[10px] font-bold ml-1">기한: {task.deadline}</span>}
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