// src/components/hq/permissions/HqPermissionPanel.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getHqAuthHeaders } from "@/lib/hq/clientApi";
import { getRankLevel, HQ_RANK_LIST } from "@/lib/hq/constants";
import type { HqRankCode } from "@/lib/hq/types";
import { useHqShell } from "../HqShellContext";

type AccessLevel = "word" | "all" | null;

interface StaffRow {
  instructor_id: string;
  name: string;
  position: string;
  department: string;
  tenant_name: string;
  is_hq: boolean;
  rank_code: HqRankCode;
  is_dept_head: boolean;
  is_hr_admin: boolean;
  contest_access: AccessLevel;
  granted_at: string | null;
  permissions: string[];
}

export default function HqPermissionPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const { refreshMembers } = useHqShell();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [me, setMe] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [scope, setScope] = useState<"hq" | "branch">("hq");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/hq/permissions", {
        headers: await getHqAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `불러오기 실패 (${res.status})`);
      }
      setStaff(json.data.staff);
      setMe(json.data.me);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateHrRoleField = async (
    row: StaffRow,
    patch: {
      rank_code?: HqRankCode;
      is_dept_head?: boolean;
      is_hr_admin?: boolean;
    }
  ) => {
    if (
      row.instructor_id === me &&
      patch.rank_code &&
      getRankLevel(patch.rank_code) < 5 &&
      row.rank_code === "CEO" &&
      !confirm(
        "본인의 대표(Lv.5) 직급을 낮추면 최고관리자 화면 접근이 제한될 수 있습니다. 계속할까요?"
      )
    ) {
      return;
    }

    const prevRow = { ...row };
    setSavingId(row.instructor_id);
    setStaff((list) =>
      list.map((s) =>
        s.instructor_id === row.instructor_id ? { ...s, ...patch } : s
      )
    );
    try {
      const res = await fetch("/api/hq/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getHqAuthHeaders()),
        },
        body: JSON.stringify({
          instructor_id: row.instructor_id,
          ...patch,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `저장 실패 (${res.status})`);
      }
      await refreshMembers();
      onChanged?.();
    } catch (e: any) {
      setStaff((list) =>
        list.map((s) => (s.instructor_id === row.instructor_id ? prevRow : s))
      );
      alert("직급·관리자 배정 실패: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  const changeAccess = async (row: StaffRow, next: AccessLevel) => {
    if (row.contest_access === next) return;
    if (
      row.instructor_id === me &&
      next !== "all" &&
      !confirm("본인의 전체 문제 열람 권한을 낮추려고 합니다. 계속할까요?")
    ) {
      return;
    }

    const prev = row.contest_access;
    setSavingId(row.instructor_id);
    setStaff((list) =>
      list.map((s) =>
        s.instructor_id === row.instructor_id
          ? { ...s, contest_access: next }
          : s
      )
    );
    try {
      const res = await fetch("/api/hq/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getHqAuthHeaders()),
        },
        body: JSON.stringify({
          instructor_id: row.instructor_id,
          contest_access: next,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `저장 실패 (${res.status})`);
      }
      setStaff((list) =>
        list.map((s) =>
          s.instructor_id === row.instructor_id
            ? { ...s, granted_at: next ? new Date().toISOString() : null }
            : s
        )
      );
      if (row.instructor_id === me) onChanged?.();
    } catch (e: any) {
      setStaff((list) =>
        list.map((s) =>
          s.instructor_id === row.instructor_id
            ? { ...s, contest_access: prev }
            : s
        )
      );
      alert("권한 변경 실패: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  const togglePermission = async (
    row: StaffRow,
    permission: string,
    enabled: boolean
  ) => {
    if (
      row.instructor_id === me &&
      !enabled &&
      !confirm("본인의 메뉴 권한을 끄려고 합니다. 계속할까요?")
    ) {
      return;
    }

    const prev = row.permissions;
    const next = enabled
      ? Array.from(new Set([...prev, permission]))
      : prev.filter((p) => p !== permission);
    setSavingId(row.instructor_id);
    setStaff((list) =>
      list.map((s) =>
        s.instructor_id === row.instructor_id ? { ...s, permissions: next } : s
      )
    );
    try {
      const res = await fetch("/api/hq/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getHqAuthHeaders()),
        },
        body: JSON.stringify({
          instructor_id: row.instructor_id,
          permission,
          enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `저장 실패 (${res.status})`);
      }
      if (row.instructor_id === me) onChanged?.();
    } catch (e: any) {
      setStaff((list) =>
        list.map((s) =>
          s.instructor_id === row.instructor_id
            ? { ...s, permissions: prev }
            : s
        )
      );
      alert("권한 변경 실패: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  const groups = useMemo(() => {
    const kw = keyword.trim();
    const filtered = staff.filter(
      (s) =>
        (scope === "hq" ? s.is_hq : !s.is_hq) &&
        (!kw ||
          s.name.includes(kw) ||
          s.department.includes(kw) ||
          s.position.includes(kw))
    );
    const map = new Map<string, StaffRow[]>();
    filtered.forEach((s) => {
      const key =
        scope === "branch"
          ? `${s.tenant_name} · ${s.department}`
          : s.department;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [staff, scope, keyword]);

  const hqCount = useMemo(() => staff.filter((s) => s.is_hq).length, [staff]);
  const branchCount = staff.length - hqCount;

  const counts = useMemo(() => {
    const inScope = staff.filter((s) => (scope === "hq" ? s.is_hq : !s.is_hq));
    return {
      total: inScope.length,
      analytics: inScope.filter((s) =>
        s.permissions.includes("admission_analytics")
      ).length,
      word: inScope.filter((s) => s.contest_access === "word").length,
      all: inScope.filter((s) => s.contest_access === "all").length,
    };
  }, [staff, scope]);

  return (
    <div className="flex flex-col h-full bg-[#F5F7FA] p-6 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            🔐 최고관리자 직급 · 관리자 · 연구DB 배정 센터
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            최고관리자가 임직원별 <strong>결재 직급(Lv.1~5) · 부서장 · 인사/급여 관리자 위임 · 문제 DB 권한</strong>을 한 화면에서 배정합니다.
          </p>
        </div>
        <div className="flex gap-2 text-xs font-bold shrink-0">
          <span className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600">
            대상 {counts.total}명
          </span>
          <span className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700">
            진단평가 {counts.analytics}명
          </span>
          <span className="px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
            문장제 {counts.word}명
          </span>
          <span className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
            전체문제 {counts.all}명
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(
            [
              ["hq", `본사·출판부 직원 (${hqCount})`],
              ["branch", `학원·지점 직원 (${branchCount})`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setScope(v)}
              className={`px-3 py-1 rounded-md text-[13px] font-bold ${
                scope === v
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="이름·부서·직책 검색"
          className="px-3 py-1.5 rounded-lg border border-slate-300 text-[13px] w-[220px]"
        />
        <button
          type="button"
          onClick={load}
          className="ml-auto px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[13px] font-bold text-slate-600"
        >
          새로고침
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-sm custom-scroll">
        {isLoading ? (
          <div className="py-20 text-center text-slate-400 font-bold">
            직원 목록 불러오는 중...
          </div>
        ) : loadError ? (
          <div className="py-20 text-center text-rose-500 font-bold">
            {loadError}
          </div>
        ) : groups.length === 0 ? (
          <div className="py-20 text-center text-slate-400 font-bold">
            해당하는 직원이 없습니다.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="text-left text-xs font-bold text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5">이름 / 호칭</th>
                {scope === "hq" && (
                  <>
                    <th className="px-3 py-2.5 w-[210px]">
                      결재 직급 배정 (Lv.1~5)
                    </th>
                    <th className="px-3 py-2.5 text-center w-[110px]">
                      부서장 지정
                    </th>
                    <th className="px-3 py-2.5 text-center w-[140px]">
                      인사·급여 관리자
                    </th>
                  </>
                )}
                <th className="px-3 py-2.5 text-center w-[120px]">
                  진단평가 분석
                </th>
                <th className="px-3 py-2.5 text-center w-[130px]">
                  문장제 DB
                </th>
                <th className="px-3 py-2.5 text-center w-[130px]">
                  전체 문제 DB
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, rows]) => (
                <React.Fragment key={group}>
                  <tr className="bg-slate-50/70">
                    <td
                      colSpan={scope === "hq" ? 7 : 4}
                      className="px-4 py-1.5 text-xs font-bold text-slate-500"
                    >
                      📁 {group} ({rows.length}명)
                    </td>
                  </tr>
                  {rows.map((s) => {
                    const busy = savingId === s.instructor_id;
                    const autoHrByRank =
                      getRankLevel(s.rank_code) >= 4 ||
                      (s.department.includes("경영지원") &&
                        getRankLevel(s.rank_code) >= 3);

                    return (
                      <tr
                        key={s.instructor_id}
                        className="border-b border-slate-100 hover:bg-slate-50/60"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-slate-800">
                            {s.name}
                            {s.instructor_id === me && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-slate-800 text-white text-[10px] rounded">
                                나
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {s.position || "-"}
                          </div>
                        </td>

                        {scope === "hq" && (
                          <>
                            <td className="px-3 py-2.5">
                              <select
                                disabled={busy}
                                value={s.rank_code}
                                onChange={(e) =>
                                  updateHrRoleField(s, {
                                    rank_code: e.target.value as HqRankCode,
                                  })
                                }
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
                              >
                                {HQ_RANK_LIST.map((r) => (
                                  <option key={r.code} value={r.code}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="px-3 py-2.5 text-center">
                              <Switch
                                checked={s.is_dept_head}
                                disabled={busy}
                                tone="indigo"
                                onChange={(on) =>
                                  updateHrRoleField(s, { is_dept_head: on })
                                }
                                label={`${s.name} 부서장 지정`}
                              />
                            </td>

                            <td className="px-3 py-2.5 text-center">
                              {autoHrByRank ? (
                                <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold">
                                  직급 기본보유
                                </span>
                              ) : (
                                <Switch
                                  checked={s.is_hr_admin}
                                  disabled={busy}
                                  tone="indigo"
                                  onChange={(on) =>
                                    updateHrRoleField(s, { is_hr_admin: on })
                                  }
                                  label={`${s.name} 인사·급여 관리자 위임`}
                                />
                              )}
                            </td>
                          </>
                        )}

                        <td className="px-3 py-2.5 text-center">
                          <Switch
                            checked={s.permissions.includes(
                              "admission_analytics"
                            )}
                            disabled={busy}
                            tone="sky"
                            onChange={(on) =>
                              togglePermission(s, "admission_analytics", on)
                            }
                            label={`${s.name} 진단평가 분석`}
                          />
                        </td>

                        <td className="px-3 py-2.5 text-center">
                          <Switch
                            checked={s.contest_access !== null}
                            disabled={busy}
                            onChange={(on) =>
                              changeAccess(
                                s,
                                on ? (s.contest_access ?? "word") : null
                              )
                            }
                            label={`${s.name} 문장제 열람`}
                          />
                        </td>

                        <td className="px-3 py-2.5 text-center">
                          <Switch
                            checked={s.contest_access === "all"}
                            disabled={busy}
                            tone="amber"
                            onChange={(on) =>
                              changeAccess(s, on ? "all" : "word")
                            }
                            label={`${s.name} 전체 문제 열람`}
                          />
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
    </div>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
  tone = "emerald",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  label: string;
  tone?: "emerald" | "amber" | "sky" | "indigo";
}) {
  const onColor =
    tone === "amber"
      ? "bg-amber-500"
      : tone === "sky"
      ? "bg-sky-500"
      : tone === "indigo"
      ? "bg-indigo-600"
      : "bg-emerald-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? onColor : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
