// src/app/(hq)/hq/dev-tools/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";
import type {
  DevToolDomainKey,
  DevToolRecordItem,
} from "@/app/api/hq/dev-tools/route";

interface DomainMeta {
  key: DevToolDomainKey;
  group: "DB" | "KV";
  icon: string;
  label: string;
  desc: string;
}

const DOMAIN_LIST: DomainMeta[] = [
  {
    key: "approvals",
    group: "DB",
    icon: "📋",
    label: "전자결재 문서",
    desc: "hq_approval_doc · hq_approval_step (승인완료·진행중 포함 강제 삭제 및 연결 FK 자동 해제)",
  },
  {
    key: "expenses",
    group: "DB",
    icon: "💳",
    label: "비용 · 경비 내역",
    desc: "hq_expense (결재연동·정산완료 건 포함 개별 강제 삭제)",
  },
  {
    key: "attendance",
    group: "DB",
    icon: "⏱️",
    label: "출퇴근 기록",
    desc: "hq_attendance (근태 마감 잠금 무시 개별 강제 삭제)",
  },
  {
    key: "contracts",
    group: "DB",
    icon: "📑",
    label: "전자계약서",
    desc: "hq_contract (서명·체결 완료 건 포함 개별 강제 삭제)",
  },
  {
    key: "payroll",
    group: "DB",
    icon: "💰",
    label: "급여 · 원천세 · 인세",
    desc: "hq_payroll (지급완료·확정 명세서 포함 개별 강제 삭제)",
  },
  {
    key: "publishing",
    group: "DB",
    icon: "📚",
    label: "출판 공정 도서",
    desc: "hq_publication (전 공정 단계 도서 카드 개별 삭제)",
  },
  {
    key: "members",
    group: "DB",
    icon: "👥",
    label: "본부 구성원 · 테스트 계정",
    desc: "hq_member_profile (+ 선택 시 instructor 및 Supabase Auth 로그인 계정까지 완전 삭제)",
  },
  {
    key: "chat_rooms",
    group: "DB",
    icon: "💬",
    label: "사내 메신저 대화방",
    desc: "internal_chat_room (소속 메시지·참여자 연쇄 삭제)",
  },
  {
    key: "chat_messages",
    group: "DB",
    icon: "🗨️",
    label: "사내 메신저 개별 메시지",
    desc: "internal_chat_message (개별 채팅 메시지 건별 삭제)",
  },
  {
    key: "notices",
    group: "KV",
    icon: "📢",
    label: "사내 공지글",
    desc: "HQ_NOTICES 원장 내 개별 공지사항 건별 삭제",
  },
  {
    key: "meetings",
    group: "KV",
    icon: "🗓️",
    label: "미팅 · 회의록",
    desc: "HQ_MEETINGS 원장 내 개별 미팅·회의록 건별 삭제",
  },
  {
    key: "leave_items",
    group: "KV",
    icon: "🏖️",
    label: "휴가 원장 세부 항목",
    desc: "LEAVES_LEDGER (연차조정 · 맞춤휴가부여 · 연차촉진 · 사용계획 · 월별업로드 개별 삭제)",
  },
  {
    key: "work_mgmt_items",
    group: "KV",
    icon: "🕒",
    label: "근무관리 원장 항목",
    desc: "WORK_MGMT_STATE (보상휴가부여 · 휴일대체 · 근태마감잠금 개별 삭제)",
  },
  {
    key: "realtime_work_logs",
    group: "KV",
    icon: "⚡",
    label: "실시간 근무 로그",
    desc: "HQ_REALTIME_WORK_LOGS 개별 키 삭제",
  },
  {
    key: "workflow_forms",
    group: "KV",
    icon: "📝",
    label: "워크플로우 양식",
    desc: "WORKFLOW_FORMS 저장 양식 개별 삭제",
  },
  {
    key: "contract_templates",
    group: "KV",
    icon: "📄",
    label: "전자계약 서식 · 커스텀필드",
    desc: "HQ_CONTRACT_TEMPLATES 내 서식 및 커스텀 토큰 개별 삭제",
  },
  {
    key: "year_end_tax",
    group: "KV",
    icon: "🧾",
    label: "연말정산 제출 내역",
    desc: "year_end_tax_* 연도별·구성원별 제출 데이터 개별 삭제",
  },
  {
    key: "audit_logs",
    group: "KV",
    icon: "🛡️",
    label: "보안 감사 로그",
    desc: "AUDIT_LOGS 개별 감사 기록 건별 삭제",
  },
  {
    key: "login_attempts",
    group: "KV",
    icon: "🔓",
    label: "로그인 실패 · 계정 잠금",
    desc: "LOGIN_ATTEMPTS 계정별 잠금·실패 카운트 개별 초기화",
  },
];

