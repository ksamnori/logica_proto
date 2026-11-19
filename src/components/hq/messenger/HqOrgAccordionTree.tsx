// src/components/hq/messenger/HqOrgAccordionTree.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import {
  normalizeOrgNodes,
  resolveMemberDisplayPosition,
} from "@/lib/hq/orgTreeHelper";
import type { HqMember, HqOrgChartNode } from "@/lib/hq/types";

interface OrgTreeBranch {
  key: string;
  id: string;
  name: string;
  depth: number;
  directMembers: any[];
  children: OrgTreeBranch[];
  totalCount: number;
  directCount: number;
  isMyDirectDept: boolean;
  containsMe: boolean;
}

interface TenantTreeGroup {
  tenantName: string;
  isHqTenant: boolean;
  isMyTenant: boolean;
  totalCount: number;
  branches: OrgTreeBranch[];
  allBranchKeys: string[];
  defaultOpenKeys: string[];
}

interface Props {
  variant: "drawer" | "page";
  instructors: any[];
  hqMembers: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  myInstId: string;
  myMember: HqMember | null;
  searchKeyword: string;
  selectedInstIds: string[];
  onToggleSelect: (instId: string) => void;
  onDirectChat?: (inst: any) => void;
  preferredTenantName?: string;
  expandAllMyTenantBranches?: boolean;
}

