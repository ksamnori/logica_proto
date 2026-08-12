// src/app/update-password/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      alert("비밀번호는 최소 6자리 이상이어야 합니다.");
      return;
    }
    if (password !== confirmPassword) {
      alert("입력하신 두 비밀번호가 일치하지 않습니다.");
      return;
    }

    setIsLoading(true);
    try {
      // 🌟 Supabase를 통해 비밀번호를 즉시 변경
      const { error } = await supabase.auth.updateUser({ password: password });
      
      if (error) throw error;

      alert("🎉 비밀번호가 성공적으로 변경되었습니다!\n새로운 비밀번호로 로그인해주세요.");
      // 변경이 완료되면 수파베이스 세션을 날리고 로그인 페이지로 보냅니다.
      await supabase.auth.signOut();
      router.push("/");
    } catch (error: any) {
      alert("비밀번호 변경에 실패했습니다. 링크가 만료되었을 수 있습니다.\n에러: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center mb-6">
          <span className="text-4xl mb-3 block">🔒</span>
          <h2 className="text-xl font-extrabold text-slate-800">새 비밀번호 설정</h2>
          <p className="text-sm font-bold text-slate-500 mt-2">앞으로 사용할 새로운 비밀번호를 입력해주세요.</p>
        </div>

        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">새 비밀번호 (6자리 이상)</label>
            <input 
              type="password" 
              required
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-indigo-600 font-medium" 
              placeholder="새로운 비밀번호 입력" 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">새 비밀번호 확인</label>
            <input 
              type="password" 
              required
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:border-indigo-600 font-medium" 
              placeholder="한 번 더 입력해주세요" 
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl shadow-md transition-colors mt-4"
          >
            {isLoading ? "변경 중... ⏳" : "비밀번호 변경 완료하기"}
          </button>
        </form>
      </div>
    </div>
  );
}