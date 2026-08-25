// src/app/clinic/viewer/components/ViewerModals.tsx
"use client";

import React from "react";
import { GEMINI_API_KEY_STORAGE_KEY, GEMINI_MODEL_STORAGE_KEY, DEFAULT_GEMINI_MODEL } from "../utils";

interface ViewerModalsProps {
  hintModal: any;
  setHintModal: (v: any) => void;
  onConfirmHint: () => Promise<void>;
  resultModal: any;
  setResultModal: (v: any) => void;
  onRetry: () => void;
  onRequestRecheck: () => void;
  sessionTimeUpModal: boolean;
  timeUpModal: boolean;
  submitConfirmModal: boolean;
  setSubmitConfirmModal: (v: boolean) => void;
  onSubmitConfirm: () => void;
  submitResultModal: boolean;
  geminiModalOpen: boolean;
  setGeminiModalOpen: (v: boolean) => void;
  recheckToast: string;
  autoLeaveSec: number;
  correctSolvedCount: number;
  totalQuestions: number;
  unansweredCount: number;
  logoutTarget: 'portal' | 'login';
  onLeave: (target: 'portal' | 'login') => void;
}

export function ViewerModals({
  hintModal, setHintModal, onConfirmHint,
  resultModal, setResultModal, onRetry, onRequestRecheck,
  sessionTimeUpModal, timeUpModal,
  submitConfirmModal, setSubmitConfirmModal, onSubmitConfirm,
  submitResultModal, geminiModalOpen, setGeminiModalOpen,
  recheckToast, autoLeaveSec, correctSolvedCount, totalQuestions, unansweredCount,
  logoutTarget, onLeave
}: ViewerModalsProps) {
  return (
    <>
      {/* 1. 힌트 차감 모달 */}
      {hintModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] text-center">
            <div className="text-4xl mb-3">🪙</div>
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">포인트 차감 안내</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">
              {hintModal.level}단계 힌트를 열람하시겠습니까?<br/>보유 포인트에서 <span className="font-bold text-rose-500">{hintModal.cost}P</span>가 차감됩니다.
            </p>
            <div className="flex gap-2">
              <button disabled={hintModal.loading} onClick={() => setHintModal(null)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-40">취소</button>
              <button disabled={hintModal.loading} onClick={onConfirmHint} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-60">{hintModal.loading ? '힌트 생성 중...' : '열람하기'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 채점 결과 모달 */}
      {resultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center transform transition-transform scale-100 animate-[fadeIn_0.2s_ease-out]">
            <div className="text-6xl mb-4">{resultModal.isCorrect ? "🎉" : "💥"}</div>
            <h3 className={`text-2xl font-black mb-2 ${resultModal.isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>
              {resultModal.isCorrect ? "정답입니다!" : "아쉽게 틀렸습니다"}
            </h3>
            <p className="text-sm text-slate-500 font-bold mb-8 leading-relaxed">
              {resultModal.isCorrect ? (resultModal.note ? `완벽히 복습되었습니다. ${resultModal.note}` : "완벽히 복습되었습니다. 오답 노트에서 제외됩니다.") : (resultModal.note || "다시 한번 풀어보거나, 힌트를 열람해보세요.")}
            </p>
            <button onClick={() => {
              if (!resultModal.isCorrect) onRetry();
              setResultModal(null);
            }} className={`w-full font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all ${resultModal.isCorrect ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}>
              {resultModal.isCorrect ? "확인 및 다음 문제" : "다시 풀기"}
            </button>
            {resultModal.canRecheck && (
              <button onClick={() => { onRequestRecheck(); setResultModal(null); }} className="w-full mt-2.5 bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-bold px-6 py-3 rounded-xl text-sm transition-all">
                🔄 AI 채점이 이상해요 — 조교에게 재확인 요청
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. 세션 종료 모달 */}
      {sessionTimeUpModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">⏰</div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">클리닉 시간이 종료되었습니다</h3>
            <p className="text-sm text-slate-500 font-bold mb-6">오늘 배정된 클리닉 이용 시간이 모두 지났어요.<br/>수고하셨습니다!</p>
            <button onClick={() => onLeave(logoutTarget)} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 4. 라운드 제한시간 초과 모달 */}
      {timeUpModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">⏰</div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">시간이 모두 지났습니다!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">20분 제한 시간이 모두 지났어요.<br/>지금까지 입력한 답안이 제출됩니다.</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6">
              <p className="text-xs font-bold text-slate-400 mb-1">정답률</p>
              <p className="text-2xl font-black text-[#002864]">{correctSolvedCount}/{totalQuestions}</p>
            </div>
            <button onClick={() => onLeave('portal')} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 5. 제출 확인 모달 */}
      {submitConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[70] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
            <div className="text-4xl mb-3">📝</div>
            <h3 className="text-lg font-extrabold text-slate-800 mb-3">테스트/과제 제출</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed" dangerouslySetInnerHTML={{ __html: unansweredCount > 0 ? `아직 풀지 않은 문제가 <span class="text-rose-500 font-black">${unansweredCount}개</span> 있어요.<br>그래도 제출하시겠습니까?` : `정말 제출하시겠습니까?<br>제출 후에는 답을 바꿀 수 없어요.` }}></p>
            <div className="flex gap-2">
              <button onClick={() => setSubmitConfirmModal(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => { setSubmitConfirmModal(false); onSubmitConfirm(); }} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors shadow-sm">제출하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. 제출 완료 모달 */}
      {submitResultModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">📮</div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">제출 완료!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">답안을 제출했어요. 수고했어요!</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6">
              <p className="text-xs font-bold text-slate-400 mb-1">정답률</p>
              <p className="text-2xl font-black text-[#002864]">{correctSolvedCount}/{totalQuestions}</p>
            </div>
            <button onClick={() => onLeave(logoutTarget)} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 7. Gemini API 키 설정 모달 */}
      {geminiModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[90] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-left">
            <h3 className="text-lg font-extrabold text-slate-800 mb-1">🤖 AI 채점 설정 (제미나이)</h3>
            <p className="text-xs text-slate-400 font-medium mb-4 leading-relaxed">손글씨 답안을 Google Gemini 비전 API로 채점합니다.<br/>API 키는 브라우저에만 저장됩니다.</p>
            <label className="text-xs font-bold text-slate-500">Gemini API 키</label>
            <input type="password" id="gemini-key" defaultValue={typeof window !== 'undefined' ? localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || '' : ''} placeholder="AIza..." className="w-full mt-1 mb-3 px-3 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-[#002864] outline-none" />
            <label className="text-xs font-bold text-slate-500">모델명</label>
            <input type="text" id="gemini-model" defaultValue={typeof window !== 'undefined' ? localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL : DEFAULT_GEMINI_MODEL} className="w-full mt-1 mb-1 px-3 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-[#002864] outline-none" />
            <p className="text-[10px] text-slate-400 font-medium mb-4">API 키는 Google AI Studio에서 발급받을 수 있어요.</p>
            <div className="flex gap-2">
              <button onClick={() => setGeminiModalOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg text-sm hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => {
                const k = (document.getElementById('gemini-key') as HTMLInputElement).value.trim();
                const m = (document.getElementById('gemini-model') as HTMLInputElement).value.trim();
                if (k) localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, k);
                if (m) localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, m);
                setGeminiModalOpen(false);
              }} className="flex-1 bg-[#002864] hover:bg-blue-900 text-white font-bold py-3 rounded-lg text-sm transition-colors shadow-sm">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {recheckToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl max-w-md text-center animate-[fadeIn_0.3s_ease-out]">
          {recheckToast}
        </div>
      )}
    </>
  );
}