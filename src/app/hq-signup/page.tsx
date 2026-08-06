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
      const fallbackHqId = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc'; 
      try {
        const { data } = await supabase.from('academy_tenant').select('tenant_id').eq('tenant_type', 'HQ').maybeSingle();
        if (data?.tenant_id) {
          setHqTenantId(data.tenant_id);
        } else {
          setHqTenantId(fallbackHqId); 
        }
      } catch (e) {
        setHqTenantId(fallbackHqId); 
      }
    };
    fetchHqTenant();
  }, []);

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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hqTenantId) return alert('본사(HQ) 테넌트 정보가 시스템에 설정되어 있지 않습니다.');
    if (!formData.name || !formData.phone || !formData.password || !formData.department) return alert('모든 항목을 입력해주세요.');

    const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
    if (!/^010\d{8}$/.test(cleanPhone)) {
      return alert('올바른 휴대폰 번호 11자리(010-XXXX-XXXX)를 입력해주세요.');
    }

    setIsLoading(true);
    try {
      const fakeEmail = `${cleanPhone}@logica.com`;

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: fakeEmail,
        password: formData.password,
      });

      if (authError) throw authError;

      const { error: dbError } = await supabase.from('instructor').insert({
        instructor_id: authData.user?.id,
        login_id: cleanPhone,
        name: formData.name,
        email: fakeEmail,
        phone: formData.phone,
        position: '본사 관리자',
        role: 'SUPER_ADMIN', 
        tenant_id: hqTenantId, 
        department: formData.department,
        status: '재직'
      });

      if (dbError) throw dbError;

      alert('🏢 본사 관리자 계정 생성이 완료되었습니다!\n본사 전용 로그인 페이지로 이동합니다.');
      router.push('/hq-login'); 
    } catch (error: any) {
      alert(`가입 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-pretendard">
      <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden">
        {/* 상단 컬러 바 (로그인과 통일) */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#002864] to-blue-500"></div>
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">천종현수학연구소 <span className="text-[#002864]">HQ</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2">본사/출판사 임직원 전용 계정 생성</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">이름</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864] font-bold text-slate-800" placeholder="홍길동" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">연락처 (로그인 아이디로 사용됨)</label>
            <input type="text" name="phone" value={formData.phone} maxLength={13} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864] font-bold tracking-wider text-slate-800" placeholder="010-1234-5678" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">비밀번호</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864] text-slate-800" placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">소속 부서</label>
            <input type="text" name="department" value={formData.department} onChange={handleChange} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#002864] font-bold text-slate-800" placeholder="예: 사업부, 콘텐츠연구소, 경영지원팀" />
          </div>

          <button type="submit" disabled={isLoading} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-extrabold py-4 rounded-xl shadow-lg transition-colors mt-4 disabled:opacity-50">
            {isLoading ? '생성 중...' : '본사 계정 생성 완료'}
          </button>
        </form>
        
        {/* 하단 로그인 이동 링크 추가 */}
        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400 font-bold">
            이미 계정이 있으신가요? <button type="button" onClick={() => router.push('/hq-login')} className="text-[#002864] hover:underline ml-1">로그인하기</button>
          </p>
        </div>
      </div>
    </div>
  );
}