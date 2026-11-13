// src/app/hq/signup/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getRankMeta,
  HQ_DEFAULT_DEPARTMENTS,
  HQ_RANK_LIST,
} from "@/lib/hq/constants";
import type { HqRankCode } from "@/lib/hq/types";

export default function HqSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState<string>(HQ_DEFAULT_DEPARTMENTS[1]);
  const [customDept, setCustomDept] = useState("");
  const [rankCode, setRankCode] = useState<HqRankCode>("STAFF");
  const [jobTitle, setJobTitle] = useState("연구원");
  const [hasTopAdmin, setHasTopAdmin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/hq/auth/signup")
      .then((r) => r.json())
      .then((json) => {
        if (json?.data && typeof json.data.hasTopAdmin === "boolean") {
          setHasTopAdmin(json.data.hasTopAdmin);
        }
      })
      .catch(() => {});
  }, []);

  const formatPhone = (val: string) => {
    const res = val.replace(/[^0-9]/g, "").slice(0, 11);
    if (res.length < 4) return res;
    if (res.length < 8) return `${res.slice(0, 3)}-${res.slice(3)}`;
    return `${res.slice(0, 3)}-${res.slice(3, 7)}-${res.slice(7, 11)}`;
  };

  const handleRankChange = (nextRank: HqRankCode) => {
    setRankCode(nextRank);
    setJobTitle(getRankMeta(nextRank).defaultTitle);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDept =
      department === "__CUSTOM__" ? customDept.trim() : department;

    if (!name.trim() || !phone || !password || !finalDept || !jobTitle.trim()) {
      alert("모든 필수 항목을 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/hq/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          password,
          department: finalDept,
          rank_code: rankCode,
          job_title: jobTitle.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "계정 생성에 실패했습니다.");
      }

      alert(
        "🏢 본부 구성원 계정과 인사 프로필 생성이 완료되었습니다.\n로그인 화면으로 이동합니다."
      );
      router.replace("/hq/login");
    } catch (error: any) {
      alert(`가입 실패: ${error?.message || "오류가 발생했습니다."}`);
    } finally {
      setIsLoading(false);
    }
  };

  const selectableRanks = hasTopAdmin
    ? HQ_RANK_LIST.filter((r) => r.level <= 2)
    : HQ_RANK_LIST;

  const selectedRankMeta = getRankMeta(rankCode);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 py-10">
      <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl w-full max-w-lg relative overflow-hidden border border-slate-200">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand via-blue-600 to-indigo-600" />

        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-brand text-xs font-extrabold mb-2.5">
            <span>👤</span>
            <span>본부 임직원 온보딩 (Core HR)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            천종현수학연구소 <span className="text-brand">HQ</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 font-medium">
            출판 · 연구 본부 임직원 계정 등록
          </p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              성명 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
              placeholder="예: 김편집"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                휴대폰 번호 (로그인 ID) <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
                placeholder="010-0000-0000"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                비밀번호 <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
                placeholder="6자리 이상"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                소속 부서 <span className="text-rose-500">*</span>
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
              >
                {HQ_DEFAULT_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
                <option value="__CUSTOM__">+ 직접 입력</option>
              </select>
              {department === "__CUSTOM__" && (
                <input
                  type="text"
                  required
                  value={customDept}
                  onChange={(e) => setCustomDept(e.target.value)}
                  className="w-full mt-2 px-3.5 py-2 bg-white border border-slate-300 rounded-xl font-bold text-slate-900"
                  placeholder="부서명 직접 입력"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                호칭 / 직책명 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
                placeholder="예: 연구원, 편집자, 디자이너"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              초기 실무 직급 선택 <span className="text-rose-500">*</span>
            </label>
            <select
              value={rankCode}
              onChange={(e) => handleRankChange(e.target.value as HqRankCode)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
            >
              {selectableRanks.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
              {hasTopAdmin
                ? "🔒 팀장·본부장·대표 결재권 및 인사·시스템 관리자 권한은 가입 후 최고관리자가 배정합니다."
                : `💡 ${selectedRankMeta.description}`}
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-3.5 rounded-xl shadow-lg transition-colors mt-2 disabled:opacity-50"
          >
            {isLoading ? "계정 등록 중..." : "본부 구성원 계정 생성 완료"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-500 font-semibold">
            이미 계정이 있으신가요?{" "}
            <button
              type="button"
              onClick={() => router.push("/hq/login")}
              className="text-brand font-bold hover:underline ml-1"
            >
              로그인하기
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
