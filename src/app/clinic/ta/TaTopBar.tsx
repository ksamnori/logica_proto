// src/app/clinic/ta/TaTopBar.tsx
//
// 조교(TA) 화면들(패드/채점) 공용 상단바. 예전엔 화면 전환을 허브(/clinic/ta)에서
// 담당했지만 허브를 없애면서, 메인 대시보드의 사이드바처럼 여기서 화면을 오갈 수 있게 했다.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { path: "/clinic/ta/pad", label: "🧑‍🏫 조교 패드" },
  { path: "/clinic/ta/grading", label: "📝 조교 채점" },
];

export default function TaTopBar({ taName, isConnected, hasActiveRequest }: { taName: string; isConnected?: boolean; hasActiveRequest?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  const guard = (e: React.MouseEvent) => {
    if (hasActiveRequest) {
      e.preventDefault();
      alert('처리 중인 요청이 있습니다. 먼저 완료한 뒤에 이동해주세요.');
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3 shrink-0 shadow-sm z-30">
      
      {/* 🌟 로고 클릭 시 /clinic/ta 로 이동 (진행 중인 작업이 있으면 guard가 막아줌) */}
      <Link href="/clinic/ta" onClick={guard} className="shrink-0 mr-1 flex items-center transition-opacity hover:opacity-80" title="조교 허브로 이동">
        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-6 object-contain" />
      </Link>

      <nav className="flex items-center gap-4 h-full self-stretch">
        {TABS.map(tab => {
          const active = pathname === tab.path || pathname.startsWith(tab.path + "/");
          return (
            <Link
              key={tab.path}
              href={tab.path}
              onClick={active ? undefined : guard}
              aria-disabled={!active && hasActiveRequest}
              className={`text-[11px] font-bold h-full flex items-center border-b-2 transition-colors ${active ? 'border-[#002864] text-[#002864]' : hasActiveRequest ? 'border-transparent text-slate-300 cursor-not-allowed' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {isConnected !== undefined && (
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 mr-1">
            <span className={`w-2 h-2 rounded-full inline-block ${isConnected ? 'bg-green-500 animate-[pulse_1.6s_infinite]' : 'bg-rose-500'}`}></span>
            <span>{isConnected ? '연결됨' : '연결 중...'}</span>
          </div>
        )}
        
        {/* 🌟 조교 이름 표시 통일 (깔끔한 뱃지 스타일 적용) */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
          <span className="text-[12px]">👨‍🏫</span>
          <span className="text-[11px] font-black text-[#002864]">{taName} 조교님</span>
        </div>
      </div>
    </header>
  );
}