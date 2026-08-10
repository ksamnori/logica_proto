// src/app/(dashboard)/permission/page.tsx
"use client";

import React, { useState } from "react";

// 🌟 권한 그룹 데이터 구조화 (이미지의 모든 메뉴 반영)
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
  },
  {
    category: "학원 홍보/문의",
    items: [
      { id: "marketing_inquiry", label: "학원 문의" },
    ]
  },
  {
    category: "수업 지원",
    desc: "기본 제공 메뉴/변경 불가",
    disabled: true, // 변경 불가 설정
    items: [
      { id: "support_att", label: "학원 출석 관리" },
      { id: "support_desk", label: "데스크 출석" },
      { id: "support_chat", label: "채팅방 에티켓" },
      { id: "support_learn", label: "학습 관리" },
    ]
  },
  {
    category: "학생 상세 관리",
    desc: "클래스 페이지 내 학생 상세 페이지에서 이용되는 메뉴로 학원 관리 권한과는 별도로 관리됩니다.",
    items: [
      { id: "detail_att", label: "출석 현황" },
      { id: "detail_consult", label: "상담 및 메모" },
    ]
  }
];

// 예시 직급 리스트
const ROLES = [
  { id: "role_director", name: "원장", desc: "모든 권한을 가진 최고 관리자" },
  { id: "role_manager", name: "실장 (데스크)", desc: "수납 및 전반적인 학원 관리" },
  { id: "role_teacher", name: "전임강사", desc: "담당 클래스 및 학생 관리" },
  { id: "role_ta", name: "조교", desc: "출결 및 학습 지원" },
];

export default function PermissionPage() {
  const [activeRole, setActiveRole] = useState(ROLES[0]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    "manage_info", "manage_staff", "manage_class", "manage_role", "manage_notice", "manage_student_status",
    "bill_create", "bill_manage", "bill_session", "bill_history", "bill_class_fee", "bill_settlement",
    "student_info", "student_register", "marketing_inquiry", "detail_att", "detail_consult"
  ]);

  const togglePermission = (id: string, groupDisabled?: boolean) => {
    if (groupDisabled) return;
    setSelectedPermissions(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    alert(`[${activeRole.name}]의 권한이 성공적으로 저장되었습니다!`);
  };

  return (
    <div className="h-full flex flex-col font-pretendard bg-slate-50 p-4 sm:p-8 overflow-hidden">
      
      {/* 헤더 영역 */}
      <div className="shrink-0 flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            🔐 권한 관리
          </h1>
          <p className="text-slate-500 font-bold text-[12px] mt-1">직급별 접속 가능한 메뉴와 세부 권한을 설정합니다.</p>
        </div>
      </div>

      {/* 메인 레이아웃 (좌: 직급 리스트, 우: 권한 상세 설정) */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden min-h-0">
        
        {/* 좌측: 직급(Role) 선택 사이드바 */}
        <div className="w-full lg:w-72 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col shrink-0 overflow-hidden h-full">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0">
            <span className="font-black text-sm text-slate-700">직급 목록</span>
            <button className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 hover:bg-blue-100 transition-colors">
              + 직급 추가
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll p-2">
            {ROLES.map(role => (
              <button 
                key={role.id}
                onClick={() => setActiveRole(role)}
                className={`w-full text-left p-3 mb-1 rounded-xl transition-colors border ${activeRole.id === role.id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
              >
                <div className={`font-bold text-[13px] ${activeRole.id === role.id ? 'text-[#002864]' : 'text-slate-700'}`}>{role.name}</div>
                <div className={`text-[10px] mt-0.5 truncate ${activeRole.id === role.id ? 'text-blue-500' : 'text-slate-400'}`}>{role.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 우측: 권한 상세 설정 영역 */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-full relative">
          
          <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0 z-10">
            <div>
              <h2 className="text-base font-black text-[#002864]">{activeRole.name} 권한 설정</h2>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">학원 운영 및 관리에 대한 권한이 기본 제공됩니다.</p>
            </div>
            <button onClick={handleSave} className="bg-[#002864] hover:bg-blue-900 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-1.5">
              <span>💾</span> 저장하기
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 lg:p-8 bg-slate-50/30">
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              
              {/* 고정 기본 권한 안내 */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-[13px] font-black text-slate-700 flex items-center gap-1.5">
                      학원 관리 권한 
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1 font-medium">홈 {'>'} My학원에 위치한 학원 관리 메뉴로 기본으로 제공되며 변경이 불가합니다.</p>
                  </div>
                  <input type="checkbox" checked disabled className="w-5 h-5 accent-slate-300 cursor-not-allowed opacity-50" />
                </div>
              </div>

              {/* 동적 카테고리 렌더링 */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {PERMISSION_GROUPS.map((group, gIdx) => (
                  <div key={gIdx} className="flex flex-col border-b border-slate-200 last:border-0">
                    
                    {/* 카테고리 헤더 */}
                    <div className="bg-slate-100 px-5 py-2.5 flex items-center gap-2">
                      <span className="text-[12px] font-black text-slate-700">{group.category}</span>
                      {group.desc && <span className="text-[10px] font-bold text-slate-400">{group.desc}</span>}
                    </div>
                    
                    {/* 카테고리 내 권한 리스트 */}
                    <div className="flex flex-col divide-y divide-slate-100">
                      {group.items.map((item) => {
                        const isChecked = group.disabled ? true : selectedPermissions.includes(item.id);
                        return (
                          <label 
                            key={item.id} 
                            className={`flex justify-between items-center px-5 py-3.5 transition-colors group ${group.disabled ? 'cursor-not-allowed bg-slate-50/50' : 'cursor-pointer hover:bg-blue-50/50'}`}
                          >
                            <span className={`text-[13px] font-bold transition-colors ${group.disabled ? 'text-slate-400' : 'text-slate-700 group-hover:text-[#002864]'}`}>
                              {item.label}
                            </span>
                            <div className="flex items-center">
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                onChange={() => togglePermission(item.id, group.disabled)}
                                disabled={group.disabled}
                                className={`w-4 h-4 rounded transition-transform active:scale-90 ${group.disabled ? 'accent-slate-300 cursor-not-allowed' : 'accent-[#002864] cursor-pointer'}`} 
                              />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}