export default function HqDevToolsPage() {
  const router = useRouter();
  const hqHref = useHqHref();
  const {
    isDevSuperAdmin,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
    refreshContractBadge,
    refreshChatUnread,
  } = useHqShell();

  const [activeDomain, setActiveDomain] = useState<DevToolDomainKey>("approvals");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [items, setItems] = useState<DevToolRecordItem[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [keyword, setKeyword] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [memberDeleteMode, setMemberDeleteMode] = useState<
    "HQ_ONLY" | "FULL_ACCOUNT"
  >("HQ_ONLY");

  const activeMeta = useMemo(
    () => DOMAIN_LIST.find((d) => d.key === activeDomain) || DOMAIN_LIST[0],
    [activeDomain]
  );

  const loadSummaryCounts = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { counts: Record<string, number> };
      }>("/api/hq/dev-tools?mode=summary");
      if (res.success && res.data?.counts) {
        setCounts(res.data.counts);
      }
    } catch {
      // ignore summary count errors
    }
  }, []);

  const loadDomainItems = useCallback(async (domain: DevToolDomainKey) => {
    setLoading(true);
    setErrorMsg("");
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          domain: DevToolDomainKey;
          meId: string;
          items: DevToolRecordItem[];
        };
      }>(`/api/hq/dev-tools?domain=${domain}`);
      if (res.success && res.data) {
        setItems(res.data.items || []);
        setMeId(res.data.meId || "");
        setCounts((prev) => ({
          ...prev,
          [domain]: (res.data.items || []).length,
        }));
      }
    } catch (err: any) {
      setErrorMsg(String(err?.message || "데이터 조회 중 오류가 발생했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isDevSuperAdmin) return;
    loadSummaryCounts();
  }, [isDevSuperAdmin, loadSummaryCounts]);

  useEffect(() => {
    if (!isDevSuperAdmin) return;
    loadDomainItems(activeDomain);
  }, [isDevSuperAdmin, activeDomain, loadDomainItems]);

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      if (item.id.toLowerCase().includes(q)) return true;
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.subtitle.toLowerCase().includes(q)) return true;
      if ((item.badge || "").toLowerCase().includes(q)) return true;
      try {
        return JSON.stringify(item.raw).toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  }, [items, keyword]);

  const selectableFilteredIds = useMemo(
    () =>
      filteredItems
        .filter((item) => !(activeDomain === "members" && item.id === meId))
        .map((item) => item.id),
    [filteredItems, activeDomain, meId]
  );

  const allSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      selectableFilteredIds.forEach((id) => next.delete(id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      selectableFilteredIds.forEach((id) => next.add(id));
      setSelectedIds(next);
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleExpandJson = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const syncShellAfterDelete = async (domain: DevToolDomainKey) => {
    if (domain === "members") await refreshMembers();
    if (domain === "approvals") await refreshApprovalBadge();
    if (domain === "attendance") await refreshAttendanceState();
    if (domain === "contracts") await refreshContractBadge();
    if (domain === "chat_rooms" || domain === "chat_messages") {
      await refreshChatUnread();
    }
  };

  const executeDelete = async (targetIds: string[]) => {
    if (targetIds.length === 0 || deleting) return;

    const scopeWarning =
      activeDomain === "members"
        ? memberDeleteMode === "FULL_ACCOUNT"
          ? "\n\n⚠️ [완전 삭제 모드] 선택됨: HQ 데이터뿐만 아니라 instructor 테이블 및 Supabase Auth 로그인 계정까지 영구 삭제됩니다!"
          : "\n\nℹ️ [HQ 데이터만 삭제 모드]: HQ 프로필 및 연관된 결재·경비·출퇴근 기록만 정리하며, 학원 강사(instructor) 원본 계정은 유지됩니다."
        : "";

    const ok = window.confirm(
      `[${activeMeta.label}] 항목 ${targetIds.length}건을 영구 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.${scopeWarning}`
    );
    if (!ok) return;

    setDeleting(true);
    setErrorMsg("");
    try {
      await hqFetch("/api/hq/dev-tools", {
        method: "POST",
        body: {
          action: "DELETE_ITEMS",
          domain: activeDomain,
          ids: targetIds,
          memberDeleteMode,
        },
      });
      await Promise.all([
        loadDomainItems(activeDomain),
        loadSummaryCounts(),
        syncShellAfterDelete(activeDomain),
      ]);
    } catch (err: any) {
      setErrorMsg(String(err?.message || "삭제 처리 중 오류가 발생했습니다."));
    } finally {
      setDeleting(false);
    }
  };

  if (!isDevSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-white rounded-2xl border border-rose-200 p-8 max-w-md shadow-xs space-y-3">
          <div className="text-3xl">🛠️</div>
          <h3 className="text-base font-extrabold text-slate-900">
            개발자 수퍼어드민(Lv.6) 전용 도구입니다
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            이 콘솔은 직급 코드가 <b>SUPER_ADMIN (Lv.6)</b>으로 지정된 개발자 계정에서만 접근할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => router.push(hqHref("/hq"))}
            className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold"
          >
            본부 홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const dbDomains = DOMAIN_LIST.filter((d) => d.group === "DB");
  const kvDomains = DOMAIN_LIST.filter((d) => d.group === "KV");

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 h-full overflow-hidden bg-[#F5F7FA]">
      {/* 좌측 도메인 네비게이션 */}
      <aside className="w-full lg:w-[272px] bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 max-h-[260px] lg:max-h-none overflow-y-auto custom-scroll">
        <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-indigo-50">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold">
              Lv.6 DEV
            </span>
            <h2 className="text-sm font-extrabold text-slate-900">
              통합 데이터 강제 삭제 콘솔
            </h2>
          </div>
          <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
            승인·정산·서명 잠금 및 FK 참조를 자동 해제하고 개발용 테스트 데이터를 건별로 즉시 정리합니다.
          </p>
        </div>

        <div className="p-3 space-y-4">
          <div>
            <div className="px-2.5 mb-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
              PostgreSQL 테이블 (9종)
            </div>
            <div className="space-y-0.5">
              {dbDomains.map((d) => {
                const active = d.key === activeDomain;
                const cnt = counts[d.key];
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setActiveDomain(d.key)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      active
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span>{d.icon}</span>
                      <span className="truncate">{d.label}</span>
                    </span>
                    {cnt !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                          active
                            ? "bg-white/20 text-white"
                            : cnt > 0
                              ? "bg-slate-200 text-slate-700"
                              : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {cnt}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-2.5 mb-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
              KV 원장 · 시스템 JSON (10종)
            </div>
            <div className="space-y-0.5">
              {kvDomains.map((d) => {
                const active = d.key === activeDomain;
                const cnt = counts[d.key];
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setActiveDomain(d.key)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      active
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span>{d.icon}</span>
                      <span className="truncate">{d.label}</span>
                    </span>
                    {cnt !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                          active
                            ? "bg-white/20 text-white"
                            : cnt > 0
                              ? "bg-slate-200 text-slate-700"
                              : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {cnt}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* 우측 레코드 목록 및 삭제 제어 영역 */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden p-4 lg:p-6 gap-4">
        {/* 상단 헤더 & 컨트롤 바 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3 shrink-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">{activeMeta.icon}</span>
                <h3 className="text-base font-extrabold text-slate-900">
                  {activeMeta.label}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-extrabold">
                  총 {items.length}건
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{activeMeta.desc}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || deleting}
                onClick={() => {
                  loadDomainItems(activeDomain);
                  loadSummaryCounts();
                }}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 disabled:opacity-50"
              >
                🔄 새로고침
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => executeDelete(Array.from(selectedIds))}
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow-xs disabled:opacity-50"
                >
                  🗑️ 선택 항목 강제 삭제 ({selectedIds.size}건)
                </button>
              )}
            </div>
          </div>

          {/* 구성원(members) 도메인 전용 삭제 범위 선택 바 */}
          {activeDomain === "members" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="text-xs text-amber-900">
                <span className="font-extrabold">구성원 계정 삭제 범위 선택:</span>{" "}
                학원 강사 겸직 계정인 경우 기본 모드(HQ만 삭제)를 권장하며, 순수 테스트 계정은 Auth까지 완전 삭제할 수 있습니다.
              </div>
              <div className="flex items-center gap-1.5 shrink-0 bg-white p-1 rounded-xl border border-amber-200">
                <button
                  type="button"
                  onClick={() => setMemberDeleteMode("HQ_ONLY")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    memberDeleteMode === "HQ_ONLY"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  HQ 프로필·연관 기록만 삭제 (기본)
                </button>
                <button
                  type="button"
                  onClick={() => setMemberDeleteMode("FULL_ACCOUNT")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    memberDeleteMode === "FULL_ACCOUNT"
                      ? "bg-rose-600 text-white"
                      : "text-rose-700 hover:bg-rose-50"
                  }`}
                >
                  instructor + Auth 로그인 계정 완전 삭제
                </button>
              </div>
            </div>
          )}

          {/* 검색 및 전체선택 바 */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={selectableFilteredIds.length === 0}
                className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span>
                현재 목록 전체 선택 ({selectableFilteredIds.length}건)
              </span>
            </label>

            <div className="flex-1 min-w-[220px]">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="ID, 이름, 제목, 상태, 금액 또는 JSON 내부 텍스트 실시간 검색..."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800 outline-none focus:border-slate-400"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-bold text-rose-700">
              ⚠️ {errorMsg}
            </div>
          )}
        </div>

        {/* 데이터 리스트 */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-y-auto custom-scroll divide-y divide-slate-100">
          {loading ? (
            <div className="py-20 text-center text-xs font-bold text-slate-400">
              데이터를 불러오는 중입니다...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-20 text-center text-xs font-bold text-slate-400">
              {keyword.trim()
                ? "검색 조건과 일치하는 레코드가 없습니다."
                : "현재 저장된 데이터가 없습니다."}
            </div>
          ) : (
            filteredItems.map((item) => {
              const isProtectedSelf =
                activeDomain === "members" && item.id === meId;
              const checked = selectedIds.has(item.id);
              const expanded = expandedIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className={`p-3.5 transition-colors ${
                    checked ? "bg-rose-50/40" : "hover:bg-slate-50/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isProtectedSelf || deleting}
                        onChange={() => toggleSelectOne(item.id)}
                        className="mt-1 w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 shrink-0 disabled:opacity-40"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-extrabold text-slate-900 break-all">
                            {item.title}
                          </span>
                          {item.badge && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-700">
                              {item.badge}
                            </span>
                          )}
                          {isProtectedSelf && (
                            <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-extrabold">
                              현재 로그인 본인 (삭제 보호)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 break-all">
                          {item.subtitle}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-slate-400 font-mono">
                          <span>KEY: {item.id}</span>
                          {item.createdAt && (
                            <span>
                              TIMESTAMP: {String(item.createdAt).slice(0, 19).replace("T", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleExpandJson(item.id)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                      >
                        {expanded ? "JSON 닫기" : "JSON 원본"}
                      </button>
                      <button
                        type="button"
                        disabled={isProtectedSelf || deleting}
                        onClick={() => executeDelete([item.id])}
                        className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 text-[11px] font-extrabold text-rose-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        개별 삭제
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <pre className="mt-3 p-3 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto max-h-72 custom-scroll leading-relaxed">
                      {JSON.stringify(item.raw, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
