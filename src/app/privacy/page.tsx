// src/app/privacy/page.tsx
"use client";

import React from 'react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-pretendard">
      <div className="max-w-3xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200 text-slate-700">
        <h1 className="text-2xl sm:text-3xl font-black text-[#002864] mb-8 border-b border-slate-200 pb-4">
          (주)이배움 로지카대치본원학원 개인정보 처리방침
        </h1>

        <div className="space-y-8 text-sm sm:text-base leading-relaxed break-keep">
          <section>
            <h2 className="text-lg font-bold text-slate-800 mb-3">1. 수집하는 개인정보의 항목 및 수집 방법</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li><span className="font-bold text-slate-700">수집 항목:</span> 휴대전화번호 (필수)</li>
              <li><span className="font-bold text-slate-700">수집 방법:</span> 카카오톡 간편 로그인(카카오 싱크) 연동 및 웹페이지 내 직접 입력</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-800 mb-3">2. 개인정보의 수집 및 이용 목적</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li><span className="font-bold text-slate-700">학부모 본인 인증 및 식별:</span> 서비스 이용을 위한 정확한 보호자 확인</li>
              <li><span className="font-bold text-slate-700">학사 정보 제공:</span> 자녀(원생)의 출결, 성적, 과제 현황 등 학습 데이터 보안 매칭 및 열람 제공</li>
              <li><span className="font-bold text-slate-700">고객 서비스:</span> 주요 학사 공지사항 전달, 상담 접수 및 민원 처리</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-800 mb-3">3. 개인정보의 보유 및 이용 기간</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>원칙적으로, 학원 수강 종료(퇴원) 또는 서비스 탈퇴(동의 철회) 시 해당 개인정보는 지체 없이 파기됩니다.</li>
              <li>단, 관계 법령(전자상거래 등에서의 소비자보호에 관한 법률 등)에 의거하여 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 안전하게 보관합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-800 mb-3">4. 개인정보의 파기 절차 및 방법</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li><span className="font-bold text-slate-700">파기 절차:</span> 이용 목적이 달성된 후 내부 방침 및 기타 관련 법령에 따라 지체 없이 파기됩니다.</li>
              <li><span className="font-bold text-slate-700">파기 방법:</span> 전자적 파일 형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 영구 삭제합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-800 mb-3">5. 이용자의 권리와 그 행사 방법</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나 수정할 수 있으며, 정보 제공 동의 철회(서비스 탈퇴)를 요청할 수 있습니다.</li>
              <li>학원 관리자 문의(전화 또는 포털 내 채팅)를 통해 요청 시 지체 없이 조치합니다.</li>
            </ul>
          </section>
        </div>
        
        {/* 🌟 사업자 정보 푸터 추가 */}
        <footer className="mt-12 pt-8 border-t border-slate-200 text-xs text-slate-500 text-center leading-relaxed">
          <p className="font-bold text-slate-600 mb-1">(주)이배움 로지카대치본원학원</p>
          <p>대표자: 천종현 | 사업자등록번호: 732-85-02927</p>
          <p>주소: 서울특별시 강남구 역삼로 448, 3층(대치동)</p>
          <p>대표번호: 02-555-8875</p>
        </footer>

        <div className="mt-8 text-center">
            <button onClick={() => window.close()} className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-colors shadow-sm">
                창 닫기
            </button>
        </div>
      </div>
    </div>
  );
}