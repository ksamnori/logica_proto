"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      alert("비밀번호는 최소 6자리 이상이어야 합니다.");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      return;
    }

    setIsLoading(true);

    try {
      // 💡 Supabase Auth의 현재 로그인된 사용자 비밀번호 업데이트
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      alert("비밀번호가 성공적으로 변경되었습니다!\n다음 로그인부터 새 비밀번호를 사용해 주세요.");
      onClose(); // 성공 시 모달 닫기
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error(error);
      alert(`비밀번호 변경 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-[#002864]">
          <h2 className="text-lg font-bold text-white">🔐 내 정보 수정 (비밀번호)</h2>
          <button onClick={onClose} className="text-blue-200 hover:text-white text-2xl leading-none transition-colors">&times;</button>
        </div>
        <form onSubmit={handleChangePassword} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">새 비밀번호</label>
            <input 
              type="password" 
              required 
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" 
              placeholder="새로운 비밀번호 입력" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">새 비밀번호 확인</label>
            <input 
              type="password" 
              required 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" 
              placeholder="다시 한번 입력" 
            />
          </div>
          <button 
            type="submit" 
            disabled={isLoading} 
            className="w-full mt-4 bg-[#002864] hover:bg-blue-900 text-white font-bold py-2.5 rounded-lg shadow-md transition-colors disabled:opacity-50"
          >
            {isLoading ? "변경 중..." : "비밀번호 변경하기"}
          </button>
        </form>
      </div>
    </div>
  );
}