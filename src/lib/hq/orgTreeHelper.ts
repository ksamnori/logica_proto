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


/**
 * 특정 조직 노드(orgName)의 실제 조직장(대표 포함)을 탐색합니다.
 * - 개발자용 수퍼어드민(SUPER_ADMIN, Lv.6) 계정이더라도 해당 조직에 직접 배정되거나 조직장으로 지정된 경우에만 매칭되며,
 *   단순 직급 숫자(rank_level >= 5)로 인해 타 부서 개발자 계정이 대표 대신 선택되는 현상을 원천 차단합니다.
 */
export function findOrgNodeLeader(
  orgName: string,
  members: HqMember[] = [],
  options?: { isRootNode?: boolean }
): HqMember | undefined {
  const cleanOrg = (orgName || "").trim();
  if (!cleanOrg || cleanOrg === "퇴직" || cleanOrg === "미지정") {
    return undefined;
  }

  const activeMembers = members.filter(
    (m) => m.work_status === "재직" && !m.is_ghost
  );

  const isCeoLikeOrg =
    cleanOrg === "대표" ||
    cleanOrg.startsWith("대표") ||
    Boolean(options?.isRootNode);

  const directMembers = activeMembers.filter((m) => {
    if ((m.department || "").trim() === cleanOrg) return true;
    if (
      (m.profile_extra?.org_assignments || []).some(
        (a) => (a?.org_name || "").trim() === cleanOrg
      )
    ) {
      return true;
    }
    if (cleanOrg === "대표" && m.rank_code === "CEO") return true;
    return false;
  });

  // 1) org_assignments에서 해당 조직의 조직장(is_leader)으로 명시 지정된 구성원 우선
  const explicitLeader = directMembers.find((m) =>
    (m.profile_extra?.org_assignments || []).some(
      (a) => (a?.org_name || "").trim() === cleanOrg && Boolean(a?.is_leader)
    )
  );
  if (explicitLeader) return explicitLeader;

  // 2) 주조직(department) 일치 + is_dept_head 체크된 구성원
  const deptHead = directMembers.find(
    (m) => Boolean(m.is_dept_head) && (m.department || "").trim() === cleanOrg
  );
  if (deptHead) return deptHead;

  // 3) 최상위 '대표' 조직 노드의 경우 해당 노드에 배치된 대표 구성원 반환
  if (isCeoLikeOrg) {
    const directCeo =
      directMembers.find((m) => m.rank_code === "CEO") ||
      directMembers.find((m) => /대표|소장|사장/.test(m.job_title || "")) ||
      (cleanOrg.startsWith("대표") || directMembers.length === 1
        ? directMembers[0]
        : undefined);
    if (directCeo) return directCeo;

    if (cleanOrg.startsWith("대표")) {
      return (
        activeMembers.find((m) => m.rank_code === "CEO") ||
        activeMembers.find(
          (m) =>
            /대표/.test(m.job_title || "") && m.rank_code !== "SUPER_ADMIN"
        )
      );
    }
  }

  return undefined;
}

/**
 * 조직도(org_chart_nodes)의 부모-자식(parent_id) 계층을 따라
 * 기안자(member) 기준 바로 1단계 위 상사, 2단계 위 상사... 순서의 직속 결재 라인을 반환합니다.
 * - 일반 팀원 기안 시: [소속 팀 조직장, 상위 조직장(또는 대표), ...]
 * - 팀장(조직장) 본인 기안 시: 본인은 자동 제외되고 바로 1단계 상위 조직의 조직장(예: 대표)이 첫 번째(1차 조직장)로 반환됩니다.
 * - 최상위 대표 본인 기안 시: 위에 상위 조직장이 없으므로 빈 배열([])이 반환됩니다.
 */
