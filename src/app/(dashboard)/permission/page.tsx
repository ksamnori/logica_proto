// src/app/(dashboard)/permission/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const PERMISSION_GROUPS = [
  {
    category: "대시보드 (홈 화면)",
    desc: "홈 화면 접근 및 대시보드 내 관리 기능 권한입니다.",
    items: [
      { id: "/home", label: "홈 메뉴 접근 (기본 제공)", isRequired: true },
      { id: "action_edit_home_attend", label: "↳ [권한] 홈 화면 출결 수동 설정 및 기록 삭제", isAction: true },
    ]
  },
  {
    category: "학생 및 수강 관리",
    items: [
      { id: "/student", label: "학생 관리 (기본 정보/리포트)" },
      { id: "action_delete_student", label: "↳ [권한] 학생 데이터 영구 삭제", isAction: true },
      { id: "/class", label: "반 관리 (수강생/일정 배정)" },
      { id: "action_view_all_classes", label: "↳ [권한] 전체 수강반 열람 (미체크 시 본인 반만 노출)", isAction: true },
      { id: "action_delete_class", label: "↳ [권한] 반(클래스) 삭제", isAction: true },
      { id: "/lesson", label: "교재 관리 (마스터 교재/진도 배정)" },
      { id: "action_delete_book", label: "↳ [권한] 마스터 교재 삭제", isAction: true },
    ]
  },
  {
    category: "학생 상세 정보 (개별 탭)",
    items: [
      { id: "action_view_consult", label: "↳ [권한] 학생 상담 기록 열람", isAction: true },
      { id: "action_view_exam", label: "↳ [권한] 학생 시험 성적 열람", isAction: true },
      { id: "action_view_clinic", label: "↳ [권한] 학생 클리닉 분석 열람", isAction: true },
      { id: "action_edit_attend", label: "↳ [권한] 학생 출결 기록 수정", isAction: true },
    ]
  },
  {
    category: "플로팅 편의 기능",
    items: [
      { id: "action_use_chat", label: "↳ [권한] 메신저 (사내/학부모) 이용", isAction: true },
      { id: "action_use_memo", label: "↳ [권한] 퀵 메모 (포스트잇) 이용", isAction: true },
    ]
  },
  {
    category: "학습 및 수업 관리",
    items: [
      { id: "/learning", label: "학습 관리 (시험/과제/오답 현황)" },
      { id: "action_delete_learning_exam", label: "↳ [권한] 타임라인 학습지(시험/과제) 강제 삭제", isAction: true },
      { id: "/progress", label: "진도 관리 (교재 진도 체크)" },
      { id: "/makeup", label: "보강 관리 (1:1 개별 보강)" },
      { id: "action_edit_makeup", label: "↳ [권한] 개별 보강 일정 수정", isAction: true },
      { id: "action_delete_makeup", label: "↳ [권한] 개별 보강 일정 삭제", isAction: true },
    ]
  },
  {
    category: "출제 및 진단 평가",
    items: [
      { id: "/exam-list", label: "문제지 보관함 (출제 및 채점)" },
      { id: "action_delete_exam", label: "↳ [권한] 출제된 문제지 삭제", isAction: true },
      { id: "/admission", label: "진단평가 및 대기생 관리" },
      { id: "action_create_admission", label: "↳ [권한] 진단평가 새 일정 만들기", isAction: true },
      { id: "action_bulk_admission", label: "↳ [권한] 진단평가 일괄 관리 (상태/삭제)", isAction: true },
    ]
  },
  {
    category: "소통 및 행정 업무",
    items: [
      { id: "/minutes", label: "AI 회의록 (회의 안건/일정)" },
      { id: "action_create_voice_minutes", label: "↳ [권한] AI 실시간 음성 회의록 작성", isAction: true },
      { id: "action_create_manual_agenda", label: "↳ [권한] 새 안건 수동 작성", isAction: true },
      { id: "action_bind_meeting", label: "↳ [권한] 안건 병합하여 회의록 생성", isAction: true },
      { id: "action_edit_agenda_status", label: "↳ [권한] 안건 상태(대기/진행/완료) 변경", isAction: true },
      { id: "action_delete_own_agenda", label: "↳ [권한] 본인이 작성한 안건 삭제", isAction: true },
      { id: "action_delete_minutes", label: "↳ [권한] AI 회의록 전체 삭제 (관리자급)", isAction: true }, 
      
      { id: "/task", label: "업무 공유 보드 (공지/인계 사항)" },
      { id: "action_delete_task", label: "↳ [권한] 업무/공지 기록 삭제", isAction: true },
      { id: "action_delete_task_comment", label: "↳ [권한] 타인의 소통 노트(댓글) 삭제", isAction: true },
      { id: "action_submit_task_agenda", label: "↳ [권한] 회의 안건 상정", isAction: true },
      
      { id: "/cs", label: "학부모 요청 및 CS 관리" },
      { id: "action_view_all_cs", label: "↳ [권한] 타인의 CS 요청 내역 전체 열람", isAction: true },
      { id: "action_delete_cs", label: "↳ [권한] 학부모 요청(CS) 기록 삭제", isAction: true },
      { id: "action_delete_cs_comment", label: "↳ [권한] 타인의 소통 노트(댓글) 삭제", isAction: true },
      { id: "action_submit_cs_agenda", label: "↳ [권한] 회의 안건 상정", isAction: true },
      
      { id: "/supply", label: "비품 신청" },
      { id: "action_delete_supply", label: "↳ [권한] 비품 신청서 삭제", isAction: true },
      { id: "action_delete_supply_comment", label: "↳ [권한] 타인의 소통 노트(댓글) 삭제", isAction: true },
      { id: "action_submit_supply_agenda", label: "↳ [권한] 회의 안건 상정", isAction: true },
    ]
  },
  {
    category: "데스크 전용 (수납 및 운영)",
    desc: "민감한 매출 및 학원 전체 운영 지표에 접근합니다.",
    items: [
      { id: "/admin-dashboard", label: "운영 대시보드 (KPI/통계)" },
      { id: "/billing", label: "수납 및 청구서 발행" },
      { id: "/unpaid", label: "미납자 특별 관리" },
      { id: "/shop-admin", label: "포인트 상점 관리" },
      { id: "/print-center", label: "교육청 서류 출력 센터" }, 
    ]
  },
  {
    category: "문제 및 교재 DB 업로드",
    desc: "문제은행 및 교재 구조를 파싱하여 서버에 등록하는 권한입니다.",
    items: [
      { id: "/qdb-upload", label: "마스터 문제은행(question_db) 업로드" },
      { id: "/book-upload", label: "통합 교재(textbook) 일괄 업로드" },
    ]
  },
  {
    category: "교재 구조화 및 데이터 교정",
    desc: "교재 매핑 툴과 분류(Taxonomy) 교정 툴 권한입니다.",
    items: [
      { id: "/mapper", label: "3단 크로스 교재 매퍼" },
      { id: "/taxonomy-editor", label: "수동 뎁스(Taxonomy) 교정 툴" },
    ]
  },
  {
    category: "최고관리자 권한",
    desc: "SUPER_ADMIN은 기본으로 모든 권한을 가지며, 이 메뉴는 별도 부여용입니다.",
    items: [
      { id: "/seat-layout-editor", label: "클리닉 좌석 배치 에디터" },
      { id: "/academy-info", label: "학원(지점) 기본 정보 설정" },
    ]
  }
];

