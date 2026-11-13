// src/app/hq/members/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import CertificatePrintModal from "@/components/hq/members/CertificatePrintModal";
import MemberFormModal from "@/components/hq/members/MemberFormModal";
import {
  getRankLevel,
  getRankMeta,
  HQ_RANK_LIST,
} from "@/lib/hq/constants";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import type { HqMember, HqRankCode, HqWorkStatus } from "@/lib/hq/types";

function getApprovalRoleHint(rankCode: HqRankCode, isDeptHead: boolean): string {
  switch (rankCode) {
    case "CEO":
      return "최고결재권자 (전사 최종승인)";
    case "DIRECTOR":
      return "2차 임원결재 · 100만원 이하 전결";
    case "TEAM_LEAD":
      return "1차 부서결재 · 30만원/3일 이하 전결";
    case "SENIOR":
      return isDeptHead ? "부서장 대행 검토" : "중급 실무 기안자";
    default:
      return isDeptHead ? "파트 리더 검토" : "실무 기안 담당";
  }
}

export default function HqMembersPage() {
  const { me, members, isHrManager, schemaMissing, refreshMembers } =
    useHqShell();

  const [viewMode, setViewMode] = useState<"roster" | "org">("roster");
  const [keyword, setKeyword] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [rankFilter, setRankFilter] = useState<"ALL" | HqRankCode>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | HqWorkStatus>("재직");
  const [asOfDate, setAsOfDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingMember, setEditingMember] = useState<HqMember | null>(null);
  const [certMember, setCertMember] = useState<HqMember | null>(null);

  const existingDepartments = useMemo(() => {
    const set = new Set<string>();
    members.forEach((m) => {
      if (m.department) set.add(m.department);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [members]);

  const statusCounts = useMemo(() => {
    let active = 0;
    let leave = 0;
    let resigned = 0;
    members.forEach((m) => {
      if (m.work_status === "재직") active += 1;
      else if (m.work_status === "휴직") leave += 1;
      else resigned += 1;
    });
    return { total: members.length, active, leave, resigned };
  }, [members]);

  const hasUpperRankConfigured = useMemo(
    () =>
      members.some(
        (m) => m.work_status === "재직" && getRankLevel(m.rank_code) >= 3
      ),
    [members]
  );

  const filteredMembers = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter !== "ALL" && m.work_status !== statusFilter) {
        return false;
      }
      if (deptFilter !== "ALL" && m.department !== deptFilter) {
        return false;
      }
      if (rankFilter !== "ALL" && m.rank_code !== rankFilter) {
        return false;
      }
      if (q) {
        const hay = [
          m.name,
          m.employee_no,
          m.department,
          m.job_title,
          m.phone,
          m.email,
          m.extension_no,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [members, statusFilter, deptFilter, rankFilter, keyword]);

  // 시점 기준 조직도용 데이터 필터링 (기준일 당시 입사 상태이며 퇴직 전인 구성원)
  const orgSnapshotMembers = useMemo(() => {
    return members.filter((m) => {
      if (m.hire_date && m.hire_date > asOfDate) return false;
      if (
        m.work_status === "퇴직" &&
        m.resign_date &&
        m.resign_date < asOfDate
      ) {
        return false;
      }
      if (m.work_status === "퇴직" && !m.resign_date) {
        return false;
      }
      return true;
    });
  }, [members, asOfDate]);

  const orgExecutives = useMemo(
    () =>
      orgSnapshotMembers
        .filter((m) => getRankLevel(m.rank_code) >= 4)
        .sort((a, b) => b.rank_level - a.rank_level),
    [orgSnapshotMembers]
  );

  const orgDepartments = useMemo(() => {
    const map = new Map<string, HqMember[]>();
    orgSnapshotMembers.forEach((m) => {
      const d = m.department || "미지정";
      const list = map.get(d) || [];
      list.push(m);
      map.set(d, list);
    });
    return Array.from(map.entries())
      .map(([dept, list]) => {
        const sorted = [...list].sort((a, b) => {
          if (a.is_dept_head !== b.is_dept_head) return a.is_dept_head ? -1 : 1;
          if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
          return a.name.localeCompare(b.name, "ko");
        });
        const head = sorted.find((x) => x.is_dept_head) || null;
        return { dept, head, members: sorted };
      })
      .sort((a, b) => b.members.length - a.members.length);
  }, [orgSnapshotMembers]);

  const openCreateModal = () => {
    if (!isHrManager) {
      alert(
        "신규 구성원 등록은 인사관리 권한(임원·경영지원 팀장·권한관리자) 계정만 가능합니다."
      );
      return;
    }
    setFormMode("create");
    setEditingMember(null);
    setFormOpen(true);
  };

  const openEditModal = (target: HqMember) => {
    const isSelf = me?.instructor_id === target.instructor_id;
    if (!isHrManager && !isSelf) {
      alert("타 구성원의 인사 정보는 인사관리자만 수정할 수 있습니다.");
      return;
    }
    setFormMode("edit");
    setEditingMember(target);
    setFormOpen(true);
  };

  return (
    <>
      <div className="p-6 space-y-5 max-w-[1440px] w-full mx-auto print:hidden">
        {/* 직급 초기 배정 안내 배너 */}
        {!schemaMissing && members.length > 0 && !hasUpperRankConfigured && (
          <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs sm:text-sm font-extrabold text-indigo-950">
                💡 직급별 전자결재 단계를 활성화하려면 구성원 직급(Lv.1~Lv.5)과 부서장을 지정해 주세요
              </h3>
              <p className="text-xs text-indigo-800 mt-0.5">
                각 구성원 우측의 <b>[인사·직급 수정]</b>에서 사원/선임/팀장/본부장/대표 직급과 부서장 여부를 저장하면 결재선이 자동으로 매칭됩니다.
              </p>
            </div>
          </div>
        )}

        {/* 상단 Core HR 통계 & 셀프서비스 액션 바 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* 재직 상태 요약 + 직급 필터 칩 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRankFilter("ALL");
                  setStatusFilter("재직");
                }}
                className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold transition-colors ${
                  rankFilter === "ALL"
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                재직 {statusCounts.active}명{" "}
                <span className="text-slate-400 font-semibold">
                  (전체 {statusCounts.total})
                </span>
              </button>

              {[...HQ_RANK_LIST].reverse().map((rk) => {
                const cnt = members.filter(
                  (m) => m.work_status === "재직" && m.rank_code === rk.code
                ).length;
                const active = rankFilter === rk.code;
                return (
                  <button
                    key={rk.code}
                    type="button"
                    onClick={() =>
                      setRankFilter(active ? "ALL" : rk.code)
                    }
                    className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                      active
                        ? "ring-2 ring-brand border-brand bg-blue-50 text-brand"
                        : `${rk.badgeClass} hover:opacity-85`
                    }`}
                  >
                    Lv.{rk.level} {rk.shortLabel} · {cnt}
                  </button>
                );
              })}
            </div>

            {/* 우측 셀프서비스 + 구성원 추가 버튼 */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {me && (
                <>
                  <button
                    type="button"
                    onClick={() => setCertMember(me)}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors"
                  >
                    🪪 내 재직·경력증명서 발급
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(me)}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors"
                  >
                    ✏️ 내 인사정보 수정
                  </button>
                </>
              )}
              {isHrManager && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-sm transition-colors"
                >
                  ➕ 신규 구성원 등록
                </button>
              )}
            </div>
          </div>

          {/* 뷰 전환 탭 & 검색 필터 바 */}
          <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 self-start">
              <button
                type="button"
                onClick={() => setViewMode("roster")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  viewMode === "roster"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                📋 구성원 인사 명부 ({filteredMembers.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode("org")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  viewMode === "org"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                🏢 시점별 부서 · 직급 조직도
              </button>
            </div>

            {viewMode === "roster" ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
                >
                  <option value="ALL">전체 부서</option>
                  {existingDepartments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as "ALL" | HqWorkStatus)
                  }
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
                >
                  <option value="재직">재직 ({statusCounts.active})</option>
                  <option value="휴직">휴직 ({statusCounts.leave})</option>
                  <option value="퇴직">퇴직 ({statusCounts.resigned})</option>
                  <option value="ALL">전체 상태 ({statusCounts.total})</option>
                </select>

                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="이름, 사번, 부서, 직책, 연락처 검색"
                  className="w-60 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">
                  📅 조직도 조회 기준일:
                </span>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAsOfDate(new Date().toISOString().slice(0, 10))
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600"
                >
                  오늘
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 메인 콘텐츠: 1) 구성원 인사 명부 테이블 */}
        {viewMode === "roster" ? (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                    <th className="px-5 py-3.5">구성원 · 사번</th>
                    <th className="px-4 py-3.5">소속 부서</th>
                    <th className="px-4 py-3.5">직급 단계 · 결재 역할</th>
                    <th className="px-4 py-3.5">고용 · 입사일</th>
                    <th className="px-4 py-3.5">연차 현황</th>
                    <th className="px-4 py-3.5">연락처 · 내선</th>
                    <th className="px-5 py-3.5 text-right">인사 · 증명서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-16 text-center text-slate-400 font-bold"
                      >
                        조건에 해당하는 본부 구성원이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((m) => {
                      const rk = getRankMeta(m.rank_code);
                      const avatar = resolveStoragePublicUrl(
                        m.profile_image_url
                      );
                      const isMe = me?.instructor_id === m.instructor_id;
                      const canEdit = isHrManager || isMe;
                      const canCert = isHrManager || isMe;
                      const leavePct = Math.min(
                        100,
                        Math.round(
                          (m.annual_leave_used /
                            Math.max(1, m.annual_leave_total)) *
                            100
                        )
                      );

                      return (
                        <tr
                          key={m.instructor_id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="relative w-9 h-9 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center font-extrabold text-slate-700 shrink-0 overflow-hidden">
                                <span>{m.name.slice(0, 1)}</span>
                                {avatar && (
                                  <img
                                    src={avatar}
                                    alt={m.name}
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <div>
                                <div className="font-extrabold text-slate-900 text-[13px] flex items-center gap-1.5">
                                  <span>{m.name}</span>
                                  {isMe && (
                                    <span className="px-1.5 py-0.5 rounded bg-brand text-white text-[10px] font-bold">
                                      나
                                    </span>
                                  )}
                                  {m.is_dept_head && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                                      부서장
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {m.employee_no}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="font-bold text-slate-800">
                              {m.department}
                            </div>
                            {m.job_description && (
                              <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                                {m.job_description}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded border text-[10px] font-extrabold ${rk.badgeClass}`}
                              >
                                Lv.{rk.level}
                              </span>
                              <span className="font-extrabold text-slate-800">
                                {m.job_title}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {getApprovalRoleHint(m.rank_code, m.is_dept_head)}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  m.work_status === "재직"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : m.work_status === "휴직"
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {m.work_status}
                              </span>
                              <span className="font-semibold text-slate-700">
                                {m.employment_type}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              입사: {m.hire_date || "-"}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="font-extrabold text-slate-800">
                              잔여{" "}
                              <span className="text-emerald-600">
                                {m.annual_leave_remain}일
                              </span>{" "}
                              <span className="text-slate-400 font-normal">
                                / {m.annual_leave_total}일
                              </span>
                            </div>
                            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${leavePct}%` }}
                              />
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-slate-700">
                              {m.phone || "-"}
                              {m.extension_no ? ` (${m.extension_no})` : ""}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[170px]">
                              {m.email || "-"}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {canCert && (
                                <button
                                  type="button"
                                  onClick={() => setCertMember(m)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]"
                                  title="재직·경력증명서 인쇄/PDF 발급"
                                >
                                  증명서
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(m)}
                                  className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-brand font-extrabold text-[11px]"
                                >
                                  {isHrManager ? "인사·직급 수정" : "내 정보 수정"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          /* 2) 시점별 부서 · 직급 조직도 뷰 */
          <section className="space-y-6">
            {/* 상단 임원진 리더십 보드 */}
            {orgExecutives.length > 0 && (
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-5 text-white shadow-sm">
                <div className="text-xs font-extrabold text-blue-300 uppercase tracking-wider mb-3">
                  👑 본부 최고 결재 · 임원단 ({asOfDate} 기준)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {orgExecutives.map((ex) => {
                    const rk = getRankMeta(ex.rank_code);
                    return (
                      <div
                        key={ex.instructor_id}
                        onClick={() =>
                          (isHrManager ||
                            ex.instructor_id === me?.instructor_id) &&
                          openEditModal(ex)
                        }
                        className="rounded-xl bg-white/10 border border-white/15 p-3.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-white/15 transition-colors"
                      >
                        <div>
                          <div className="text-sm font-extrabold">
                            {ex.name}{" "}
                            <span className="text-blue-200 text-xs">
                              {ex.job_title}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-300 mt-0.5">
                            {ex.department} · Lv.{rk.level}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-white/15 text-[10px] font-bold">
                          {ex.rank_code === "CEO" ? "최종승인" : "임원전결"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 부서별 카드 트리 */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {orgDepartments.map((group) => (
                <div
                  key={group.dept}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col"
                >
                  <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        📁 {group.dept}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {group.head
                          ? `부서장: ${group.head.name} ${group.head.job_title}`
                          : "부서장 미지정"}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-slate-200/80 text-slate-700 text-xs font-extrabold">
                      {group.members.length}명
                    </span>
                  </div>

                  <div className="p-4 space-y-2 flex-1">
                    {group.members.map((m) => {
                      const rk = getRankMeta(m.rank_code);
                      const canClick =
                        isHrManager || m.instructor_id === me?.instructor_id;
                      return (
                        <div
                          key={m.instructor_id}
                          onClick={() => canClick && openEditModal(m)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                            m.is_dept_head
                              ? "border-amber-200 bg-amber-50/40"
                              : "border-slate-100 bg-slate-50/50"
                          } ${canClick ? "cursor-pointer hover:border-brand/40" : ""}`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                              <span>{m.name}</span>
                              <span className="text-slate-500 font-semibold">
                                {m.job_title}
                              </span>
                              {m.is_dept_head && (
                                <span className="text-[10px] text-amber-700 font-extrabold">
                                  ★부서장
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {m.job_description || m.phone || m.employee_no}
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-extrabold shrink-0 ${rk.badgeClass}`}
                          >
                            Lv.{rk.level}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 구성원 신규 등록 / 인사정보 수정 모달 */}
      <MemberFormModal
        isOpen={formOpen}
        mode={formMode}
        member={editingMember}
        isHrManager={isHrManager}
        existingDepartments={existingDepartments}
        onClose={() => setFormOpen(false)}
        onSaved={refreshMembers}
      />

      {/* 재직·경력증명서 인쇄 모달 */}
      <CertificatePrintModal
        isOpen={Boolean(certMember)}
        member={certMember}
        onClose={() => setCertMember(null)}
      />
    </>
  );
}
