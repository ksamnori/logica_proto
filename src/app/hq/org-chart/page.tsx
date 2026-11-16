// src/app/hq/org-chart/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import { hqFetch } from "@/lib/hq/clientApi";
import { getRankLevel } from "@/lib/hq/constants";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import type { HqMember, HqOrgChartNode } from "@/lib/hq/types";

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

function avatarColor(name: string): string {
  if (name === "천종현") return "#8da2fb";
  if (name === "김근식") return "#2dd4bf";
  if (name === "이웅행") return "#fbbf24";
  const palette = ["#38bdf8", "#4ade80", "#fb923c", "#f87171", "#a78bfa"];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return palette[sum % palette.length];
}

type TrendMetricKey = "SALARY_SUM" | "RETENTION" | "AVG_OT" | "AVG_LEAVE";

export default function HqOrgChartPage() {
  const {
    instId,
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshMembers,
    refreshCompanySettings,
  } = useHqShell();

  const canManageOrg = isHrManager || isHqAdmin;
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // 상단 모드: 일반 조직도 | 조직도 관리 (스크린샷 203609 vs 203718)
  const [manageMode, setManageMode] = useState<boolean>(false);

  // 기준일 · 필터 · 검색 · 줌 상태
  const [asOfDate, setAsOfDate] = useState<string>(todayIso);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [includeOnLeave, setIncludeOnLeave] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoomPct, setZoomPct] = useState<number>(85);

  // 우측 플로팅 툴바 팝오버: 트렌드 | 조직뷰 | 조직설정
  const [openTool, setOpenTool] = useState<null | "TREND" | "VIEW">(null);
  const [direction, setDirection] = useState<"DOWN" | "RIGHT">("DOWN");
  const [countMode, setCountMode] = useState<"INCLUDE_SUB" | "DIRECT_ONLY">(
    "INCLUDE_SUB"
  );
  const [selectedTrends, setSelectedTrends] = useState<TrendMetricKey[]>([
    "SALARY_SUM",
    "RETENTION",
  ]);

  // 트리 접기/펼치기 상태
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<string[]>([]);

  // 선택된 부서 드로어 & 구성원 프로필 모달
  const [selectedDeptName, setSelectedDeptName] = useState<string | null>(null);
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);

  // 조직도 설정 모달 상태 (스크린샷 203740 동일)
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [nodesDraft, setNodesDraft] = useState<HqOrgChartNode[]>([]);
  const [effDateDraft, setEffDateDraft] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [memoInputOpen, setMemoInputOpen] = useState(false);
  const [orgModalSearch, setOrgModalSearch] = useState("");
  const [modalCollapsed, setModalCollapsed] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptParentId, setNewDeptParentId] = useState<string>("org-ceo");
  const [addingDeptRow, setAddingDeptRow] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);

  const orgNodes: HqOrgChartNode[] = useMemo(() => {
    const saved = companySettings?.extra_settings?.org_chart_nodes;
    return Array.isArray(saved) && saved.length > 0
      ? saved
      : DEFAULT_ORG_CHART_NODES;
  }, [companySettings?.extra_settings?.org_chart_nodes]);

  const visibleNodes = useMemo(
    () =>
      orgNodes
        .filter((n) => !n.is_hidden)
        .sort((a, b) => a.order - b.order),
    [orgNodes]
  );

  // 기준일 기준 재직 구성원 필터링
  const snapshotMembers = useMemo(() => {
    return members.filter((m) => {
      if (m.hire_date && m.hire_date > asOfDate) return false;
      if (m.work_status === "퇴직") {
        if (!m.resign_date || m.resign_date <= asOfDate) return false;
      }
      if (!includeOnLeave && m.work_status === "휴직") return false;
      return true;
    });
  }, [members, asOfDate, includeOnLeave]);

  // 부서별 소속 구성원 맵
  const membersByDept = useMemo(() => {
    const map = new Map<string, HqMember[]>();
    visibleNodes.forEach((n) => map.set(n.name, []));

    snapshotMembers.forEach((m) => {
      const dept =
        m.rank_code === "CEO"
          ? "대표"
          : (m.department || "미지정").trim();
      const bucket = map.get(dept) || [];
      bucket.push(m);
      map.set(dept, bucket);
    });

    return map;
  }, [visibleNodes, snapshotMembers]);

  // 최상위 루트 노드('대표' 또는 parent_id === null 인 첫 표시 노드) 및 하위 노드 계산
  const rootNode = useMemo(
    () =>
      visibleNodes.find((n) => n.parent_id === null && n.name === "대표") ||
      visibleNodes.find((n) => n.parent_id === null) || {
        id: "org-ceo",
        name: "대표",
        parent_id: null,
        order: 1,
      },
    [visibleNodes]
  );

  const childNodes = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    return visibleNodes.filter((n) => {
      if (n.id === rootNode.id) return false;
      if (!kw) return true;
      const deptMems = membersByDept.get(n.name) || [];
      return (
        n.name.toLowerCase().includes(kw) ||
        deptMems.some((m) => m.name.toLowerCase().includes(kw))
      );
    });
  }, [visibleNodes, rootNode.id, searchQuery, membersByDept]);

  // 노드별 트렌드 수치 계산 헬퍼 (계약월급 총합 · 유지율 · 평균 초과근무 · 평균 휴가사용)
  const calcNodeMetrics = (deptName: string, includeSub: boolean) => {
    const targetMembers = includeSub
      ? snapshotMembers
      : membersByDept.get(deptName) || [];

    const allHistoricalInScope = includeSub
      ? members
      : members.filter((m) =>
          deptName === "대표"
            ? m.rank_code === "CEO"
            : (m.department || "").trim() === deptName
        );

    const salarySum = targetMembers.reduce((acc, m) => {
      const wc = m.profile_extra?.wage_contract;
      const monthly =
        Number(wc?.monthly_base || 0) ||
        (wc?.annual_salary ? Math.round(Number(wc.annual_salary) / 12) : 0);
      return acc + monthly;
    }, 0);

    const activeCnt = targetMembers.length;
    const totalEver = Math.max(activeCnt, allHistoricalInScope.length);
    const retentionPct =
      totalEver > 0 ? Math.round((activeCnt / totalEver) * 100) : null;

    const avgLeaveUsed =
      activeCnt > 0
        ? (
            targetMembers.reduce(
              (acc, m) => acc + Number(m.annual_leave_used || 0),
              0
            ) / activeCnt
          ).toFixed(1)
        : null;

    return {
      directCount: (membersByDept.get(deptName) || []).length,
      totalCount: activeCnt,
      salarySum,
      retentionPct,
      avgLeaveUsed,
    };
  };

  const rootLeader = useMemo(
    () =>
      snapshotMembers.find((m) => m.rank_code === "CEO") ||
      snapshotMembers.find((m) => getRankLevel(m.rank_code) >= 4) ||
      null,
    [snapshotMembers]
  );

  const rootMetrics = calcNodeMetrics(rootNode.name, true);
  const isRootCollapsed = collapsedNodeIds.includes(rootNode.id);

  const toggleTrendMetric = (key: TrendMetricKey) => {
    setSelectedTrends((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const openOrgSettingModal = () => {
    setOpenTool(null);
    setNodesDraft(JSON.parse(JSON.stringify(orgNodes)));
    setEffDateDraft(
      companySettings?.extra_settings?.org_chart_effective_date || todayIso
    );
    setMemoDraft(companySettings?.extra_settings?.org_chart_memo || "");
    setMemoInputOpen(false);
    setAddingDeptRow(false);
    setNewDeptName("");
    setOrgModalSearch("");
    setOrgModalOpen(true);
  };

  const handleSaveOrgModal = async () => {
    setSavingOrg(true);
    try {
      await hqFetch("/api/hq/settings", {
        method: "PATCH",
        body: {
          extra_settings: {
            ...companySettings.extra_settings,
            org_chart_nodes: nodesDraft,
            org_chart_effective_date: effDateDraft,
            org_chart_memo: memoDraft,
          },
        },
      });
      await refreshCompanySettings();
      setOrgModalOpen(false);
    } catch (err: any) {
      alert(err?.message || "조직도 설정 저장 실패");
    } finally {
      setSavingOrg(false);
    }
  };

  const renderTrendPills = (metrics: ReturnType<typeof calcNodeMetrics>) => {
    if (!manageMode || selectedTrends.length === 0) return null;
    return (
      <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col items-start gap-1.5">
        {selectedTrends.includes("SALARY_SUM") && (
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            계약월급 총합{" "}
            <b className="text-slate-800">
              {metrics.salarySum > 0
                ? `${metrics.salarySum.toLocaleString()}원`
                : "-"}
            </b>
          </span>
        )}
        {selectedTrends.includes("RETENTION") && (
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            구성원 유지율{" "}
            <b className="text-slate-800">
              {metrics.totalCount > 0 && metrics.retentionPct !== null
                ? `${metrics.retentionPct}%`
                : "-"}
            </b>
          </span>
        )}
        {selectedTrends.includes("AVG_OT") && (
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            평균 초과 근무 <b className="text-slate-800">0시간</b>
          </span>
        )}
        {selectedTrends.includes("AVG_LEAVE") && (
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            평균 휴가 사용{" "}
            <b className="text-slate-800">
              {metrics.avgLeaveUsed ? `${metrics.avgLeaveUsed}일` : "-"}
            </b>
          </span>
        )}
      </div>
    );
  };

  const existingDepartments = useMemo(
    () =>
      Array.from(
        new Set(members.map((m) => m.department).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, "ko")),
    [members]
  );

  const activeProfileMember = useMemo(
    () => members.find((m) => m.instructor_id === profileTargetId) || null,
    [members, profileTargetId]
  );

  const drawerMembers = useMemo(() => {
    if (!selectedDeptName) return [];
    if (selectedDeptName === rootNode.name) {
      return countMode === "INCLUDE_SUB"
        ? snapshotMembers
        : membersByDept.get(rootNode.name) || [];
    }
    return membersByDept.get(selectedDeptName) || [];
  }, [
    selectedDeptName,
    rootNode.name,
    countMode,
    snapshotMembers,
    membersByDept,
  ]);

  return (
    <>
      <div
        onClick={() => {
          if (openTool) setOpenTool(null);
          if (datePickerOpen) setDatePickerOpen(false);
          if (filterOpen) setFilterOpen(false);
        }}
        className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden relative"
      >
        {/* 상단 타이틀 바 (조직도 | 조직도 관리 — 스크린샷 203609, 203718 동일) */}
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white z-10">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setManageMode(false)}
              className={`text-[22px] font-extrabold tracking-tight transition-colors ${
                !manageMode
                  ? "text-slate-900"
                  : "text-slate-300 hover:text-slate-500"
              }`}
            >
              조직도
            </button>

            {canManageOrg && (
              <button
                type="button"
                onClick={() => setManageMode(true)}
                className={`text-[22px] font-extrabold tracking-tight transition-colors ${
                  manageMode
                    ? "text-slate-900"
                    : "text-slate-300 hover:text-slate-500"
                }`}
              >
                조직도 관리
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {searchOpen && (
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="조직명 또는 구성원 이름 검색"
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-[#00c458]"
              />
            )}
            <button
              type="button"
              onClick={() => {
                setSearchOpen((p) => !p);
                if (searchOpen) setSearchQuery("");
              }}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
              title="조직·구성원 검색"
            >
              🔍
            </button>
            {canManageOrg && (
              <button
                type="button"
                onClick={openOrgSettingModal}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center font-extrabold"
                title="조직도 구조 편집"
              >
                ⋯
              </button>
            )}
          </div>
        </div>

        {/* =============================================================== */}
        {/* 도트 그리드 인터랙티브 조직도 캔버스                              */}
        {/* =============================================================== */}
        <div
          style={{
            backgroundImage: "radial-gradient(#d8dee6 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
          className="flex-1 relative overflow-auto custom-scroll bg-[#fafbfc]"
        >
          {/* 좌상단 플로팅 기준일 · 필터 필 (203718 동일) */}
          <div
            className="sticky top-5 left-6 z-20 inline-flex items-center gap-2 ml-6 mt-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => setDatePickerOpen((p) => !p)}
                className="px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-2xs hover:border-slate-300 text-xs text-slate-600 flex items-center gap-1.5"
              >
                <span>📅 기준일</span>
                <b className="text-slate-900">
                  {asOfDate === todayIso ? "오늘" : asOfDate}
                </b>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {datePickerOpen && (
                <div className="absolute left-0 top-full mt-1.5 p-3 bg-white rounded-2xl shadow-xl border border-slate-200 z-30 space-y-2 text-xs">
                  <div className="font-bold text-slate-700">
                    시점 기준 조직도 조회
                  </div>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => {
                      setAsOfDate(e.target.value || todayIso);
                      setDatePickerOpen(false);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAsOfDate(todayIso);
                      setDatePickerOpen(false);
                    }}
                    className="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
                  >
                    오늘 기준으로 복원
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((p) => !p)}
                className="px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-2xs hover:border-slate-300 text-xs font-semibold text-slate-600 flex items-center gap-1"
              >
                <span>+ 필터 추가</span>
              </button>

              {filterOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-[180px] p-3 bg-white rounded-2xl shadow-xl border border-slate-200 z-30 text-xs space-y-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="font-semibold text-slate-700">
                      휴직자 포함 표시
                    </span>
                    <input
                      type="checkbox"
                      checked={includeOnLeave}
                      onChange={(e) => setIncludeOnLeave(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* 트리 본문 (줌 스케일 적용) */}
          <div className="min-w-max px-12 py-14 flex justify-center">
            <div
              style={{
                transform: `scale(${zoomPct / 100})`,
                transformOrigin: "top center",
              }}
              className={`transition-transform duration-150 ${
                direction === "DOWN"
                  ? "flex flex-col items-center"
                  : "flex items-start gap-12"
              }`}
            >
              {/* 최상위 대표 노드 카드 */}
              <div className="flex flex-col items-center">
                <div
                  onClick={() => setSelectedDeptName(rootNode.name)}
                  className="w-[235px] rounded-2xl bg-white border border-slate-200 hover:border-blue-400 shadow-sm p-4 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-extrabold text-slate-900">
                      {rootNode.name}
                    </span>
                    <span className="text-slate-300 text-xs font-bold">⋯</span>
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <span>
                      👤{" "}
                      <b className="text-slate-700">
                        {countMode === "INCLUDE_SUB"
                          ? rootMetrics.totalCount
                          : rootMetrics.directCount}
                      </b>
                    </span>

                    {rootLeader && (
                      <span className="inline-flex items-center gap-1 text-slate-700 font-semibold">
                        <span
                          style={{
                            backgroundColor: avatarColor(rootLeader.name),
                          }}
                          className="w-4 h-4 rounded text-white text-[8px] font-extrabold flex items-center justify-center"
                        >
                          {shortAvatarText(rootLeader.name)}
                        </span>
                        <span>{rootLeader.name}</span>
                        <span className="text-amber-500 text-[11px]">✪</span>
                      </span>
                    )}
                  </div>

                  {renderTrendPills(rootMetrics)}
                </div>

                {/* 하위 조직 접기/펼치기 초록 배지 (5 - / 5 +) */}
                {childNodes.length > 0 && direction === "DOWN" && (
                  <div className="flex flex-col items-center">
                    <div className="w-px h-3 bg-slate-300" />
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedNodeIds((prev) =>
                          isRootCollapsed
                            ? prev.filter((x) => x !== rootNode.id)
                            : [...prev, rootNode.id]
                        )
                      }
                      className="px-2.5 py-0.5 rounded-full bg-[#00c458] hover:bg-[#00b04f] text-white text-[10px] font-extrabold shadow-xs"
                    >
                      {childNodes.length} {isRootCollapsed ? "+" : "-"}
                    </button>
                    {!isRootCollapsed && (
                      <div className="w-px h-5 bg-slate-400" />
                    )}
                  </div>
                )}
              </div>

              {/* 하위 부서 노드들 */}
              {!isRootCollapsed && childNodes.length > 0 && (
                <div
                  className={
                    direction === "DOWN"
                      ? "flex items-start gap-5 relative pt-5 border-t border-slate-400"
                      : "flex flex-col gap-4 pl-6 border-l border-slate-400"
                  }
                >
                  {childNodes.map((node) => {
                    const deptMems = membersByDept.get(node.name) || [];
                    const head =
                      deptMems.find((m) => m.is_dept_head) || null;
                    const m = calcNodeMetrics(node.name, false);

                    return (
                      <div
                        key={node.id}
                        onClick={() => setSelectedDeptName(node.name)}
                        className="w-[215px] rounded-2xl bg-white border border-slate-200 hover:border-blue-400 shadow-2xs p-4 cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-extrabold text-slate-900">
                            {node.name}
                          </span>
                          <span className="text-[11px] text-slate-300">›</span>
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                          <span>
                            👤 <b className="text-slate-700">{m.directCount}</b>
                          </span>

                          {head && (
                            <span className="inline-flex items-center gap-1 text-slate-700 font-semibold truncate">
                              <span
                                style={{
                                  backgroundColor: avatarColor(head.name),
                                }}
                                className="w-4 h-4 rounded text-white text-[8px] font-extrabold flex items-center justify-center shrink-0"
                              >
                                {shortAvatarText(head.name)}
                              </span>
                              <span className="truncate">{head.name}</span>
                            </span>
                          )}
                        </div>

                        {renderTrendPills(m)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 우측 플로팅 도구 버튼 (트렌드 · 조직뷰 · 조직설정 — 203718, 203728, 203752 동일) */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed right-6 top-36 z-20 flex flex-col gap-2"
          >
            {canManageOrg && manageMode && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenTool(openTool === "TREND" ? null : "TREND")
                  }
                  className={`w-13 py-2.5 rounded-2xl border shadow-sm flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
                    openTool === "TREND" || selectedTrends.length > 0
                      ? "bg-white border-blue-300 text-blue-600"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-sm">📊</span>
                  <span>트렌드</span>
                </button>

                {/* 트렌드 지표 팝오버 (스크린샷 203752 동일) */}
                {openTool === "TREND" && (
                  <div className="absolute right-full mr-2.5 top-0 w-[195px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5 text-xs space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                      <span>트렌드 지표</span>
                      <span>ⓘ</span>
                    </div>
                    {(
                      [
                        {
                          key: "SALARY_SUM" as const,
                          icon: "💵",
                          label: "계약월급 총합",
                        },
                        {
                          key: "RETENTION" as const,
                          icon: "🧩",
                          label: "구성원 유지율",
                        },
                        {
                          key: "AVG_OT" as const,
                          icon: "🔥",
                          label: "평균 초과 근무",
                        },
                        {
                          key: "AVG_LEAVE" as const,
                          icon: "🏖️",
                          label: "평균 휴가 사용",
                        },
                      ] as const
                    ).map((tr) => {
                      const active = selectedTrends.includes(tr.key);
                      return (
                        <button
                          key={tr.key}
                          type="button"
                          onClick={() => toggleTrendMetric(tr.key)}
                          className="w-full py-1.5 px-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-left"
                        >
                          <span className="flex items-center gap-2 font-semibold text-slate-800">
                            <span>{tr.icon}</span>
                            <span>{tr.label}</span>
                          </span>
                          {active && (
                            <span className="text-[#00c458] font-bold">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 조직뷰 버튼 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenTool(openTool === "VIEW" ? null : "VIEW")}
                className={`w-13 py-2.5 rounded-2xl bg-white border shadow-sm flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
                  openTool === "VIEW"
                    ? "border-blue-400 text-blue-600"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="text-sm">品</span>
                <span>조직뷰</span>
              </button>

              {/* 조직뷰 팝오버 (스크린샷 203728 동일) */}
              {openTool === "VIEW" && (
                <div className="absolute right-full mr-2.5 top-0 w-[210px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 text-xs space-y-4">
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 mb-2">
                      정렬 방식
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDirection("DOWN")}
                        className={`py-2.5 rounded-xl border flex flex-col items-center gap-1 font-bold ${
                          direction === "DOWN"
                            ? "border-blue-500 bg-blue-50/50 text-blue-600"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        <span>品</span>
                        <span className="text-[11px]">아래로</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirection("RIGHT")}
                        className={`py-2.5 rounded-xl border flex flex-col items-center gap-1 font-bold ${
                          direction === "RIGHT"
                            ? "border-blue-500 bg-blue-50/50 text-blue-600"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        <span>◫</span>
                        <span className="text-[11px]">옆으로</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-bold text-slate-400 mb-1.5">
                      구성원 숫자 표기
                    </div>
                    <button
                      type="button"
                      onClick={() => setCountMode("INCLUDE_SUB")}
                      className="w-full py-1.5 flex items-center justify-between font-bold text-slate-800"
                    >
                      <span>하위 조직 포함</span>
                      {countMode === "INCLUDE_SUB" && (
                        <span className="text-[#00c458]">✓</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountMode("DIRECT_ONLY")}
                      className="w-full py-1.5 flex items-center justify-between font-bold text-slate-800"
                    >
                      <span>직속 조직만</span>
                      {countMode === "DIRECT_ONLY" && (
                        <span className="text-[#00c458]">✓</span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 조직설정 버튼 */}
            {canManageOrg && (
              <button
                type="button"
                onClick={openOrgSettingModal}
                className="w-13 py-2.5 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 shadow-sm flex flex-col items-center gap-1 text-[10px] font-extrabold text-slate-600"
              >
                <span className="text-sm">⚙️</span>
                <span>조직설정</span>
              </button>
            )}
          </div>

          {/* 우하단 줌 컨트롤 바 (203609, 203718 동일) */}
          <div className="fixed right-6 bottom-6 z-20 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoomPct(70)}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-xs text-slate-500 hover:text-slate-800 text-xs font-bold"
              title="한눈에 맞춤"
            >
              ⤡
            </button>
            <button
              type="button"
              onClick={() => setZoomPct(100)}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-xs text-slate-500 hover:text-slate-800 text-xs font-bold"
              title="100% 원본 크기"
            >
              ⛶
            </button>
            <div className="h-8 px-2 rounded-lg bg-white border border-slate-200 shadow-xs flex items-center gap-2 text-xs font-bold text-slate-700">
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.max(50, z - 10))}
                className="px-1 text-slate-400 hover:text-slate-800"
              >
                −
              </button>
              <span className="w-10 text-center">{zoomPct}%</span>
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.min(140, z + 10))}
                className="px-1 text-slate-400 hover:text-slate-800"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* 부서 카드 클릭 시 우측 소속 구성원 드로어 */}
        {selectedDeptName && (
          <div className="absolute inset-y-0 right-0 w-[330px] bg-white border-l border-slate-200 shadow-2xl z-30 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  🏢 {selectedDeptName}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  소속 구성원 {drawerMembers.length}명
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDeptName(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-2">
              {drawerMembers.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  현재 배정된 구성원이 없습니다.
                </div>
              ) : (
                drawerMembers.map((m) => (
                  <div
                    key={m.instructor_id}
                    onClick={() => setProfileTargetId(m.instructor_id)}
                    className="p-3 rounded-xl border border-slate-200/80 hover:border-blue-400 flex items-center justify-between gap-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        style={{ backgroundColor: avatarColor(m.name) }}
                        className="w-8 h-8 rounded-xl text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                      >
                        {shortAvatarText(m.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1">
                          <span>{m.name}</span>
                          {m.rank_code === "CEO" && (
                            <span className="text-amber-500 text-[11px]">
                              ✪
                            </span>
                          )}
                          {m.is_dept_head && m.rank_code !== "CEO" && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[9px] font-bold">
                              조직장
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {m.department} · {m.job_title}
                        </div>
                      </div>
                    </div>
                    <span className="text-slate-300 text-xs">›</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* 모달: 조직도 설정 (스크린샷 203740 동일)                           */}
      {/* ================================================================= */}
      {orgModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            <div className="px-7 pt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOrgModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-600 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="px-7 pb-4">
              <h3 className="text-xl font-extrabold text-slate-900">
                조직도 설정
              </h3>
              <div className="mt-3 flex items-center gap-2">
                <label className="px-2.5 py-1 rounded-lg border border-blue-400 bg-blue-50/50 text-blue-700 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer">
                  <span>적용일</span>
                  <input
                    type="date"
                    value={effDateDraft}
                    onChange={(e) => setEffDateDraft(e.target.value)}
                    className="bg-transparent font-bold focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setMemoInputOpen((p) => !p)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold"
                >
                  메모
                </button>
              </div>

              {memoInputOpen && (
                <input
                  value={memoDraft}
                  onChange={(e) => setMemoDraft(e.target.value)}
                  placeholder="조직 개편 사유·메모를 입력하세요"
                  className="w-full mt-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none"
                />
              )}
            </div>

            {/* 툴바: 검색 · + 조직 추가 · 모두 접기 */}
            <div className="px-7 py-2 border-y border-slate-100 flex items-center justify-between gap-2">
              <input
                value={orgModalSearch}
                onChange={(e) => setOrgModalSearch(e.target.value)}
                placeholder="🔍 조직명 검색"
                className="flex-1 py-1 text-xs focus:outline-none"
              />
              <div className="flex items-center gap-2.5 text-slate-500">
                <button
                  type="button"
                  onClick={() => setAddingDeptRow((p) => !p)}
                  className="px-2 py-1 rounded hover:bg-slate-100 font-extrabold text-sm leading-none text-slate-700"
                  title="새 부서/조직 추가"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setModalCollapsed((p) => !p)}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  {modalCollapsed ? "모두 펼치기" : "모두 접기"}
                </button>
              </div>
            </div>

            {addingDeptRow && (
              <div className="px-7 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                <select
                  value={newDeptParentId}
                  onChange={(e) => setNewDeptParentId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold"
                >
                  <option value="org-ceo">상위: 대표</option>
                  <option value="ROOT">최상위 조직</option>
                </select>
                <input
                  autoFocus
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="새 조직(부서)명"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newDeptName.trim();
                    if (!clean) return;
                    setNodesDraft([
                      ...nodesDraft,
                      {
                        id: `org-${Date.now()}`,
                        name: clean,
                        parent_id:
                          newDeptParentId === "ROOT" ? null : newDeptParentId,
                        is_hidden: false,
                        order: nodesDraft.length + 1,
                      },
                    ]);
                    setNewDeptName("");
                    setAddingDeptRow(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#00c458] text-white font-extrabold"
                >
                  추가
                </button>
              </div>
            )}

            {/* 조직 트리 리스트 */}
            <div className="flex-1 overflow-y-auto custom-scroll px-7 py-4 space-y-1">
              {nodesDraft
                .filter((n) => !n.is_hidden)
                .filter(
                  (n) =>
                    !orgModalSearch.trim() ||
                    n.name.includes(orgModalSearch.trim())
                )
                .sort((a, b) => a.order - b.order)
                .map((node) => {
                  const isChild = node.parent_id !== null;
                  if (modalCollapsed && isChild) return null;
                  const cnt = (membersByDept.get(node.name) || []).length;

                  return (
                    <div
                      key={node.id}
                      className={`py-2.5 border-b border-slate-50 flex items-center justify-between group ${
                        isChild ? "pl-6" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-[10px]">
                          {isChild ? "•" : "▾"}
                        </span>
                        <span className="font-bold text-slate-800">
                          {node.name}
                        </span>
                        {cnt > 0 && (
                          <span className="text-[11px] font-bold text-slate-300">
                            {cnt}
                          </span>
                        )}
                      </div>

                      {isChild && (
                        <button
                          type="button"
                          onClick={() =>
                            setNodesDraft(
                              nodesDraft.filter((x) => x.id !== node.id)
                            )
                          }
                          className="opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 hover:text-rose-500 font-bold"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="p-6 border-t border-slate-100 shrink-0">
              <button
                type="button"
                disabled={savingOrg}
                onClick={handleSaveOrgModal}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-sm disabled:opacity-50"
              >
                {savingOrg ? "저장 중..." : "저장하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 구성원 프로필 모달 */}
      <HqMemberProfileModal
        isOpen={Boolean(activeProfileMember)}
        member={activeProfileMember}
        meId={instId}
        isHrManager={isHrManager}
        existingDepartments={existingDepartments}
        onClose={() => setProfileTargetId(null)}
        onSaved={refreshMembers}
      />
    </>
  );
}
