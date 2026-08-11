// src/components/auth/SuperAdminModal.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation"; 
import { supabase } from "@/lib/supabase";

interface SuperAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SuperAdminModal({ isOpen, onClose }: SuperAdminModalProps) {
  const router = useRouter(); 
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
      document.cookie = "sb-access-token=; path=/; max-age=0;"; 
      
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

      if (authData.session) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }

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

      const isSuperAdmin = adminData.role === 'SUPER_ADMIN' || String(adminData.position).includes('최고관리자');

      if (isSuperAdmin) {
        localStorage.setItem("logica_instructor_id", adminData.instructor_id);
        localStorage.setItem("logica_instructor_name", adminData.name);
        localStorage.setItem("logica_instructor_role", adminData.role || "SUPER_ADMIN");
        localStorage.setItem("logica_instructor_position", adminData.position || "최고관리자");
        
        // 🌟 [추가됨] 최고관리자도 시스템 이용을 위해 소속 지점(본사 등) 꼬리표를 챙겨야 합니다!
        if (adminData.tenant_id) {
          localStorage.setItem("logica_tenant_id", adminData.tenant_id);
        }

        sessionStorage.setItem("just_logged_in", "true");

        alert("👑 최고관리자님, 환영합니다. 모든 시스템 접근이 허가되었습니다.");
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