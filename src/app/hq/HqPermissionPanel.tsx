// src/app/hq/HqPermissionPanel.tsx
// 출판사 포털 "권한 관리" 화면: 직원별 메뉴 권한(진단평가 분석, 문제 DB)을 켜고 끔 (권한 관리자 전용)
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccessLevel = "word" | "all" | null;

interface StaffRow {
  instructor_id: string;
  name: string;
  position: string;
  department: string;
  tenant_name: string;
  contest_access: AccessLevel;
  granted_at: string | null;
  permissions: string[];   // 켜기/끄기형 메뉴 권한 (예: 'admission_analytics')
}

const HQ_TENANT_NAME = "본사";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

export default function HqPermissionPanel({ onChanged }: { onChanged?: () => void }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [me, setMe] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [scope, setScope] = useState<"hq" | "all">("hq");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/hq-permissions", { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `불러오기 실패 (${res.status})`);
      setStaff(json.data.staff);
      setMe(json.data.me);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeAccess = async (row: StaffRow, next: AccessLevel) => {
    if (row.contest_access === next) return;
    if (row.instructor_id === me && next !== "all" &&
        !confirm("본인의 전체 문제 열람 권한을 낮추려고 합니다. 계속할까요?")) return;

    const prev = row.contest_access;
    setSavingId(row.instructor_id);
    setStaff((list) => list.map((s) => (s.instructor_id === row.instructor_id ? { ...s, contest_access: next } : s)));
    try {
      const res = await fetch("/api/hq-permissions", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ instructor_id: row.instructor_id, contest_access: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `저장 실패 (${res.status})`);
      setStaff((list) => list.map((s) => (s.instructor_id === row.instructor_id ? { ...s, granted_at: next ? new Date().toISOString() : null } : s)));
      if (row.instructor_id === me) onChanged?.();
    } catch (e: any) {
      // 실패하면 화면을 원래 값으로 되돌림
      setStaff((list) => list.map((s) => (s.instructor_id === row.instructor_id ? { ...s, contest_access: prev } : s)));
      alert("권한 변경 실패: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  /** 켜기/끄기형 메뉴 권한 변경 (진단평가 분석 등) */
  const togglePermission = async (row: StaffRow, permission: string, enabled: boolean) => {
    if (row.instructor_id === me && !enabled &&
        !confirm("본인의 메뉴 권한을 끄려고 합니다. 계속할까요?")) return;

    const prev = row.permissions;
    const next = enabled ? Array.from(new Set([...prev, permission])) : prev.filter((p) => p !== permission);
    setSavingId(row.instructor_id);
    setStaff((list) => list.map((s) => (s.instructor_id === row.instructor_id ? { ...s, permissions: next } : s)));
    try {
      const res = await fetch("/api/hq-permissions", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ instructor_id: row.instructor_id, permission, enabled }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `저장 실패 (${res.status})`);
      if (row.instructor_id === me) onChanged?.();
    } catch (e: any) {
      setStaff((list) => list.map((s) => (s.instructor_id === row.instructor_id ? { ...s, permissions: prev } : s)));
      alert("권한 변경 실패: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  // 소속 → 부서 순으로 묶기
  const groups = useMemo(() => {
    const kw = keyword.trim();
    const filtered = staff.filter((s) =>
      (scope === "all" || s.tenant_name === HQ_TENANT_NAME) &&
      (!kw || s.name.includes(kw) || s.department.includes(kw) || s.position.includes(kw))
    );
    const map = new Map<string, StaffRow[]>();
    filtered.forEach((s) => {
      const key = scope === "all" ? `${s.tenant_name} · ${s.department}` : s.department;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [staff, scope, keyword]);

  const counts = useMemo(() => {
    const inScope = staff.filter((s) => scope === "all" || s.tenant_name === HQ_TENANT_NAME);
    return {
      total: inScope.length,
      analytics: inScope.filter((s) => s.permissions.includes("admission_analytics")).length,
      word: inScope.filter((s) => s.contest_access === "word").length,
      all: inScope.filter((s) => s.contest_access === "all").length,
    };
  }, [staff, scope]);

  return (
    <div className="flex flex-col h-full bg-[#eef2f6] p-6 overflow-hidden">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">🔐 권한 관리</h2>
          <p className="text-xs text-slate-500 mt-1">
            직원별 진단평가 분석·문제 DB 열람 권한을 켜고 끕니다. 바꾸는 즉시 적용되며, 해당 직원은 포털을 새로 열면 메뉴가 바뀝니다.
          </p>
        </div>
        <div className="flex gap-2 text-xs font-bold shrink-0">
          <span className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600">대상 {counts.total}명</span>
          <span className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700">진단평가 {counts.analytics}명</span>
          <span className="px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">문장제 {counts.word}명</span>
          <span className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">전체 {counts.all}명</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {([["hq", "출판사(본사) 직원"], ["all", "전체 지점 직원"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setScope(v)}
              className={`px-3 py-1 rounded-md text-[13px] font-bold ${scope === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
              {label}
            </button>
          ))}
        </div>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="이름·부서·직책 검색"
          className="px-3 py-1.5 rounded-lg border border-slate-300 text-[13px] w-[220px]" />
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[13px] font-bold text-slate-600">
          새로고침
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-sm">
        {isLoading ? (
          <div className="py-20 text-center text-slate-400 font-bold">직원 목록 불러오는 중...</div>
        ) : loadError ? (
          <div className="py-20 text-center text-rose-500 font-bold">{loadError}</div>
        ) : groups.length === 0 ? (
          <div className="py-20 text-center text-slate-400 font-bold">해당하는 직원이 없습니다.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="text-left text-xs font-bold text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">직책</th>
                <th className="px-4 py-2.5 text-center w-[130px]">진단평가 분석</th>
                <th className="px-4 py-2.5 text-center w-[150px]">사고력·문장제 열람</th>
                <th className="px-4 py-2.5 text-center w-[150px]">전체 문제 열람</th>
                <th className="px-4 py-2.5 w-[120px]">마지막 변경</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, rows]) => (
                <React.Fragment key={group}>
                  <tr className="bg-slate-50/70">
                    <td colSpan={6} className="px-4 py-1.5 text-xs font-bold text-slate-500">📁 {group} ({rows.length}명)</td>
                  </tr>
                  {rows.map((s) => {
                    const busy = savingId === s.instructor_id;
                    return (
                      <tr key={s.instructor_id} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-bold text-slate-800">
                          {s.name}
                          {s.instructor_id === me && <span className="ml-1.5 px-1.5 py-0.5 bg-slate-800 text-white text-[11px] rounded">나</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{s.position || "-"}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Switch
                            checked={s.permissions.includes("admission_analytics")}
                            disabled={busy}
                            tone="sky"
                            onChange={(on) => togglePermission(s, "admission_analytics", on)}
                            label={`${s.name} 진단평가 분석`}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Switch
                            checked={s.contest_access !== null}
                            disabled={busy}
                            onChange={(on) => changeAccess(s, on ? (s.contest_access ?? "word") : null)}
                            label={`${s.name} 문장제 열람`}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Switch
                            checked={s.contest_access === "all"}
                            disabled={busy}
                            tone="amber"
                            onChange={(on) => changeAccess(s, on ? "all" : "word")}
                            label={`${s.name} 전체 문제 열람`}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">
                          {busy ? "저장 중..." : s.granted_at ? new Date(s.granted_at).toLocaleDateString("ko-KR") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2">
        전체 문제 열람을 켜면 문장제 열람도 함께 켜집니다. 마지막 변경 날짜는 문제 DB 권한 기준입니다. 권한 관리자 지정은 보안을 위해 DB에서만 할 수 있습니다.
      </p>
    </div>
  );
}

function Switch({ checked, disabled, onChange, label, tone = "emerald" }: {
  checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; label: string; tone?: "emerald" | "amber" | "sky";
}) {
  const onColor = tone === "amber" ? "bg-amber-500" : tone === "sky" ? "bg-sky-500" : "bg-emerald-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? onColor : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}