const ACADEMY_POS_ORDER: Record<string, number> = {
  최고관리자: 1,
  대표원장: 2,
  원장: 2,
  부원장: 3,
  실장: 4,
  전임강사: 5,
  파트강사: 6,
  조교: 7,
};

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 transition-transform duration-150 shrink-0 ${
        expanded ? "rotate-90 text-slate-600" : "text-slate-400"
      }`}
      aria-hidden="true"
    >
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

function resolveAcademyMemberDept(rawInst: any): string {
  const rawRole = String(rawInst?.role || "")
    .trim()
    .toUpperCase();
  const rawPos = String(rawInst?.position || "").trim();
  const rawChatPos = String(rawInst?.chat_position || "").trim();
  const rawDept = String(rawInst?.department || "").trim();

  if (
    rawRole === "TA" ||
    rawPos.includes("조교") ||
    rawChatPos.includes("조교") ||
    rawDept === "조교" ||
    rawDept === "조교팀"
  ) {
    return "조교";
  }

  return rawDept || "부서 미지정";
}

export default function HqOrgAccordionTree({
  variant,
  instructors,
  hqMembers,
  orgNodes,
  myInstId,
  myMember,
  searchKeyword,
  selectedInstIds,
  onToggleSelect,
  onDirectChat,
  preferredTenantName,
  expandAllMyTenantBranches = false,
}: Props) {
  const [expandedTenants, setExpandedTenants] = useState<string[]>([]);
  const [expandedBranchKeys, setExpandedBranchKeys] = useState<string[]>([]);
  const initializedRef = useRef(false);

  const hqMemberById = useMemo(() => {
    const map = new Map<string, HqMember>();
    hqMembers.forEach((m) => {
      if (m.work_status !== "퇴직" && !m.is_ghost) {
        map.set(String(m.instructor_id), m);
      }
    });
    return map;
  }, [hqMembers]);

  const meInst = useMemo(
    () =>
      instructors.find(
        (i: any) => String(i.instructor_id) === String(myInstId)
      ),
    [instructors, myInstId]
  );

  const activeMyTenantName = (
    preferredTenantName?.trim() ||
    meInst?.academy_tenant?.name ||
    "천종현수학연구소"
  ).trim();

  const activeMyDeptName = useMemo(() => {
    if (myMember) {
      if (myMember.rank_code === "CEO" && !myMember.department) return "대표";
      if (myMember.department?.trim()) return myMember.department.trim();
    }
    if (!meInst) return "부서 미지정";
    const meTName = (meInst.academy_tenant?.name || "").trim();
    const isMeHq =
      Boolean(meInst.is_hq_tenant) ||
      meTName.includes("천종현") ||
      meTName === "본사" ||
      meTName.includes("본부");
    return isMeHq
      ? (meInst.department || "부서 미지정").trim()
      : resolveAcademyMemberDept(meInst);
  }, [myMember, meInst]);

  // 테넌트 + 다단계 상하위 조직 트리 구성
  const tenantGroups: TenantTreeGroup[] = useMemo(() => {
    const q = searchKeyword.trim().toLowerCase();

    const byTenant = new Map<string, any[]>();
    instructors.forEach((rawInst: any) => {
      if (rawInst?.is_explicit_ghost || rawInst?.is_ghost) return;

      const tName = (rawInst.academy_tenant?.name || "소속 미지정").trim();
      const isInstHq =
        Boolean(rawInst.is_hq_tenant) ||
        tName.includes("천종현") ||
        tName === "본사" ||
        tName.includes("본부");
      const hm = isInstHq
        ? hqMemberById.get(String(rawInst.instructor_id))
        : undefined;
      const enrichedPos = hm
        ? resolveMemberDisplayPosition(hm)
        : rawInst.chat_position || rawInst.position || "구성원";
      const enrichedDept = hm
        ? hm.rank_code === "CEO" && !hm.department
          ? "대표"
          : (hm.department || rawInst.department || "부서 미지정").trim()
        : resolveAcademyMemberDept(rawInst);

      const item = {
        ...rawInst,
        _hqMember: hm || null,
        _displayDept: enrichedDept,
        _displayPos: enrichedPos,
      };

      const arr = byTenant.get(tName) || [];
      arr.push(item);
      byTenant.set(tName, arr);
    });

    const visibleNodes = normalizeOrgNodes(orgNodes).filter(
      (n) => !n.is_hidden && n.name.trim() !== "퇴직"
    );
    const validIds = new Set(visibleNodes.map((n) => n.id));
    const childrenByParent = new Map<string | null, HqOrgChartNode[]>();
    visibleNodes.forEach((n) => {
      const pid = n.parent_id && validIds.has(n.parent_id) ? n.parent_id : null;
      childrenByParent.set(pid, [...(childrenByParent.get(pid) || []), n]);
    });

    const matchesSearch = (inst: any, orgName: string, tName: string) => {
      if (!q) return true;
      return (
        String(inst.name || "")
          .toLowerCase()
          .includes(q) ||
        String(inst._displayDept || "")
          .toLowerCase()
          .includes(q) ||
        String(inst._displayPos || "")
          .toLowerCase()
          .includes(q) ||
        orgName.toLowerCase().includes(q) ||
        tName.toLowerCase().includes(q)
      );
    };

    const sortedTenantNames = Array.from(byTenant.keys()).sort((a, b) => {
      const aTrim = a.trim();
      const bTrim = b.trim();
      if (aTrim === activeMyTenantName) return -1;
      if (bTrim === activeMyTenantName) return 1;
      if (aTrim.includes("천종현") || aTrim === "본사") return -1;
      if (bTrim.includes("천종현") || bTrim === "본사") return 1;
      return aTrim.localeCompare(bTrim, "ko");
    });

    const groups: TenantTreeGroup[] = [];

    sortedTenantNames.forEach((tName) => {
      const tMembers = byTenant.get(tName) || [];
      const isMyTenant = tName === activeMyTenantName;
      const isHqTenant =
        tName.includes("천종현") ||
        tName === "본사" ||
        tName.includes("본부") ||
        tMembers.some((m) => Boolean(m.is_hq_tenant));

      const allBranchKeys: string[] = [];
      const defaultOpenKeys: string[] = [];

      if (isHqTenant && visibleNodes.length > 0) {
        // 1) 조직도 설정(org_chart_nodes) 기반 다단계 상하위 부서 매핑
        const directByOrgName = new Map<string, any[]>();
        const placedInstIds = new Set<string>();
        const registeredNameSet = new Set(
          visibleNodes.map((n) => n.name.trim())
        );

        tMembers.forEach((inst) => {
          const hm: HqMember | null = inst._hqMember;
          const targetOrgs = new Set<string>();
          if (registeredNameSet.has(inst._displayDept)) {
            targetOrgs.add(inst._displayDept);
          }
          if (hm?.rank_code === "CEO" && registeredNameSet.has("대표")) {
            targetOrgs.add("대표");
          }
          (hm?.profile_extra?.org_assignments || []).forEach((asg) => {
            const oName = (asg?.org_name || "").trim();
            if (oName && registeredNameSet.has(oName)) {
              targetOrgs.add(oName);
            }
          });

          targetOrgs.forEach((oName) => {
            const bucket = directByOrgName.get(oName) || [];
            if (
              !bucket.some(
                (x) => String(x.instructor_id) === String(inst.instructor_id)
              )
            ) {
              bucket.push(inst);
              directByOrgName.set(oName, bucket);
              placedInstIds.add(String(inst.instructor_id));
            }
          });
        });

        const visitedNodeIds = new Set<string>();

        const buildBranch = (
          node: HqOrgChartNode,
          depth: number
        ): { branch: OrgTreeBranch | null; uniqIds: Set<string> } => {
          if (visitedNodeIds.has(node.id)) {
            return { branch: null, uniqIds: new Set() };
          }
          visitedNodeIds.add(node.id);

          const rawDirect = directByOrgName.get(node.name.trim()) || [];
          const filteredDirect = rawDirect
            .filter((inst) => matchesSearch(inst, node.name, tName))
            .sort((a, b) => {
              if (String(a.instructor_id) === String(myInstId)) return -1;
              if (String(b.instructor_id) === String(myInstId)) return 1;
              return String(a.name || "").localeCompare(
                String(b.name || ""),
                "ko"
              );
            });

          const childNodes = childrenByParent.get(node.id) || [];
          const childBranches: OrgTreeBranch[] = [];
          const uniqIds = new Set<string>(
            filteredDirect.map((x) => String(x.instructor_id))
          );

          childNodes.forEach((cn) => {
            const built = buildBranch(cn, depth + 1);
            if (built.branch) {
              childBranches.push(built.branch);
              built.uniqIds.forEach((id) => uniqIds.add(id));
            }
          });

          // 검색 중일 때는 매칭 구성원도 없고 하위 매칭 부서도 없으면 숨김
          if (
            q &&
            filteredDirect.length === 0 &&
            childBranches.length === 0 &&
            !node.name.toLowerCase().includes(q)
          ) {
            return { branch: null, uniqIds: new Set() };
          }

          const key = `${tName}::node::${node.id}`;
          const isMyDirectDept =
            isMyTenant && node.name.trim() === activeMyDeptName;
          const containsMe =
            uniqIds.has(String(myInstId)) ||
            isMyDirectDept ||
            childBranches.some((cb) => cb.containsMe);

          const branch: OrgTreeBranch = {
            key,
            id: node.id,
            name: node.name.trim(),
            depth,
            directMembers: filteredDirect,
            children: childBranches,
            totalCount: uniqIds.size,
            directCount: filteredDirect.length,
            isMyDirectDept,
            containsMe,
          };

          return { branch, uniqIds };
        };

        const rootOrgNodes = childrenByParent.get(null) || [];
        const branches: OrgTreeBranch[] = [];
        const tenantUniqIds = new Set<string>();

        rootOrgNodes.forEach((rn) => {
          const built = buildBranch(rn, 0);
          if (built.branch) {
            branches.push(built.branch);
            built.uniqIds.forEach((id) => tenantUniqIds.add(id));
          }
        });

        // 조직도에 아직 등록되지 않은 부서명을 가진 구성원도 누락 없이 표시
        const unplacedByDept = new Map<string, any[]>();
        tMembers.forEach((inst) => {
          if (placedInstIds.has(String(inst.instructor_id))) return;
          if (!matchesSearch(inst, inst._displayDept, tName)) return;
          const dName = inst._displayDept || "부서 미지정";
          const arr = unplacedByDept.get(dName) || [];
          arr.push(inst);
          unplacedByDept.set(dName, arr);
        });

        Array.from(unplacedByDept.keys())
          .sort((a, b) => a.localeCompare(b, "ko"))
          .forEach((dName) => {
            const list = (unplacedByDept.get(dName) || []).sort((a, b) =>
              String(a.name || "").localeCompare(String(b.name || ""), "ko")
            );
            if (list.length === 0) return;
            list.forEach((x) => tenantUniqIds.add(String(x.instructor_id)));
            const containsMe = list.some(
              (x) => String(x.instructor_id) === String(myInstId)
            );
            branches.push({
              key: `${tName}::orphan::${dName}`,
              id: `orphan-${dName}`,
              name: dName,
              depth: 0,
              directMembers: list,
              children: [],
              totalCount: list.length,
              directCount: list.length,
              isMyDirectDept: isMyTenant && dName === activeMyDeptName,
              containsMe,
            });
          });

        if (q && tenantUniqIds.size === 0 && branches.length === 0) {
          return;
        }

        const collectKeys = (list: OrgTreeBranch[]) => {
          list.forEach((b) => {
            allBranchKeys.push(b.key);
            if (b.containsMe) {
              defaultOpenKeys.push(b.key);
            }
            collectKeys(b.children);
          });
        };
        collectKeys(branches);

        // 최상위 루트가 단일 노드(예: '대표')이면 루트 1단계는 기본 펼쳐서 산하 본부·팀 아코디언이 바로 보이도록 처리
        if (branches.length === 1 && !defaultOpenKeys.includes(branches[0].key)) {
          defaultOpenKeys.push(branches[0].key);
        }

        groups.push({
          tenantName: tName,
          isHqTenant: true,
          isMyTenant,
          totalCount: q ? tenantUniqIds.size : tMembers.length,
          branches,
          allBranchKeys,
          defaultOpenKeys,
        });
      } else {
        // 2) 일반 가맹점/지점 테넌트: 부서별 깔끔한 1단계 아코디언
        const deptMap = new Map<string, any[]>();
        tMembers.forEach((inst) => {
          const dName = inst._displayDept || "부서 미지정";
          if (!matchesSearch(inst, dName, tName)) return;
          const arr = deptMap.get(dName) || [];
          arr.push(inst);
          deptMap.set(dName, arr);
        });

        const branches: OrgTreeBranch[] = Array.from(deptMap.keys())
          .sort((a, b) => {
            if (isMyTenant && a === activeMyDeptName) return -1;
            if (isMyTenant && b === activeMyDeptName) return 1;
            if (a === "부서 미지정" && b !== "부서 미지정") return 1;
            if (b === "부서 미지정" && a !== "부서 미지정") return -1;
            return a.localeCompare(b, "ko");
          })
          .map((dName) => {
            const list = (deptMap.get(dName) || []).sort((a, b) => {
              if (String(a.instructor_id) === String(myInstId)) return -1;
              if (String(b.instructor_id) === String(myInstId)) return 1;
              const orderA =
                ACADEMY_POS_ORDER[String(a.position || "").trim()] || 99;
              const orderB =
                ACADEMY_POS_ORDER[String(b.position || "").trim()] || 99;
              if (orderA !== orderB) return orderA - orderB;
              return String(a.name || "").localeCompare(
                String(b.name || ""),
                "ko"
              );
            });
            const key = `${tName}::dept::${dName}`;
            const containsMe = list.some(
              (x) => String(x.instructor_id) === String(myInstId)
            );
            allBranchKeys.push(key);
            if ((isMyTenant && expandAllMyTenantBranches) || containsMe) {
              defaultOpenKeys.push(key);
            }
            return {
              key,
              id: key,
              name: dName,
              depth: 0,
              directMembers: list,
              children: [],
              totalCount: list.length,
              directCount: list.length,
              isMyDirectDept: isMyTenant && dName === activeMyDeptName,
              containsMe,
            };
          });

        const totalMatched = branches.reduce((s, b) => s + b.totalCount, 0);
        if (q && totalMatched === 0) return;

        groups.push({
          tenantName: tName,
          isHqTenant: false,
          isMyTenant,
          totalCount: totalMatched,
          branches,
          allBranchKeys,
          defaultOpenKeys,
        });
      }
    });

    return groups;
  }, [
    instructors,
    hqMemberById,
    orgNodes,
    searchKeyword,
    activeMyTenantName,
    activeMyDeptName,
    myInstId,
    expandAllMyTenantBranches,
  ]);

  // 최초 로드 시 내 소속 테넌트 + 기본 오픈 경로만 깔끔하게 자동 펼침 (타 지점·본사는 접힌 상태 유지)
  useEffect(() => {
    if (initializedRef.current || tenantGroups.length === 0) return;
    initializedRef.current = true;
    const myGroup =
      tenantGroups.find((g) => g.isMyTenant) || tenantGroups[0];
    if (myGroup) {
      setExpandedTenants([myGroup.tenantName]);
      setExpandedBranchKeys(myGroup.defaultOpenKeys);
    }
  }, [tenantGroups]);

  const isSearching = searchKeyword.trim().length > 0;

  const toggleTenant = (group: TenantTreeGroup) => {
    const isCurrentlyOpen = expandedTenants.includes(group.tenantName);
    if (isCurrentlyOpen) {
      setExpandedTenants((prev) =>
        prev.filter((x) => x !== group.tenantName)
      );
      return;
    }
    setExpandedTenants((prev) => [...prev, group.tenantName]);
    if (group.defaultOpenKeys.length > 0) {
      setExpandedBranchKeys((prev) => {
        const hasAnyOpen = group.allBranchKeys.some((k) => prev.includes(k));
        if (hasAnyOpen) return prev;
        return Array.from(new Set([...prev, ...group.defaultOpenKeys]));
      });
    }
  };

  const toggleBranch = (key: string) => {
    setExpandedBranchKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const expandAllInTenant = (group: TenantTreeGroup) => {
    if (!expandedTenants.includes(group.tenantName)) {
      setExpandedTenants((prev) => [...prev, group.tenantName]);
    }
    setExpandedBranchKeys((prev) =>
      Array.from(new Set([...prev, ...group.allBranchKeys]))
    );
  };

  const collapseAllInTenant = (group: TenantTreeGroup) => {
    const removeSet = new Set(group.allBranchKeys);
    setExpandedBranchKeys((prev) => prev.filter((k) => !removeSet.has(k)));
  };

  const renderMemberRow = (inst: any) => {
    const id = String(inst.instructor_id);
    const checked = selectedInstIds.includes(id);
    const isMe = id === String(myInstId);
    const avatar = resolveStoragePublicUrl(inst.profile_image_url);

    if (variant === "drawer") {
      return (
        <div
          key={id}
          className={`px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 bg-white transition-colors ${
            checked
              ? "border-brand bg-blue-50/40"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleSelect(id)}
              className="w-3.5 h-3.5 rounded accent-brand shrink-0"
            />
            <div className="relative w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-700 overflow-hidden shrink-0">
              <span>{(inst.name || "?").slice(0, 1)}</span>
              {avatar && (
                <img
                  src={avatar}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 truncate flex items-center gap-1">
                <span className="truncate">{inst.name}</span>
                {isMe && (
                  <span className="px-1 py-0.2 rounded bg-brand text-white text-[9.5px] font-extrabold shrink-0">
                    나
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-slate-400 truncate">
                {inst._displayPos || "구성원"}
              </div>
            </div>
          </label>

          {onDirectChat && (
            <button
              type="button"
              onClick={() => onDirectChat(inst)}
              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-brand hover:text-white text-[11px] font-bold text-slate-700 shrink-0 transition-colors"
            >
              대화
            </button>
          )}
        </div>
      );
    }

    return (
      <div
        key={id}
        onClick={() => onToggleSelect(id)}
        className={`bg-white px-2.5 py-2 rounded-xl border cursor-pointer transition-all flex items-center gap-2.5 ${
          checked
            ? "border-brand bg-blue-50/40"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <div
          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
            checked
              ? "bg-brand border-brand text-white"
              : "border-slate-300 bg-white"
          }`}
        >
          {checked ? "✓" : ""}
        </div>
        <div className="relative w-7.5 h-7.5 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 font-bold text-xs shrink-0 overflow-hidden">
          <span>{inst.name?.slice(0, 1) || "구"}</span>
          {avatar && (
            <img
              src={avatar}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-800 text-xs flex items-center gap-1">
            <span className="truncate">{inst.name}</span>
            {isMe && (
              <span className="px-1 py-0.2 bg-brand text-white text-[10px] rounded font-bold shrink-0">
                나
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {inst._displayPos || "구성원"}
          </div>
        </div>
      </div>
    );
  };

  const renderBranchNode = (branch: OrgTreeBranch): React.ReactNode => {
    const isExpanded =
      isSearching || expandedBranchKeys.includes(branch.key);
    const hasSubOrgs = branch.children.length > 0;
    const isEmptyAll =
      branch.directMembers.length === 0 && branch.children.length === 0;

    return (
      <div key={branch.key} className="select-none">
        <button
          type="button"
          onClick={() => toggleBranch(branch.key)}
          className={`w-full px-2.5 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
            hasSubOrgs
              ? "bg-slate-100/90 hover:bg-slate-200/70 border-slate-200/90 text-slate-800"
              : "bg-white hover:bg-slate-50 border-slate-200/85 text-slate-700"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <ChevronIcon expanded={isExpanded} />
            {branch.depth > 0 && (
              <span className="text-[11px] font-bold text-slate-300 shrink-0 -ml-0.5">
                └
              </span>
            )}
            <span className="text-xs shrink-0">
              {branch.name === "대표"
                ? "👑"
                : hasSubOrgs
                  ? isExpanded
                    ? "📂"
                    : "🗂️"
                  : isExpanded
                    ? "📂"
                    : "📁"}
            </span>
            <span
              className={`text-xs truncate ${
                hasSubOrgs ? "font-extrabold text-slate-800" : "font-bold text-slate-700"
              }`}
            >
              {branch.name}
            </span>
            {branch.isMyDirectDept && (
              <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 text-[10px] font-extrabold shrink-0">
                내 부서
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasSubOrgs && (
              <span className="px-1.5 py-0.2 rounded bg-white/90 border border-slate-200/80 text-[10px] font-bold text-slate-500">
                하위 {branch.children.length}
              </span>
            )}
            <span className="text-[11px] font-bold text-slate-400 tabular-nums">
              ({branch.totalCount})
            </span>
          </div>
        </button>

        {isExpanded && (
          <div className="mt-1.5 ml-3 pl-2.5 border-l-2 border-slate-200/90 space-y-1.5">
            {isEmptyAll ? (
              <div className="px-2.5 py-1.5 text-[11px] text-slate-400 font-medium">
                소속 구성원 없음
              </div>
            ) : (
              <>
                {branch.directMembers.length > 0 && (
                  <div className="space-y-1">
                    {branch.directMembers.map((inst) => renderMemberRow(inst))}
                  </div>
                )}

                {branch.children.length > 0 && (
                  <div className="space-y-1.5">
                    {branch.children.map((child) => renderBranchNode(child))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (tenantGroups.length === 0) {
    return (
      <div className="py-12 text-center text-xs font-bold text-slate-400">
        검색 결과가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {tenantGroups.map((group) => {
        const isTenantExpanded =
          isSearching || expandedTenants.includes(group.tenantName);
        const allBranchesOpen =
          group.allBranchKeys.length > 0 &&
          group.allBranchKeys.every((k) => expandedBranchKeys.includes(k));

        return (
          <div key={group.tenantName} className="space-y-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleTenant(group)}
                className="flex-1 px-3 py-2.5 rounded-xl bg-slate-200/85 hover:bg-slate-300/75 text-slate-800 text-xs font-extrabold flex items-center justify-between transition-colors min-w-0"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <ChevronIcon expanded={isTenantExpanded} />
                  <span className="truncate">🏢 {group.tenantName}</span>
                  {group.isMyTenant && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-brand text-[10px] rounded font-bold shrink-0">
                      내 소속
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                    ({group.totalCount}명)
                  </span>
                </span>
              </button>

              {isTenantExpanded && group.allBranchKeys.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    allBranchesOpen
                      ? collapseAllInTenant(group)
                      : expandAllInTenant(group)
                  }
                  className="px-2.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-[10.5px] font-bold text-slate-600 shrink-0 transition-colors"
                  title={
                    allBranchesOpen
                      ? "모든 부서 아코디언 접기"
                      : "모든 상·하위 부서 펼치기"
                  }
                >
                  {allBranchesOpen ? "모두 접기" : "모두 펼치기"}
                </button>
              )}
            </div>

            {isTenantExpanded && (
              <div className="ml-2 pl-2.5 border-l-2 border-slate-200 space-y-1.5">
                {group.branches.map((branch) => renderBranchNode(branch))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
