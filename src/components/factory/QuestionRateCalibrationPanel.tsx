// src/components/factory/QuestionRateCalibrationPanel.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  BatchCalibrationResult,
  CalibrationStatusInfo,
} from "@/lib/questionRateCalibrationServer";

interface Props {
  onAfterApply?: () => void;
}

const DIFF_BADGE_CLASS: Record<string, string> = {
  최상: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  상: "bg-rose-50 text-rose-700 border-rose-200",
  중: "bg-indigo-50 text-indigo-700 border-indigo-200",
  하: "bg-sky-50 text-sky-700 border-sky-200",
  최하: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function QuestionRateCalibrationPanel({ onAfterApply }: Props) {
  const [status, setStatus] = useState<CalibrationStatusInfo | null>(null);
  const [isRunning, setIsRunning] = useState<"dry_run" | "batch_apply" | null>(null);
  const [result, setResult] = useState<BatchCalibrationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/question-calibration?mode=status");
      const json = await res.json();
      if (json?.success && json.status) {
        setStatus(json.status);
      }
    } catch {
      // 초기 조회 실패 무시
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const runAction = async (action: "dry_run" | "batch_apply") => {
    if (action === "batch_apply") {
      const ok = window.confirm(
        "실제 수업 시험·과제 정오답 데이터를 기반으로 문항 정답률(solving_probability)과 난이도(difficulty)를 일괄 보정하시겠습니까?\n\n" +
          "• 입학테스트·진단평가 문항 및 해당 답안은 모수에서 자동 제외됩니다.\n" +
          "• 최초 AI 예상 정답률이 보존되어 여러 번 실행해도 중복 보정되지 않습니다."
      );
      if (!ok) return;
    }

    setIsRunning(action);
    setErrorMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/question-calibration", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, accessToken: token || null }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `보정 요청 실패 (HTTP ${res.status})`);
      }

      setResult(json.result);
      await loadStatus();

      if (action === "batch_apply") {
        onAfterApply?.();
        alert(
          `✅ 전체 DB 문항 정답률·난이도 보정이 완료되었습니다!\n\n` +
            `• 정오답 보유 보정 문항: ${Number(json.result.calibratedQuestions || 0).toLocaleString()}제\n` +
            `• 정답률 변경 문항: ${Number(json.result.changedProbabilityCount || 0).toLocaleString()}제\n` +
            `• 난이도 등급 변경: ${Number(json.result.changedDifficultyCount || 0).toLocaleString()}제`
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "보정 실행 중 오류가 발생했습니다.");
    } finally {
      setIsRunning(null);
    }
  };

  const handleCopySql = async () => {
    try {
      const res = await fetch("/api/question-calibration?mode=sql");
      const json = await res.json();
      if (!json?.success || !json.sql) {
        throw new Error("SQL 스크립트를 불러오지 못했습니다.");
      }
      await navigator.clipboard.writeText(json.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
      alert(
        "✅ 실시간 트리거 SQL 전체가 클립보드에 복사되었습니다!\n\n" +
          "💡 Supabase SQL Editor 실행 시 주의사항:\n" +
          "붙여넣기 후 에디터에 일부 텍스트가 마우스로 드래그(블록 선택)되어 있으면 'Run selected'로 인식되어 중간에 잘린 채 실행됩니다.\n" +
          "반드시 빈 곳을 한 번 클릭해 선택을 해제한 뒤 우측 하단 [Run]을 눌러주세요."
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "SQL 복사에 실패했습니다.");
    }
  };

  return (
    <div className="mt-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span>🎯</span> 실데이터 기반 문항 정답률 · 난이도 자동 보정 엔진
            </h3>
            {status?.dbRpcInstalled ? (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ● DB 실시간 트리거 + 고속 RPC 가동 중
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                ● 웹 서버 실시간 보정 가동 중 (DB 트리거 SQL 선택 적용 가능)
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-slate-500 mt-1.5 leading-relaxed">
            일반 수업 시험·과제·오답노트를 통합해{" "}
            <strong className="text-slate-700">한 번이라도 틀린 기록은 100% 오답 처리</strong>하고,{" "}
            <strong className="text-slate-700">50% 중심 점진 분산(45%→40%, 55%→60%) + 학생 실력 보정(Rasch IRT)</strong>으로{" "}
            <code className="text-indigo-600 font-bold">solving_probability</code>(<strong className="text-slate-700">15~95%</strong>)와{" "}
            <code className="text-indigo-600 font-bold">difficulty</code>(최상 ~30% · 상 30~45% · 중 45~60% · 하 60~80% · 최하 80%~)를 함께 갱신합니다.
          </p>
          {status && (status.totalCalibratedInDb > 0 || status.lastCalibratedAt) && (
            <p className="text-xs font-bold text-indigo-600 mt-1.5">
              누적 보정 문항: {status.totalCalibratedInDb.toLocaleString()}제
              {status.studentAbilityCachedCount > 0 &&
                ` · 학생 실력 모수: ${status.studentAbilityCachedCount.toLocaleString()}명`}
              {status.lastCalibratedAt &&
                ` · 최근 보정: ${new Date(status.lastCalibratedAt).toLocaleString("ko-KR")}`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowRuleModal((v) => !v)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-600 transition-colors cursor-pointer"
          >
            {showRuleModal ? "📐 보정 규칙 접기" : "📐 보정 수식·규칙 보기"}
          </button>

          <button
            type="button"
            onClick={handleCopySql}
            className="px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-800 transition-colors cursor-pointer"
            title="Supabase SQL Editor에 붙여넣으면 외부 앱/직접 쿼리 변경까지 DB 내부 트리거가 밀리초 단위로 즉시 자동 보정합니다."
          >
            {copiedSql ? "✅ 트리거 SQL 복사됨!" : "📋 Supabase 실시간 트리거 SQL 복사"}
          </button>

          <button
            type="button"
            disabled={isRunning !== null}
            onClick={() => runAction("dry_run")}
            className="px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-xs font-bold text-indigo-700 transition-colors cursor-pointer"
          >
            {isRunning === "dry_run" ? "⏳ 시뮬레이션 계산 중..." : "🔍 보정 시뮬레이션 (미리보기)"}
          </button>

          <button
            type="button"
            disabled={isRunning !== null}
            onClick={() => runAction("batch_apply")}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
          >
            {isRunning === "batch_apply" ? "⚡ 전체 DB 보정 반영 중..." : "⚡ 전체 DB 일괄 보정 적용"}
          </button>
        </div>
      </div>

      {showRuleModal && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2 leading-relaxed">
          <div className="font-bold text-slate-800">적용된 4단계 정밀 분산·하향 보정 명세 (V3)</div>
          <div>
            1. <strong>최초 오답 전수 반영 (고쳐 맞혀도 오답)</strong>: 채점 기호가 `O`로 덮어써졌더라도 오답노트(`student_incorrect_record`) 이력이나 답안의 `wrong_attempts_log`가 1건이라도 존재하면 무조건 오답(0점)으로 처리합니다. (`RO`/`TO`/`q`/`X` 모두 0점, 입학테스트·진단평가·더미 학생 제외)
          </div>
          <div>
            2. <strong>50% 중심 밀집 해소 &amp; 15~95% 점진 분산</strong>: 50% 부근에 몰려 있던 문항들을 원본 난이도·문항 위치·인지수준 및 50% 기준 점진 확장 곡선(45%→40%, 55%→60%, 최저 15% ~ 최대 95%)으로 고르게 펼쳐 난이도 `중` 편중 현상을 해소합니다.
          </div>
          <div>
            3. <strong>학생 실력 편향 제거 + 상단 과열 억제</strong>: 학생별 실력 지수(θ)와 학원 집단 선발 편향 보정을 결합해 실제 정오답을 민감하게 반영하면서도 100% 근접 과열을 방지합니다.
          </div>
          <div>
            4. <strong>새 난이도 구간 자동 재분류 (`examUtils.tsx` 동일 기준)</strong>: 80% 이상 `최하` · 60~79% `하` · 45~59% `중` · 30~44% `상` · 30% 미만 `최상`으로 `question_db.difficulty` 및 `textbook_question.difficulty`를 일괄 동기화합니다.
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-bold text-slate-500">실행 구분</div>
              <div className="text-sm font-black text-slate-800 mt-1">
                {result.dryRun ? "시뮬레이션 (미반영)" : "실제 DB 반영 완료"}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-bold text-slate-500">실력 산출 학생 수</div>
              <div className="text-base font-black text-slate-800 mt-1">
                {result.studentsEvaluated.toLocaleString()}명
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
              <div className="text-[11px] font-bold text-indigo-600">정오답 보유 대상 문항</div>
              <div className="text-base font-black text-indigo-800 mt-1">
                {result.calibratedQuestions.toLocaleString()}제
                {result.nullPriorCount > 0 && (
                  <span className="ml-1 text-[11px] font-bold text-indigo-500">
                    (null→50% 시작 {result.nullPriorCount.toLocaleString()}제)
                  </span>
                )}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
              <div className="text-[11px] font-bold text-emerald-700">정답률 변동 문항</div>
              <div className="text-base font-black text-emerald-800 mt-1">
                {result.changedProbabilityCount.toLocaleString()}제
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-100">
              <div className="text-[11px] font-bold text-amber-700">난이도 등급 변동</div>
              <div className="text-base font-black text-amber-800 mt-1">
                {result.changedDifficultyCount.toLocaleString()}제
              </div>
            </div>
          </div>

          {result.previewItems.length > 0 ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  변동폭 상위 {result.previewItems.length}개 문항 상세 내역
                </span>
                <span className="text-[11px] font-medium text-slate-400">
                  풀이 집단 실력(θ): +면 상위권 집단, -면 하위권 집단 풀이
                </span>
              </div>
              <div className="overflow-x-auto max-h-80 custom-scroll">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100/70 text-slate-500 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-bold">교재 / 출처</th>
                      <th className="py-2 px-2 font-bold text-center">번호</th>
                      <th className="py-2 px-2 font-bold text-center">초기 기준(P0)</th>
                      <th className="py-2 px-2 font-bold text-center">표본(N)</th>
                      <th className="py-2 px-2 font-bold text-center">단순 실측</th>
                      <th className="py-2 px-2 font-bold text-center">집단 실력(θ)</th>
                      <th className="py-2 px-3 font-bold text-center">보정 전 → 보정 후 정답률</th>
                      <th className="py-2 px-3 font-bold text-center">난이도 변화</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.previewItems.map((it) => {
                      const beforeLabel = it.beforeRate !== null ? `${it.beforeRate}%` : "null(미입력)";
                      const diffChanged = String(it.beforeDifficulty || "") !== it.afterDifficulty;
                      return (
                        <tr key={it.questionId} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-semibold text-slate-700 max-w-[240px] truncate" title={it.bookName}>
                            {it.bookName}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-slate-600">{it.questionNumber}</td>
                          <td className="py-2 px-2 text-center font-semibold text-slate-600">
                            {it.priorWasNull ? (
                              <span className="text-amber-600">50% (null)</span>
                            ) : (
                              `${it.priorRate}%`
                            )}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-slate-700">{it.sampleCount}명</td>
                          <td className="py-2 px-2 text-center text-slate-500">{it.rawRate.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600">
                            {it.avgStudentTheta > 0 ? `+${it.avgStudentTheta.toFixed(2)}` : it.avgStudentTheta.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-center font-bold">
                            <span className="text-slate-400">{beforeLabel}</span>
                            <span className="mx-1.5 text-slate-300">→</span>
                            <span className="text-indigo-700">{it.afterRate}%</span>
                          </td>
                          <td className="py-2 px-3 text-center font-bold">
                            <span className="text-slate-400">{it.beforeDifficulty || "미지정"}</span>
                            <span className="mx-1.5 text-slate-300">→</span>
                            <span
                              className={`inline-block px-2 py-0.5 rounded border text-[11px] ${
                                DIFF_BADGE_CLASS[it.afterDifficulty] || "bg-slate-100 text-slate-700 border-slate-200"
                              } ${diffChanged ? "ring-1 ring-amber-300" : ""}`}
                            >
                              {it.afterDifficulty}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-500 text-center">
              현재 보정 조건(일반 수업 시험·과제 채점 기록)에 해당하는 문항 데이터가 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