const ROLES = [
  { id: "ADMIN", name: "원장", desc: "지점 내 최고 권한 (SUPER_ADMIN 제외)" },
  { id: "VICE_ADMIN", name: "부원장", desc: "원장에 준하는 총괄 관리 권한" },
  { id: "MANAGER", name: "실장", desc: "수납/상담 및 데스크 전반 관리" },
  { id: "TEACHER", name: "전임강사", desc: "클래스, 학생, 출제, 학습 관리" },
  { id: "PART_TEACHER", name: "파트강사", desc: "제한된 반 및 학생 관리" },
  { id: "TA", name: "조교", desc: "보조 채점, 클리닉 출결 지원" },
  { id: "GUEST", name: "체험/테스트", desc: "모든 메뉴 열람 전용 (조작 차단됨)" },
];

export default function PermissionPage() {
  const router = useRouter();
  
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [tenantId, setTenantId] = useState("");
  const [activeRole, setActiveRole] = useState(ROLES[0]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tId = localStorage.getItem("logica_tenant_id");

    const adminFlag = ["SUPER_ADMIN", "ADMIN", "GUEST"].includes(role.toUpperCase()) || 
                      ["최고관리자", "대장", "원장"].some(p => pos.includes(p));

    if (!tId) {
      alert("지점 정보가 없습니다.");
      router.replace("/home");
      return;
    }
                      
    if (!adminFlag) {
      alert("⛔ 권한 관리 페이지에 접근할 권한이 없습니다. (원장 및 최고관리자 전용)");
      router.replace("/home");
      return;
    }
    
    setIsAuthorized(true);
    setTenantId(tId);
    loadPermissions(tId);
  }, [router]);

  const loadPermissions = async (tId: string) => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('tenant_role_permissions')
      .select('role_name, allowed_menus')
      .eq('tenant_id', tId);

    if (!error && data) {
      const perms: Record<string, string[]> = {};
      data.forEach(row => {
        perms[row.role_name] = row.allowed_menus;
      });
      ROLES.forEach(r => {
        if (!perms[r.id]) perms[r.id] = ["/home"];
      });
      setRolePermissions(perms);
    }
    setIsLoading(false);
  };

  const currentPermissions = rolePermissions[activeRole.id] || ["/home"];

  const togglePermission = (menuId: string, isDisabled?: boolean) => {
    if (isDisabled) return;
    
    setRolePermissions(prev => {
      const current = prev[activeRole.id] || [];
      const updated = current.includes(menuId) 
        ? current.filter(id => id !== menuId) 
        : [...current, menuId];
      
      return { ...prev, [activeRole.id]: updated };
    });
  };

  const toggleGroupAll = (groupItems: any[]) => {
    const toggleableItems = groupItems.filter(i => !i.isRequired);
    if (toggleableItems.length === 0) return;

    setRolePermissions(prev => {
      const current = prev[activeRole.id] || [];
      const itemIds = toggleableItems.map(item => item.id);
      
      const isAllChecked = itemIds.every(id => current.includes(id));
      
      let updated = [...current];

      if (isAllChecked) {
        updated = updated.filter(id => !itemIds.includes(id));
      } else {
        itemIds.forEach(id => {
          if (!updated.includes(id)) updated.push(id);
        });
      }

      return { ...prev, [activeRole.id]: updated };
    });
  };

  const handleSave = async () => {
    if (!tenantId) return;
    setIsSaving(true);
    
    try {
      const finalPermissions = Array.from(new Set([...currentPermissions, "/home"]));

      const { error } = await supabase
        .from('tenant_role_permissions')
        .upsert({
          tenant_id: tenantId,
          role_name: activeRole.id,
          allowed_menus: finalPermissions,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id, role_name' });

      if (error) throw error;
      alert(`✅ [${activeRole.name}]의 권한이 성공적으로 업데이트되었습니다!`);
    } catch (e: any) {
      alert("권한 저장 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  if (isLoading) {
    return <div className="p-8 font-bold text-slate-500">권한 정보를 불러오는 중입니다...</div>;
  }

  return (
    <div className="h-full flex flex-col font-pretendard bg-slate-50 p-4 sm:p-8 overflow-hidden">
      <div className="shrink-0 flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            🔐 지점 권한 관리
          </h1>
          <p className="text-slate-500 font-bold text-[12px] mt-1">
            우리 학원의 직급별로 접근 가능한 메뉴와 세부 권한을 제어합니다.
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden min-h-0">
        <div className="w-full lg:w-72 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col shrink-0 overflow-hidden h-full">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0">
            <span className="font-black text-sm text-slate-700">관리 대상 직급</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll p-2">
            {ROLES.map(role => (
              <button 
                key={role.id}
                onClick={() => setActiveRole(role)}
                className={`w-full text-left p-3 mb-1 rounded-xl transition-colors border flex flex-col gap-1 ${activeRole.id === role.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
              >
                <div className="flex justify-between items-center">
                  <span className={`font-bold text-[13px] ${activeRole.id === role.id ? 'text-indigo-800' : 'text-slate-700'}`}>{role.name}</span>
                  <span className="text-[9px] font-black text-slate-400 border border-slate-200 bg-white px-1.5 py-0.5 rounded">{role.id}</span>
                </div>
                <div className={`text-[10px] truncate ${activeRole.id === role.id ? 'text-indigo-500' : 'text-slate-400'}`}>{role.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-full relative">
          <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center shrink-0 z-10">
            <div>
              <h2 className="text-base font-black text-indigo-900 flex items-center gap-2">
                <span className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded text-[11px] border border-indigo-200">{activeRole.id}</span> 
                {activeRole.name} 권한 설정
              </h2>
              <p className="text-[11px] text-slate-500 font-medium mt-1">체크박스를 선택하여 해당 직급의 선생님이 좌측 메뉴에 접근할 수 있도록 허용합니다.</p>
            </div>
            <button onClick={handleSave} disabled={isSaving} className="bg-[#002864] hover:bg-blue-900 disabled:opacity-50 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-1.5">
              <span>💾</span> {isSaving ? "저장 중..." : "설정 저장하기"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 lg:p-8 bg-slate-50/30">
            <div className="max-w-4xl mx-auto flex flex-col gap-5 pb-10">
              {PERMISSION_GROUPS.map((group, gIdx) => {
                
                const toggleableItems = group.items.filter((i: any) => !i.isRequired);
                const hasToggleable = toggleableItems.length > 0;
                
                const isGroupAllChecked = hasToggleable && toggleableItems.every(item => currentPermissions.includes(item.id));
                const isGroupPartiallyChecked = !isGroupAllChecked && toggleableItems.some(item => currentPermissions.includes(item.id));

                return (
                  <div key={gIdx} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    
                    <div className="bg-slate-100/80 px-5 py-3 flex justify-between items-center border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-black text-slate-700">{group.category}</span>
                        {group.desc && <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200">{group.desc}</span>}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {hasToggleable && (
                          <>
                            <span className="text-[11px] font-bold text-slate-500 cursor-pointer" onClick={() => toggleGroupAll(group.items)}>전체 선택</span>
                            <input 
                              type="checkbox" 
                              checked={isGroupAllChecked}
                              ref={input => {
                                if (input) input.indeterminate = isGroupPartiallyChecked;
                              }}
                              onChange={() => toggleGroupAll(group.items)}
                              className="w-5 h-5 rounded transition-transform active:scale-90 accent-indigo-600 cursor-pointer" 
                            />
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col divide-y divide-slate-100">
                      {group.items.map((item: any) => {
                        const isChecked = item.isRequired ? true : currentPermissions.includes(item.id);
                        const isDisabled = item.isRequired;

                        return (
                          <label 
                            key={item.id} 
                            className={`flex justify-between items-center py-2.5 transition-colors group ${isDisabled ? 'cursor-not-allowed bg-slate-50/50 px-5' : (item.isAction ? 'cursor-pointer hover:bg-rose-50/50 bg-slate-50/30 pl-10 pr-5' : 'cursor-pointer hover:bg-indigo-50/30 px-5')}`}
                          >
                            <div className="flex flex-col">
                              <span className={`text-[12px] font-bold transition-colors ${isDisabled ? 'text-slate-400' : (item.isAction ? 'text-rose-600' : 'text-slate-700 group-hover:text-indigo-800')}`}>
                                {item.label}
                              </span>
                              {!item.isAction && <span className="text-[9px] text-slate-400 font-mono mt-0.5">{item.id}</span>}
                            </div>
                            <div className="flex items-center">
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                onChange={() => togglePermission(item.id, isDisabled)}
                                disabled={isDisabled}
                                className={`w-4 h-4 rounded transition-transform active:scale-90 ${isDisabled ? 'accent-slate-300 cursor-not-allowed opacity-50' : (item.isAction ? 'accent-rose-500 cursor-pointer' : 'accent-[#002864] cursor-pointer')}`} 
                              />
                            </div>
                          </label>
                        );
                      })}
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}