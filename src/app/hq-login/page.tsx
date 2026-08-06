// src/app/hq-login/page.tsx
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function HQLoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ phone: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phone || !formData.password) return alert('연락처와 비밀번호를 입력해주세요.');

    setIsLoading(true);
    try {
      const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
      const fakeEmail = `${cleanPhone}@logica.com`; // 본사 가입 시 사용한 규칙 그대로 적용

      // 1. Supabase Auth 로그인
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: formData.password,
      });

      if (authError) throw new Error('연락처나 비밀번호가 일치하지 않습니다.');

      // 2. 강사(Staff) 정보 불러오기
      const { data: instData, error: dbError } = await supabase
        .from('instructor')
        .select('instructor_id, name, role, position, tenant_id, academy_tenant(tenant_type)')
        .eq('instructor_id', authData.user.id)
        .single();

      if (dbError || !instData) throw new Error('직원 정보를 찾을 수 없습니다.');

      // 3. 브라우저 저장소에 로그인 정보 세팅 (채팅방 등에서 사용됨)
      localStorage.setItem('logica_instructor_id', instData.instructor_id);
      localStorage.setItem('logica_instructor_name', instData.name);
      localStorage.setItem('logica_instructor_role', instData.role || 'SUPER_ADMIN');
      localStorage.setItem('logica_instructor_position', instData.position || '본사 직원');
      if (instData.tenant_id) localStorage.setItem('logica_tenant_id', instData.tenant_id);

      // 💡 4. 핵심: 로그인 성공 시 무조건 HQ 전용 채팅/업무 공간으로 꽂아버림!
      router.push('/hq');

    } catch (error: any) {
      alert(`로그인 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-pretendard relative overflow-hidden">
      {/* 배경 장식 */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="bg-white/95 backdrop-blur-sm p-10 rounded-3xl shadow-2xl w-full max-w-md relative z-10 border border-white/20">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-slate-800 tracking-tighter">LOGICA <span className="text-blue-600">HQ</span></h1>
          <p className="text-sm font-bold text-slate-500 mt-2">본사/출판사 임직원 전용 로그인</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 pl-1">연락처 (아이디)</label>
            <input 
              type="text" 
              name="phone" 
              value={formData.phone} 
              onChange={handleChange} 
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white font-bold tracking-wider transition-all" 
              placeholder="01012345678" 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 pl-1">비밀번호</label>
            <input 
              type="password" 
              name="password" 
              value={formData.password} 
              onChange={handleChange} 
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" 
              placeholder="••••••••" 
            />
          </div>

          <button type="submit" disabled={isLoading} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-black py-4 rounded-xl shadow-[0_8px_20px_rgba(0,40,100,0.3)] transition-all mt-6 disabled:opacity-50">
            {isLoading ? '로그인 중...' : 'HQ 워크스페이스 입장'}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400 font-medium">
            계정이 없으신가요? <button onClick={() => router.push('/hq-signup')} className="text-blue-600 font-bold hover:underline ml-1">본사 직원 가입하기</button>
          </p>
        </div>
      </div>
    </div>
  );
}