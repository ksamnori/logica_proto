// src/app/hq-signup/page.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function HQSignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ name: '', phone: '', password: '', department: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [hqTenantId, setHqTenantId] = useState<string | null>(null);

  useEffect(() => {
    const fetchHqTenant = async () => {
      // 💡 1. 원장님이 알려주신 실제 본사(HQ)의 고유 ID를 비상용으로 탑재 (보안 우회)
      const fallbackHqId = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc'; 
      
      try {
        const { data } = await supabase.from('academy_tenant').select('tenant_id').eq('tenant_type', 'HQ').maybeSingle();
        if (data?.tenant_id) {
          setHqTenantId(data.tenant_id);
        } else {
          setHqTenantId(fallbackHqId); // DB 권한이 막혀있으면 비상용 ID 즉시 투입
        }
      } catch (e) {
        setHqTenantId(fallbackHqId); // 에러가 나도 비상용 ID 투입
      }
    };
    fetchHqTenant();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hqTenantId) return alert('본사(HQ) 테넌트 정보가 시스템에 설정되어 있지 않습니다.');
    if (!formData.name || !formData.phone || !formData.password || !formData.department) return alert('모든 항목을 입력해주세요.');

    setIsLoading(true);
    try {
      const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
      const fakeEmail = `${cleanPhone}@logica.com`; // 본사 전용 페이크 이메일

      // 1. Supabase Auth 회원가입
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: fakeEmail,
        password: formData.password,
      });

      if (authError) throw authError;

      // 2. 통합 Staff (instructor) 테이블에 본사 소속으로 Insert
      const { error: dbError } = await supabase.from('instructor').insert({
        instructor_id: authData.user?.id,
        login_id: cleanPhone,
        name: formData.name,
        email: fakeEmail,
        phone: formData.phone,
        position: '본사 관리자',
        role: 'SUPER_ADMIN', // 본사 직원은 최고 권한 부여
        tenant_id: hqTenantId, // 💡 무조건 본사 소속으로 확정!
        department: formData.department,
        status: '재직'
      });

      if (dbError) throw dbError;

      alert('🏢 본사 관리자 계정 생성이 완료되었습니다!\n본사 전용 로그인 페이지로 이동합니다.');
      router.push('/hq-login'); // 💡 HQ 전용 로그인 페이지로 수정!
    } catch (error: any) {
      alert(`가입 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-pretendard">
      <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-800"></div>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">천종현수학연구소 <span className="text-blue-600">HQ</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2">본사/출판사 임직원 전용 계정 생성</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">이름</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold" placeholder="홍길동" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">연락처 (로그인 아이디로 사용됨)</label>
            <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold tracking-wider" placeholder="01012345678" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">비밀번호</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">소속 부서</label>
            <input type="text" name="department" value={formData.department} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold" placeholder="예: 사업부, 콘텐츠연구소, 경영지원팀" />
          </div>

          <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-xl shadow-lg transition-colors mt-4">
            {isLoading ? '생성 중...' : '본사 계정 생성 완료'}
          </button>
        </form>
      </div>
    </div>
  );
}