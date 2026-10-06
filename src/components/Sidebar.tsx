// src/components/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [strictSuperAdmin, setStrictSuperAdmin] = useState(false);
  const [isPrincipal, setIsPrincipal] = useState(false);
  // 🌟 메뉴 분류 표시용 직급 판정 (메뉴 접근 권한과는 별개)
  const [isOwner, setIsOwner] = useState(false);       // 최고관리자 또는 원장 (부원장 제외)
  const [isDeskStaff, setIsDeskStaff] = useState(false); // 최고관리자·원장·부원장·실장
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const [tenantName, setTenantName] = useState<string>("로딩중...");
  const [displayRole, setDisplayRole] = useState<string>("TEACHER");

  const [allowedMenus, setAllowedMenus] = useState<string[]>([]);
  const [isLoadingPerms, setIsLoadingPerms] = useState(true);

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || 'TEACHER';
    const pos = localStorage.getItem('logica_instructor_position') || '';

    setDisplayRole(role);

    const isTeacherMode = role === 'TEACHER';
    const isSA = !isTeacherMode && (role === 'SUPER_ADMIN' || pos.includes('최고관리자') || pos.includes('대장'));
    const isPrin = !isTeacherMode && (role === 'ADMIN' || pos.includes('원장'));

    setStrictSuperAdmin(isSA);
    setIsPrincipal(isPrin);

    // "부원장"에도 "원장"이 들어 있으므로 원장은 부원장을 빼고 판정
    const posIsOwner = pos.includes('원장') && !pos.includes('부원장');
    const owner = isSA || (!isTeacherMode && (role === 'ADMIN' || posIsOwner));
    const desk = owner || (!isTeacherMode && (['VICE_ADMIN', 'MANAGER'].includes(role) || pos.includes('부원장') || pos.includes('실장')));
    setIsOwner(owner);
    setIsDeskStaff(desk);

    // 분류 접힘 상태: 기본값 + 이 컴퓨터에 저장된 선생님 선택
    const defaults: Record<string, boolean> = {
      academy: true, lesson: true, comm: false, exam: true,
      desk: desk, ta: role === 'TA', factory: false, owner: true,
    };
    let saved: Record<string, boolean> = {};
    try { saved = JSON.parse(localStorage.getItem('logica_sidebar_sections') || '{}'); } catch { saved = {}; }
    setOpenSections({ ...defaults, ...saved });

    const fetchData = async () => {
      const tId = localStorage.getItem('logica_tenant_id');

      if (tId) {
        const { data } = await supabase.from('academy_tenant').select('name').eq('tenant_id', tId).maybeSingle();
        setTenantName(data?.name || "지점 미배정");
      } else {
        setTenantName("지점 미배정");
      }

      if (!(isSA || isPrin) && tId) {
        const { data: permData } = await supabase
          .from('tenant_role_permissions')
          .select('allowed_menus')
          .eq('tenant_id', tId)
          .eq('role_name', role)
          .maybeSingle();

        if (permData && permData.allowed_menus) {
          setAllowedMenus(permData.allowed_menus);
        } else {
          // DB에 데이터가 없을 때의 기본 폴백 (팩토리 메뉴 제외됨)
          setAllowedMenus(['/home', '/student', '/class', '/lesson', '/progress', '/learning', '/class-report', '/makeup', '/minutes', '/task', '/cs', '/supply', '/exam-list', '/admission']);
        }
      }
      setIsLoadingPerms(false);
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (displayRole === 'GUEST') {
      const blockActions = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.closest('aside')) return;
        if (target.closest('.allow-guest-interaction')) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'click') {
          alert("🔒 테스트(체험용) 계정은 읽기 전용 모드입니다.\n화면 구경은 가능하지만 데이터를 수정하거나 삭제할 수 없습니다.");
        }
      };
      window.addEventListener('click', blockActions, true);
      window.addEventListener('keydown', blockActions, true);
      window.addEventListener('mousedown', blockActions, true);
      return () => {
        window.removeEventListener('click', blockActions, true);
        window.removeEventListener('keydown', blockActions, true);
        window.removeEventListener('mousedown', blockActions, true);
      };
    }
  }, [displayRole]);

  // 🌟 핵심 로직 변경: 팩토리 메뉴의 강제 하드 블락을 해제하고 DB 권한 설정에 완벽히 동기화
  const canAccess = (path: string) => {
    if (displayRole === 'GUEST' && path === '/ta-tools') return false;
    
    // 원장, 최고관리자, 게스트(뷰어)는 프리패스
    if (strictSuperAdmin || isPrincipal || displayRole === 'GUEST') return true;
    
    // 조교 전용 페이지
    if (path === '/ta-tools' && displayRole === 'TA') return true;

    // 조교(TA)는 팩토리 영역(DB 건드리는 메뉴) 원천 차단
    const factoryPaths = ['/factory-dashboard', '/pdf-parser', '/mapper', '/taxonomy-editor', '/twin-manager', '/qdb-upload', '/book-upload', '/competency-mapper'];
    if (factoryPaths.includes(path) && displayRole === 'TA') return false;

    // 🌟 그 외 모든 직급(파트강사 포함)은 오직 DB(권한 관리 페이지) 설정값에 따릅니다.
    if (isLoadingPerms) return false;
    return allowedMenus.includes(path);
  };

  const MenuItem = ({ path, linkTo, label, desc, full = false }: { path: string, linkTo?: string, label: string, desc?: string, full?: boolean }) => {
    const active = pathname === (linkTo || path) || pathname.startsWith((linkTo || path) + "/");
    const disabled = !canAccess(path);
    const isFactory = ['/factory-dashboard', '/pdf-parser', '/mapper', '/taxonomy-editor', '/twin-manager', '/qdb-upload', '/book-upload', '/competency-mapper'].includes(path);

    const baseClass = `flex flex-col items-center justify-center px-2 py-2 rounded-xl transition-all border relative overflow-hidden ${full ? 'col-span-2' : 'col-span-1'}`;

    if (disabled) {
      return (
        <div className={`${baseClass} bg-slate-50/50 border-slate-100 text-slate-400 opacity-40 cursor-not-allowed`} title="접근 권한이 없습니다 (권한 관리 페이지에서 허용 필요)">
          <span className="text-[13px] font-bold truncate w-full text-center">{label}</span>
          {desc && <span className="text-xs font-medium mt-0.5">{desc}</span>}
          <span className="absolute top-1 right-2 text-[8px] font-bold text-slate-300">🔒</span>
        </div>
      );
    }

    let customBg = active ? 'bg-blue-50 border-blue-200 text-brand shadow-[0_2px_8px_rgba(0,40,100,0.08)]' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-800 hover:shadow-sm';
    let customLabel = active ? 'font-bold' : 'font-bold';
    let customDesc = active ? 'text-blue-500 font-bold' : 'text-slate-400 font-medium';

    if (path === '/home') {
      customBg = active ? 'bg-brand border-[#001f4d] text-white shadow-md' : 'bg-blue-50/50 border-blue-100 text-brand hover:bg-blue-100 hover:border-blue-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-blue-200 font-medium' : 'text-blue-400 font-medium';
    } else if (path === '/learning') { 
      customBg = active ? 'bg-emerald-500 border-emerald-600 text-white shadow-md' : 'bg-emerald-50/50 border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-emerald-100 font-medium' : 'text-emerald-500 font-medium';
    } else if (path === '/class-report') {
      customBg = active ? 'bg-teal-500 border-teal-600 text-white shadow-md' : 'bg-teal-50/50 border-teal-100 text-teal-700 hover:bg-teal-100 hover:border-teal-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-teal-100 font-medium' : 'text-teal-500 font-medium';
    } else if (path === '/exam-list') {
      customBg = active ? 'bg-violet-500 border-violet-600 text-white shadow-md' : 'bg-violet-50/50 border-violet-100 text-violet-700 hover:bg-violet-100 hover:border-violet-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-violet-100 font-medium' : 'text-violet-400 font-medium';
    } else if (path === '/minutes') {
      customBg = active ? 'bg-sky-500 border-sky-600 text-white shadow-md' : 'bg-sky-50/50 border-sky-100 text-sky-700 hover:bg-sky-100 hover:border-sky-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-sky-100 font-medium' : 'text-sky-500 font-medium';
    } else if (path === '/admin-dashboard') {
      customBg = active ? 'bg-orange-500 border-orange-600 text-white shadow-md' : 'bg-orange-50/50 border-orange-100 text-orange-700 hover:bg-orange-100 hover:border-orange-200 shadow-sm';
      customLabel = 'font-bold';
      customDesc = active ? 'text-orange-100 font-medium' : 'text-orange-400 font-medium';
    } else if (path === '/consultation') {
      customBg = active ? 'bg-pink-500 border-pink-600 text-white shadow-md' : 'bg-pink-50/50 border-pink-100 text-pink-700 hover:bg-pink-100 hover:border-pink-200 shadow-sm';
      customLabel = 'font-bold';
    } else if (path === '/supervisor') {
      customBg = active ? 'bg-blue-600 border-blue-700 text-white shadow-md' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300 shadow-sm';
      customLabel = 'font-bold';
    } else if (path === '/academy-info') {
      customBg = active ? 'bg-[#1f2d26] border-[#1f2d26] text-white shadow-md' : 'bg-[#2e4036] border-[#2e4036] text-white hover:bg-[#24332b] hover:border-[#24332b] shadow-sm';
      customLabel = 'font-bold';
      customDesc = 'text-emerald-200 font-medium';
    } else if (path === '/permission') {
      customBg = active ? 'bg-rose-100 border-rose-300 text-rose-800 shadow-md' : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 hover:border-rose-300 hover:text-rose-700 shadow-sm';
    } else if (isFactory) {
      customBg = active
        ? 'bg-amber-50 border-amber-200 text-amber-800 shadow-sm'
        : 'bg-white border-slate-200 text-slate-600 hover:bg-amber-50/50 hover:border-amber-200 hover:text-amber-700 shadow-sm';
      customLabel = 'font-bold';
    }

    return (
      <Link href={linkTo || path} className={`${baseClass} ${customBg}`}>
        <span className={`text-[13px] truncate w-full text-center tracking-tight ${customLabel}`}>{label}</span>
        {desc && <span className={`text-xs truncate w-full text-center tracking-tight mt-0.5 ${customDesc}`}>{desc}</span>}
      </Link>
    );
  };

  // 분류별 메뉴 경로 (지금 보는 화면이 들어 있는 분류는 자동으로 펼침)
  const SECTION_PATHS: Record<string, string[]> = {
    academy: ['/home', '/student', '/class'],
    lesson: ['/lesson', '/progress', '/learning', '/class-report', '/makeup'],
    comm: ['/minutes', '/task', '/supply', '/cs'],
    exam: ['/exam-list', '/admission'],
    desk: ['/admin-dashboard', '/consultation', '/supervisor', '/billing', '/unpaid', '/shop-admin', '/print-center'],
    ta: ['/clinic/ta'],
    factory: ['/factory-dashboard', '/pdf-parser', '/taxonomy-editor', '/twin-manager', '/mapper', '/competency-mapper', '/book-upload', '/qdb-upload'],
    owner: ['/seat-layout-editor', '/clinic-pad-registry', '/permission', '/instructor', '/academy-info'],
  };
  const sectionHasCurrent = (id: string) => (SECTION_PATHS[id] || []).some(p => pathname === p || pathname.startsWith(p + "/"));

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !isSectionOpen(id, prev) };
      try {
        const saved = JSON.parse(localStorage.getItem('logica_sidebar_sections') || '{}');
        localStorage.setItem('logica_sidebar_sections', JSON.stringify({ ...saved, [id]: next[id] }));
      } catch { /* 저장 실패는 무시 */ }
      return next;
    });
  };
  const isSectionOpen = (id: string, state = openSections) => sectionHasCurrent(id) || !!state[id];

  const renderSection = (id: string, title: string, count: number, children: React.ReactNode, tone: "default" | "factory" = "default") => {
    const open = isSectionOpen(id);
    const forced = sectionHasCurrent(id);
    return (
      <div className={`mb-4 ${tone === "factory" ? "mx-3 rounded-xl bg-amber-50/40 border border-amber-100" : ""}`}>
        <button
          type="button"
          onClick={() => !forced && toggleSection(id)}
          aria-expanded={open}
          title={forced ? "지금 보고 있는 화면이 이 분류에 있어서 펼쳐져 있습니다" : open ? "접기" : "펼치기"}
          className={`w-full flex items-center gap-2 py-2 text-left rounded-lg transition-colors ${tone === "factory" ? "px-3" : "px-4"} ${forced ? "cursor-default" : "hover:bg-slate-50"}`}
        >
          <span className="text-xs font-bold text-slate-500 tracking-wide">{title}</span>
          {!open && <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded-full px-1.5 leading-5">{count}</span>}
          <svg className={`ml-auto w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {open && (
          <div className={`grid grid-cols-2 gap-2 mt-1 ${tone === "factory" ? "px-2 pb-2" : "px-3"}`}>
            {children}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="print:hidden w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 h-full relative">

      <div onClick={() => canAccess("/home") ? router.push("/home") : router.push("/admission")} className="h-24 flex items-center px-6 border-b border-slate-100 shrink-0 cursor-pointer group hover:bg-slate-50 transition-colors gap-3.5">
        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-9 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />

        <div className="flex flex-col border-l-2 border-slate-200 pl-3.5 flex-1 min-w-0 justify-center h-12">
          <span className="text-[15px] font-bold text-slate-800 truncate leading-tight mb-0.5">
            {tenantName}
          </span>
          <span className="text-xs font-bold text-slate-400 uppercase leading-none tracking-wider whitespace-nowrap">
            {strictSuperAdmin ? "Super Admin" : (displayRole === 'GUEST' ? "테스트(읽기전용)" : displayRole.replace('_', ' '))}
          </span>
        </div>
      </div>

      <nav className="flex-1 py-5 overflow-y-auto custom-scroll">

        {renderSection("academy", "학원 관리", 3, <>
          <MenuItem path="/home" label="홈 (대시보드)" full />
          <MenuItem path="/student" label="학생 관리" />
          <MenuItem path="/class" label="반 관리" />
        </>)}

        {renderSection("lesson", "수업 관리", 5, <>
          <MenuItem path="/lesson" label="교재 관리" />
          <MenuItem path="/progress" label="진도 관리" />
          <MenuItem path="/learning" label="학습 관리" desc="(시험·과제·미완료·오답·유사)" full />
          <MenuItem path="/class-report" label="학습 결과" />
          <MenuItem path="/makeup" label="보강 관리" />
        </>)}

        {renderSection("comm", "소통 및 업무 관리", 4, <>
          <MenuItem path="/minutes" label="AI 회의록" />
          <MenuItem path="/task" label="업무 공유" />
          <MenuItem path="/supply" label="비품 신청" />
          <MenuItem path="/cs" label="학부모 요청/CS" />
        </>)}

        {renderSection("exam", "출제 및 배포", 2, <>
          <MenuItem path="/exam-list" label="문제지 관리" />
          <MenuItem path="/admission" label="진단평가 관리" />
        </>)}

        {renderSection("desk", "데스크 전용", 7, <>
          <MenuItem path="/admin-dashboard" label="운영 대시보드" full />
          <MenuItem path="/consultation" label="정기 상담 관리" />
          <MenuItem path="/supervisor" label="클리닉 관제탑" />
          <MenuItem path="/billing" label="수납/청구" />
          <MenuItem path="/unpaid" label="미납 관리" />
          <MenuItem path="/shop-admin" label="상점 관리" />
          <MenuItem path="/print-center" label="서류 출력" />
        </>)}

        {renderSection("ta", "조교(TA) 전용", 1, <>
          <MenuItem path="/ta-tools" linkTo="/clinic/ta/pad" label="조교 전용 페이지로 이동" full />
        </>)}

        {renderSection("factory", "LOGICA Factory", 8, <>
          <MenuItem path="/factory-dashboard" label="DB 통계 대시보드" full />
          <MenuItem path="/pdf-parser" label="PDF 문항 추출기" full />
          <MenuItem path="/taxonomy-editor" label="문제 교정 및 쌍둥이/유사 생성" full />
          <MenuItem path="/twin-manager" label="쌍둥이 문제 팩토리 (수동 배정)" full />
          <MenuItem path="/mapper" label="교재 수동 연결 도구" full />
          <MenuItem path="/competency-mapper" label="교과 역량 매핑" full />
          <MenuItem path="/book-upload" label="교재 DB 업로드" />
          <MenuItem path="/qdb-upload" label="문제 DB 업로드" />
        </>, "factory")}

        {/* 원장·최고관리자 전용: 해당 직급에게만 보임 */}
        {isOwner && renderSection("owner", "원장·최고관리자 전용", 5, <>
          <MenuItem path="/seat-layout-editor" label="클리닉 좌석 관리" full />
          <MenuItem path="/clinic-pad-registry" label="키오스크 패드 등록" full />
          <MenuItem path="/permission" label="권한 관리" />
          <MenuItem path="/instructor" label="강사 관리" />
          <MenuItem path="/academy-info" label="학원 정보 설정" full />
        </>)}

      </nav>
    </aside>
  );
}