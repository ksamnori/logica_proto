// src/app/super-admin/page.tsx
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase"; 

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfwlmbwornivkrvoeqdh.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmd2xtYndvcm5pdmtydm9lcWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDUzNzQsImV4cCI6MjA5NTMyMTM3NH0.Kh9MPHzUxf9xLRYTH_UqoIhxOm4lybA_OL8Z60H9vqo';

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

export default function AdminDashboardPage() {
  const [adminProfileName, setAdminProfileName] = useState("관리자님");
  const [activeTab, setActiveTab] = useState("student");

  const [sName, setSName] = useState("");
  const [sPw, setSPw] = useState("");
  const [sContact, setSContact] = useState("");
  const [pContact, setPContact] = useState("");
  const [sSchool, setSSchool] = useState("");
  const [sGrade, setSGrade] = useState("1");
  const [sStatus, setSStatus] = useState("입학테스트");
  const [isStudentSubmitting, setIsStudentSubmitting] = useState(false);

  const [iLoginId, setILoginId] = useState("");
  const [iPw, setIPw] = useState("");
  const [iName, setIName] = useState("");
  const [iPosition, setIPosition] = useState("전임강사"); // 기본값 변경
  const [iEmail, setIEmail] = useState("");
  const [iPhone, setIPhone] = useState("");
  const [isInstructorSubmitting, setIsInstructorSubmitting] = useState(false);

  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editInst, setEditInst] = useState<any>({});

  useEffect(() => {
    const checkSuperAdminAccess = async () => {
      let instId = localStorage.getItem('logica_instructor_id') || sessionStorage.getItem('logica_instructor_id') || "";

      if (!instId) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const extractedLoginId = session.user.email.split('@')[0];
          const { data: inst } = await supabase
            .from('instructor')
            .select('instructor_id, role, position, name')
            .eq('login_id', extractedLoginId)
            .maybeSingle();
            
          if (inst) {
            instId = inst.instructor_id || ""; 
            
            localStorage.setItem('logica_instructor_id', instId);
            localStorage.setItem('logica_instructor_name', inst.name || '관리자');
            localStorage.setItem('logica_instructor_role', inst.role || 'SUPER_ADMIN');
            localStorage.setItem('logica_instructor_position', inst.position || '최고관리자');
          }
        }
      }

      if (!instId) {
        alert('접근 권한이 없습니다. 다시 로그인해주세요.');
        window.location.href = '/';
        return;
      }

      const { data, error } = await supabase
        .from('instructor')
        .select('position, name, role')
        .eq('instructor_id', instId)
        .single();
        
      if (data) {
        const isRealSuperAdmin = data.role === 'SUPER_ADMIN' || data.role === 'ADMIN' || String(data.position).includes('최고관리자') || String(data.position).includes('원장');
        
        if (!isRealSuperAdmin) {
          alert('⛔ 비정상적인 접근입니다. 최고관리자 권한이 부족합니다.');
          window.location.href = '/admin-dashboard';
          return;
        }
        
        setAdminProfileName(`${data.name} ${data.position || '관리자'}님`);
      } else {
        alert('강사 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
        window.location.href = '/';
      }
    };

    checkSuperAdminAccess();
  }, []);

  useEffect(() => {
    if (activeTab === "instructor-manage") {
      loadInstructors();
    }
  }, [activeTab]);

  const handlePhoneChange = (setter: any) => (e: any) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    let res = '';
    if (val.length < 4) res = val;
    else if (val.length < 8) res = val.substring(0, 3) + '-' + val.substring(3);
    else if (val.length < 12) res = val.substring(0, 3) + '-' + val.substring(3, 7) + '-' + val.substring(7);
    else res = val.substring(0, 3) + '-' + val.substring(3, 7) + '-' + val.substring(7, 11) + '-' + val.substring(11);
    setter(res);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('로그아웃 에러:', error);
    } finally {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    }
  };

  const registerStudent = async () => {
    if (!sName || !sContact || !sPw) return alert("이름, 학생 연락처, 초기 비밀번호는 필수 입력 항목입니다!");
    if (sContact.length < 12) return alert("올바른 연락처 형식을 입력해주세요. (예: 010-1234-5678)");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다.");

    setIsStudentSubmitting(true);

    try {
      let finalParentId = null;

      if (pContact) {
        const { data: existingParent } = await supabase
          .from('parent')
          .select('parent_id')
          .eq('phone', pContact)
          .maybeSingle();

        if (existingParent) {
          finalParentId = existingParent.parent_id;
        } else {
          const { data: newParent, error: insertParentError } = await supabase
            .from('parent')
            .insert([{ phone: pContact }])
            .select('parent_id')
            .single();
          if (insertParentError) throw insertParentError;
          finalParentId = newParent.parent_id;
        }
      }

      let finalContact = sContact;
      const { data: existingContacts } = await supabase
        .from('student')
        .select('phone')
        .like('phone', `${sContact}%`);

      if (existingContacts && existingContacts.length > 0) {
        let maxSuffix = 0;
        let hasExactMatch = false;

        existingContacts.forEach(s => {
          if (s.phone === sContact) hasExactMatch = true;
          else {
            const suffixStr = s.phone.replace(sContact + '-', '');
            if (!isNaN(Number(suffixStr))) {
              const num = parseInt(suffixStr);
              if (num > maxSuffix) maxSuffix = num;
            }
          }
        });

        if (hasExactMatch || maxSuffix > 0) {
          finalContact = `${sContact}-${maxSuffix + 1}`;
          alert(`ℹ️ 알림: 동일한 학생 연락처가 존재하여, 형제/자매 구분을 위해 학생 ID를 [ ${finalContact} ](으)로 변경하여 등록합니다.`);
        }
      }

      const { error: studentError } = await supabase
        .from('student')
        .insert([{
          name: sName,
          grade: String(sGrade),
          school_name: sSchool,
          phone: finalContact,
          password_hash: sPw,
          status: sStatus,
          parent_id: finalParentId,
          tenant_id: myTenantId 
        }]);

      if (studentError) throw studentError;

      alert(`🎉 [${sName}] 학생이 성공적으로 등록되었습니다!`);
      
      setSName(""); setSPw(""); setSContact(""); setPContact(""); setSSchool(""); setSStatus("입학테스트");
    } catch (error: any) {
      alert(`❌ 학생 데이터베이스 오류 발생!\n메시지: ${error.message}`);
    } finally {
      setIsStudentSubmitting(false);
    }
  };

  const registerInstructor = async () => {
    if (!iLoginId || !iPw || !iName) return alert("로그인 ID, 비밀번호, 이름은 필수입니다!");
    if (iPw.length < 6) return alert("비밀번호는 최소 6자리 이상이어야 합니다.");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다.");

    setIsInstructorSubmitting(true);

    // 🌟 [핵심 변경] 신규 직급 체계에 맞춘 Role 매핑 로직
    let assignedRole = 'TEACHER';
    if (iPosition === '원장') assignedRole = 'ADMIN';
    else if (iPosition === '부원장') assignedRole = 'VICE_ADMIN';
    else if (iPosition === '실장') assignedRole = 'MANAGER';
    else if (iPosition === '파트강사') assignedRole = 'PART_TEACHER';
    else if (iPosition === '조교') assignedRole = 'TA';

    try {
      const fakeEmail = `${iLoginId}@logica.com`;
      
      const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
        email: fakeEmail,
        password: iPw,
      });

      if (authError) {
        if (authError.message.includes('User already registered')) {
          alert("❌ 이미 사용 중인 로그인 ID입니다. 다른 ID를 입력해 주세요.");
        } else {
          alert(`❌ Auth 계정 생성 실패: ${authError.message}`);
        }
        setIsInstructorSubmitting(false);
        return; 
      }

      const newUserId = authData.user?.id;
      if (!newUserId) {
         alert("❌ Auth 유저는 생성되었으나 UID를 가져오지 못했습니다.");
         setIsInstructorSubmitting(false);
         return;
      }

      const { error: dbError } = await supabase.from('instructor').insert([{
        instructor_id: newUserId,
        login_id: iLoginId,
        name: iName,
        position: iPosition,
        role: assignedRole,
        email: iEmail || null,
        phone: iPhone || null,
        status: '재직',
        tenant_id: myTenantId
      }]);

      if (dbError) {
        if (dbError.code === '23505') alert("❌ DB 에러: 이미 존재하는 ID 또는 이메일입니다.");
        else alert(`❌ DB 등록 에러: ${dbError.message}`);
        setIsInstructorSubmitting(false);
        return;
      }
      
      alert(`🎉 [${iName}] 선생님(${iPosition}) 등록 성공!\n이제 아이디(${fakeEmail})와 설정하신 비밀번호로 로그인 가능합니다.`);
      
      setILoginId(""); setIPw(""); setIName(""); setIEmail(""); setIPhone("");
    } catch (error) {
      console.error(error);
      alert("등록 중 알 수 없는 에러가 발생했습니다.");
    } finally {
      setIsInstructorSubmitting(false);
    }
  };

  const loadInstructors = async () => {
    setIsLoadingInstructors(true);
    try {
      const { data, error } = await supabase
        .from('instructor')
        .select('*, academy_tenant(tenant_type, name)')
        .order('created_at', { ascending: false });
        
      if (error) throw error;

      const filteredData = (data || []).filter((inst: any) => {
        const isHQ = inst.academy_tenant?.tenant_type === 'HQ' || 
                     inst.academy_tenant?.name?.includes('본사') ||
                     inst.position?.includes('본사'); 
        return !isHQ;
      });

      // 🌟 [핵심 변경] 새 직급 체계 기반 정렬 로직 (원장 -> 부원장 -> 실장 -> 전임 -> 파트 -> 조교)
      const posOrder: any = { '원장': 1, '부원장': 2, '실장': 3, '전임강사': 4, '파트강사': 5, '조교': 6 };
      const sortedData = filteredData.sort((a: any, b: any) => {
        let orderA = posOrder[a.position] || 99;
        let orderB = posOrder[b.position] || 99;
        if (orderA === orderB) return a.name.localeCompare(b.name);
        return orderA - orderB;
      });

      setInstructors(sortedData);
    } catch (e: any) {
      alert('조회 실패: ' + e.message);
    } finally {
      setIsLoadingInstructors(false);
    }
  };

  const openEditModal = (inst: any) => {
    setEditInst(inst);
    setIsEditModalOpen(true);
  };

  const saveInstructorEdit = async () => {
    if (!editInst.name) return alert('이름은 필수입니다.');

    // 🌟 [핵심 변경] 수정 시에도 새 체계에 맞춘 Role 업데이트
    let assignedRole = 'TEACHER';
    if (editInst.position === '원장') assignedRole = 'ADMIN';
    else if (editInst.position === '부원장') assignedRole = 'VICE_ADMIN';
    else if (editInst.position === '실장') assignedRole = 'MANAGER';
    else if (editInst.position === '파트강사') assignedRole = 'PART_TEACHER';
    else if (editInst.position === '조교') assignedRole = 'TA';

    try {
      const { error } = await supabase.from('instructor').update({
        name: editInst.name,
        position: editInst.position,
        role: assignedRole,
        phone: editInst.phone || null,
        email: editInst.email || null,
        status: editInst.status
      }).eq('instructor_id', editInst.instructor_id);

      if (error) throw error;
      alert('선생님 정보가 성공적으로 수정되었습니다.');
      setIsEditModalOpen(false);
      loadInstructors();
    } catch (e: any) {
      alert('수정 실패: ' + e.message);
    }
  };

  const softDeleteInstructor = async (id: string, name: string) => {
    if (!confirm(`[${name}] 선생님을 정말 퇴사 처리하시겠습니까?\n\n🚨 과거 내역 보존을 위해 DB에서 삭제되지 않고 '퇴사' 상태로만 변경됩니다.`)) return;
    try {
      const { error } = await supabase.from('instructor').update({ status: '퇴사', deleted_at: new Date().toISOString() }).eq('instructor_id', id);
      if (error) throw error;
      alert('안전하게 퇴사 처리가 완료되었습니다.');
      loadInstructors();
    } catch (e: any) { alert('퇴사 처리 실패: ' + e.message); }
  };

  const hardDeleteInstructor = async (id: string, name: string) => {
    if (!confirm(`[🚨 초강력 경고 🚨]\n[${name}] 선생님을 영구 삭제하시겠습니까?\n\n이 작업은 절대 되돌릴 수 없으며, 참여 중인 채팅, 배정된 시험, 개별 보강, 학부모 요청 내역 등 모든 연관 데이터가 연쇄적으로 강제 파괴됩니다.`)) return;
    
    try {
      await Promise.all([
        supabase.from('class').update({ instructor_id: null }).eq('instructor_id', id),
        supabase.from('internal_chat_message').delete().eq('sender_id', id),
        supabase.from('internal_chat_member').delete().eq('instructor_id', id),
        supabase.from('individual_makeup').delete().eq('instructor_id', id),
        supabase.from('parent_request_log').update({ processed_instructor_id: null }).eq('processed_instructor_id', id),
        supabase.from('parent_request_log').delete().eq('author_id', id)
      ]);

      const { data: exams } = await supabase.from('exam_master').select('exam_id').eq('instructor_id', id);
      
      if (exams && exams.length > 0) {
        const examIds = exams.map(e => e.exam_id);
        await Promise.all([
          supabase.from('exam_assignment').delete().in('exam_id', examIds),
          supabase.from('exam_assignment').delete().in('exam_paper_id', examIds),
          supabase.from('exam_item').delete().in('exam_id', examIds)
        ]);
      }
      
      await supabase.from('exam_master').delete().eq('instructor_id', id);

      const { error: deleteErr } = await supabase.from('instructor').delete().eq('instructor_id', id);
      if (deleteErr) throw deleteErr;
      
      alert(`🎉 [${name}] 선생님과 관련된 모든 데이터가 완벽하게 삭제되었습니다.`);
      loadInstructors();
    } catch (e: any) { 
      alert('영구 삭제 실패:\n' + e.message + '\n\n💡 처리하지 못한 연결 테이블이 존재할 수 있습니다.'); 
    }
  };

  const tabClass = (tabName: string) => 
    `flex-1 py-4 text-base text-center transition-all font-bold ${activeTab === tabName ? 'border-b-4 border-[#002864] text-[#002864] bg-white' : 'border-l border-slate-200 text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-800'}`;

  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-slate-100 font-sans">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-xl overflow-hidden flex flex-col h-[850px]">
        
        {/* 헤더 */}
        <div className="bg-[#002864] text-white p-6 shrink-0 relative flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">⚙️ Logica 슈퍼 어드민 센터</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="bg-blue-800 text-blue-200 text-xs px-2 py-1 rounded font-bold border border-blue-600">최고 관리자 전용</span>
              <span className="text-blue-200 text-sm font-bold">{adminProfileName}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => window.location.href = '/admin-dashboard'} className="bg-blue-50 text-[#002864] font-bold py-2 px-5 rounded-lg shadow-md hover:bg-blue-100 transition-colors text-sm flex items-center gap-2 border border-blue-200">
              <span>📊</span> 운영 대시보드로
            </button>
            <button onClick={handleLogout} className="bg-white text-[#002864] font-bold py-2 px-5 rounded-lg shadow-md hover:bg-slate-100 transition-colors text-sm flex items-center gap-2">
              <span>🔐</span> 로그아웃
            </button>
          </div>
        </div>

        {/* 탭 버튼 */}
        <div className="flex border-b border-slate-200 shrink-0 cursor-pointer">
          <div onClick={() => setActiveTab('student')} className={tabClass('student')}>👨‍🎓 학생 신규 등록</div>
          <div onClick={() => setActiveTab('instructor')} className={tabClass('instructor')}>👨‍🏫 관리자 신규 등록</div>
          <div onClick={() => setActiveTab('instructor-manage')} className={tabClass('instructor-manage')}>📋 관리자 목록 및 수정</div>
        </div>

        {/* 탭 내용 영역 */}
        <div className="p-8 overflow-y-auto flex-1 bg-slate-50 scrollbar-thin scrollbar-thumb-slate-300">
          
          {/* 학생 등록 폼 */}
          {activeTab === 'student' && (
            <div className="space-y-6 max-w-2xl mx-auto block">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold mb-5 text-slate-800 border-b border-slate-100 pb-3">신규 학생 정보 입력</h2>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">이름 <span className="text-red-500">*</span></label>
                    <input type="text" value={sName} onChange={(e) => setSName(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 홍길동" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">초기 비밀번호 <span className="text-red-500">*</span></label>
                    <input type="password" value={sPw} onChange={(e) => setSPw(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="비밀번호 입력" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">학생 연락처 (ID 역할) <span className="text-red-500">*</span></label>
                    <input type="text" value={sContact} onChange={handlePhoneChange(setSContact)} maxLength={13} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="010-0000-0000" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">학부모 연락처</label>
                    <input type="text" value={pContact} onChange={handlePhoneChange(setPContact)} maxLength={13} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="010-0000-0000" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">학교</label>
                    <input type="text" value={sSchool} onChange={(e) => setSSchool(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]" placeholder="예: 로지카중학교" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">학년 <span className="text-red-500">*</span></label>
                    <select value={sGrade} onChange={(e) => setSGrade(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864]">
                      {[1,2,3,4,5,6].map(g => <option key={g} value={g}>초등학교 {g}학년</option>)}
                      {[1,2,3].map(g => <option key={g+6} value={g+6}>중학교 {g}학년</option>)}
                      {[1,2,3].map(g => <option key={g+9} value={g+9}>고등학교 {g}학년</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-slate-700 mb-1">학생 상태 <span className="text-red-500">*</span></label>
                    <select value={sStatus} onChange={(e) => setSStatus(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 font-bold text-[#002864] focus:outline-none focus:ring-2 focus:ring-[#002864] bg-blue-50">
                      <option value="입학테스트">📝 입학테스트 대기</option>
                      <option value="재원">✅ 정규 재원생</option>
                      <option value="휴원">⏸️ 휴원생</option>
                      <option value="퇴원">❌ 퇴원생</option>
                    </select>
                  </div>
                </div>
                <button disabled={isStudentSubmitting} onClick={registerStudent} className={`w-full mt-8 text-white font-bold py-3.5 px-4 rounded-xl shadow-md transition-colors text-lg ${isStudentSubmitting ? 'bg-slate-400' : 'bg-[#002864] hover:bg-[#001f4d]'}`}>
                  {isStudentSubmitting ? "등록 처리 중... ⏳" : "학생 DB에 등록하기"}
                </button>
              </div>
            </div>
          )}

          {/* 관리자 등록 폼 */}
          {activeTab === 'instructor' && (
            <div className="space-y-6 max-w-2xl mx-auto block">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold mb-4 text-slate-800">신규 관리자(선생님) 등록</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">로그인 ID (영어/숫자) *</label><input type="text" value={iLoginId} onChange={(e) => setILoginId(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]" placeholder="예: admin123" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">초기 비밀번호 (6자리 이상) *</label><input type="password" value={iPw} onChange={(e) => setIPw(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]" placeholder="비밀번호 입력" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">이름 *</label><input type="text" value={iName} onChange={(e) => setIName(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]" placeholder="예: 김로지" /></div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">직급 *</label>
                    <select value={iPosition} onChange={(e) => setIPosition(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]">
                      {/* 🌟 [추가] 부원장 등 신규 직급 리스트 업데이트 */}
                      <option value="원장">원장</option>
                      <option value="부원장">부원장</option>
                      <option value="실장">실장</option>
                      <option value="전임강사">전임강사</option>
                      <option value="파트강사">파트강사</option>
                      <option value="조교">조교</option>
                    </select>
                  </div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">실제 이메일 (선택)</label><input type="email" value={iEmail} onChange={(e) => setIEmail(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]" placeholder="email@example.com" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">연락처</label><input type="text" value={iPhone} onChange={handlePhoneChange(setIPhone)} maxLength={13} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864]" placeholder="010-0000-0000" /></div>
                </div>
                <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs font-bold text-blue-800">
                  💡 선생님 계정은 입력한 <b>로그인 ID @logica.com</b> 형식으로 자동 생성되어 완벽한 보안 로그인 체계를 갖춥니다. 
                </div>
                <button 
                  onClick={registerInstructor} 
                  disabled={isInstructorSubmitting}
                  className={`w-full mt-6 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors text-lg ${isInstructorSubmitting ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                >
                  {isInstructorSubmitting ? "계정 생성 중... ⏳" : "관리자 DB에 등록하기"}
                </button>
              </div>
            </div>
          )}

          {/* 관리자 목록 폼 */}
          {activeTab === 'instructor-manage' && (
            <div className="space-y-6 max-w-5xl mx-auto block">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h2 className="text-xl font-bold text-slate-800">등록된 관리자 목록 (학원)</h2>
                  <button onClick={loadInstructors} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm transition-colors">새로고침 ↻</button>
                </div>
                <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">이름</th>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">로그인 ID</th>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">직급</th>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-slate-500">연락처</th>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-center text-slate-500">상태</th>
                        <th className="py-3 px-4 border-b border-slate-200 font-extrabold text-center text-slate-500">관리 액션</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {isLoadingInstructors ? (
                        <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">데이터를 불러오는 중입니다...</td></tr>
                      ) : instructors.length === 0 ? (
                        <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">등록된 선생님이 없습니다.</td></tr>
                      ) : (
                        instructors.map(inst => (
                          <tr key={inst.instructor_id} className={inst.status === '퇴사' ? 'bg-slate-50/50 opacity-70' : 'hover:bg-blue-50/50 transition-colors'}>
                            <td className="py-3 px-4 font-bold text-[#002864]">{inst.name}</td>
                            <td className="py-3 px-4 text-slate-500 font-mono text-xs">{inst.login_id}</td>
                            <td className="py-3 px-4 font-bold text-slate-700">{inst.position || '-'}</td>
                            <td className="py-3 px-4 font-bold text-slate-500">{inst.phone || '-'}</td>
                            <td className="py-3 px-4 text-center">
                              {inst.status === '재직' ? <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-md text-xs font-bold">재직 중</span>
                               : inst.status === '휴직' ? <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-md text-xs font-bold">휴직</span>
                               : <span className="bg-slate-200 text-slate-500 px-2.5 py-1 rounded-md text-xs font-bold">퇴사</span>}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button onClick={() => openEditModal(inst)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded text-xs font-bold hover:bg-slate-50 shadow-sm transition-colors">수정</button>
                                {inst.status !== '퇴사' 
                                  ? <button onClick={() => softDeleteInstructor(inst.instructor_id, inst.name)} className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-600 rounded text-xs font-bold hover:bg-amber-500 hover:text-white shadow-sm transition-colors">퇴사 처리</button>
                                  : <button disabled className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded text-xs font-bold cursor-not-allowed">퇴사 완료</button>
                                }
                                <button onClick={() => hardDeleteInstructor(inst.instructor_id, inst.name)} className="px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-500 rounded text-xs font-bold hover:bg-rose-600 hover:text-white shadow-sm transition-colors">영구 삭제 ☠️</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 강사 수정 모달 */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center">
              <h2 className="font-bold text-lg">👨‍🏫 관리자 정보 수정</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 bg-slate-50 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold text-slate-500 mb-1">이름</label><input type="text" value={editInst.name || ''} onChange={(e) => setEditInst({...editInst, name: e.target.value})} className="w-full px-3 py-2 rounded border border-slate-300 font-bold focus:outline-none focus:border-[#002864]" /></div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">직급</label>
                  <select value={editInst.position || '파트강사'} onChange={(e) => setEditInst({...editInst, position: e.target.value})} className="w-full px-3 py-2 rounded border border-slate-300 font-bold focus:outline-none focus:border-[#002864]">
                    {/* 🌟 [추가] 모달 드롭다운에도 동일하게 추가 */}
                    <option value="원장">원장</option>
                    <option value="부원장">부원장</option>
                    <option value="실장">실장</option>
                    <option value="전임강사">전임강사</option>
                    <option value="파트강사">파트강사</option>
                    <option value="조교">조교</option>
                  </select>
                </div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label><input type="text" value={editInst.phone || ''} onChange={handlePhoneChange((val: string) => setEditInst({...editInst, phone: val}))} maxLength={13} className="w-full px-3 py-2 rounded border border-slate-300 font-bold focus:outline-none focus:border-[#002864]" /></div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
                  <select value={editInst.status || '재직'} onChange={(e) => setEditInst({...editInst, status: e.target.value})} className="w-full px-3 py-2 rounded border border-slate-300 font-bold focus:outline-none focus:border-[#002864]">
                    <option value="재직">✅ 재직</option><option value="휴직">⏸️ 휴직</option><option value="퇴사">❌ 퇴사 (접속 차단)</option>
                  </select>
                </div>
              </div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">이메일</label><input type="email" value={editInst.email || ''} onChange={(e) => setEditInst({...editInst, email: e.target.value})} className="w-full px-3 py-2 rounded border border-slate-300 font-bold focus:outline-none focus:border-[#002864]" /></div>
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 bg-slate-100 font-bold text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={saveInstructorEdit} className="px-5 py-2 bg-[#002864] text-white font-bold rounded-lg hover:bg-blue-900 shadow-sm transition-colors">저장하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}