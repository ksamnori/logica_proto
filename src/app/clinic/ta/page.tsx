// src/app/clinic/ta/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getInstructorPosition, performTaLogout, syncInstructorProfile } from "./taAccess";

export default function TaHubPage() {
  const router = useRouter();
  const [taName, setTaName] = useState<string | null>(null);
  const [taPosition, setTaPosition] = useState<string>("");
  const [isInstructorLogin, setIsInstructorLogin] = useState(false);

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id");
    const instName = localStorage.getItem("logica_instructor_name");
    const role = localStorage.getItem("logica_instructor_role");

    if (!instId || !instName) {
      alert("로그인이 필요합니다.");
      router.replace("/");
      return;
    }

    setTaName(instName);
    setTaPosition(getInstructorPosition());
    setIsInstructorLogin(role !== "TA" && role !== "GUEST");

    syncInstructorProfile(supabase).then((profile) => {
      if (profile.name) setTaName(profile.name);
      if (profile.position) setTaPosition(profile.position);
    });
  }, [router]);

  const handleLogout = async () => {
    await performTaLogout(supabase);
    router.replace("/");
  };

  if (taName === null) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 font-pretendard">
      <div className="bg-white w-full max-w-[500px] rounded-2xl shadow-2xl overflow-hidden flex flex-col z-10 border border-slate-200">
        <div className="bg-brand p-6 text-center relative shrink-0">
          <h2 className="text-xl font-bold text-white tracking-tighter">Logica Clinic TA</h2>
          <p className="text-blue-200 text-sm mt-1.5 font-medium">
            환영합니다, <span className="font-bold text-white">{taName}</span>
            {taPosition ? ` ${taPosition}님` : "님"}
          </p>
        </div>

        <div className="p-6 space-y-3 bg-slate-50">
          <button
            onClick={() => router.push("/clinic/ta/pad")}
            className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-md transition-all group"
          >
            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-blue-600 transition-colors shrink-0">
              <span className="group-hover:text-white transition-colors">🧑‍🏫</span>
            </div>
            <div className="text-left flex-1 min-w-0">
              <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-blue-700 transition-colors truncate">조교 패드 (현장용)</h3>
              <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">클리닉 순회 및 학생 호출 · 힌트 응대</p>
            </div>
            <span className="text-slate-300 group-hover:text-blue-600 font-bold transition-colors">➔</span>
          </button>

          <button
            onClick={() => router.push("/clinic/ta/grading")}
            className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-500 hover:shadow-md transition-all group"
          >
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-emerald-500 transition-colors shrink-0">
              <span className="group-hover:text-white transition-colors">📝</span>
            </div>
            <div className="text-left flex-1 min-w-0">
              <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-emerald-700 transition-colors truncate">조교 채점 (데스크용)</h3>
              <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">제출된 시험지 및 과제 수동 집중 채점</p>
            </div>
            <span className="text-slate-300 group-hover:text-emerald-600 font-bold transition-colors">➔</span>
          </button>

          {isInstructorLogin && (
            <button
              onClick={() => router.push("/home")}
              className="w-full flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-500 hover:shadow-md transition-all group mt-2"
            >
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-2xl group-hover:bg-indigo-500 transition-colors shrink-0">
                <span className="group-hover:text-white transition-colors">🏠</span>
              </div>
              <div className="text-left flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-700 transition-colors truncate">메인 메뉴 (Home)</h3>
                <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">일반 강사 대시보드로 이동</p>
              </div>
              <span className="text-slate-300 group-hover:text-indigo-600 font-bold transition-colors">➔</span>
            </button>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-100 flex justify-center">
          <button
            onClick={handleLogout}
            className="text-sm font-bold text-slate-400 hover:text-rose-500 transition-colors underline"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