export function resolveOrgSupervisorChain(params: {
  member: HqMember | null | undefined;
  members: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
}): HqMember[] {
  const { member, members, orgNodes } = params;
  if (!member) return [];

  const activeMembers = members.filter(
    (m) => m.work_status === "재직" && !m.is_ghost
  );
  const nodes = normalizeOrgNodes(orgNodes).filter((n) => n.name !== "퇴직");
  const nodeById = new Map<string, HqOrgChartNode>();
  nodes.forEach((n) => nodeById.set(n.id, n));

  const primaryAssignedOrg = (
    member.profile_extra?.org_assignments?.find((a) => a.is_primary)
      ?.org_name || ""
  ).trim();
  const deptName = (member.department || "").trim();
  const myOrgName =
    primaryAssignedOrg ||
    (deptName && deptName !== "미지정"
      ? deptName
      : member.rank_code === "CEO"
        ? "대표"
        : "");

  const ceoNode =
    nodes.find((n) => !n.is_hidden && n.name.trim() === "대표") ||
    nodes.find((n) => !n.is_hidden && n.name.trim().startsWith("대표")) ||
    nodes.find((n) => n.name.trim() === "대표") ||
    null;

  const startNode = myOrgName
    ? nodes.find((n) => !n.is_hidden && n.name.trim() === myOrgName) ||
      nodes.find((n) => n.name.trim() === myOrgName) ||
      null
    : null;

  const orgPath: { name: string; isRoot: boolean }[] = [];
  const visitedIds = new Set<string>();

  let cur: HqOrgChartNode | null = startNode;
  while (cur && !visitedIds.has(cur.id)) {
    visitedIds.add(cur.id);
    const parentNode = cur.parent_id ? nodeById.get(cur.parent_id) || null : null;
    if (!cur.is_hidden && cur.name.trim() && cur.name.trim() !== "미지정") {
      const isRoot = !parentNode || Boolean(parentNode.is_hidden);
      orgPath.push({ name: cur.name.trim(), isRoot });
    }
    cur = parentNode;
  }

  if (
    myOrgName &&
    myOrgName !== "미지정" &&
    !orgPath.some((p) => p.name === myOrgName)
  ) {
    orgPath.unshift({ name: myOrgName, isRoot: myOrgName.startsWith("대표") });
  }

  // 하위 부서가 parent_id 누락 등으로 최상위 '대표' 노드를 거치지 않은 경우 최상위 '대표' 노드를 상위로 연결
  if (
    ceoNode &&
    myOrgName !== ceoNode.name.trim() &&
    !orgPath.some((p) => p.name === ceoNode.name.trim())
  ) {
    orgPath.push({ name: ceoNode.name.trim(), isRoot: true });
  } else if (!ceoNode && myOrgName !== "대표" && !orgPath.some((p) => p.name === "대표")) {
    orgPath.push({ name: "대표", isRoot: true });
  }

  const supervisors: HqMember[] = [];
  const seenIds = new Set<string>();

  orgPath.forEach((entry) => {
    const leader = findOrgNodeLeader(entry.name, activeMembers, {
      isRootNode: entry.isRoot,
    });
    if (!leader) return;
    if (leader.instructor_id === member.instructor_id) return;
    if (seenIds.has(leader.instructor_id)) return;
    seenIds.add(leader.instructor_id);
    supervisors.push(leader);
  });

  return supervisors;
}


const NON_POSITION_SYSTEM_LABELS = new Set([
  "수퍼어드민",
  "개발자 수퍼어드민",
  "최고관리자",
  "승인자",
]);

export function isNonPositionSystemLabel(label?: string | null): boolean {
  const t = (label || "").trim();
  return !t || NON_POSITION_SYSTEM_LABELS.has(t);
}

/**
 * 구성원의 실제 현재 직위(인사 정보의 hr_position 최우선 -> 유효한 job_title -> 주조직 직책/부서 추론)를 반환합니다.
 * 포털 권한 등급명('수퍼어드민' 등)이 결재선 직위 자리에 노출되지 않도록 보호합니다.
 */
export function resolveMemberDisplayPosition(member?: {
  department?: string | null;
  rank_code?: string | null;
  job_title?: string | null;
  is_dept_head?: boolean | null;
  profile_extra?: {
    hr_position?: string | null;
    org_assignments?: {
      org_name?: string;
      is_primary?: boolean;
      is_leader?: boolean;
      title?: string;
    }[];
  } | null;
} | null): string {
  if (!member) return "";

  const hrPos = (member.profile_extra?.hr_position || "").trim();
  if (!isNonPositionSystemLabel(hrPos)) return hrPos;

  const jobTitle = (member.job_title || "").trim();
  if (!isNonPositionSystemLabel(jobTitle)) return jobTitle;

  const assignments = Array.isArray(member.profile_extra?.org_assignments)
    ? member.profile_extra!.org_assignments!
    : [];
  const primaryTitle = (
    assignments.find((a) => a.is_primary)?.title ||
    assignments[0]?.title ||
    ""
  ).trim();
  if (!isNonPositionSystemLabel(primaryTitle)) return primaryTitle;

  const dept = (member.department || "").trim();
  if (dept === "대표" || member.rank_code === "CEO") return "대표";
  if (member.rank_code === "DIRECTOR") return "이사";
  if (member.is_dept_head || member.rank_code === "TEAM_LEAD") return "팀장";
  if (member.rank_code === "SENIOR") return "선임";
  return "사원";
}
