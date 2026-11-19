// src/app/hq/org-chart/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqMemberProfileModal from "@/components/hq/members/HqMemberProfileModal";
import HqOrgChartSettingsModal from "@/components/hq/org-chart/HqOrgChartSettingsModal";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import { findOrgNodeLeader, getRegisteredOrgNames } from "@/lib/hq/orgTreeHelper";
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
    isBooting,
    isHrManager,
    isHqAdmin,
    canAccessAnalytics,
    refreshMembers,
    refreshCompanySettings,
  } = useHqShell();

  const canManageOrg = isHrManager || isHqAdmin;
  const canViewSalaryTrend = isHrManager || isHqAdmin || canAccessAnalytics;
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [manageMode, setManageMode] = useState<boolean>(false);
  const [asOfDate, setAsOfDate] = useState<string>(todayIso);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [includeOnLeave, setIncludeOnLeave] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [treeSize, setTreeSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [isPanning, setIsPanning] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const pendingCenterScrollRef = useRef<boolean>(false);
  const userTouchedZoomRef = useRef<boolean>(false);
  const didInitialBootFitRef = useRef<boolean>(false);
  const panStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const [openTool, setOpenTool] = useState<null | "TREND" | "VIEW">(null);
  const [direction, setDirection] = useState<"DOWN" | "RIGHT">("DOWN");
  const [countMode, setCountMode] = useState<"INCLUDE_SUB" | "DIRECT_ONLY">(
    "INCLUDE_SUB"
  );
  const [selectedTrends, setSelectedTrends] = useState<TrendMetricKey[]>([]);
  const userTouchedTrendsRef = useRef<boolean>(false);
  const [monthlyOtByMember, setMonthlyOtByMember] = useState<
    Record<string, number>
  >({});

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
    const isRoot = !node.parent_id;
    return (
      findOrgNodeLeader(node.name, snapshotMembers, { isRootNode: isRoot }) ||
      null
    );
  };

  // 특정 노드와 모든 하위 조직 이름 집합
  const collectSubtreeOrgNames = (node: HqOrgChartNode): Set<string> => {
    const names = new Set<string>();
    const walk = (cur: HqOrgChartNode) => {
      names.add(cur.name);
      (childrenByParent.get(cur.id) || []).forEach(walk);
    };
    walk(node);
    return names;
  };

  // 평균 초과 근무 지표 선택 시 기준월 근태 데이터 로드
  const asOfMonth = asOfDate.slice(0, 7);
  const needsOtFetch = selectedTrends.includes("AVG_OT");
  useEffect(() => {
    if (!needsOtFetch) return;
    let cancelled = false;
    hqFetch<{
      success: boolean;
      data?: {
        records?: {
          instructor_id?: string;
          work_date?: string;
          overtime_minutes?: number;
        }[];
      };
    }>(`/api/hq/attendance?month=${encodeURIComponent(asOfMonth)}`)
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        (res.data?.records || []).forEach((r) => {
          const id = String(r.instructor_id || "");
          const wd = String(r.work_date || "");
          if (!id || (wd && wd > asOfDate)) return;
          const ot = Math.max(0, Number(r.overtime_minutes || 0));
          if (ot > 0) {
            map[id] = (map[id] || 0) + ot;
          }
        });
        setMonthlyOtByMember(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [asOfMonth, asOfDate, needsOtFetch]);

  const calcNodeMetrics = (node: HqOrgChartNode, includeSub: boolean) => {
    const directList = directMembersByDept.get(node.name) || [];
    const targetMembers = includeSub ? collectSubtreeMembers(node) : directList;
    const scopeOrgNames = includeSub
      ? collectSubtreeOrgNames(node)
      : new Set<string>([node.name]);

    const salarySum = targetMembers.reduce((acc, m) => {
      const wc = m.profile_extra?.wage_contract;
      const monthly =
        Number(wc?.monthly_base || 0) ||
        (wc?.annual_salary ? Math.round(Number(wc.annual_salary) / 12) : 0);
      return acc + monthly;
    }, 0);

    const activeCnt = targetMembers.length;
    const allEverInScope = members.filter((m) => {
      if (m.is_ghost) return false;
      if (m.hire_date && m.hire_date > asOfDate) return false;
      const primaryDept =
        m.rank_code === "CEO" && !m.department
          ? "대표"
          : (m.department || "").trim();
      if (primaryDept && scopeOrgNames.has(primaryDept)) return true;
      if (m.rank_code === "CEO" && scopeOrgNames.has("대표")) return true;
      return (m.profile_extra?.org_assignments || []).some(
        (asg) => asg.org_name && scopeOrgNames.has(asg.org_name.trim())
      );
    }).length;
    const allEverCnt = Math.max(activeCnt, allEverInScope);
    const retentionPct =
      allEverCnt > 0 ? Math.round((activeCnt / allEverCnt) * 100) : null;

    const totalOtMinutes = targetMembers.reduce(
      (acc, m) => acc + Number(monthlyOtByMember[m.instructor_id] || 0),
      0
    );
    const avgOtHours =
      activeCnt > 0
        ? Number((totalOtMinutes / 60 / activeCnt).toFixed(1))
        : null;

    const avgLeaveUsed =
      activeCnt > 0
        ? Number(
            (
              targetMembers.reduce(
                (acc, m) => acc + Number(m.annual_leave_used || 0),
                0
              ) / activeCnt
            ).toFixed(1)
          )
        : null;

    return {
      directCount: directList.length,
      totalCount: collectSubtreeMembers(node).length,
      activeCnt,
      salarySum,
      retentionPct,
      avgOtHours,
      avgLeaveUsed,
    };
  };

  const subtreeMatchesQuery = useCallback(
    (rootTarget: HqOrgChartNode, kw: string): boolean => {
      if (!kw) return true;
      const walkMatch = (cur: HqOrgChartNode): boolean => {
        if (cur.name.toLowerCase().includes(kw)) return true;
        const direct = directMembersByDept.get(cur.name) || [];
        if (direct.some((m) => m.name.toLowerCase().includes(kw))) return true;
        return (childrenByParent.get(cur.id) || []).some(walkMatch);
      };
      return walkMatch(rootTarget);
    },
    [directMembersByDept, childrenByParent]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // 하위 조직이 존재하는 모든 노드 ID 목록
  const collapsibleNodeIds = useMemo(() => {
    return visibleNodes
      .filter((n) =>
        (childrenByParent.get(n.id) || []).some((ch) =>
          subtreeMatchesQuery(ch, normalizedQuery)
        )
      )
      .map((n) => n.id);
  }, [visibleNodes, childrenByParent, subtreeMatchesQuery, normalizedQuery]);

  // 현재 화면상 펼쳐져 있는 하위 조직이 하나라도 있는지 여부
  const hasExpandedBranches = useMemo(() => {
    const collapsedSet = new Set(collapsedNodeIds);
    const checkExpanded = (node: HqOrgChartNode): boolean => {
      if (!subtreeMatchesQuery(node, normalizedQuery)) return false;
      const visChildren = (childrenByParent.get(node.id) || []).filter((ch) =>
        subtreeMatchesQuery(ch, normalizedQuery)
      );
      if (visChildren.length === 0) return false;
      if (!collapsedSet.has(node.id)) return true;
      return false;
    };
    return rootNodes.some(checkExpanded);
  }, [
    rootNodes,
    collapsedNodeIds,
    childrenByParent,
    subtreeMatchesQuery,
    normalizedQuery,
  ]);

  const centerCanvasScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2);
    vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2);
  }, []);

  const fitToScreen = useCallback(
    (markUserAction = false) => {
      const viewport = viewportRef.current;
      const treeEl = treeRef.current;
      if (!viewport || !treeEl) return;

      const treeW = treeEl.offsetWidth;
      const treeH = treeEl.offsetHeight;
      if (treeW <= 0 || treeH <= 0) return;

      if (markUserAction) {
        userTouchedZoomRef.current = true;
      }

      const drawerWidth = selectedNodeId ? 330 : 0;
      const availW = Math.max(240, viewport.clientWidth - drawerWidth - 160);
      const availH = Math.max(180, viewport.clientHeight - 150);

      const rawScale = Math.min(availW / treeW, availH / treeH, 1);
      const nextZoom = Math.max(20, Math.min(100, Math.floor(rawScale * 100)));

      pendingCenterScrollRef.current = true;
      setTreeSize((prev) =>
        prev.width === treeW && prev.height === treeH
          ? prev
          : { width: treeW, height: treeH }
      );
      setZoomPct(nextZoom);

      requestAnimationFrame(() => {
        centerCanvasScroll();
      });
    },
    [selectedNodeId, centerCanvasScroll]
  );

  const handleToggleCollapseAll = useCallback(() => {
    pendingCenterScrollRef.current = true;
    if (hasExpandedBranches) {
      setCollapsedNodeIds(collapsibleNodeIds);
    } else {
      setCollapsedNodeIds([]);
    }
  }, [hasExpandedBranches, collapsibleNodeIds]);

  // 트리 원본(100%) 크기 동기 측정 및 리사이즈 감지
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setTreeSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
    };
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    rootNodes,
    collapsedNodeIds,
    direction,
    manageMode,
    selectedTrends,
    countMode,
    normalizedQuery,
    snapshotMembers,
  ]);

  // 줌/접기 변경 직후 캔버스 스크롤 중앙 정렬
  useLayoutEffect(() => {
    if (!pendingCenterScrollRef.current) return;
    pendingCenterScrollRef.current = false;
    centerCanvasScroll();
  }, [zoomPct, treeSize, collapsedNodeIds, centerCanvasScroll]);

  // 초기 데이터 로드 완료 시 전체 조직도가 한눈에 들어오도록 자동 맞춤
  useEffect(() => {
    if (isBooting || didInitialBootFitRef.current) return;
    if (treeSize.width <= 0 || treeSize.height <= 0) return;
    didInitialBootFitRef.current = true;
    if (!userTouchedZoomRef.current) {
      fitToScreen(false);
    }
  }, [isBooting, treeSize.width, treeSize.height, fitToScreen]);

  // 빈 캔버스 드래그 이동 (패닝)
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const start = panStartRef.current;
      const vp = viewportRef.current;
      if (!start || !vp) return;
      vp.scrollLeft = start.scrollLeft - (e.clientX - start.x);
      vp.scrollTop = start.scrollTop - (e.clientY - start.y);
    };
    const onUp = () => {
      panStartRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, input, label, a, [data-org-card="true"], [data-floating-ui="true"]'
      )
    ) {
      return;
    }
    const vp = viewportRef.current;
    if (!vp) return;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: vp.scrollLeft,
      scrollTop: vp.scrollTop,
    };
    setIsPanning(true);
  };

  const toggleTrendMetric = (key: TrendMetricKey) => {
    userTouchedTrendsRef.current = true;
    setSelectedTrends((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const handleSwitchManageMode = (nextManage: boolean) => {
    setManageMode(nextManage);
    if (!userTouchedTrendsRef.current) {
      if (nextManage) {
        setSelectedTrends(
          canViewSalaryTrend ? ["SALARY_SUM", "RETENTION"] : ["RETENTION"]
        );
      } else {
        setSelectedTrends([]);
      }
    }
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
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "조직도 설정 저장 실패";
      alert(msg);
    } finally {
      setSavingOrg(false);
    }
  };

  const renderTrendPills = (metrics: ReturnType<typeof calcNodeMetrics>) => {
    const visibleTrendKeys = selectedTrends.filter(
      (k) => k !== "SALARY_SUM" || canViewSalaryTrend
    );
    if (visibleTrendKeys.length === 0) return null;
    return (
      <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col items-start gap-1.5">
        {visibleTrendKeys.includes("SALARY_SUM") && (
          <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            계약월급 총합{" "}
            <b className="text-slate-800">
              {metrics.salarySum > 0
                ? `${metrics.salarySum.toLocaleString()}원`
                : "-"}
            </b>
          </span>
        )}
        {visibleTrendKeys.includes("RETENTION") && (
          <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            구성원 유지율{" "}
            <b className="text-slate-800">
              {metrics.activeCnt > 0 && metrics.retentionPct !== null
                ? `${metrics.retentionPct}%`
                : "-"}
            </b>
          </span>
        )}
        {visibleTrendKeys.includes("AVG_OT") && (
          <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            평균 초과 근무{" "}
            <b className="text-slate-800">
              {metrics.activeCnt > 0 && metrics.avgOtHours !== null
                ? `${metrics.avgOtHours}시간`
                : "-"}
            </b>
          </span>
        )}
        {visibleTrendKeys.includes("AVG_LEAVE") && (
          <span className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50/70 text-[10px] text-slate-500">
            평균 휴가 사용{" "}
            <b className="text-slate-800">
              {metrics.activeCnt > 0 && metrics.avgLeaveUsed !== null
                ? `${metrics.avgLeaveUsed}일`
                : "-"}
            </b>
          </span>
        )}
      </div>
    );
  };

  // 재귀 트리 노드 카드 렌더링 (1단계 부서뿐 아니라 2·3단계 하위 조직까지 사다리 연결선 포함 완벽 표시)
  const renderOrgBranch = (
    node: HqOrgChartNode,
    depth: number
  ): React.ReactNode => {
    const kw = normalizedQuery;
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
            : "flex items-center"
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
            data-org-card="true"
            onClick={() => setSelectedNodeId(node.id)}
            className={`${
              depth === 0 ? "w-[235px]" : "w-[215px]"
            } relative z-10 rounded-2xl bg-white border transition-all p-4 cursor-pointer shadow-2xs select-none ${
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsedNodeIds((prev) =>
                    isCollapsed
                      ? prev.filter((x) => x !== node.id)
                      : [...prev, node.id]
                  );
                }}
                className={`-mt-2.5 relative z-20 px-2.5 py-0.5 rounded-full text-white text-[10px] font-extrabold shadow-xs transition-colors ${
                  isCollapsed
                    ? "bg-[#525866] hover:bg-[#3f444f]"
                    : "bg-[#00c458] hover:bg-[#00b04f]"
                }`}
              >
                {visibleChildren.length} {isCollapsed ? "▾" : "−"}
              </button>
              {!isCollapsed && (
                <div className="w-[1.5px] h-5 bg-[#64748b]" />
              )}
            </div>
          )}

          {hasChildren && direction === "RIGHT" && (
            <div className="flex items-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsedNodeIds((prev) =>
                    isCollapsed
                      ? prev.filter((x) => x !== node.id)
                      : [...prev, node.id]
                  );
                }}
                className={`-ml-2.5 relative z-20 px-2 py-0.5 rounded-full text-white text-[10px] font-extrabold shadow-xs transition-colors ${
                  isCollapsed
                    ? "bg-[#525866] hover:bg-[#3f444f]"
                    : "bg-[#00c458] hover:bg-[#00b04f]"
                }`}
              >
                {visibleChildren.length} {isCollapsed ? "▸" : "−"}
              </button>
              {!isCollapsed && (
                <div className="w-5 h-[1.5px] bg-[#64748b]" />
              )}
            </div>
          )}
        </div>

        {hasChildren && !isCollapsed && direction === "DOWN" && (
          <div className="flex items-start">
            {visibleChildren.map((ch, idx) => {
              const total = visibleChildren.length;
              return (
                <div
                  key={ch.id}
                  className="relative flex flex-col items-center pt-5 px-2.5"
                >
                  {total > 1 && idx === 0 && (
                    <div
                      style={{ left: "calc(50% - 0.75px)" }}
                      className="absolute top-0 right-0 h-[1.5px] bg-[#64748b]"
                    />
                  )}
                  {total > 1 && idx > 0 && idx < total - 1 && (
                    <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-[#64748b]" />
                  )}
                  {total > 1 && idx === total - 1 && (
                    <div
                      style={{ right: "calc(50% - 0.75px)" }}
                      className="absolute top-0 left-0 h-[1.5px] bg-[#64748b]"
                    />
                  )}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1.5px] h-5 bg-[#64748b]" />
                  {renderOrgBranch(ch, depth + 1)}
                </div>
              );
            })}
          </div>
        )}

        {hasChildren && !isCollapsed && direction === "RIGHT" && (
          <div className="flex flex-col items-start">
            {visibleChildren.map((ch, idx) => {
              const total = visibleChildren.length;
              return (
                <div
                  key={ch.id}
                  className="relative flex items-center pl-5 py-2"
                >
                  {total > 1 && idx === 0 && (
                    <div
                      style={{ top: "calc(50% - 0.75px)" }}
                      className="absolute left-0 bottom-0 w-[1.5px] bg-[#64748b]"
                    />
                  )}
                  {total > 1 && idx > 0 && idx < total - 1 && (
                    <div className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[#64748b]" />
                  )}
                  {total > 1 && idx === total - 1 && (
                    <div
                      style={{ bottom: "calc(50% - 0.75px)" }}
                      className="absolute left-0 top-0 w-[1.5px] bg-[#64748b]"
                    />
                  )}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-[1.5px] bg-[#64748b]" />
                  {renderOrgBranch(ch, depth + 1)}
                </div>
              );
            })}
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
              onClick={() => handleSwitchManageMode(false)}
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
                onClick={() => handleSwitchManageMode(true)}
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
        <div className="flex-1 relative min-h-0 overflow-hidden bg-[#fafbfc]">
          {/* 좌상단 플로팅 기준일 · 필터 */}
          <div
            data-floating-ui="true"
            className="absolute top-5 left-6 z-20 inline-flex items-center gap-2"
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

          {/* 스크롤 & 드래그 가능한 캔버스 뷰포트 */}
          <div
            ref={viewportRef}
            onMouseDown={handleCanvasMouseDown}
            style={{
              backgroundImage: "radial-gradient(#d8dee6 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
            className={`w-full h-full overflow-auto custom-scroll ${
              isPanning ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
          >
            {/* 다단계 트리 본문 (스케일 실제 레이아웃 반영 + 화면 중앙 정렬) */}
            <div className="w-max min-w-full min-h-full flex items-center justify-center px-14 py-14">
              <div
                style={{
                  width:
                    treeSize.width > 0
                      ? Math.ceil((treeSize.width * zoomPct) / 100)
                      : undefined,
                  height:
                    treeSize.height > 0
                      ? Math.ceil((treeSize.height * zoomPct) / 100)
                      : undefined,
                }}
                className="relative shrink-0"
              >
                <div
                  ref={treeRef}
                  style={{
                    transform: `scale(${zoomPct / 100})`,
                    transformOrigin: "top left",
                  }}
                  className={`w-max ${
                    direction === "DOWN"
                      ? "flex items-start gap-10"
                      : "flex flex-col gap-10"
                  }`}
                >
                  {rootNodes.map((rNode) => renderOrgBranch(rNode, 0))}
                </div>
              </div>
            </div>
          </div>

          {/* 우측 플로팅 도구 버튼 (트렌드 · 조직뷰 · 조직설정) */}
          <div
            data-floating-ui="true"
            onClick={(e) => e.stopPropagation()}
            className={`absolute top-5 z-20 flex flex-col gap-2 transition-[right] duration-150 ${
              selectedNode ? "right-[350px]" : "right-6"
            }`}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenTool(openTool === "TREND" ? null : "TREND")
                }
                className={`w-13 py-2.5 rounded-2xl border shadow-xs flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
                  openTool === "TREND" || selectedTrends.length > 0
                    ? "bg-white border-blue-200 text-blue-600"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <rect x="2" y="9" width="2.4" height="5" rx="0.8" />
                  <rect x="6.8" y="5.5" width="2.4" height="8.5" rx="0.8" />
                  <rect x="11.6" y="2.5" width="2.4" height="11.5" rx="0.8" />
                </svg>
                <span>트렌드</span>
              </button>

              {openTool === "TREND" && (
                <div className="absolute right-full mr-2.5 top-0 w-[205px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 p-3.5 text-xs space-y-1.5">
                  <div className="px-1.5 pb-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <span>트렌드 지표</span>
                    <span
                      title="기준일 및 구성원 숫자 표기(하위 조직 포함/직속만) 기준에 따라 각 조직 박스에 실시간 표시됩니다."
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-slate-300 text-[9px] font-bold text-slate-400 cursor-help"
                    >
                      i
                    </span>
                  </div>
                  {(
                    [
                      ...(canViewSalaryTrend
                        ? [
                            {
                              key: "SALARY_SUM" as const,
                              label: "계약월급 총합",
                              icon: (
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect
                                    x="1.8"
                                    y="4"
                                    width="12.4"
                                    height="8"
                                    rx="1.5"
                                  />
                                  <circle cx="8" cy="8" r="1.8" />
                                </svg>
                              ),
                            },
                          ]
                        : []),
                      {
                        key: "RETENTION" as const,
                        label: "구성원 유지율",
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M6.5 2.8a1.5 1.5 0 0 1 3 0v.7h2a1.2 1.2 0 0 1 1.2 1.2v2a1.5 1.5 0 0 0 0 2.6v2.2a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2V4.7a1.2 1.2 0 0 1 1.2-1.2h2.7v-.7Z" />
                          </svg>
                        ),
                      },
                      {
                        key: "AVG_OT" as const,
                        label: "평균 초과 근무",
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8.3 2.2c.4 2.1 3.5 3.6 3.5 6.8a3.8 3.8 0 0 1-7.6 0c0-1.9 1.1-3.3 2.2-4.2.2 1 .8 1.5 1.4 1.5.5 0 .7-.8.5-4.1Z" />
                          </svg>
                        ),
                      },
                      {
                        key: "AVG_LEAVE" as const,
                        label: "평균 휴가 사용",
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M2.5 8.5a5.5 5.5 0 0 1 11 0Z" />
                            <path d="M8 8.5v4.3a1.2 1.2 0 0 1-2.4 0M3 13.8h10" />
                          </svg>
                        ),
                      },
                    ] as const
                  ).map((tr) => {
                    const active = selectedTrends.includes(tr.key);
                    return (
                      <button
                        key={tr.key}
                        type="button"
                        onClick={() => toggleTrendMetric(tr.key)}
                        className="w-full py-2 px-2 rounded-xl hover:bg-slate-50 flex items-center justify-between text-left transition-colors"
                      >
                        <span className="flex items-center gap-2.5 font-bold text-slate-700">
                          <span className="text-slate-500 shrink-0">
                            {tr.icon}
                          </span>
                          <span>{tr.label}</span>
                        </span>
                        {active && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="#00c458"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3.2 8.4l3.1 3.1 6.5-6.5" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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

          {/* 우하단 플렉스 스타일 컨트롤 바 (조직 접기/펼치기 · 화면에 맞추기 · 줌 배율) */}
          <div
            data-floating-ui="true"
            onClick={(e) => e.stopPropagation()}
            className={`absolute bottom-6 z-20 flex items-center gap-1.5 transition-[right] duration-150 ${
              selectedNode ? "right-[350px]" : "right-6"
            }`}
          >
            {/* 조직 접기 / 조직 펼치기 */}
            <div className="relative group">
              <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-[#333840] text-white text-[11px] font-bold whitespace-nowrap shadow-lg">
                {hasExpandedBranches || collapsibleNodeIds.length === 0
                  ? "조직 접기"
                  : "조직 펼치기"}
              </div>
              <button
                type="button"
                disabled={collapsibleNodeIds.length === 0}
                onClick={handleToggleCollapseAll}
                aria-label={
                  hasExpandedBranches || collapsibleNodeIds.length === 0
                    ? "조직 접기"
                    : "조직 펼치기"
                }
                className="w-9 h-9 rounded-xl bg-white border border-slate-200/90 shadow-xs hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors"
              >
                {hasExpandedBranches || collapsibleNodeIds.length === 0 ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 2.5L6.2 6.2M6.2 6.2V3.2M6.2 6.2H3.2" />
                    <path d="M13.5 2.5L9.8 6.2M9.8 6.2V3.2M9.8 6.2H12.8" />
                    <path d="M2.5 13.5L6.2 9.8M6.2 9.8V12.8M6.2 9.8H3.2" />
                    <path d="M13.5 13.5L9.8 9.8M9.8 9.8V12.8M9.8 9.8H12.8" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6.2 6.2L2.5 2.5M2.5 2.5V5.5M2.5 2.5H5.5" />
                    <path d="M9.8 6.2L13.5 2.5M13.5 2.5V5.5M13.5 2.5H10.5" />
                    <path d="M6.2 9.8L2.5 13.5M2.5 13.5V10.5M2.5 13.5H5.5" />
                    <path d="M9.8 9.8L13.5 13.5M13.5 13.5V10.5M13.5 13.5H10.5" />
                  </svg>
                )}
              </button>
            </div>

            {/* 화면에 맞추기 */}
            <div className="relative group">
              <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-[#333840] text-white text-[11px] font-bold whitespace-nowrap shadow-lg">
                화면에 맞추기
              </div>
              <button
                type="button"
                onClick={() => fitToScreen(true)}
                aria-label="화면에 맞추기"
                className="w-9 h-9 rounded-xl bg-white border border-slate-200/90 shadow-xs hover:bg-slate-50 active:bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 5.5V3.5C2.5 2.95 2.95 2.5 3.5 2.5H5.5" />
                  <path d="M10.5 2.5H12.5C13.05 2.5 13.5 2.95 13.5 3.5V5.5" />
                  <path d="M2.5 10.5V12.5C2.5 13.05 2.95 13.5 3.5 13.5H5.5" />
                  <path d="M10.5 13.5H12.5C13.05 13.5 13.5 13.05 13.5 12.5V10.5" />
                </svg>
              </button>
            </div>

            {/* 줌 배율 조절 (- / 배율% / +) */}
            <div className="h-9 rounded-xl bg-white border border-slate-200/90 shadow-xs flex items-center divide-x divide-slate-100 text-xs font-bold text-slate-700">
              <button
                type="button"
                disabled={zoomPct <= 20}
                onClick={() => {
                  userTouchedZoomRef.current = true;
                  setZoomPct((z) => Math.max(20, z - 10));
                }}
                aria-label="축소"
                className="w-8 h-full rounded-l-xl flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-35 transition-colors"
              >
                −
              </button>
              <div className="relative group h-full flex items-center">
                <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-[#333840] text-white text-[11px] font-bold whitespace-nowrap shadow-lg">
                  100% 원본 크기
                </div>
                <button
                  type="button"
                  onClick={() => {
                    userTouchedZoomRef.current = true;
                    pendingCenterScrollRef.current = true;
                    setZoomPct(100);
                    requestAnimationFrame(() => centerCanvasScroll());
                  }}
                  className="min-w-[56px] h-full px-2.5 flex items-center justify-center text-[12px] font-semibold text-slate-700 hover:bg-slate-50 tabular-nums transition-colors"
                >
                  {zoomPct} %
                </button>
              </div>
              <button
                type="button"
                disabled={zoomPct >= 150}
                onClick={() => {
                  userTouchedZoomRef.current = true;
                  setZoomPct((z) => Math.min(150, z + 10));
                }}
                aria-label="확대"
                className="w-8 h-full rounded-r-xl flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-35 transition-colors"
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
