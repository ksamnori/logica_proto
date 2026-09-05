// src/app/clinic/viewer/components/ViewerModals.tsx
"use client";

import React from "react";

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
  pendingRecheckReview: any[];
  requestRecheckForReviewItem: (item: any) => void;
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
  submitResultModal, pendingRecheckReview, requestRecheckForReviewItem,
  recheckToast, autoLeaveSec,
  correctSolvedCount, totalQuestions, unansweredCount, logoutTarget, onLeave
}: ViewerModalsProps) {
  return (
    <>
      {/* 1. 힌트 차감 모달 */}
      {hintModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] text-center">
            <div className="text-4xl mb-3">💡</div>
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">포인트 차감 안내</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">
              힌트(개념 및 접근법)를 열람하시겠습니까?<br/>보유 포인트에서 <span className="font-bold text-rose-500">{hintModal.cost}P</span>가 차감됩니다.
            </p>
            <div className="flex gap-2">
              <button disabled={hintModal.loading} onClick={() => setHintModal(null)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-40">취소</button>
              <button disabled={hintModal.loading} onClick={onConfirmHint} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-60">{hintModal.loading ? '힌트 준비 중...' : '열람하기'}</button>
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

      {/* 6. 제출 완료 모달 (재확인 리뷰 포함) */}
      {submitResultModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className={`bg-white rounded-2xl shadow-2xl p-10 w-full text-center ${pendingRecheckReview.length > 0 ? 'max-w-lg' : 'max-w-sm'}`}>
            <div className="text-6xl mb-4">📮</div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">제출 완료!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">답안을 제출했어요. 수고했어요!</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6">
              <p className="text-xs font-bold text-slate-400 mb-1">정답률</p>
              <p className="text-2xl font-black text-[#002864]">{correctSolvedCount}/{totalQuestions}</p>
            </div>
            
            {pendingRecheckReview.length > 0 && (
              <div className="text-left bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
                <p className="text-xs font-bold text-indigo-700 mb-3">🔄 AI가 손글씨로 채점해서 오답 처리된 문제예요. 채점이 이상하다면 재확인을 요청하세요.</p>
                <div className="flex flex-col gap-2 max-h-56 overflow-y-auto custom-scrollbar">
                  {pendingRecheckReview.map(item => (
                    <div key={item.uid} className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-600">{item.qNum}번 문항</span>
                      {item.resolved ? (
                        <span className={`text-xs font-bold ${item.verdict === 'correct' ? 'text-emerald-600' : 'text-slate-400'}`}>{item.verdict === 'correct' ? '✅ 정답 확인됨' : '조교 확인: 오답'}</span>
                      ) : item.requested ? (
                        <span className="text-xs font-bold text-slate-400">요청됨 · 대기 중</span>
                      ) : (
                        <button onClick={() => requestRecheckForReviewItem(item)} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md px-2.5 py-1 transition-colors">재확인 요청</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <button onClick={() => onLeave(logoutTarget)} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            {pendingRecheckReview.length === 0 && <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>}
          </div>
        </div>
      )}

      {/* 7. 수동 채점 토스트 알림 */}
      {recheckToast && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-slate-800 text-white px-6 py-3 rounded-full shadow-lg font-bold text-sm">
            {recheckToast}
          </div>
        </div>
      )}
    </>
  );
}