// src/app/hq/signup/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HQ_DEFAULT_DEPARTMENTS } from "@/lib/hq/constants";
import { inferRankCodeFromHrSelection } from "@/lib/hq/orgTreeHelper";

interface SignupOrgOption {
  name: string;
  label: string;
  depth: number;
}

export default function HqSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const [orgOptions, setOrgOptions] = useState<SignupOrgOption[]>(
    HQ_DEFAULT_DEPARTMENTS.map((d) => ({ name: d, label: d, depth: 1 }))
  );
  const [titleOptions, setTitleOptions] = useState<string[]>([
    "사원",
    "연구원",
    "팀장",
    "실장",
  ]);

  const [department, setDepartment] = useState<string>(
    HQ_DEFAULT_DEPARTMENTS[0]
  );
  const [jobTitle, setJobTitle] = useState("사원");
  const [hasTopAdmin, setHasTopAdmin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/hq/auth/signup")
      .then((r) => r.json())
      .then((json) => {
        const d = json?.data;
        if (!d) return;
        if (typeof d.hasTopAdmin === "boolean") {
          setHasTopAdmin(d.hasTopAdmin);
        }
        if (Array.isArray(d.orgOptions) && d.orgOptions.length > 0) {
          setOrgOptions(d.orgOptions);
          setDepartment(d.orgOptions[0].name);
        }
        const mergedTitles = Array.from(
          new Set<string>([
            ...(Array.isArray(d.hrPositions) ? d.hrPositions : []),
            ...(Array.isArray(d.hrTitles) ? d.hrTitles : []),
            "사원",
          ])
        ).filter((t) => (d.hasTopAdmin ? t !== "대표" : true));
        if (mergedTitles.length > 0) {
          setTitleOptions(mergedTitles);
          setJobTitle(mergedTitles.includes("사원") ? "사원" : mergedTitles[0]);
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !phone || !password || !department || !jobTitle.trim()) {
      alert("모든 필수 항목을 입력해 주세요.");
      return;
    }

    const inferredRank = hasTopAdmin
      ? "STAFF"
      : inferRankCodeFromHrSelection({
          orgName: department,
          position: jobTitle,
          title: jobTitle,
        });

    setIsLoading(true);
    try {
      const res = await fetch("/api/hq/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          password,
          department,
          rank_code: inferredRank,
          job_title: jobTitle.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "계정 생성에 실패했습니다.");
      }

      alert(
        "🏢 본부 구성원 계정과 조직도 소속 배정이 완료되었습니다.\n로그인 화면으로 이동합니다."
      );
      router.replace("/hq/login");
    } catch (error: any) {
      alert(`가입 실패: ${error?.message || "오류가 발생했습니다."}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 py-10">
      <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl w-full max-w-lg relative overflow-hidden border border-slate-200">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand via-blue-600 to-indigo-600" />

        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-brand text-xs font-extrabold mb-2.5">
            <span>👤</span>
            <span>본부 임직원 가입 (조직도 실시간 연동)</span>
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
                소속 조직 (조직도 기준) <span className="text-rose-500">*</span>
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
              >
                {orgOptions.map((opt) => (
                  <option key={opt.name} value={opt.name}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                직위 · 직책 <span className="text-rose-500">*</span>
              </label>
              <select
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
              >
                {titleOptions.map((ttl) => (
                  <option key={ttl} value={ttl}>
                    {ttl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-3 text-[11px] text-slate-500 font-medium leading-relaxed">
            💡 [조직도 설정]에 등록된 조직으로 즉시 배정되며, 가입 후 인사관리자가 세부 직무·직군·조직장 권한을 설정할 수 있습니다.
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
