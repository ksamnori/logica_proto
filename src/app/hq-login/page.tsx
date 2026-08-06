// src/app/hq-login/page.tsx
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function HQLoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ phone: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);

  const formatPhone = (val: string) => {
    const res = val.replace(/[^0-9]/g, '');
    if (res.length < 4) return res;
    if (res.length < 8) return res.substring(0, 3) + '-' + res.substring(3);
    return res.substring(0, 3) + '-' + res.substring(3, 7) + '-' + res.substring(7, 11);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === 'phone') {
      setFormData({ ...formData, phone: formatPhone(e.target.value) });
    } else {
      setFormData({ ...formData, [e.target.name]: e.target.value });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phone || !formData.password) return alert('연락처와 비밀번호를 입력해주세요.');

    setIsLoading(true);
    try {
      const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
      const fakeEmail = `${cleanPhone}@logica.com`; 

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: formData.password,
      });

      if (authError) throw new Error('연락처나 비밀번호가 일치하지 않습니다.');

      // 💡 [수정] DB에서 chat_position을 함께 불러옵니다.
      const { data: instData, error: dbError } = await supabase
        .from('instructor')
        .select('instructor_id, name, role, position, chat_position, tenant_id, academy_tenant(tenant_type)')
        .eq('instructor_id', authData.user.id)
        .single();

      if (dbError || !instData) throw new Error('직원 정보를 찾을 수 없습니다.');

      localStorage.setItem('logica_instructor_id', instData.instructor_id);
      localStorage.setItem('logica_instructor_name', instData.name);
      localStorage.setItem('logica_instructor_role', instData.role || 'SUPER_ADMIN');
      
      // 💡 [핵심] 브라우저에 "chat_position(채팅용 직책)"을 1순위로 저장. (없으면 기존 position 사용)
      localStorage.setItem('logica_instructor_position', instData.chat_position || instData.position || '본사 직원');
      
      if (instData.tenant_id) localStorage.setItem('logica_tenant_id', instData.tenant_id);

      router.push('/hq');

    } catch (error: any) {
      alert(`로그인 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-pretendard">
      <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#002864] to-blue-500"></div>
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">천종현수학연구소 <span className="text-[#002864]">HQ</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2">본사/출판사 임직원 전용 로그인</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">연락처 (아이디)</label>
            <input 
              type="text" 
              name="phone" 
              value={formData.phone} 
              maxLength={13} 
              onChange={handleChange} 
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864] font-bold tracking-wider" 
              placeholder="010-1234-5678" 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">비밀번호</label>
            <input 
              type="password" 
              name="password" 
              value={formData.password} 
              onChange={handleChange} 
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864]" 
              placeholder="••••••••" 
            />
          </div>

          <button type="submit" disabled={isLoading} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-extrabold py-4 rounded-xl shadow-lg transition-colors mt-4 disabled:opacity-50">
            {isLoading ? '로그인 중...' : 'HQ 워크스페이스 입장'}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400 font-bold">
            계정이 없으신가요? <button type="button" onClick={() => router.push('/hq-signup')} className="text-[#002864] hover:underline ml-1">본사 직원 가입하기</button>
          </p>
        </div>
      </div>
    </div>
  );
}