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
  const [isManager, setIsManager] = useState(false);
  const [isFactoryWorker, setIsFactoryWorker] = useState(false);

  const [tenantName, setTenantName] = useState<string>("로딩중...");
  const [displayRole, setDisplayRole] = useState<string>("TEACHER");

  const [allowedMenus, setAllowedMenus] = useState<string[]>([]);
  const [isLoadingPerms, setIsLoadingPerms] = useState(true);

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || 'TEACHER';
    const pos = localStorage.getItem('logica_instructor_position') || '';

    setDisplayRole(role);

    // 🌟 강사 뷰(TEACHER) 모드일 때는 pos 텍스트에 '원장'이 남아있더라도 무시합니다.
    const isTeacherMode = role === 'TEACHER';

    const isSA = !isTeacherMode && (role === 'SUPER_ADMIN' || pos.includes('최고관리자') || pos.includes('대장'));
    const isPrin = !isTeacherMode && (role === 'ADMIN' || pos.includes('원장'));
    const isMgr = !isTeacherMode && (role === 'MANAGER' || pos.includes('실장'));
    const isFW = isSA || isPrin || isMgr || pos.includes('부원장') || pos.includes('전임강사') || isTeacherMode;

    setStrictSuperAdmin(isSA);
    setIsPrincipal(isPrin);
    setIsManager(isMgr || isPrin || isSA);
    setIsFactoryWorker(isFW);

    const fetchData = async () => {
      const tId = localStorage.getItem('logica_tenant_id');

      if (tId) {
        const { data } = await supabase.from('academy_tenant').select('name').eq('tenant_id', tId).maybeSingle();
        setTenantName(data?.name || "지점 미배정");
      } else {
        setTenantName("지점 미배정");
      }

      // isSA나 isPrin이 false가 되므로, 강사 모드일 때는 반드시 DB에서 권한을 읽어옵니다.
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

  const canAccess = (path: string) => {
    // 게스트(GUEST) 계정은 조교 전용 도구에 접근할 수 없도록 최상단에서 먼저 차단
    if (displayRole === 'GUEST' && path === '/ta-tools') return false;

    if (strictSuperAdmin || isPrincipal || displayRole === 'GUEST') return true;

    // 조교(TA) 전용 메뉴는 TA 역할 계정에게 항상 열어준다
    if (path === '/ta-tools' && displayRole === 'TA') return true;

    // 팩토리 메뉴 권한 처리
    const factoryPaths = ['/factory-dashboard', '/pdf-parser', '/mapper', '/taxonomy-editor', '/qdb-upload', '/book-upload'];
    if (factoryPaths.includes(path) && isFactoryWorker) return true;

    if (isLoadingPerms) return false;
    return allowedMenus.includes(path);
  };

  const MenuItem = ({ path, linkTo, label, desc, full = false }: { path: string, linkTo?: string, label: string, desc?: string, full?: boolean }) => {
    const active = pathname === (linkTo || path) || pathname.startsWith((linkTo || path) + "/");
    const disabled = !canAccess(path);
    const isFactory = ['/factory-dashboard', '/pdf-parser', '/mapper', '/taxonomy-editor', '/qdb-upload', '/book-upload'].includes(path);

    const baseClass = `flex flex-col items-center justify-center px-2 py-3 rounded-xl transition-all border relative overflow-hidden ${full ? 'col-span-2' : 'col-span-1'}`;

    if (disabled) {
      return (
        <div className={`${baseClass} bg-slate-50/50 border-slate-100 text-slate-400 opacity-40 cursor-not-allowed`} title="접근 권한이 없습니다">
          <span className="text-[13px] font-bold truncate w-full text-center">{label}</span>
          {desc && <span className="text-[10px] font-medium mt-0.5">{desc}</span>}
          <span className="absolute top-1 right-2 text-[8px] font-black text-slate-300">🔒</span>
        </div>
      );
    }

    // 기본 테마
    let customBg = active ? 'bg-blue-50 border-blue-200 text-[#002864] shadow-[0_2px_8px_rgba(0,40,100,0.08)]' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-800 hover:shadow-sm';
    let customLabel = active ? 'font-black' : 'font-bold';
    let customDesc = active ? 'text-blue-500 font-bold' : 'text-slate-400 font-medium';

    if (path === '/home') {
      customBg = active ? 'bg-[#002864] border-[#001f4d] text-white shadow-md' : 'bg-blue-50/50 border-blue-100 text-[#002864] hover:bg-blue-100 hover:border-blue-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-blue-200 font-medium' : 'text-blue-400 font-medium';
    } else if (path === '/learning') { 
      customBg = active ? 'bg-emerald-500 border-emerald-600 text-white shadow-md' : 'bg-emerald-50/50 border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-emerald-100 font-medium' : 'text-emerald-500 font-medium';
    } else if (path === '/class-report') {
      customBg = active ? 'bg-teal-500 border-teal-600 text-white shadow-md' : 'bg-teal-50/50 border-teal-100 text-teal-700 hover:bg-teal-100 hover:border-teal-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-teal-100 font-medium' : 'text-teal-500 font-medium';
    } else if (path === '/exam-list') {
      customBg = active ? 'bg-violet-500 border-violet-600 text-white shadow-md' : 'bg-violet-50/50 border-violet-100 text-violet-700 hover:bg-violet-100 hover:border-violet-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-violet-100 font-medium' : 'text-violet-400 font-medium';
    } else if (path === '/minutes') {
      customBg = active ? 'bg-sky-500 border-sky-600 text-white shadow-md' : 'bg-sky-50/50 border-sky-100 text-sky-700 hover:bg-sky-100 hover:border-sky-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-sky-100 font-medium' : 'text-sky-500 font-medium';
    } else if (path === '/admin-dashboard') {
      customBg = active ? 'bg-orange-500 border-orange-600 text-white shadow-md' : 'bg-orange-50/50 border-orange-100 text-orange-700 hover:bg-orange-100 hover:border-orange-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-orange-100 font-medium' : 'text-orange-400 font-medium';
    } else if (path === '/consultation') {
      // 💡 상담 관리 전용 테마 적용
      customBg = active ? 'bg-pink-500 border-pink-600 text-white shadow-md' : 'bg-pink-50/50 border-pink-100 text-pink-700 hover:bg-pink-100 hover:border-pink-200 shadow-sm';
      customLabel = 'font-black';
    } else if (path === '/academy-info') {
      customBg = active ? 'bg-[#1f2d26] border-[#1f2d26] text-white shadow-md' : 'bg-[#2e4036] border-[#2e4036] text-white hover:bg-[#24332b] hover:border-[#24332b] shadow-sm';
      customLabel = 'font-black';
      customDesc = 'text-emerald-200 font-medium';
    } else if (path === '/permission') {
      customBg = active ? 'bg-rose-100 border-rose-300 text-rose-800 shadow-md' : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 hover:border-rose-300 hover:text-rose-700 shadow-sm';
    } else if (path === '/print-center') {
      customBg = active ? 'bg-indigo-500 border-indigo-600 text-white shadow-md' : 'bg-indigo-50/50 border-indigo-100 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 shadow-sm';
      customLabel = 'font-black';
      customDesc = active ? 'text-indigo-100 font-medium' : 'text-indigo-400 font-medium';
    } else if (isFactory) {
      customBg = active
        ? 'bg-amber-50 border-amber-200 text-amber-800 shadow-sm'
        : 'bg-white border-slate-200 text-slate-600 hover:bg-amber-50/50 hover:border-amber-200 hover:text-amber-700 shadow-sm';
      customLabel = 'font-black';
    }

    return (
      <Link href={linkTo || path} className={`${baseClass} ${customBg}`}>
        <span className={`text-[13px] truncate w-full text-center tracking-tight ${customLabel}`}>{label}</span>
        {desc && <span className={`text-[10px] truncate w-full text-center tracking-tight mt-0.5 ${customDesc}`}>{desc}</span>}
      </Link>
    );
  };

  const MenuSection = ({ title, icon, children }: { title: string, icon: string, children: React.ReactNode }) => (
    <div className="mb-6">
      <div className="px-4 flex items-center gap-1.5 mb-3">
        <span className="text-[13px]">{icon}</span>
        <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">{title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 relative">
        {children}
      </div>
    </div>
  );

  return (
    <aside className="print:hidden w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 h-full relative">

      <div onClick={() => canAccess("/home") ? router.push("/home") : router.push("/admission")} className="h-24 flex items-center px-6 border-b border-slate-100 shrink-0 cursor-pointer group hover:bg-slate-50 transition-colors gap-3.5">
        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-9 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />

        <div className="flex flex-col border-l-2 border-slate-200 pl-3.5 flex-1 min-w-0 justify-center h-12">
          <span className="text-[15px] font-black text-slate-800 truncate leading-tight mb-0.5">
            {tenantName}
          </span>
          <span className="text-[10px] font-bold text-slate-400 uppercase leading-none tracking-wider whitespace-nowrap">
            {strictSuperAdmin ? "Super Admin" : (displayRole === 'GUEST' ? "테스트(읽기전용)" : displayRole.replace('_', ' '))}
          </span>
        </div>
      </div>

      <nav className="flex-1 py-5 overflow-y-auto custom-scroll">

        {/* 🌟 1. 학원 관리 */}
        <MenuSection title="학원 관리" icon="🏫">
          <MenuItem path="/home" label="홈 (대시보드)" full />
          <MenuItem path="/student" label="학생 관리" />
          <MenuItem path="/class" label="반 관리" />
        </MenuSection>

        {/* 🌟 2. 수업 관리 */}
        <MenuSection title="수업 관리" icon="👨‍🏫">
          <MenuItem path="/lesson" label="교재 관리" />
          <MenuItem path="/progress" label="진도 관리" />
          <MenuItem path="/learning" label="학습 관리" desc="(시험·과제·미완료·오답·유사)" full />
          <MenuItem path="/class-report" label="학습 결과" />
          <MenuItem path="/makeup" label="보강 관리" />
        </MenuSection>

        {/* 🌟 3. 소통 및 업무 관리 */}
        <MenuSection title="소통 및 업무 관리" icon="💬">
          <MenuItem path="/minutes" label="AI 회의록" />
          <MenuItem path="/task" label="업무 공유" />
          <MenuItem path="/supply" label="비품 신청" />
          <MenuItem path="/cs" label="학부모 요청/CS" />
        </MenuSection>

        {/* 🌟 4. 출제 및 배포 */}
        <MenuSection title="출제 및 배포" icon="🖨️">
          <MenuItem path="/exam-list" label="문제지 관리" />
          <MenuItem path="/admission" label="진단평가 관리" />
        </MenuSection>

        {/* 🌟 5. 데스크 전용 (팩토리 위로 이동) */}
        <div className="mb-6">
          <div className="px-4 flex items-center gap-1.5 mb-3">
            <span className="text-[13px]">🏢</span>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">데스크 전용</p>
            <span className="text-[9px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-md font-black border border-rose-200 ml-1">원장·실장</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3">
            <MenuItem path="/admin-dashboard" label="운영 대시보드" full />
            {/* 💡 상담 관리 메뉴를 운영 대시보드 바로 아래 널찍하게 배치 */}
            <MenuItem path="/consultation" label="정기 상담 관리" full />
            <MenuItem path="/billing" label="수납/청구" />
            <MenuItem path="/unpaid" label="미납 관리" />
            <MenuItem path="/shop-admin" label="상점 관리" />
            <MenuItem path="/print-center" label="서류 출력" />
          </div>
        </div>

        {/* 🌟 6. 조교(TA) 전용 */}
        <div className="mb-6">
          <div className="px-4 flex items-center gap-1.5 mb-3">
            <span className="text-[13px]">🧑‍🏫</span>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">조교(TA) 전용</p>
            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-black border border-slate-200 ml-1">조교</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3">
            <MenuItem path="/ta-tools" linkTo="/clinic/ta/pad" label="조교 전용 페이지로 이동" full />
          </div>
        </div>

        {/* 🌟 7. LOGICA Factory (데스크 아래로 이동) */}
        <div className="mx-3 mb-6 bg-slate-50/80 rounded-xl pt-4 pb-3 border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-[repeating-linear-gradient(45deg,#fcd34d,#fcd34d_8px,#475569_8px,#475569_16px)] opacity-50"></div>

          <div className="px-3 flex items-center gap-2 mb-3 mt-1">
            <span className="text-[14px] grayscale group-hover:grayscale-0 transition-all duration-500">🏭</span>
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-widest leading-none">LOGICA Factory</p>
          </div>

          <div className="grid grid-cols-2 gap-1.5 px-2">
            <MenuItem path="/factory-dashboard" label="DB 통계 대시보드" full />
            <MenuItem path="/pdf-parser" label="PDF 문항 추출기" full />
            <MenuItem path="/taxonomy-editor" label="문제 교정 및 쌍둥이/유사 생성" full />
            <MenuItem path="/mapper" label="교재 수동 연결 도구" full />

            <MenuItem path="/book-upload" label="교재 DB 업로드" />
            <MenuItem path="/qdb-upload" label="문제 DB 업로드" />
          </div>
        </div>

        {/* 🌟 8. 원장·최고관리자 전용 */}
        <div className="mb-6">
          <div className="px-4 flex items-center gap-1.5 mb-3">
            <span className="text-[13px]">👑</span>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">원장·최고관리자 전용</p>
            <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-md font-black border border-indigo-200 ml-1">ADMIN</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3">
            <MenuItem path="/seat-layout-editor" label="클리닉 좌석 관리" full />
            <MenuItem path="/clinic-pad-registry" label="키오스크 패드 등록" full />
            <MenuItem path="/permission" label="권한 관리" />
            <MenuItem path="/instructor" label="강사 관리" />
            <MenuItem path="/academy-info" label="학원 정보 설정" full />
          </div>
        </div>

      </nav>
    </aside>
  );
}