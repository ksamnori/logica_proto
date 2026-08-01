// src/components/auth/SuperAdminModal.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation"; // 💡 Next.js 라우터 추가
import { supabase } from "@/lib/supabase";

interface SuperAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SuperAdminModal({ isOpen, onClose }: SuperAdminModalProps) {
  const router = useRouter(); // 💡 라우터 객체 생성
  const [adminId, setAdminId] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSuperLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      localStorage.clear();
      document.cookie = "sb-access-token=; path=/; max-age=0;"; // 이전 쿠키 초기화
      
      // 1. Supabase Auth로 인증 (가짜 이메일 트릭)
      const fakeEmail = `${adminId}@logica.com`;
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: adminPw,
      });

      if (authError) {
        alert("최고관리자 인증에 실패했습니다.");
        setIsLoading(false);
        return;
      }

      // 🌟 2. 미들웨어가 읽을 수 있도록 수파베이스 토큰을 쿠키에 저장! (필수)
      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

      // 3. 인증 성공 후 DB에서 직급/권한 확인
      const { data: adminData, error: dbError } = await supabase
        .from("instructor")
        .select("*")
        .eq("login_id", adminId)
        .single();

      if (dbError || !adminData) {
        alert("계정 정보를 찾을 수 없습니다.");
        setIsLoading(false);
        return;
      }

      // 4. 최고관리자 권한인지 깐깐하게 체크
      const isSuperAdmin = adminData.role === 'SUPER_ADMIN' || String(adminData.position).includes('최고관리자');

      if (isSuperAdmin) {
        localStorage.setItem("logica_instructor_id", adminData.instructor_id);
        localStorage.setItem("logica_instructor_name", adminData.name);
        localStorage.setItem("logica_instructor_role", adminData.role || "SUPER_ADMIN");
        localStorage.setItem("logica_instructor_position", adminData.position || "최고관리자");
        sessionStorage.setItem("just_logged_in", "true");

        alert("👑 최고관리자님, 환영합니다. 모든 시스템 접근이 허가되었습니다.");
        
        // 💡 5. window.location.href 대신 Next.js 라우터를 사용하여 통제실로 직행
        router.replace("/super-admin"); 
      } else {
        alert("이 계정은 최고관리자(SUPER_ADMIN) 권한이 없습니다.");
      }
    } catch (error) {
      console.error("수퍼어드민 로그인 에러:", error);
      alert("서버 통신 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-600 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden text-white">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-black text-rose-500 tracking-tight">👑 SUPER ADMIN</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-2xl leading-none">&times;</button>
          </div>
          <form onSubmit={handleSuperLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">마스터 ID</label>
              <input type="text" required value={adminId} onChange={(e) => setAdminId(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white outline-none focus:border-rose-500 font-mono" placeholder="Developer ID" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">마스터 Password</label>
              <input type="password" required value={adminPw} onChange={(e) => setAdminPw(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white outline-none focus:border-rose-500 font-mono" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={isLoading} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-lg mt-4 transition-colors shadow-lg shadow-rose-900/50 disabled:opacity-50">
              {isLoading ? "접근 확인 중..." : "시스템 최상위 권한 획득"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}