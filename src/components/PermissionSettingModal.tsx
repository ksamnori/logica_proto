"use client";

import React, { useState } from "react";

// 🌟 권한 그룹 데이터 구조화 (추후 DB에서 불러오기 쉽게 배열로 구성)
const PERMISSION_GROUPS = [
  {
    category: "학원관리",
    items: [
      { id: "manage_info", label: "학원정보" },
      { id: "manage_staff", label: "직원/강사" },
      { id: "manage_class", label: "클래스" },
      { id: "manage_role", label: "권한" },
      { id: "manage_notice", label: "학원공지" },
      { id: "manage_student_status", label: "수강생 관리" },
    ]
  },
  {
    category: "청구/납부",
    items: [
      { id: "bill_create", label: "청구서 생성" },
      { id: "bill_manage", label: "납부 관리" },
      { id: "bill_session", label: "회차 관리" },
      { id: "bill_history", label: "입출금 내역" },
      { id: "bill_class_fee", label: "클래스 수강료" },
      { id: "bill_settlement", label: "정산내역" },
    ]
  },
  {
    category: "학생관리",
    items: [
      { id: "student_info", label: "학생/학부모 정보" },
      { id: "student_register", label: "학생 등록" },
    ]
  }
];

export default function PermissionSettingModal({ onClose }: { onClose: () => void }) {
  // 체크된 권한 ID들을 관리하는 상태
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  // 개별 체크박스 토글 함수
  const togglePermission = (id: string) => {
    setSelectedPermissions(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      {/* 모달 컨테이너 */}
      <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        
        {/* 🌟 헤더 영역 */}
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-[16px] flex items-center gap-2">
              🛡️ 권한 상세보기
              <span className="bg-blue-800 text-blue-200 text-[10px] px-2 py-0.5 rounded-full font-black border border-blue-600">임시</span>
            </h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold leading-none transition-colors">
            &times;
          </button>
        </div>

        {/* 🌟 본문 영역 */}
        <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50 flex flex-col gap-6">
          
          {/* 1. 권한명 설정 영역 */}
          <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-800 mb-1">권한명</h3>
            <p className="text-[11px] text-slate-500 mb-3 font-medium">학원 운영 및 관리에 대한 권한이 기본 제공됩니다. (변경 불가)</p>
            <input 
              type="text" 
              value="학원장" 
              disabled 
              className="w-full bg-slate-100 border border-slate-200 text-slate-500 font-bold px-4 py-2.5 rounded-lg cursor-not-allowed"
            />
          </section>

          {/* 2. 권한 선택 영역 */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-200 bg-white">
              <h3 className="text-sm font-black text-slate-800">권한 선택</h3>
            </div>

            {/* 고정 기본 권한 (비활성화) */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
              <div>
                <h4 className="text-[13px] font-bold text-slate-700 flex items-center gap-1">
                  학원 관리 권한 
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </h4>
                <p className="text-[10px] text-slate-500 mt-0.5">홈 {'>'} My학원에 위치한 학원 관리 메뉴로 기본으로 제공되며 변경이 불가합니다.</p>
              </div>
              <input type="checkbox" checked disabled className="w-4 h-4 accent-slate-300 cursor-not-allowed opacity-50" />
            </div>

            {/* 🌟 동적 카테고리 렌더링 */}
            {PERMISSION_GROUPS.map((group, gIdx) => (
              <div key={gIdx} className="flex flex-col">
                {/* 카테고리 헤더 */}
                <div className="bg-slate-100/80 px-4 py-2 border-y border-slate-200 first:border-t-0">
                  <span className="text-[12px] font-black text-slate-600">{group.category}</span>
                </div>
                {/* 카테고리 내 권한 리스트 */}
                <div className="flex flex-col divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <label 
                      key={item.id} 
                      className="flex justify-between items-center px-4 py-3 cursor-pointer hover:bg-blue-50/50 transition-colors group"
                    >
                      <span className="text-[13px] font-bold text-slate-700 group-hover:text-[#002864] transition-colors">
                        {item.label}
                      </span>
                      <input 
                        type="checkbox" 
                        checked={selectedPermissions.includes(item.id)}
                        onChange={() => togglePermission(item.id)}
                        className="w-4 h-4 accent-[#002864] cursor-pointer transition-transform active:scale-90" 
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </section>
          
        </div>

        {/* 🌟 푸터 버튼 영역 */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button 
            onClick={onClose} 
            className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold text-[13px] rounded-xl hover:bg-slate-200 transition-colors"
          >
            취소
          </button>
          <button 
            onClick={() => {
              console.log("저장할 권한 목록:", selectedPermissions);
              alert("권한이 성공적으로 저장되었습니다!");
              onClose();
            }} 
            className="px-6 py-2.5 bg-[#002864] text-white font-bold text-[13px] rounded-xl hover:bg-blue-900 transition-colors shadow-sm"
          >
            저장하기
          </button>
        </div>

      </div>
    </div>
  );
}