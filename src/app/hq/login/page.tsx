// src/app/hq/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { FALLBACK_HQ_TENANT_ID } from "@/lib/hq/constants";

export default function HqLoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ phone: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);

  const formatPhone = (val: string) => {
    const res = val.replace(/[^0-9]/g, "").slice(0, 11);
    if (res.length < 4) return res;
    if (res.length < 8) return `${res.slice(0, 3)}-${res.slice(3)}`;
    return `${res.slice(0, 3)}-${res.slice(3, 7)}-${res.slice(7, 11)}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === "phone") {
      setFormData({ ...formData, phone: formatPhone(e.target.value) });
    } else {
      setFormData({ ...formData, [e.target.name]: e.target.value });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phone || !formData.password) {
      alert("연락처와 비밀번호를 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      const cleanPhone = formData.phone.replace(/[^0-9]/g, "");
      const authEmail = `${cleanPhone}@logica.com`;

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password: formData.password,
        });

      if (authError || !authData.user) {
        throw new Error("연락처 또는 비밀번호가 일치하지 않습니다.");
      }

      const [instRes, adminRpcRes] = await Promise.all([
        supabase
          .from("instructor")
          .select(
            "instructor_id, name, role, position, chat_position, tenant_id, status, academy_tenant(name, tenant_type)"
          )
          .eq("instructor_id", authData.user.id)
          .maybeSingle(),
        supabase.rpc("is_hq_admin"),
      ]);

      const instData = instRes.data;
      if (instRes.error || !instData) {
        await supabase.auth.signOut().catch(() => {});
        throw new Error("본부 구성원 정보를 찾을 수 없습니다.");
      }

      if (instData.status === "퇴사" || instData.status === "퇴직") {
        await supabase.auth.signOut().catch(() => {});
        throw new Error("퇴직 처리된 계정은 접속할 수 없습니다.");
      }

      const tenantObj: any = Array.isArray(instData.academy_tenant)
        ? instData.academy_tenant[0]
        : instData.academy_tenant;
      const isHqTenant =
        String(instData.tenant_id || "") === FALLBACK_HQ_TENANT_ID ||
        String(tenantObj?.tenant_type || "").toUpperCase() === "HQ" ||
        String(tenantObj?.name || "").includes("본사");
      const isSuperRole =
        String(instData.role || "").toUpperCase() === "SUPER_ADMIN";
      const isHqAdmin = adminRpcRes.data === true;

      if (!isHqTenant && !isSuperRole && !isHqAdmin) {
        await supabase.auth.signOut().catch(() => {});
        throw new Error(
          "본부(HQ) 소속 임직원 전용 시스템입니다. 학원 가맹점 포털(/)을 이용해 주세요."
        );
      }

      if (authData.session?.access_token) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=86400;`;
      }
      if (instData.tenant_id) {
        document.cookie = `logica_tenant_id=${instData.tenant_id}; path=/; max-age=86400;`;
        localStorage.setItem("logica_tenant_id", String(instData.tenant_id));
      }

      localStorage.setItem("logica_instructor_id", instData.instructor_id);
      localStorage.setItem("logica_instructor_name", instData.name);
      localStorage.setItem(
        "logica_instructor_role",
        instData.role || "ADMIN"
      );
      localStorage.setItem(
        "logica_instructor_position",
        instData.chat_position || instData.position || "본사 임직원"
      );

      router.replace("/hq");
    } catch (error: any) {
      alert(`로그인 실패: ${error?.message || "오류가 발생했습니다."}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl w-full max-w-md relative overflow-hidden border border-slate-200">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand via-blue-600 to-indigo-600" />

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-brand text-xs font-extrabold mb-3">
            <span>🏢</span>
            <span>HQ Enterprise HR · 전자결재</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            천종현수학연구소 <span className="text-brand">HQ</span>
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-2">
            본부 · 출판연구소 임직원 전용 올인원 워크스페이스
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              휴대폰 번호 (사내 ID)
            </label>
            <input
              type="text"
              name="phone"
              value={formData.phone}
              maxLength={13}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold tracking-wider text-slate-900"
              placeholder="010-1234-5678"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              비밀번호
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand text-slate-900"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-3.5 rounded-xl shadow-lg transition-colors mt-2 disabled:opacity-50"
          >
            {isLoading ? "인증 확인 중..." : "HQ 워크스페이스 입장"}
          </button>
        </form>

        <div className="mt-7 pt-5 border-t border-slate-100 flex flex-col gap-2.5 text-center">
          <p className="text-xs text-slate-500 font-semibold">
            신규 입사 임직원이신가요?{" "}
            <button
              type="button"
              onClick={() => router.push("/hq/signup")}
              className="text-brand font-bold hover:underline ml-1"
            >
              본부 구성원 계정 등록
            </button>
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold"
          >
            ← 학원(가맹점) 관리 포털 로그인으로 이동
          </button>
        </div>
      </div>
    </div>
  );
}
