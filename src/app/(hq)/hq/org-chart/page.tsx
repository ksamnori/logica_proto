// src/app/hq/org-chart/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import HqOrgChartSettingsModal from "@/components/hq/org-chart/HqOrgChartSettingsModal";
import { hqFetch } from "@/lib/hq/clientApi";
import { getRankLevel } from "@/lib/hq/constants";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import { getRegisteredOrgNames } from "@/lib/hq/orgTreeHelper";
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

  const [manageMode, setManageMode] = useState<boolean>(false);
  const [asOfDate, setAsOfDate] = useState<string>(todayIso);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [includeOnLeave, setIncludeOnLeave] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoomPct, setZoomPct] = useState<number>(85);

  const [openTool, setOpenTool] = useState<null | "TREND" | "VIEW">(null);
  const [direction, setDirection] = useState<"DOWN" | "RIGHT">("DOWN");
  const [countMode, setCountMode] = useState<"INCLUDE_SUB" | "DIRECT_ONLY">(
    "INCLUDE_SUB"
  );
  const [selectedTrends, setSelectedTrends] = useState<TrendMetricKey[]>([
    "SALARY_SUM",
    "RETENTION",
  ]);

  const [collapsedNodeIds, setCollapsedNodeIds] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);

  const [orgModalOpen, setOrgModalOpen] = useState(false);
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

  const isRetiredNodeVisible = useMemo(
    () =>
      visibleNodes.some(
        (n) => n.name === "퇴직" || n.id === "org-retired"
      ),
    [visibleNodes]
  );

  // 부모-자식 트리 맵 구성 (다단계 하위 조직 완벽 지원)
  const childrenByParent = useMemo(() => {
    const validIds = new Set(visibleNodes.map((n) => n.id));
    const map = new Map<string | null, HqOrgChartNode[]>();
    visibleNodes.forEach((n) => {
      const pid = n.parent_id && validIds.has(n.parent_id) ? n.parent_id : null;
      map.set(pid, [...(map.get(pid) || []), n]);
    });
    return map;
  }, [visibleNodes]);

  const rootNodes = useMemo(() => {
    const roots = childrenByParent.get(null) || [];
    return roots.length > 0
      ? roots
      : [
          {
            id: "org-ceo",
            name: "대표",
            parent_id: null,
            order: 1,
          },
        ];
  }, [childrenByParent]);

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

  // 각 조직별 직속 구성원 (주조직 + 겸직 배정 포함)
  const directMembersByDept = useMemo(() => {
    const map = new Map<string, HqMember[]>();
    visibleNodes.forEach((n) => map.set(n.name, []));

    snapshotMembers.forEach((m) => {
      const primaryDept =
        m.rank_code === "CEO" && !m.department
          ? "대표"
          : (m.department || "").trim();

      const assignedNames = new Set<string>();
      if (primaryDept) assignedNames.add(primaryDept);
      if (m.rank_code === "CEO") assignedNames.add("대표");

      (m.profile_extra?.org_assignments || []).forEach((asg) => {
        if (asg.org_name) assignedNames.add(asg.org_name.trim());
      });

      assignedNames.forEach((deptName) => {
        const bucket = map.get(deptName) || [];
        if (!bucket.some((x) => x.instructor_id === m.instructor_id)) {
          bucket.push(m);
          map.set(deptName, bucket);
        }
      });
    });

    if (isRetiredNodeVisible) {
      const retiredBucket: HqMember[] = [];
      members.forEach((m) => {
        if (m.work_status === "퇴직") {
          retiredBucket.push(m);
        }
      });
      map.set("퇴직", retiredBucket);
    }

    return map;
  }, [visibleNodes, snapshotMembers, isRetiredNodeVisible, members]);

  // 특정 노드와 모든 하위 조직에 속한 중복 없는 구성원 목록
  const collectSubtreeMembers = (node: HqOrgChartNode): HqMember[] => {
    const uniq = new Map<string, HqMember>();
    const walk = (cur: HqOrgChartNode) => {
      (directMembersByDept.get(cur.name) || []).forEach((m) => {
        uniq.set(m.instructor_id, m);
      });
      (childrenByParent.get(cur.id) || []).forEach(walk);
    };
    walk(node);
    return Array.from(uniq.values());
  };

  const findNodeLeader = (node: HqOrgChartNode): HqMember | null => {
    const direct = directMembersByDept.get(node.name) || [];
    if (node.name === "대표") {
      return (
        direct.find((m) => m.rank_code === "CEO") ||
        snapshotMembers.find((m) => m.rank_code === "CEO") ||
        snapshotMembers.find((m) => getRankLevel(m.rank_code) >= 4) ||
        null
      );
    }
    // org_assignments에서 해당 조직의 조직장(is_leader)으로 체크된 구성원 우선
    const explicitLeader = direct.find((m) =>
      (m.profile_extra?.org_assignments || []).some(
        (a) => a.org_name === node.name && a.is_leader
      )
    );
    if (explicitLeader) return explicitLeader;
    return (
      direct.find((m) => m.is_dept_head && m.department === node.name) || null
    );
  };

  const calcNodeMetrics = (node: HqOrgChartNode, includeSub: boolean) => {
    const directList = directMembersByDept.get(node.name) || [];
    const targetMembers = includeSub ? collectSubtreeMembers(node) : directList;

    const salarySum = targetMembers.reduce((acc, m) => {
      const wc = m.profile_extra?.wage_contract;
      const monthly =
        Number(wc?.monthly_base || 0) ||
        (wc?.annual_salary ? Math.round(Number(wc.annual_salary) / 12) : 0);
      return acc + monthly;
    }, 0);

    const activeCnt = targetMembers.length;
    const allEverCnt = Math.max(
      activeCnt,
      members.filter((m) =>
        includeSub ? true : (m.department || "").trim() === node.name
      ).length
    );
    const retentionPct =
      allEverCnt > 0 ? Math.round((activeCnt / allEverCnt) * 100) : null;

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
      directCount: directList.length,
      totalCount: collectSubtreeMembers(node).length,
      salarySum,
      retentionPct,
      avgLeaveUsed,
    };
  };

  const subtreeMatchesQuery = (node: HqOrgChartNode, kw: string): boolean => {
    if (!kw) return true;
    if (node.name.toLowerCase().includes(kw)) return true;
    const direct = directMembersByDept.get(node.name) || [];
    if (direct.some((m) => m.name.toLowerCase().includes(kw))) return true;
    return (childrenByParent.get(node.id) || []).some((ch) =>
      subtreeMatchesQuery(ch, kw)
    );
  };

  const toggleTrendMetric = (key: TrendMetricKey) => {
    setSelectedTrends((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const handleSaveOrgSettings = async (payload: {
    nodes: HqOrgChartNode[];
    effectiveDate: string;
    memo: string;
    renameMap: Record<string, string>;
  }) => {
    setSavingOrg(true);
    try {
      await hqFetch("/api/hq/settings", {
        method: "PATCH",
        body: {
          extra_settings: {
            ...companySettings.extra_settings,
            org_chart_nodes: payload.nodes,
            org_chart_effective_date: payload.effectiveDate,
            org_chart_memo: payload.memo,
          },
          org_rename_map: payload.renameMap,
        },
      });
      await Promise.all([refreshCompanySettings(), refreshMembers()]);
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

  // 재귀 트리 노드 카드 렌더링 (1단계 부서뿐 아니라 2·3단계 하위 조직까지 모두 계층으로 표시!)
  const renderOrgBranch = (
    node: HqOrgChartNode,
    depth: number
  ): React.ReactNode => {
    const kw = searchQuery.trim().toLowerCase();
    if (!subtreeMatchesQuery(node, kw)) return null;

    const rawChildren = childrenByParent.get(node.id) || [];
    const visibleChildren = rawChildren.filter((ch) =>
      subtreeMatchesQuery(ch, kw)
    );
    const hasChildren = visibleChildren.length > 0;
    const isCollapsed = collapsedNodeIds.includes(node.id);
    const leader = findNodeLeader(node);
    const metrics = calcNodeMetrics(node, countMode === "INCLUDE_SUB");
    const displayCount =
      countMode === "INCLUDE_SUB" ? metrics.totalCount : metrics.directCount;
    const isSelected = selectedNodeId === node.id;

    return (
      <div
        key={node.id}
        className={
          direction === "DOWN"
            ? "flex flex-col items-center"
            : "flex items-start gap-8"
        }
      >
        <div
          className={
            direction === "DOWN"
              ? "flex flex-col items-center"
              : "flex items-center"
          }
        >
          <div
            onClick={() => setSelectedNodeId(node.id)}
            className={`${
              depth === 0 ? "w-[235px]" : "w-[215px]"
            } rounded-2xl bg-white border transition-all p-4 cursor-pointer shadow-2xs ${
              isSelected
                ? "border-[#00c458] ring-2 ring-[#00c458]/20"
                : "border-slate-200 hover:border-blue-400"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`${
                  depth === 0 ? "text-sm" : "text-[13px]"
                } font-extrabold text-slate-900 truncate`}
              >
                {node.name}
              </span>
              <span className="text-slate-300 text-xs font-bold">›</span>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <span>
                👤 <b className="text-slate-700">{displayCount}</b>
              </span>

              {leader && (
                <span className="inline-flex items-center gap-1 text-slate-700 font-semibold truncate">
                  <span
                    style={{ backgroundColor: avatarColor(leader.name) }}
                    className="w-4 h-4 rounded text-white text-[8px] font-extrabold flex items-center justify-center shrink-0"
                  >
                    {shortAvatarText(leader.name)}
                  </span>
                  <span className="truncate">{leader.name}</span>
                  {depth === 0 && (
                    <span className="text-amber-500 text-[11px]">✪</span>
                  )}
                </span>
              )}
            </div>

            {renderTrendPills(metrics)}
          </div>

          {hasChildren && direction === "DOWN" && (
            <div className="flex flex-col items-center">
              <div className="w-px h-3 bg-slate-300" />
              <button
                type="button"
                onClick={() =>
                  setCollapsedNodeIds((prev) =>
                    isCollapsed
                      ? prev.filter((x) => x !== node.id)
                      : [...prev, node.id]
                  )
                }
                className="px-2.5 py-0.5 rounded-full bg-[#00c458] hover:bg-[#00b04f] text-white text-[10px] font-extrabold shadow-xs"
              >
                {visibleChildren.length} {isCollapsed ? "+" : "-"}
              </button>
              {!isCollapsed && <div className="w-px h-5 bg-slate-300" />}
            </div>
          )}

          {hasChildren && direction === "RIGHT" && (
            <div className="flex items-center">
              <div className="w-3 h-px bg-slate-300" />
              <button
                type="button"
                onClick={() =>
                  setCollapsedNodeIds((prev) =>
                    isCollapsed
                      ? prev.filter((x) => x !== node.id)
                      : [...prev, node.id]
                  )
                }
                className="px-2 py-0.5 rounded-full bg-[#00c458] hover:bg-[#00b04f] text-white text-[10px] font-extrabold shadow-xs"
              >
                {visibleChildren.length} {isCollapsed ? "+" : "-"}
              </button>
            </div>
          )}
        </div>

        {hasChildren && !isCollapsed && (
          <div
            className={
              direction === "DOWN"
                ? `flex items-start gap-5 relative pt-5 ${
                    visibleChildren.length > 1
                      ? "border-t border-slate-300"
                      : ""
                  }`
                : `flex flex-col gap-4 pl-6 ${
                    visibleChildren.length > 1
                      ? "border-l border-slate-300"
                      : ""
                  }`
            }
          >
            {visibleChildren.map((ch) => renderOrgBranch(ch, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const registeredOrgNames = useMemo(
    () => getRegisteredOrgNames(orgNodes),
    [orgNodes]
  );

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) || null,
    [visibleNodes, selectedNodeId]
  );

  const drawerMembers = useMemo(() => {
    if (!selectedNode) return [];
    return countMode === "INCLUDE_SUB"
      ? collectSubtreeMembers(selectedNode)
      : directMembersByDept.get(selectedNode.name) || [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, countMode, directMembersByDept, childrenByParent]);

  const activeProfileMember = useMemo(
    () => members.find((m) => m.instructor_id === profileTargetId) || null,
    [members, profileTargetId]
  );

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
        {/* 상단 타이틀 바 */}
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
                onClick={() => setOrgModalOpen(true)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-extrabold text-slate-700 flex items-center gap-1.5"
              >
                <span>⚙️</span>
                <span>조직도 설정</span>
              </button>
            )}
          </div>
        </div>

        {/* 도트 그리드 인터랙티브 조직도 캔버스 */}
        <div
          style={{
            backgroundImage: "radial-gradient(#d8dee6 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
          className="flex-1 relative overflow-auto custom-scroll bg-[#fafbfc]"
        >
          {/* 좌상단 플로팅 기준일 · 필터 */}
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

          {/* 다단계 트리 본문 */}
          <div className="min-w-max px-12 py-14 flex justify-center">
            <div
              style={{
                transform: `scale(${zoomPct / 100})`,
                transformOrigin: "top center",
              }}
              className={`transition-transform duration-150 ${
                direction === "DOWN"
                  ? "flex items-start gap-10"
                  : "flex flex-col gap-10"
              }`}
            >
              {rootNodes.map((rNode) => renderOrgBranch(rNode, 0))}
            </div>
          </div>

          {/* 우측 플로팅 도구 버튼 (트렌드 · 조직뷰 · 조직설정) */}
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

                {openTool === "TREND" && (
                  <div className="absolute right-full mr-2.5 top-0 w-[195px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5 text-xs space-y-2">
                    <div className="text-[11px] font-bold text-slate-400">
                      트렌드 지표
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

            {canManageOrg && (
              <button
                type="button"
                onClick={() => setOrgModalOpen(true)}
                className="w-13 py-2.5 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 shadow-sm flex flex-col items-center gap-1 text-[10px] font-extrabold text-slate-600"
              >
                <span className="text-sm">⚙️</span>
                <span>조직설정</span>
              </button>
            )}
          </div>

          {/* 우하단 줌 컨트롤 바 */}
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

        {/* 조직 카드 클릭 시 우측 소속 구성원 드로어 */}
        {selectedNode && (
          <div className="absolute inset-y-0 right-0 w-[330px] bg-white border-l border-slate-200 shadow-2xl z-30 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  🏢 {selectedNode.name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  소속 구성원 {drawerMembers.length}명
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
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

      {/* 플렉스 스타일 조직도 설정 모달 (하위 조직 추가/삭제 · 이름 변경 · 상위 이동 · 숨김 통합) */}
      <HqOrgChartSettingsModal
        isOpen={orgModalOpen}
        initialNodes={orgNodes}
        initialEffectiveDate={
          companySettings?.extra_settings?.org_chart_effective_date
        }
        initialMemo={companySettings?.extra_settings?.org_chart_memo}
        members={members}
        saving={savingOrg}
        onClose={() => setOrgModalOpen(false)}
        onSave={handleSaveOrgSettings}
      />

      {/* 구성원 프로필 모달 */}
      <HqMemberProfileModal
        isOpen={Boolean(activeProfileMember)}
        member={activeProfileMember}
        meId={instId}
        isHrManager={isHrManager}
        existingDepartments={registeredOrgNames}
        onClose={() => setProfileTargetId(null)}
        onSaved={refreshMembers}
      />
    </>
  );
}
