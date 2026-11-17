// src/lib/hq/orgTreeHelper.ts
import { DEFAULT_ORG_CHART_NODES } from "./defaultCompanySettings";
import type { HqMember, HqOrgChartNode, HqRankCode } from "./types";

export interface FlatOrgTreeOption {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  is_hidden: boolean;
  hasChildren: boolean;
  memberCount: number;
  indentedLabel: string;
}

export function normalizeOrgNodes(
  rawNodes?: HqOrgChartNode[] | null
): HqOrgChartNode[] {
  const src =
    Array.isArray(rawNodes) && rawNodes.length > 0
      ? rawNodes
      : DEFAULT_ORG_CHART_NODES;
  return [...src].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function countMembersInOrg(
  orgName: string,
  members: HqMember[] = []
): number {
  if (orgName === "퇴직") {
    return members.filter((m) => m.work_status === "퇴직").length;
  }
  return members.filter((m) => {
    if (m.work_status === "퇴직") return false;
    if (orgName === "대표" && m.rank_code === "CEO") return true;
    if ((m.department || "").trim() === orgName) return true;
    const subOrgs = m.profile_extra?.org_assignments || [];
    return subOrgs.some((a) => !a.is_primary && a.org_name === orgName);
  }).length;
}

/**
 * 조직도 설정(org_chart_nodes)을 계층 순서(DFS)로 평탄화하여 반환합니다.
 * includeHiddenSystemNodes = true 이면 플렉스 조직 선택 팝오버처럼 상단 (주)천종현수학연구소 / 퇴직 노드도 함께 반환합니다.
 */
export function buildFlatOrgTreeOptions(
  rawNodes?: HqOrgChartNode[] | null,
  members: HqMember[] = [],
  options?: { includeHiddenSystemNodes?: boolean; excludeRetired?: boolean }
): FlatOrgTreeOption[] {
  const nodes = normalizeOrgNodes(rawNodes);
  const includeHidden = Boolean(options?.includeHiddenSystemNodes);
  const excludeRetired = options?.excludeRetired !== false;

  const filtered = nodes.filter((n) => {
    if (excludeRetired && n.name === "퇴직") return false;
    if (!includeHidden && n.is_hidden) return false;
    return true;
  });

  const validIds = new Set(filtered.map((n) => n.id));
  const childrenByParent = new Map<string | null, HqOrgChartNode[]>();

  filtered.forEach((n) => {
    const pid = n.parent_id && validIds.has(n.parent_id) ? n.parent_id : null;
    const arr = childrenByParent.get(pid) || [];
    arr.push(n);
    childrenByParent.set(pid, arr);
  });

  const result: FlatOrgTreeOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) || [];
    children.forEach((node) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const sub = childrenByParent.get(node.id) || [];
      const prefix =
        depth === 0 ? "" : `${"　".repeat(Math.max(0, depth - 1))}└ `;
      result.push({
        id: node.id,
        name: node.name,
        parent_id: parentId,
        depth,
        is_hidden: Boolean(node.is_hidden),
        hasChildren: sub.length > 0,
        memberCount: countMembersInOrg(node.name, members),
        indentedLabel: `${prefix}${node.name}`,
      });
      walk(node.id, depth + 1);
    });
  };

  walk(null, 0);

  // 혹시 고아 노드가 있다면 누락 없이 뒤에 추가
  filtered.forEach((n) => {
    if (!visited.has(n.id)) {
      result.push({
        id: n.id,
        name: n.name,
        parent_id: null,
        depth: 0,
        is_hidden: Boolean(n.is_hidden),
        hasChildren: false,
        memberCount: countMembersInOrg(n.name, members),
        indentedLabel: n.name,
      });
    }
  });

  return result;
}

/**
 * 회원가입 / 구성원 등록 / 필터 등에서 사용할 표준 조직 이름 목록
 * (조직도 설정에 등록된 실제 표시 조직만 순서대로 반환)
 */
export function getRegisteredOrgNames(
  rawNodes?: HqOrgChartNode[] | null,
  options?: { excludeCeoRoot?: boolean }
): string[] {
  const flat = buildFlatOrgTreeOptions(rawNodes, [], {
    includeHiddenSystemNodes: false,
    excludeRetired: true,
  });
  const list = flat
    .filter((item) => !(options?.excludeCeoRoot && item.name === "대표"))
    .map((item) => item.name);

  return list.length > 0
    ? list
    : ["집필팀", "디자인", "영업팀", "관리팀", "마케팅"];
}

/**
 * 플렉스식 직위(position) · 직책(title) · 조직장(isLeader) 조합으로부터
 * 내부 결재/권한 호환용 HqRankCode를 자동 추론합니다.
 */
export function inferRankCodeFromHrSelection(params: {
  orgName: string;
  position?: string;
  title?: string;
  isLeader?: boolean;
  fallbackRank?: HqRankCode;
}): HqRankCode {
  const pos = (params.position || "").trim();
  const ttl = (params.title || "").trim();
  const combined = `${pos} ${ttl}`;

  if (params.orgName === "대표" || /대표|소장|사장|원장/.test(combined)) {
    return "CEO";
  }
  if (/본부장|이사|부원장|총괄/.test(combined)) {
    return "DIRECTOR";
  }
  if (params.isLeader || /팀장|실장|편집장|부장|파트장/.test(combined)) {
    return "TEAM_LEAD";
  }
  if (/선임|책임|수석|과장|차장|대리/.test(combined)) {
    return "SENIOR";
  }
  return "STAFF";
}
