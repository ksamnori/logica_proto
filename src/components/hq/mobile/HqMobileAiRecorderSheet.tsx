// src/components/hq/mobile/HqMobileAiRecorderSheet.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import type { HqMeetingItem } from "@/lib/hq/types";
import { supabase } from "@/lib/supabase";

interface Props {
  targetMeeting?: HqMeetingItem | null;
  onClose: () => void;
  onSaved: (updatedMeetings?: HqMeetingItem[]) => void;
}

interface SttTurn {
  speaker: string;
  text: string;
}

interface AiMinutesResult {
  summary: string;
  decisions?: string[];
  tasks?: { assignee: string; task_type: string; description: string }[];
}

const IDLE_WAVE = Array<number>(16).fill(10);

function getErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function HqMobileAiRecorderSheet({
  targetMeeting,
  onClose,
  onSaved,
}: Props) {
  const { me } = useHqShell();

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uiError, setUiError] = useState("");
  const [newMeetingTitle, setNewMeetingTitle] = useState("");

  const [waveData, setWaveData] = useState<number[]>(IDLE_WAVE);
  const [sttTranscript, setSttTranscript] = useState<SttTurn[]>([]);
  const [aiResult, setAiResult] = useState<AiMinutesResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream
            .getTracks()
            .forEach((track) => track.stop());
        } catch {
          // ignore
        }
      }
      isRecordingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(
      () => setRecordingTime((prev) => prev + 1),
      1000
    );
    const waveTimer = setInterval(() => {
      setWaveData(
        Array(16)
          .fill(0)
          .map(() => 10 + Math.random() * 34)
      );
    }, 150);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(waveTimer);
    };
  }, [isRecording]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsAnalyzing(true);
    setUiError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const formData = new FormData();
      formData.append("media", audioBlob, "hq_meeting_record.webm");

      const sttRes = await fetch("/api/clova-speech", {
        method: "POST",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
        body: formData,
      });
      const sttData = await sttRes.json();
      if (!sttData.success) {
        throw new Error(sttData.error || "음성 인식(STT) 변환 실패");
      }

      const segments: SttTurn[] = sttData.segments || [];
      setSttTranscript(segments);

      const textForAi = segments
        .map((t) => `${t.speaker}: ${t.text}`)
        .join("\n");

      if (!textForAi.trim()) {
        setUiError(
          "음성이 인식되지 않았습니다. 마이크 위치를 확인하고 다시 녹음해 주세요."
        );
        return;
      }

      const attendeeStr = targetMeeting
        ? targetMeeting.attendees.map((a) => a.name).join(", ")
        : me?.name || "";

      const aiRes = await fetch("/api/ai-minutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          transcript: textForAi,
          attendees: attendeeStr,
        }),
      });
      const aiData = await aiRes.json();
      if (!aiData.success) {
        throw new Error(aiData.error || "AI 요약 분석 실패");
      }
      setAiResult(aiData.data as AiMinutesResult);
    } catch (err: unknown) {
      setUiError(getErrMsg(err, "녹음 분석 중 오류가 발생했습니다."));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startRecording = async () => {
    setUiError("");
    setIsRequestingMic(true);
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        }),
        new Promise<MediaStream>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 8000)
        ),
      ]);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          await processAudio(blob);
        }
      };

      recorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);
      setAiResult(null);
      setSttTranscript([]);
    } catch {
      setUiError("마이크 권한이 거부되었거나 오디오 장치를 찾을 수 없습니다.");
    } finally {
      setIsRequestingMic(false);
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
    setIsRecording(false);
  };

  const handleSaveToHqMeeting = async () => {
    if (!aiResult) return;

    const now = new Date();
    const stamp = now.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const formattedNotes = [
      `[🎙️ AI 음성 회의록 요약 · ${stamp}]`,
      `■ 핵심 요약`,
      aiResult.summary,
      aiResult.decisions && aiResult.decisions.length > 0
        ? `\n■ 결정·합의 사항\n${aiResult.decisions
            .map((d) => `- ${d}`)
            .join("\n")}`
        : "",
      aiResult.tasks && aiResult.tasks.length > 0
        ? `\n■ 후속 액션 아이템\n${aiResult.tasks
            .map((t) => `- [${t.assignee}] ${t.description}`)
            .join("\n")}`
        : "",
      sttTranscript.length > 0
        ? `\n■ 화자 분리 대화록\n${sttTranscript
            .map((t) => `${t.speaker}: ${t.text}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    setSaving(true);
    try {
      if (targetMeeting) {
        const mergedSummary = [
          targetMeeting.summary_notes?.trim(),
          formattedNotes,
        ]
          .filter(Boolean)
          .join("\n\n────────────────────\n\n");

        const res = await hqFetch<{
          success: boolean;
          data: { meetings: HqMeetingItem[] };
        }>("/api/hq/meetings", {
          method: "POST",
          body: {
            action: "SAVE",
            id: targetMeeting.id,
            title: targetMeeting.title,
            has_schedule: targetMeeting.has_schedule,
            start_at: targetMeeting.start_at,
            end_at: targetMeeting.end_at,
            location_or_url: targetMeeting.location_or_url,
            attendees: targetMeeting.attendees,
            agenda: targetMeeting.agenda,
            summary_notes: mergedSummary,
          },
        });
        onSaved(res.data?.meetings);
      } else {
        const fallbackTitle =
          newMeetingTitle.trim() ||
          `${now.getMonth() + 1}월 ${now.getDate()}일 본부 AI 녹음 회의록`;
        const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(now.getDate()).padStart(2, "0")}`;
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")}`;

        const res = await hqFetch<{
          success: boolean;
          data: { meetings: HqMeetingItem[] };
        }>("/api/hq/meetings", {
          method: "POST",
          body: {
            action: "SAVE",
            title: fallbackTitle,
            has_schedule: true,
            start_at: `${ymd}T${hhmm}:00+09:00`,
            end_at: null,
            location_or_url: "모바일 현장 녹음",
            attendees: me
              ? [
                  {
                    member_id: me.instructor_id,
                    name: me.name,
                    department: me.department,
                    rsvp: "ATTENDING",
                  },
                ]
              : [],
            agenda: aiResult.summary,
            summary_notes: formattedNotes,
          },
        });
        onSaved(res.data?.meetings);
      }
      onClose();
    } catch (err: unknown) {
      alert(getErrMsg(err, "회의록 저장 중 오류가 발생했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const activeBars = isRecording ? waveData : IDLE_WAVE;

  return (
    <div className="fixed inset-0 z-[55] bg-slate-900/70 backdrop-blur-xs flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">🎙️</span>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold truncate">
                {targetMeeting
                  ? `${targetMeeting.title}`
                  : "새 회의 AI 음성 녹음"}
              </h3>
              <p className="text-[10px] text-slate-300">
                Clova 화자 분리 STT · 핵심 결정사항 자동 요약
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/15 text-white font-extrabold text-sm flex items-center justify-center shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 녹음 상태 박스 */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 flex flex-col items-center text-center space-y-3">
            {isRecording ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-600" />
                  </span>
                  <span className="text-lg font-extrabold text-rose-600 tracking-wider">
                    {formatTime(recordingTime)}
                  </span>
                </div>
                <div className="flex items-end justify-center gap-1.5 h-12 w-full">
                  {activeBars.map((h, i) => (
                    <div
                      key={i}
                      className="w-2 bg-rose-500 rounded-full transition-all duration-150"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>
                <p className="text-xs font-bold text-slate-500">
                  스마트폰을 회의 테이블 중앙에 두면 화자 분리 정확도가 높아집니다
                </p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center text-2xl">
                  🎙️
                </div>
                <p className="text-xs font-bold text-slate-600 leading-relaxed">
                  녹음 시작을 누르고 회의를 진행하세요.
                  <br />
                  종료 즉시 참석자별 대화 분리와 요약본이 생성됩니다.
                </p>
              </>
            )}

            {!isRecording ? (
              <button
                type="button"
                disabled={isAnalyzing || isRequestingMic}
                onClick={startRecording}
                className="px-6 py-3 rounded-full bg-rose-600 text-white font-extrabold text-xs shadow-sm disabled:opacity-50"
              >
                {isRequestingMic
                  ? "마이크 연결 중..."
                  : aiResult
                    ? "다시 녹음하기"
                    : "● 회의 녹음 시작"}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="px-6 py-3 rounded-full bg-slate-900 text-white font-extrabold text-xs shadow-sm animate-pulse"
              >
                ■ 녹음 종료 및 AI 분석 시작
              </button>
            )}
          </div>

          {uiError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-bold text-rose-700">
              ⚠️ {uiError}
            </div>
          )}

          {isAnalyzing && (
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-6 text-center space-y-2">
              <div className="w-7 h-7 mx-auto rounded-full border-3 border-blue-200 border-t-brand animate-spin" />
              <p className="text-xs font-extrabold text-brand">
                화자 분리 및 회의 핵심 내용을 요약하고 있습니다...
              </p>
            </div>
          )}

          {/* AI 분석 결과 */}
          {aiResult && (
            <div className="space-y-3">
              {!targetMeeting && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    저장할 본부 미팅 제목
                  </label>
                  <input
                    type="text"
                    value={newMeetingTitle}
                    onChange={(e) => setNewMeetingTitle(e.target.value)}
                    placeholder="미입력 시 오늘 날짜 제목으로 자동 저장"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-brand"
                  />
                </div>
              )}

              <div className="rounded-2xl bg-blue-50/70 border border-blue-200 p-3.5 space-y-1.5">
                <h4 className="text-xs font-extrabold text-blue-900">
                  📋 회의 요약
                </h4>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {aiResult.summary}
                </p>
              </div>

              {aiResult.decisions && aiResult.decisions.length > 0 && (
                <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-3.5 space-y-1.5">
                  <h4 className="text-xs font-extrabold text-emerald-900">
                    🎯 결정 · 합의 사항
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-700 font-medium">
                    {aiResult.decisions.map((d, i) => (
                      <li key={i}>• {d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {sttTranscript.length > 0 && (
                <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
                  <h4 className="text-xs font-extrabold text-slate-700">
                    🗣️ 화자 분리 대화 기록 ({sttTranscript.length}구간)
                  </h4>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {sttTranscript.map((turn, idx) => (
                      <div key={idx} className="text-xs">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 font-extrabold text-slate-700 text-[10px] mr-1.5">
                          {turn.speaker}
                        </span>
                        <span className="text-slate-600">{turn.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {aiResult && (
          <div className="border-t border-slate-200 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveToHqMeeting}
              className="w-full py-3.5 rounded-xl bg-brand text-white font-extrabold text-sm shadow-md disabled:opacity-50"
            >
              {saving
                ? "본부 회의록에 저장 중..."
                : targetMeeting
                  ? "💾 이 미팅 회의록에 요약 저장하기"
                  : "💾 새 본부 회의록으로 저장하기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
