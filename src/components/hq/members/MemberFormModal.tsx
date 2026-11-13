// src/components/hq/members/MemberFormModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  getRankMeta,
  HQ_DEFAULT_DEPARTMENTS,
  HQ_EMPLOYMENT_TYPES,
  HQ_RANK_LIST,
} from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type { HqMember, HqRankCode, HqWorkStatus } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  mode: "create" | "edit";
  member?: HqMember | null;
  isHrManager: boolean;
  existingDepartments: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function MemberFormModal({
  isOpen,
  mode,
  member,
  isHrManager,
  existingDepartments,
  onClose,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [department, setDepartment] = useState("연구개발팀");
  const [customDept, setCustomDept] = useState("");
  const [rankCode, setRankCode] = useState<HqRankCode>("STAFF");
  const [jobTitle, setJobTitle] = useState("연구원");
  const [isDeptHead, setIsDeptHead] = useState(false);
  const [employmentType, setEmploymentType] = useState("정규직");
  const [workStatus, setWorkStatus] = useState<HqWorkStatus>("재직");
  const [hireDate, setHireDate] = useState("");
  const [resignDate, setResignDate] = useState("");
  const [annualTotal, setAnnualTotal] = useState("15");
  const [annualUsed, setAnnualUsed] = useState("0");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [extensionNo, setExtensionNo] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [address, setAddress] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [hrMemo, setHrMemo] = useState("");

  const deptOptions = Array.from(
    new Set([...HQ_DEFAULT_DEPARTMENTS, ...existingDepartments.filter(Boolean)])
  );

  const formatPhone = (val: string) => {
    const d = val.replace(/[^0-9]/g, "").slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  };

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().slice(0, 10);
    if (mode === "create" || !member) {
      setName("");
      setPhone("");
      setPassword("");
      setEmail("");
      setEmployeeNo("");
      setDepartment("연구개발팀");
      setCustomDept("");
      setRankCode("STAFF");
      setJobTitle("연구원");
      setIsDeptHead(false);
      setEmploymentType("정규직");
      setWorkStatus("재직");
      setHireDate(today);
      setResignDate("");
      setAnnualTotal("15");
      setAnnualUsed("0");
      setBankName("");
      setBankAccount("");
      setAccountHolder("");
      setExtensionNo("");
      setEmergencyContact("");
      setAddress("");
      setJobDescription("");
      setHrMemo("");
    } else {
      setName(member.name);
      setPhone(member.phone || "");
      setPassword("");
      setEmail(member.email || "");
      setEmployeeNo(member.employee_no || "");
      if (deptOptions.includes(member.department)) {
        setDepartment(member.department);
        setCustomDept("");
      } else {
        setDepartment("__CUSTOM__");
        setCustomDept(member.department || "");
      }
      setRankCode(member.rank_code);
      setJobTitle(member.job_title);
      setIsDeptHead(member.is_dept_head);
      setEmploymentType(member.employment_type || "정규직");
      setWorkStatus(member.work_status || "재직");
      setHireDate(member.hire_date || "");
      setResignDate(member.resign_date || "");
      setAnnualTotal(String(member.annual_leave_total ?? 15));
      setAnnualUsed(String(member.annual_leave_used ?? 0));
      setBankName(member.bank_name || "");
      setBankAccount(member.bank_account || "");
      setAccountHolder(member.account_holder || member.name);
      setExtensionNo(member.extension_no || "");
      setEmergencyContact(member.emergency_contact || "");
      setAddress(member.address || "");
      setJobDescription(member.job_description || "");
      setHrMemo(member.hr_memo || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, member]);

  if (!isOpen) return null;

  const handleRankChange = (next: HqRankCode) => {
    setRankCode(next);
    const meta = getRankMeta(next);
    setJobTitle(meta.defaultTitle);
    if (next === "TEAM_LEAD" || next === "DIRECTOR" || next === "CEO") {
      setIsDeptHead(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDept =
      department === "__CUSTOM__" ? customDept.trim() || "미지정" : department;

    setSaving(true);
    try {
      if (mode === "create") {
        await hqFetch("/api/hq/members", {
          method: "POST",
          body: {
            name,
            phone,
            password,
            email,
            employee_no: employeeNo,
            department: finalDept,
            rank_code: rankCode,
            job_title: jobTitle,
            is_dept_head: isDeptHead,
            employment_type: employmentType,
            hire_date: hireDate,
            annual_leave_total: Number(annualTotal || 15),
            bank_name: bankName,
            bank_account: bankAccount,
            account_holder: accountHolder || name,
            extension_no: extensionNo,
            emergency_contact: emergencyContact,
            address,
            job_description: jobDescription,
            hr_memo: hrMemo,
          },
        });
        alert(`✅ [${name}] 구성원이 본부 HR 시스템에 등록되었습니다.`);
      } else if (member) {
        await hqFetch("/api/hq/members", {
          method: "PATCH",
          body: {
            instructor_id: member.instructor_id,
            name,
            phone,
            email,
            employee_no: employeeNo,
            department: finalDept,
            rank_code: rankCode,
            job_title: jobTitle,
            is_dept_head: isDeptHead,
            employment_type: employmentType,
            work_status: workStatus,
            hire_date: hireDate || null,
            resign_date: resignDate || null,
            annual_leave_total: Number(annualTotal || 0),
            annual_leave_used: Number(annualUsed || 0),
            bank_name: bankName,
            bank_account: bankAccount,
            account_holder: accountHolder,
            extension_no: extensionNo,
            emergency_contact: emergencyContact,
            address,
            job_description: jobDescription,
            hr_memo: hrMemo,
          },
        });
        alert("✅ 인사 정보가 저장되었습니다.");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold">
              {mode === "create"
                ? "➕ 본부 신규 구성원 등록"
                : `👤 ${member?.name} 구성원 인사 정보 수정`}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isHrManager
                ? "부서·직급·부서장 설정은 전자결재 결재선 자동 배정에 즉시 반영됩니다."
                : "연락처·주소·경비정산 계좌 등 본인 셀프서비스 정보를 수정합니다."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none font-bold"
          >
            &times;
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-auto space-y-5 custom-scroll flex-1 text-[13px]"
        >
          {/* 1. 기본 계정 정보 */}
          <section className="space-y-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-1.5">
              기본 계정 · 연락처
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  이름 <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  disabled={!isHrManager}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 disabled:bg-slate-100"
                  placeholder="홍길동"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  휴대폰 번호 {mode === "create" && "(로그인 ID)"}{" "}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  required={mode === "create"}
                  value={phone}
                  maxLength={13}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800"
                  placeholder="010-1234-5678"
                />
              </div>

              {mode === "create" && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    초기 비밀번호 (6자리 이상) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-slate-800"
                    placeholder="초기 비밀번호 입력"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  사내 이메일
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="name@logica.com"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  내선번호 / 직통번호
                </label>
                <input
                  value={extensionNo}
                  onChange={(e) => setExtensionNo(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="예: 내선 204"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  비상연락망
                </label>
                <input
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="예: 배우자 010-0000-0000"
                />
              </div>
            </div>
          </section>

          {/* 2. 조직 · 직급 · 결재권한 (HR 관리자 전용 편집) */}
          {isHrManager && (
            <section className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <h4 className="text-xs font-bold text-brand uppercase tracking-wider">
                인사 발령 · 직급 · 결재선 권한 (HR 관리자 전용)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    소속 부서
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {deptOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value="__CUSTOM__">+ 새 부서 직접 입력</option>
                  </select>
                  {department === "__CUSTOM__" && (
                    <input
                      value={customDept}
                      onChange={(e) => setCustomDept(e.target.value)}
                      className="mt-2 w-full px-3.5 py-2 rounded-xl border border-blue-300 bg-white font-bold text-slate-800"
                      placeholder="신규 부서명 입력 (예: 콘텐츠기획팀)"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    본부 직급 단계 (결재 레벨)
                  </label>
                  <select
                    value={rankCode}
                    onChange={(e) => handleRankChange(e.target.value as HqRankCode)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {HQ_RANK_LIST.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    호칭 · 직책명 (화면/결재란 표시)
                  </label>
                  <input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                    placeholder="예: 수석연구원, 편집팀장, 대표이사"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    사번
                  </label>
                  <input
                    value={employeeNo}
                    onChange={(e) => setEmployeeNo(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                    placeholder="미입력 시 자동 생성 (HQ-2026-...)"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    고용 형태
                  </label>
                  <select
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    {HQ_EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {mode === "edit" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      재직 상태
                    </label>
                    <select
                      value={workStatus}
                      onChange={(e) => setWorkStatus(e.target.value as HqWorkStatus)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                    >
                      <option value="재직">재직</option>
                      <option value="휴직">휴직</option>
                      <option value="퇴직">퇴직</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    입사일
                  </label>
                  <input
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                  />
                </div>

                {mode === "edit" && workStatus === "퇴직" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      퇴직일
                    </label>
                    <input
                      type="date"
                      value={resignDate}
                      onChange={(e) => setResignDate(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    연차 부여 일수 (일)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={annualTotal}
                    onChange={(e) => setAnnualTotal(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                  />
                </div>

                {mode === "edit" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      사용 연차 일수 (일)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={annualUsed}
                      onChange={(e) => setAnnualUsed(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isDeptHead}
                  onChange={(e) => setIsDeptHead(e.target.checked)}
                  className="w-4 h-4 accent-brand rounded"
                />
                <span className="text-xs font-bold text-slate-800">
                  소속 부서장(리더)으로 지정 — 부서원 기안 시 1차 결재자로 최우선 자동 배정됩니다.
                </span>
              </label>
            </section>
          )}

          {/* 3. 급여/경비정산 계좌 및 증명서용 정보 */}
          <section className="space-y-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-1.5">
              급여 · 경비정산 계좌 및 담당 업무
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  은행명
                </label>
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="예: 국민은행"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  계좌번호
                </label>
                <input
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="- 포함 입력"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  예금주
                </label>
                <input
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder={name || "예금주"}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  담당 직무 요약 (증명서 표기용)
                </label>
                <input
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="예: 초·중등 사고력 수학 교재 연구 및 집필"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  거주지 주소 (증명서 표기용)
                </label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                  placeholder="서울특별시 강남구 ..."
                />
              </div>
            </div>

            {isHrManager && (
              <div>
                <label className="block text-xs font-bold text-amber-700 mb-1">
                  🔒 인사 관리자 비공개 메모 (본인에게 노출되지 않음)
                </label>
                <textarea
                  rows={2}
                  value={hrMemo}
                  onChange={(e) => setHrMemo(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50/40 font-medium text-slate-800 resize-none"
                  placeholder="연봉 계약 조건, 발령 이력, 인사 특이사항 메모"
                />
              </div>
            )}
          </section>
        </form>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-100"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold shadow-sm disabled:opacity-50"
          >
            {saving
              ? "저장 중..."
              : mode === "create"
                ? "본부 구성원 등록"
                : "변경사항 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
