// src/app/student/enroll/page.tsx
"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { registerStudentAction } from "@/app/actions/enrollStudent"; 

function StudentEnrollContent() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const isAdmission = mode === "admission";

  // === 폼 상태 관리 ===
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    studentContact: "",
    parentContact: "", // 🌟 ID 역할 (필수)
    school: "",
    grade: "초1",
    gender: "", // 선택 항목 (초기값 없음)
    registrationPath: "", // 선택 항목 (초기값 없음)
    status: isAdmission ? "입학테스트" : "재원",
    tenant_id: "", 
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const myTenantId = localStorage.getItem("logica_tenant_id") || "";
    setFormData(prev => ({ ...prev, tenant_id: myTenantId }));
  }, []);

  const headerTitle = isAdmission ? "📝 로지카 입학 대기생 등록" : "👨‍🎓 로지카 신규 학생 등록";
  const headerDesc = isAdmission
    ? "입학테스트를 대기 중인 학생의 정보를 DB에 저장합니다."
    : "학원에 등록한 정규 재원생의 정보를 DB에 저장합니다.";

  const handlePhoneInput = (field: "studentContact" | "parentContact", value: string) => {
    const formatted = value
      .replace(/[^0-9]/g, "")
      .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (match, p1, p2, p3) => {
        let res = p1;
        if (p2) res += "-" + p2;
        if (p3) res += "-" + p3;
        return res;
      });
    setFormData((prev) => ({ ...prev, [field]: formatted }));
  };

  // ==========================================
  // DB 등록 처리 로직 (서버 액션 호출)
  // ==========================================
  const registerStudent = async () => {
    const { name, password, studentContact, parentContact, tenant_id } = formData;

    // 🌟 필수값 체크: 학부모 연락처
    if (!name || !parentContact || !password) {
      alert("이름, 학부모 연락처, 초기 비밀번호는 필수 입력 항목입니다!");
      return;
    }

    if (parentContact.length < 12) {
      alert("올바른 학부모 연락처 형식을 입력해주세요. (예: 010-1234-5678)");
      return;
    }

    if (!tenant_id) {
      alert("소속 지점(학원) 정보가 없습니다. 다시 로그인 해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      // 🌟 [수정된 부분] 학생 연락처가 비어있으면 학부모 연락처를 기본 ID로 복사해서 서버로 보냅니다.
      const finalStudentContact = studentContact.trim() === "" ? parentContact : studentContact;
      
      const payload = {
        ...formData,
        studentContact: finalStudentContact
      };

      // payload를 서버 액션으로 전송!
      const result = await registerStudentAction(payload);

      if (result.success) {
        if (result.hasModifiedId) {
          alert(`ℹ️ 알림: 동일한 학부모 연락처가 존재하여, 형제/자매 구분을 위해 학생 ID를 [ ${result.finalContact} ](으)로 자동 변경하여 등록합니다.\n\n🎉 [${name}] 학생이 성공적으로 등록되었습니다!`);
        } else {
          alert(`🎉 [${name}] 학생이 성공적으로 등록되었습니다!`);
        }

        try {
          if (window.opener && !window.opener.closed && window.opener.refreshStudents) {
            window.opener.refreshStudents();
          }
        } catch (e) {}
        localStorage.setItem("logica_refresh_signal", JSON.stringify({ target: "student", time: Date.now() }));

        setFormData((prev) => ({
          ...prev,
          name: "",
          password: "",
          studentContact: "",
          parentContact: "",
          school: "",
          gender: "",
          registrationPath: "",
        }));
      } else {
        alert(`❌ 학생 등록 실패:\n${result.message}`);
      }
    } catch (error: any) {
      console.error("클라이언트 통신 에러:", error);
      alert("서버와 통신하는 중 문제가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6 font-pretendard">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col">
        
        <div className="bg-[#002864] text-white p-6 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">{headerTitle}</h1>
          <p className="text-blue-200 text-sm mt-1">{headerDesc}</p>
        </div>

        <div className="p-8">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all"
                  placeholder="예: 홍길동"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  성별 (선택)
                </label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      value="남"
                      checked={formData.gender === "남"}
                      onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                      className="w-5 h-5 text-[#002864] focus:ring-[#002864]"
                    />
                    <span className="text-slate-700 font-medium">남학생</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      value="여"
                      checked={formData.gender === "여"}
                      onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                      className="w-5 h-5 text-[#002864] focus:ring-[#002864]"
                    />
                    <span className="text-slate-700 font-medium">여학생</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  학부모 연락처 (ID 역할) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={13}
                  value={formData.parentContact}
                  onChange={(e) => handlePhoneInput("parentContact", e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all"
                  placeholder="010-0000-0000"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  학생 본인 연락처 (선택)
                </label>
                <input
                  type="text"
                  maxLength={13}
                  value={formData.studentContact}
                  onChange={(e) => handlePhoneInput("studentContact", e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all"
                  placeholder="010-0000-0000"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">학교 (선택)</label>
                <input
                  type="text"
                  value={formData.school}
                  onChange={(e) => setFormData({ ...formData, school: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all"
                  placeholder="예: 대치중학교"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  학년 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.grade}
                  onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all text-slate-700"
                >
                  <option value="7세 반">미취학 (7세 반)</option>
                  <option value="초1">초등학교 1학년 (초1)</option>
                  <option value="초2">초등학교 2학년 (초2)</option>
                  <option value="초3">초등학교 3학년 (초3)</option>
                  <option value="초4">초등학교 4학년 (초4)</option>
                  <option value="초5">초등학교 5학년 (초5)</option>
                  <option value="초6">초등학교 6학년 (초6)</option>
                  <option value="중1">중학교 1학년 (중1)</option>
                  <option value="중2">중학교 2학년 (중2)</option>
                  <option value="중3">중학교 3학년 (중3)</option>
                  <option value="고1">고등학교 1학년 (고1)</option>
                  <option value="고2">고등학교 2학년 (고2)</option>
                  <option value="고3">고등학교 3학년 (고3)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  등록 경로 (선택)
                </label>
                <select
                  value={formData.registrationPath}
                  onChange={(e) => setFormData({ ...formData, registrationPath: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all text-slate-700"
                >
                  <option value="">-- 선택 안 함 --</option>
                  <option value="지인 소개">지인 소개</option>
                  <option value="블로그/SNS">블로그 / SNS</option>
                  <option value="전단지/현수막">전단지 / 현수막</option>
                  <option value="학원 앞 방문">학원 앞 방문(워크인)</option>
                  <option value="기타">기타</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  초기 비밀번호 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all"
                  placeholder="비밀번호 입력"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  학생 상태 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 font-bold text-[#002864] focus:outline-none focus:ring-2 focus:ring-[#002864] transition-all bg-blue-50"
                >
                  <option value="재원">✅ 정규 재원생 (기본)</option>
                  <option value="입학테스트">📝 입학테스트 대기</option>
                  <option value="휴원">⏸️ 휴원생</option>
                  <option value="퇴원">❌ 퇴원생</option>
                </select>
              </div>
            </div>

            <hr className="border-slate-200 my-6" />

            <div className="flex gap-3">
              <button
                onClick={registerStudent}
                disabled={isSubmitting}
                className={`flex-1 text-white font-extrabold text-lg py-4 px-4 rounded-xl shadow-lg transition-all transform hover:scale-[1.01] ${isSubmitting ? "bg-slate-400 cursor-not-allowed" : "bg-[#002864] hover:bg-blue-900"}`}
              >
                {isSubmitting ? "등록 처리 중... ⏳" : "DB에 학생 등록하기"}
              </button>
              <button
                type="button"
                onClick={() => window.close()}
                className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-lg rounded-xl shadow-sm transition-all border border-slate-300 whitespace-nowrap"
              >
                창닫기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentEnrollPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center font-bold text-slate-500">로딩 중...</div>}>
      <StudentEnrollContent />
    </Suspense>
  );
}