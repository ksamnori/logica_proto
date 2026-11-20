// src/app/hq/login/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { FALLBACK_HQ_TENANT_ID } from "@/lib/hq/constants";
import { useHqHref } from "@/lib/hq/hqRoutes";
import { isHqSubdomainHost } from "@/lib/hq/hqRouteUtils";

export default function HqLoginPage() {
  const router = useRouter();
  const hqHref = useHqHref();
  const [formData, setFormData] = useState({ loginId: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 비밀번호 재설정 모달 상태
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMethod, setResetMethod] = useState<"SMS" | "EMAIL">("SMS");
  const [resetName, setResetName] = useState("");
  const [resetPhone, setResetPhone] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetConfirmPw, setResetConfirmPw] = useState("");
  const [smsCodeSent, setSmsCodeSent] = useState(false);
  const [remainSec, setRemainSec] = useState(0);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{
    kind: "info" | "error" | "success";
    text: string;
  } | null>(null);

  // 이메일 재설정 링크로 복귀했을 때 즉시 새 비밀번호 설정 모달
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPw, setRecoveryPw] = useState("");
  const [recoveryConfirmPw, setRecoveryConfirmPw] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryOpen(true);
      }
    });
    if (
      typeof window !== "undefined" &&
      (window.location.hash.includes("type=recovery") ||
        new URLSearchParams(window.location.search).get("recovery") === "1")
    ) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setRecoveryOpen(true);
      });
    }
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!smsCodeSent || remainSec <= 0) return;
    const timer = window.setInterval(() => {
      setRemainSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsCodeSent, remainSec]);

  const formatPhoneIfDigits = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return "";
    // 영문·@·점 등이 포함되면 이메일/아이디 입력으로 간주하여 그대로 유지
    if (!/^[0-9-]+$/.test(trimmed)) return val;
    const res = trimmed.replace(/[^0-9]/g, "").slice(0, 11);
    if (res.length < 4) return res;
    if (res.length < 8) return `${res.slice(0, 3)}-${res.slice(3)}`;
    return `${res.slice(0, 3)}-${res.slice(3, 7)}-${res.slice(7, 11)}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === "loginId") {
      setFormData({ ...formData, loginId: formatPhoneIfDigits(e.target.value) });
    } else {
      setFormData({ ...formData, [e.target.name]: e.target.value });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = formData.loginId.trim();
    if (!rawId || !formData.password) {
      alert("휴대폰 번호(또는 이메일·아이디)와 비밀번호를 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      // 회사 보안·로그인 설정 조회 (실패 시 안전 기본값 유지)
      const policyRes = await fetch("/api/hq/auth/login-policy")
        .then((r) => r.json())
        .catch(() => null);
      const policy = policyRes?.data || {
        allow_email_login: true,
        allow_phone_login: true,
        pc_auto_logout_seconds: 604800,
        mobile_auto_logout_seconds: 31536000,
        allow_on_leave_login: false,
      };

      const isPhoneInput = /^[0-9-]+$/.test(rawId);
      if (isPhoneInput && policy.allow_phone_login === false) {
        throw new Error(
          "현재 회사 로그인 설정에서 휴대폰 번호 기반 로그인이 비활성화되어 있습니다. 이메일 아이디로 로그인해 주세요."
        );
      }
      if (!isPhoneInput && rawId.includes("@") && policy.allow_email_login === false) {
        throw new Error(
          "현재 회사 로그인 설정에서 이메일 로그인이 비활성화되어 있습니다. 휴대폰 번호로 로그인해 주세요."
        );
      }

      // 계정 잠금 사전 확인
      const lockCheck = await fetch("/api/hq/auth/login-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CHECK", identifier: rawId }),
      })
        .then((r) => r.json())
        .catch(() => null);

      if (lockCheck?.locked) {
        throw new Error(
          `로그인 시도 횟수를 초과하여 계정이 잠겼습니다. 약 ${lockCheck.remainMinutes || 15}분 후 다시 시도하거나 인사·최고관리자에게 잠금 해제를 요청해 주세요.`
        );
      }

      let authEmail = "";
      if (rawId.includes("@")) {
        authEmail = rawId;
      } else if (isPhoneInput) {
        const cleanPhone = rawId.replace(/[^0-9]/g, "");
        authEmail = `${cleanPhone}@logica.com`;
      } else {
        authEmail = `${rawId}@logica.com`;
      }

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password: formData.password,
        });

      if (authError || !authData.user) {
        const failRes = await fetch("/api/hq/auth/login-policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "FAIL", identifier: rawId }),
        })
          .then((r) => r.json())
          .catch(() => null);

        if (failRes?.locked) {
          throw new Error(
            `로그인 실패 횟수(${failRes.maxAttempts}회)를 초과하여 계정이 15분간 잠겼습니다.`
          );
        }
        const attemptHint =
          failRes?.failCount && failRes?.maxAttempts
            ? ` (실패 ${failRes.failCount}/${failRes.maxAttempts}회)`
            : "";
        throw new Error(
          `계정 정보(연락처·이메일) 또는 비밀번호가 일치하지 않습니다.${attemptHint}`
        );
      }

      const [instRes, adminRpcRes] = await Promise.all([
        supabase
          .from("instructor")
          .select(
            "instructor_id, name, role, position, chat_position, department, tenant_id, status, academy_tenant(name, tenant_type)"
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

      if (instData.status === "휴직" && !policy.allow_on_leave_login) {
        await supabase.auth.signOut().catch(() => {});
        throw new Error(
          "현재 회사 로그인 설정에 따라 휴직 기간 중에는 워크스페이스 접속이 제한되어 있습니다."
        );
      }

      const rawTenant = instData.academy_tenant as
        | { name?: string; tenant_type?: string }
        | { name?: string; tenant_type?: string }[]
        | null;
      const tenantObj = Array.isArray(rawTenant) ? rawTenant[0] : rawTenant;
      const isHqTenant =
        String(instData.tenant_id || "") === FALLBACK_HQ_TENANT_ID ||
        String(tenantObj?.tenant_type || "").toUpperCase() === "HQ" ||
        String(tenantObj?.name || "").includes("본사");
      const posStr = String(instData.position || "");
      const isSuperRole =
        String(instData.role || "").toUpperCase() === "SUPER_ADMIN" ||
        posStr.includes("최고관리자") ||
        posStr.includes("대장");
      const isHqAdmin = adminRpcRes.data === true;

      if (!isHqTenant && !isSuperRole && !isHqAdmin) {
        await supabase.auth.signOut().catch(() => {});
        throw new Error(
          "본부(HQ) 소속 임직원 전용 시스템입니다. 학원 가맹점 포털(/)을 이용해 주세요."
        );
      }

      const isMobileUa =
        typeof navigator !== "undefined" &&
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const maxAgeSec = isMobileUa
        ? Number(policy.mobile_auto_logout_seconds || 31536000)
        : Number(policy.pc_auto_logout_seconds || 604800);

      if (authData.session?.access_token) {
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=${maxAgeSec};`;
      }
      if (instData.tenant_id) {
        document.cookie = `logica_tenant_id=${instData.tenant_id}; path=/; max-age=${maxAgeSec};`;
        localStorage.setItem("logica_tenant_id", String(instData.tenant_id));
      }

      localStorage.setItem(
        "hq_session_expires_at",
        String(Date.now() + maxAgeSec * 1000)
      );
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

      // 감사 로그 적재 및 실패 카운트 초기화
      fetch("/api/hq/auth/login-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUCCESS",
          identifier: rawId,
          user_id: authData.user.id,
          user_name: instData.name,
          user_email: authData.user.email || authEmail,
          department: instData.department || "",
        }),
      }).catch(() => {});

      const preferDesktop =
        typeof window !== "undefined" &&
        localStorage.getItem("hq_prefer_desktop") === "1";
      router.replace(
        isMobileUa && !preferDesktop ? hqHref("/hq/m") : hqHref("/hq")
      );
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "오류가 발생했습니다.";
      alert(`로그인 실패: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const openResetModal = () => {
    const typed = formData.loginId.trim();
    if (/^[0-9-]+$/.test(typed) && typed.length >= 3) {
      setResetMethod("SMS");
      setResetPhone(formatPhoneIfDigits(typed));
    } else if (typed.includes("@") && !typed.toLowerCase().endsWith("@logica.com")) {
      setResetMethod("EMAIL");
      setResetEmail(typed);
    } else {
      setResetMethod("SMS");
    }
    setSmsCodeSent(false);
    setRemainSec(0);
    setResetCode("");
    setResetNewPw("");
    setResetConfirmPw("");
    setResetFeedback(null);
    setResetOpen(true);
  };

  const handleSendSmsResetCode = async () => {
    const cleanName = resetName.trim();
    const cleanPhone = resetPhone.replace(/[^0-9]/g, "");
    if (!cleanName) {
      setResetFeedback({ kind: "error", text: "성명을 입력해 주세요." });
      return;
    }
    if (!/^01\d{8,9}$/.test(cleanPhone)) {
      setResetFeedback({
        kind: "error",
        text: "올바른 휴대폰 번호(010-XXXX-XXXX)를 입력해 주세요.",
      });
      return;
    }

    setResetBusy(true);
    setResetFeedback(null);
    try {
      const res = await fetch("/api/hq/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SEND_SMS_CODE",
          name: cleanName,
          phone: cleanPhone,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "인증번호 발송에 실패했습니다.");
      }
      setSmsCodeSent(true);
      setRemainSec(Number(json?.data?.expiresInSeconds || 300));
      setResetCode("");
      setResetFeedback({
        kind: "info",
        text: `${json?.data?.maskedPhone || resetPhone} 번호로 6자리 인증번호가 발송되었습니다.`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "인증번호 발송 중 오류가 발생했습니다.";
      setResetFeedback({ kind: "error", text: msg });
    } finally {
      setResetBusy(false);
    }
  };

  const handleConfirmSmsReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCodeSent) {
      await handleSendSmsResetCode();
      return;
    }
    if (resetCode.trim().length !== 6) {
      setResetFeedback({
        kind: "error",
        text: "문자로 받은 6자리 인증번호를 입력해 주세요.",
      });
      return;
    }
    if (resetNewPw.length < 6) {
      setResetFeedback({
        kind: "error",
        text: "새 비밀번호는 최소 6자리 이상이어야 합니다.",
      });
      return;
    }
    if (resetNewPw !== resetConfirmPw) {
      setResetFeedback({
        kind: "error",
        text: "새 비밀번호와 확인 비밀번호가 일치하지 않습니다.",
      });
      return;
    }

    setResetBusy(true);
    setResetFeedback(null);
    try {
      const res = await fetch("/api/hq/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CONFIRM_SMS_RESET",
          name: resetName.trim(),
          phone: resetPhone.replace(/[^0-9]/g, ""),
          code: resetCode.trim(),
          newPassword: resetNewPw,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "비밀번호 변경에 실패했습니다.");
      }

      alert(
        "비밀번호가 성공적으로 재설정되었습니다.\n변경된 비밀번호로 로그인해 주세요."
      );
      setFormData({
        loginId: formatPhoneIfDigits(resetPhone),
        password: "",
      });
      setResetOpen(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "비밀번호 변경 중 오류가 발생했습니다.";
      setResetFeedback({ kind: "error", text: msg });
    } finally {
      setResetBusy(false);
    }
  };

  const handleSendEmailResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = resetEmail.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes("@")) {
      setResetFeedback({
        kind: "error",
        text: "올바른 이메일 주소를 입력해 주세요.",
      });
      return;
    }

    setResetBusy(true);
    setResetFeedback(null);
    try {
      const checkRes = await fetch("/api/hq/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CHECK_EMAIL_TARGET",
          email: targetEmail,
        }),
      });
      const checkJson = await checkRes.json();
      if (!checkRes.ok || !checkJson?.success) {
        if (checkJson?.useSmsInstead) {
          setResetMethod("SMS");
        }
        throw new Error(
          checkJson?.error || "등록된 본부 이메일 계정을 확인할 수 없습니다."
        );
      }

      const redirectUrl = `${window.location.origin}${hqHref(
        "/hq/login"
      )}?recovery=1`;
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;

      setResetFeedback({
        kind: "success",
        text: `[${targetEmail}]로 비밀번호 재설정 링크를 발송했습니다. 메일함의 링크를 클릭해 새 비밀번호를 설정해 주세요.`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "재설정 메일 발송에 실패했습니다.";
      setResetFeedback({ kind: "error", text: msg });
    } finally {
      setResetBusy(false);
    }
  };

  const handleCompleteRecoveryPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryPw.length < 6) {
      alert("새 비밀번호는 최소 6자리 이상이어야 합니다.");
      return;
    }
    if (recoveryPw !== recoveryConfirmPw) {
      alert("입력하신 두 비밀번호가 일치하지 않습니다.");
      return;
    }

    setRecoveryBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: recoveryPw,
      });
      if (error) throw error;
      await supabase.auth.signOut().catch(() => {});
      alert(
        "새 비밀번호 설정이 완료되었습니다.\n변경된 비밀번호로 로그인해 주세요."
      );
      setRecoveryOpen(false);
      setRecoveryPw("");
      setRecoveryConfirmPw("");
      router.replace(hqHref("/hq/login"));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.";
      alert(`비밀번호 변경 실패: ${msg}`);
    } finally {
      setRecoveryBusy(false);
    }
  };

  const formatMmSs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
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
              휴대폰 번호 또는 이메일 · 아이디
            </label>
            <input
              type="text"
              name="loginId"
              value={formData.loginId}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand font-bold text-slate-900"
              placeholder="010-1234-5678 또는 이메일 입력"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-700">
                비밀번호
              </label>
              <button
                type="button"
                onClick={openResetModal}
                className="text-xs font-bold text-brand hover:underline"
              >
                비밀번호 재설정
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full px-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand text-slate-900"
                placeholder="••••••••"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((p) => !p)}
                className="absolute inset-y-0 right-3 flex items-center text-[11px] font-bold text-slate-400 hover:text-slate-700"
              >
                {showPassword ? "숨김" : "보기"}
              </button>
            </div>
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
              onClick={() => router.push(hqHref("/hq/signup"))}
              className="text-brand font-bold hover:underline ml-1"
            >
              본부 구성원 계정 등록
            </button>
          </p>
          <button
            type="button"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                isHqSubdomainHost(window.location.hostname)
              ) {
                window.location.href = "https://logicaclass.com";
                return;
              }
              router.push("/");
            }}
            className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold"
          >
            ← 학원(가맹점) 관리 포털 로그인으로 이동
          </button>
        </div>
      </div>

      {/* 본부 비밀번호 재설정 모달 (휴대폰 SMS 본인인증 / 이메일 링크 발송) */}
      {resetOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🔑</span>
                <h2 className="text-sm font-extrabold text-slate-900">
                  본부 계정 비밀번호 재설정
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setResetMethod("SMS");
                    setResetFeedback(null);
                  }}
                  className={`py-2 rounded-lg transition-all ${
                    resetMethod === "SMS"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  📱 휴대폰 문자 인증
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetMethod("EMAIL");
                    setResetFeedback(null);
                  }}
                  className={`py-2 rounded-lg transition-all ${
                    resetMethod === "EMAIL"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  ✉️ 이메일 링크 발송
                </button>
              </div>
            </div>

            {resetMethod === "SMS" ? (
              <form
                onSubmit={handleConfirmSmsReset}
                className="p-6 space-y-3.5 text-xs"
              >
                <p className="text-slate-500 leading-relaxed">
                  등록된 본부 임직원 성명과 휴대폰 번호로 인증번호(6자리)를 받아 즉시 새 비밀번호를 설정합니다.
                </p>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    이름
                  </label>
                  <input
                    type="text"
                    value={resetName}
                    disabled={smsCodeSent && remainSec > 0}
                    onChange={(e) => setResetName(e.target.value)}
                    placeholder="예: 이웅행"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    휴대폰 번호
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={resetPhone}
                      disabled={smsCodeSent && remainSec > 0}
                      onChange={(e) =>
                        setResetPhone(formatPhoneIfDigits(e.target.value))
                      }
                      placeholder="010-1234-5678"
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={resetBusy}
                      onClick={handleSendSmsResetCode}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold shrink-0 transition-colors"
                    >
                      {smsCodeSent ? "재발송" : "인증번호 받기"}
                    </button>
                  </div>
                </div>

                {smsCodeSent && (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-slate-700">
                          인증번호 6자리
                        </label>
                        <span
                          className={`font-mono font-bold ${
                            remainSec > 0 ? "text-rose-600" : "text-slate-400"
                          }`}
                        >
                          {remainSec > 0
                            ? `남은 시간 ${formatMmSs(remainSec)}`
                            : "유효시간 만료"}
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={resetCode}
                        onChange={(e) =>
                          setResetCode(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        placeholder="6자리 숫자 입력"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-sm font-extrabold tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        새 비밀번호 (6자리 이상)
                      </label>
                      <input
                        type="password"
                        value={resetNewPw}
                        onChange={(e) => setResetNewPw(e.target.value)}
                        placeholder="새 비밀번호 입력"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        새 비밀번호 확인
                      </label>
                      <input
                        type="password"
                        value={resetConfirmPw}
                        onChange={(e) => setResetConfirmPw(e.target.value)}
                        placeholder="새 비밀번호 다시 입력"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                    </div>
                  </>
                )}

                {resetFeedback && (
                  <div
                    className={`p-3 rounded-xl font-semibold leading-relaxed ${
                      resetFeedback.kind === "error"
                        ? "bg-rose-50 border border-rose-200 text-rose-700"
                        : resetFeedback.kind === "success"
                          ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                          : "bg-blue-50 border border-blue-200 text-blue-700"
                    }`}
                  >
                    {resetFeedback.text}
                  </div>
                )}

                {smsCodeSent && (
                  <button
                    type="submit"
                    disabled={resetBusy || remainSec <= 0}
                    className="w-full py-3 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-bold shadow-md transition-colors mt-1"
                  >
                    {resetBusy ? "처리 중..." : "새 비밀번호로 변경 완료"}
                  </button>
                )}
              </form>
            ) : (
              <form
                onSubmit={handleSendEmailResetLink}
                className="p-6 space-y-3.5 text-xs"
              >
                <p className="text-slate-500 leading-relaxed">
                  실제 이메일 아이디로 가입된 본부 계정의 경우, 입력하신 이메일로 비밀번호 재설정 링크를 발송합니다.
                </p>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    가입된 이메일 주소
                  </label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="example@company.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>

                {resetFeedback && (
                  <div
                    className={`p-3 rounded-xl font-semibold leading-relaxed ${
                      resetFeedback.kind === "error"
                        ? "bg-rose-50 border border-rose-200 text-rose-700"
                        : resetFeedback.kind === "success"
                          ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                          : "bg-blue-50 border border-blue-200 text-blue-700"
                    }`}
                  >
                    {resetFeedback.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resetBusy}
                  className="w-full py-3 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-bold shadow-md transition-colors"
                >
                  {resetBusy ? "발송 중..." : "비밀번호 재설정 링크 받기"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 이메일 재설정 링크 클릭 복귀 시 새 비밀번호 설정 모달 */}
      {recoveryOpen && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-slate-900">
                🔒 새 비밀번호 설정
              </h2>
              <button
                type="button"
                onClick={() => setRecoveryOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={handleCompleteRecoveryPassword}
              className="p-6 space-y-3.5 text-xs"
            >
              <p className="text-slate-500">
                앞으로 사용할 새로운 비밀번호(6자리 이상)를 입력해 주세요.
              </p>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  새 비밀번호
                </label>
                <input
                  type="password"
                  required
                  value={recoveryPw}
                  onChange={(e) => setRecoveryPw(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  새 비밀번호 확인
                </label>
                <input
                  type="password"
                  required
                  value={recoveryConfirmPw}
                  onChange={(e) => setRecoveryConfirmPw(e.target.value)}
                  placeholder="한 번 더 입력"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <button
                type="submit"
                disabled={recoveryBusy}
                className="w-full py-3 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-bold shadow-md transition-colors mt-1"
              >
                {recoveryBusy ? "변경 중..." : "비밀번호 변경 완료"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
