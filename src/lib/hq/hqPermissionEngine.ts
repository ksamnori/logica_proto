// src/lib/hq/hqPermissionEngine.ts
import {
  type CanonicalPermissionScope,
  DEFAULT_PERMISSION_SETTINGS,
  mergeScopeToCover,
  normalizePermissionScope,
  PERMISSION_ITEM_BY_KEY,
} from "./defaultPermissionSettings";
import { normalizeOrgNodes } from "./orgTreeHelper";
import type {
  HqMember,
  HqOrgChartNode,
  HqPermissionGroupItem,
  HqPermissionScope,
  HqPermissionSettings,
  HqProfileExtra,
  HqRankCode,
} from "./types";

export interface HqSidebarMenuPermDef {
  permKey: string;
  route: string;
  icon: string;
  label: string;
  sectionLabel: string;
  description: string;
  defaultForMember: boolean;
  defaultForOrgHead: boolean;
}

/**
 * 본부(HQ) 좌측 사이드바 전체 메뉴 정의 (표시 순서 동일)
 * - '/hq' (본부 홈 대시보드) 및 '내 프로필'은 로그인한 모든 본부 구성원 기본 진입점입니다.
 */
export const HQ_SIDEBAR_MENU_PERM_ITEMS: HqSidebarMenuPermDef[] = [
  {
    permKey: "menu.notices",
    route: "/hq/notices",
    icon: "📢",
    label: "공지",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "사내 공지사항 좌측 메뉴 노출 및 게시글 열람을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.members",
    route: "/hq/members",
    icon: "👥",
    label: "구성원",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "구성원 디렉토리 · 인사 정보 관리 메뉴 노출 및 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.org_chart",
    route: "/hq/org-chart",
    icon: "🏢",
    label: "조직도",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "본부 부서 트리 및 조직도 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.meetings",
    route: "/hq/meetings",
    icon: "💬",
    label: "미팅",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "사내 미팅 · 회의록 공유 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.attendance",
    route: "/hq/attendance",
    icon: "⏱️",
    label: "근무 (내 출퇴근)",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "본인 출퇴근 기록 및 유연근무 타임라인 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.leaves",
    route: "/hq/leaves",
    icon: "🏖️",
    label: "휴가 (내 휴가)",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "본인 연차·맞춤휴가 신청 및 사용 원장 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.work_management",
    route: "/hq/work-management",
    icon: "🕒",
    label: "근태 관리 > 근무 관리",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "관리자·조직장용 근무 관리(초과근무 보상 · 근태 마감) 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.leave_management",
    route: "/hq/leave-management",
    icon: "🗓️",
    label: "근태 관리 > 휴가 관리",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "관리자·조직장용 전사/부서 휴가 보유현황 · 맞춤휴가 부여 · 연차 조정 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.approvals",
    route: "/hq/approvals",
    icon: "📋",
    label: "워크플로우",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "전자결재 기안 · 승인 및 문서함 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.contracts",
    route: "/hq/contracts",
    icon: "📑",
    label: "전자계약 · 저작권",
    sectionLabel: "인사(HR) · 근태 · 워크플로우",
    description: "근로·연봉·외주·출판권 전자계약 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.expenses",
    route: "/hq/expenses",
    icon: "💳",
    label: "비용 · 경비 정산",
    sectionLabel: "경비 · 급여 · 경영",
    description: "법인카드·영수증 비용 청구 및 경비 정산 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.payroll",
    route: "/hq/payroll",
    icon: "💰",
    label: "급여 · 인세 · 원천세",
    sectionLabel: "경비 · 급여 · 경영",
    description: "급여 메뉴 접근을 허용합니다 (일반 직원은 본인 급여명세서만 조회, 급여관리 권한자는 전체 정산 가능).",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.year_end_tax",
    route: "/hq/year-end-tax",
    icon: "🧾",
    label: "연말정산",
    sectionLabel: "경비 · 급여 · 경영",
    description: "연말정산 간소화 PDF 제출 및 원천징수영수증 보관함 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.insights",
    route: "/hq/insights",
    icon: "📈",
    label: "인사이트",
    sectionLabel: "경비 · 급여 · 경영",
    description: "인력·근태·인건비/인세·출판 공정 핵심 경영 지표 대시보드 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: false,
  },
  {
    permKey: "menu.publishing",
    route: "/hq/publishing",
    icon: "📚",
    label: "출판 공정 · ISBN 보드",
    sectionLabel: "출판 제작 · 연구 DB",
    description: "도서 기획·교정·디자인·인쇄하판 공정 파이프라인 보드 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.analytics",
    route: "/hq/analytics",
    icon: "📊",
    label: "진단평가 분석",
    sectionLabel: "출판 제작 · 연구 DB",
    description: "전국 가맹점 진단평가 성취도 및 문항 통계 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: false,
  },
  {
    permKey: "menu.contest_db",
    route: "/hq/contest-db",
    icon: "📐",
    label: "사고력·문장제 문제 DB",
    sectionLabel: "출판 제작 · 연구 DB",
    description: "출판 연구소 전용 문항 검색 및 번역 관리 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: false,
  },
  {
    permKey: "menu.messenger",
    route: "/hq/messenger",
    icon: "💬",
    label: "사내 메신저",
    sectionLabel: "소통 · 시스템",
    description: "전사 임직원 실시간 대화 메신저 메뉴 접근을 허용합니다.",
    defaultForMember: true,
    defaultForOrgHead: true,
  },
  {
    permKey: "menu.settings",
    route: "/hq/settings",
    icon: "⚙️",
    label: "설정",
    sectionLabel: "소통 · 시스템",
    description: "회사 정보 · 인사 · 근태 · 급여 · 보안 · 권한 설정 메뉴 접근을 허용합니다.",
    defaultForMember: false,
    defaultForOrgHead: false,
  },
];

export const ROUTE_TO_MENU_PERM_KEY: Record<string, string> = Object.fromEntries(
  HQ_SIDEBAR_MENU_PERM_ITEMS.map((item) => [item.route, item.permKey])
);

function inferLegacyGroupMenuPerms(perms: Record<string, boolean>): Record<string, boolean> {
  const next = { ...perms };
  if (perms["member.directory_access"] || perms["hr.employment_manage"]) {
    next["menu.members"] = true;
  }
  if (perms["work.record_view"] || perms["work.stats_view"] || perms["work.record_edit"]) {
    next["menu.work_management"] = true;
  }
  if (perms["leave.balance_view"] || perms["leave.view"] || perms["leave.edit"]) {
    next["menu.leave_management"] = true;
  }
  if (perms["payroll.run"] || perms["hr.payslip_view"]) {
    next["menu.payroll"] = true;
  }
  if (perms["payroll.year_end"]) {
    next["menu.year_end_tax"] = true;
  }
  if (perms["insight.view"] || perms["payroll.run"]) {
    next["menu.insights"] = true;
  }
  if (
    perms["company.basic_manage"] ||
    perms["permission.manage"] ||
    perms["security.login_manage"]
  ) {
    next["menu.settings"] = true;
  }
  return next;
}

export function buildDefaultSuperAdminPermsAndScopes(): {
  permissions: Record<string, boolean>;
  scopes: Record<string, HqPermissionScope>;
} {
  const permissions: Record<string, boolean> = {};
  const scopes: Record<string, HqPermissionScope> = {};

  HQ_SIDEBAR_MENU_PERM_ITEMS.forEach((m) => {
    permissions[m.permKey] = true;
  });
  Object.keys(PERMISSION_ITEM_BY_KEY).forEach((k) => {
    permissions[k] = true;
    scopes[k] = "전체 구성원";
  });
  permissions["company.basic_manage"] = true;
  permissions["hr.employment_manage"] = true;
  permissions["payroll.run"] = true;
  permissions["payroll.year_end"] = true;
  permissions["insight.view"] = true;
  permissions["permission.manage"] = true;
  permissions["audit.view"] = true;
  permissions["security.login_manage"] = true;

  return { permissions, scopes };
}

/**
 * DB에 저장된 기존 permission_settings(v1)에 좌측 메뉴 권한 키가 아직 없을 때
 * 최초 1회 합리적인 기본 배분을 자동 주입하고, menu_linked_v2 저장 이후에는
 * 관리자가 설정한 ON/OFF 값을 100% 그대로 유지합니다.
 */
export function normalizeHqPermissionSettings(
  raw?: HqPermissionSettings | null
): HqPermissionSettings {
  const base = raw || DEFAULT_PERMISSION_SETTINGS;

  const superNames =
    Array.isArray(base.super_admin_names) && base.super_admin_names.length > 0
      ? base.super_admin_names
      : DEFAULT_PERMISSION_SETTINGS.super_admin_names;

  const superIds = Array.isArray(base.super_admin_ids) ? base.super_admin_ids : [];
  const defaultSuper = buildDefaultSuperAdminPermsAndScopes();
  const normalizedSuperPerms: Record<string, boolean> = {
    ...defaultSuper.permissions,
    ...(base.super_admin_permissions || {}),
  };
  const normalizedSuperScopes: Record<string, HqPermissionScope> = {
    ...defaultSuper.scopes,
    ...(base.super_admin_scopes || {}),
  };
  const overrides = base.member_overrides || {};

  if (base.menu_linked_v2) {
    return {
      ...DEFAULT_PERMISSION_SETTINGS,
      ...base,
      menu_linked_v2: true,
      super_admin_names: superNames,
      super_admin_ids: superIds,
      super_admin_permissions: normalizedSuperPerms,
      super_admin_scopes: normalizedSuperScopes,
      org_head_permissions: base.org_head_permissions || {},
      org_head_scopes: base.org_head_scopes || {},
      default_member_permissions: base.default_member_permissions || {},
      default_member_scopes: {
        ...(DEFAULT_PERMISSION_SETTINGS.default_member_scopes || {}),
        ...(base.default_member_scopes || {}),
      },
      groups: Array.isArray(base.groups) ? base.groups : [],
      member_overrides: overrides,
    };
  }

  // v1 -> v2 초기 자동 배분 (일반 신입/테스트 계정에 관리자 메뉴가 노출되지 않도록 정리)
  const migratedDefaultMember: Record<string, boolean> = {
    ...(base.default_member_permissions || {}),
  };
  HQ_SIDEBAR_MENU_PERM_ITEMS.forEach((item) => {
    if (migratedDefaultMember[item.permKey] === undefined) {
      migratedDefaultMember[item.permKey] = item.defaultForMember;
    }
  });

  const migratedOrgHead: Record<string, boolean> = {
    ...(base.org_head_permissions || {}),
  };
  HQ_SIDEBAR_MENU_PERM_ITEMS.forEach((item) => {
    if (item.defaultForOrgHead && migratedOrgHead[item.permKey] === undefined) {
      migratedOrgHead[item.permKey] = true;
    }
  });

  const rawGroups = Array.isArray(base.groups)
    ? base.groups
    : DEFAULT_PERMISSION_SETTINGS.groups;

  const migratedGroups: HqPermissionGroupItem[] = rawGroups.map((g) => ({
    ...g,
    member_ids: Array.isArray(g.member_ids) ? g.member_ids : [],
    permissions: inferLegacyGroupMenuPerms(g.permissions || {}),
  }));

  // 출판·편집 실무 그룹이 없으면 기본 추가 (기존 집필·디자인·마케팅 실무진 배정)
  const hasPubGroup = migratedGroups.some(
    (g) => g.id === "pg-publishing-team" || g.permissions?.["menu.publishing"]
  );
  if (!hasPubGroup) {
    migratedGroups.push({
      id: "pg-publishing-team",
      name: "출판 · 편집 제작",
      description: "출판 공정 · ISBN 보드 실무 접근 그룹",
      member_names: [
        "김동현",
        "김문수",
        "민세리",
        "박주원",
        "백시연",
        "심혜영",
        "원종준",
        "조원형",
        "최수연",
        "한민서",
      ],
      member_ids: [],
      permissions: {
        "menu.publishing": true,
      },
      scopes: {},
    });
  }

  return {
    ...DEFAULT_PERMISSION_SETTINGS,
    ...base,
    menu_linked_v2: true,
    super_admin_names: superNames,
    super_admin_ids: superIds,
    super_admin_permissions: normalizedSuperPerms,
    super_admin_scopes: normalizedSuperScopes,
    org_head_permissions: migratedOrgHead,
    org_head_scopes:
      base.org_head_scopes || DEFAULT_PERMISSION_SETTINGS.org_head_scopes,
    default_member_permissions: migratedDefaultMember,
    default_member_scopes: {
      ...(DEFAULT_PERMISSION_SETTINGS.default_member_scopes || {}),
      ...(base.default_member_scopes || {}),
    },
    groups: migratedGroups,
    member_overrides: overrides,
  };
}

export function isMemberInGroup(
  member: { instructor_id?: string; name?: string },
  group: HqPermissionGroupItem
): boolean {
  if (
    member.instructor_id &&
    Array.isArray(group.member_ids) &&
    group.member_ids.includes(member.instructor_id)
  ) {
    return true;
  }
  const cleanName = (member.name || "").trim();
  if (cleanName && Array.isArray(group.member_names)) {
    return group.member_names.includes(cleanName);
  }
  return false;
}

export interface MemberPermissionSubject {
  instructor_id?: string;
  name?: string;
  department?: string | null;
  rank_code?: HqRankCode;
  is_dept_head?: boolean;
  profile_extra?: HqProfileExtra | null;
}

function getMemberOrgNames(
  subject: MemberPermissionSubject | null | undefined,
  includeSecondary: boolean
): Set<string> {
  const out = new Set<string>();
  if (!subject) return out;

  const primaryDept = (subject.department || "").trim();
  if (primaryDept && primaryDept !== "미지정" && primaryDept !== "퇴직") {
    out.add(primaryDept);
  }
  if (subject.rank_code === "CEO") {
    out.add("대표");
  }

  const assignments = Array.isArray(subject.profile_extra?.org_assignments)
    ? subject.profile_extra!.org_assignments!
    : [];

  assignments.forEach((a) => {
    const orgName = (a?.org_name || "").trim();
    if (!orgName || orgName === "미지정" || orgName === "퇴직") return;
    if (a.is_primary || includeSecondary) {
      out.add(orgName);
    }
  });

  return out;
}

export function getOrgAndDescendantNames(
  rootOrgNames: Iterable<string>,
  rawOrgNodes?: HqOrgChartNode[] | null
): Set<string> {
  const allowed = new Set<string>();
  const seeds = Array.from(rootOrgNames).filter(
    (n) => n && n !== "미지정" && n !== "퇴직"
  );
  seeds.forEach((s) => allowed.add(s));
  if (seeds.length === 0) return allowed;

  const nodes = normalizeOrgNodes(rawOrgNodes).filter(
    (n) => n.name !== "퇴직"
  );
  const childrenByParentId = new Map<string, HqOrgChartNode[]>();
  nodes.forEach((n) => {
    if (!n.parent_id) return;
    const arr = childrenByParentId.get(n.parent_id) || [];
    arr.push(n);
    childrenByParentId.set(n.parent_id, arr);
  });

  const visitedIds = new Set<string>();
  const queue: HqOrgChartNode[] = nodes.filter((n) => allowed.has(n.name));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visitedIds.has(cur.id)) continue;
    visitedIds.add(cur.id);
    if (cur.name && cur.name !== "퇴직") {
      allowed.add(cur.name);
    }
    const kids = childrenByParentId.get(cur.id) || [];
    kids.forEach((k) => {
      if (!visitedIds.has(k.id)) queue.push(k);
    });
  }

  return allowed;
}

export function doesScopeMatchTargetMember(params: {
  actor: MemberPermissionSubject | null | undefined;
  target: MemberPermissionSubject | null | undefined;
  scope: CanonicalPermissionScope;
  orgNodes?: HqOrgChartNode[] | null;
}): boolean {
  const { actor, target, scope, orgNodes } = params;
  if (!actor || !target) return false;

  const isSelf = Boolean(
    actor.instructor_id &&
      target.instructor_id &&
      actor.instructor_id === target.instructor_id
  );
  if (isSelf) return true;

  if (scope === "본인만") return false;
  if (scope === "전체 구성원") return true;

  const targetOrgs = getMemberOrgNames(target, true);
  if (targetOrgs.size === 0) return false;

  let allowedOrgs: Set<string>;
  if (scope === "소속 주조직") {
    allowedOrgs = getMemberOrgNames(actor, false);
  } else if (scope === "소속 조직 전체") {
    allowedOrgs = getMemberOrgNames(actor, true);
  } else if (scope === "소속 주조직 및 하위 조직") {
    allowedOrgs = getOrgAndDescendantNames(
      getMemberOrgNames(actor, false),
      orgNodes
    );
  } else {
    // "소속 조직 전체 및 하위 조직"
    allowedOrgs = getOrgAndDescendantNames(
      getMemberOrgNames(actor, true),
      orgNodes
    );
  }

  for (const tOrg of targetOrgs) {
    if (allowedOrgs.has(tOrg)) return true;
  }
  return false;
}

export interface ResolvedMemberPermissionState {
  isSuperAdmin: boolean;
  isOrgHead: boolean;
  assignedGroups: HqPermissionGroupItem[];
  inheritedPermissions: Record<string, boolean>; // 개인 오버라이드 적용 전 (기본 + 조직장 + 소속그룹)
  personalOverrides: Record<string, boolean>; // 구성원 권한 탭에서 직접 지정한 ON/OFF
  effectivePermissions: Record<string, boolean>; // 최종 권한 맵
  effectiveScopes: Record<string, CanonicalPermissionScope>; // 최종 권한별 허용 범위 맵
  canAccessRoute: (canonicalHqPath: string) => boolean;
  canAccessTargetMember: (
    permKey: string,
    target: MemberPermissionSubject | null | undefined,
    orgNodes?: HqOrgChartNode[] | null
  ) => boolean;
}

export function resolveMemberPermissions(params: {
  member: MemberPermissionSubject | null;
  rawSettings?: HqPermissionSettings | null;
  isDbHqAdmin?: boolean;
  canAccessAnalyticsRpc?: boolean;
  hasContestAccess?: boolean;
}): ResolvedMemberPermissionState {
  const settings = normalizeHqPermissionSettings(params.rawSettings);
  const mem = params.member;

  if (!mem) {
    return {
      isSuperAdmin: false,
      isOrgHead: false,
      assignedGroups: [],
      inheritedPermissions: {},
      personalOverrides: {},
      effectivePermissions: {},
      effectiveScopes: {},
      canAccessRoute: (p) =>
        p === "/hq" || p === "/hq/login" || p === "/hq/signup",
      canAccessTargetMember: () => false,
    };
  }

  const cleanName = (mem.name || "").trim();
  const memId = mem.instructor_id || "";
  const inSuperList =
    (Boolean(memId) && Boolean(settings.super_admin_ids?.includes(memId))) ||
    (Boolean(cleanName) && settings.super_admin_names.includes(cleanName));

  // Lv.6 개발자 수퍼어드민, DB 최고관리자(시스템 오너) 또는 최고 관리자 그룹 포함자
  const isSuperAdmin = Boolean(
    mem.rank_code === "SUPER_ADMIN" || params.isDbHqAdmin || inSuperList
  );

  const isOrgHead = Boolean(
    mem.is_dept_head ||
      mem.rank_code === "TEAM_LEAD" ||
      mem.rank_code === "DIRECTOR" ||
      mem.rank_code === "CEO" ||
      mem.rank_code === "SUPER_ADMIN"
  );

  const assignedGroups = settings.groups.filter((g) => isMemberInGroup(mem, g));

  const inherited: Record<string, boolean> = {};
  const inheritedScopes: Record<string, CanonicalPermissionScope> = {};

  const applyLayerPermissionsAndScopes = (
    layerPerms: Record<string, boolean> | undefined,
    layerScopes: Record<string, HqPermissionScope> | undefined
  ) => {
    if (!layerPerms) return;
    Object.entries(layerPerms).forEach(([k, v]) => {
      if (!v) return;
      inherited[k] = true;
      const item = PERMISSION_ITEM_BY_KEY[k];
      if (!item) {
        inheritedScopes[k] = "전체 구성원";
        return;
      }
      const normScope = normalizePermissionScope(layerScopes?.[k], item);
      inheritedScopes[k] = mergeScopeToCover(inheritedScopes[k], normScope, item);
    });
  };

  if (mem.rank_code === "SUPER_ADMIN") {
    // Lv.6 개발자 수퍼어드민은 항상 모든 권한 및 전체 범위를 보유
    const allSuper = buildDefaultSuperAdminPermsAndScopes();
    Object.assign(inherited, allSuper.permissions);
    Object.keys(PERMISSION_ITEM_BY_KEY).forEach((k) => {
      inheritedScopes[k] = "전체 구성원";
    });
  } else if (isSuperAdmin) {
    // 최고 관리자 권한 그룹: 매트릭스에서 설정된 기능별 체크박스(기본 전체 ON)를 반영
    applyLayerPermissionsAndScopes(
      settings.super_admin_permissions,
      settings.super_admin_scopes
    );
    assignedGroups.forEach((g) => {
      applyLayerPermissionsAndScopes(g.permissions, g.scopes);
    });
    if (params.canAccessAnalyticsRpc) {
      inherited["menu.analytics"] = true;
    }
    if (params.hasContestAccess) {
      inherited["menu.contest_db"] = true;
    }
  } else {
    applyLayerPermissionsAndScopes(
      settings.default_member_permissions,
      settings.default_member_scopes
    );

    if (isOrgHead) {
      applyLayerPermissionsAndScopes(
        settings.org_head_permissions,
        settings.org_head_scopes
      );
    }

    assignedGroups.forEach((g) => {
      applyLayerPermissionsAndScopes(g.permissions, g.scopes);
    });

    if (params.canAccessAnalyticsRpc) {
      inherited["menu.analytics"] = true;
    }
    if (params.hasContestAccess) {
      inherited["menu.contest_db"] = true;
    }
  }

  // 개인별 오버라이드 (ID 우선, 이름 폴백 병합)
  const byNameOverride = cleanName
    ? settings.member_overrides?.[cleanName] || {}
    : {};
  const byIdOverride = mem.instructor_id
    ? settings.member_overrides?.[mem.instructor_id] || {}
    : {};
  const personalOverrides: Record<string, boolean> = {
    ...byNameOverride,
    ...byIdOverride,
  };

  const byNameScopeOverride = cleanName
    ? settings.member_scope_overrides?.[cleanName] || {}
    : {};
  const byIdScopeOverride = mem.instructor_id
    ? settings.member_scope_overrides?.[mem.instructor_id] || {}
    : {};
  const personalScopeOverrides: Record<string, HqPermissionScope> = {
    ...byNameScopeOverride,
    ...byIdScopeOverride,
  };

  const effective: Record<string, boolean> = { ...inherited };
  const effectiveScopes: Record<string, CanonicalPermissionScope> = {
    ...inheritedScopes,
  };

  if (mem.rank_code !== "SUPER_ADMIN") {
    Object.entries(personalOverrides).forEach(([k, val]) => {
      if (typeof val === "boolean") {
        effective[k] = val;
        if (val && !effectiveScopes[k]) {
          effectiveScopes[k] = normalizePermissionScope(
            personalScopeOverrides[k],
            PERMISSION_ITEM_BY_KEY[k]
          );
        }
      }
    });
    Object.entries(personalScopeOverrides).forEach(([k, rawScope]) => {
      if (effective[k]) {
        effectiveScopes[k] = normalizePermissionScope(
          rawScope,
          PERMISSION_ITEM_BY_KEY[k]
        );
      }
    });
  }

  const canAccessRoute = (canonicalPath: string): boolean => {
    if (
      canonicalPath === "/hq/dev-tools" ||
      canonicalPath.startsWith("/hq/dev-tools/") ||
      canonicalPath === "/hq/permissions" ||
      canonicalPath.startsWith("/hq/permissions/")
    ) {
      return mem.rank_code === "SUPER_ADMIN";
    }
    if (
      !canonicalPath ||
      canonicalPath === "/hq" ||
      canonicalPath === "/hq/login" ||
      canonicalPath === "/hq/signup"
    ) {
      return true;
    }
    if (mem.rank_code === "SUPER_ADMIN") return true;

    // 하위 경로 매칭 (예: /hq/approvals/123 -> /hq/approvals)
    const matchedMenu = HQ_SIDEBAR_MENU_PERM_ITEMS.find(
      (item) =>
        canonicalPath === item.route ||
        canonicalPath.startsWith(`${item.route}/`)
    );
    if (!matchedMenu) return true;
    return Boolean(effective[matchedMenu.permKey]);
  };

  const canAccessTargetMember = (
    permKey: string,
    target: MemberPermissionSubject | null | undefined,
    orgNodes?: HqOrgChartNode[] | null
  ): boolean => {
    if (!target) return false;
    if (mem.rank_code === "SUPER_ADMIN") return true;
    if (!effective[permKey]) return false;

    const item = PERMISSION_ITEM_BY_KEY[permKey];
    const scope =
      effectiveScopes[permKey] || normalizePermissionScope(undefined, item);

    return doesScopeMatchTargetMember({
      actor: mem,
      target,
      scope,
      orgNodes,
    });
  };

  return {
    isSuperAdmin,
    isOrgHead,
    assignedGroups,
    inheritedPermissions: inherited,
    personalOverrides,
    effectivePermissions: effective,
    effectiveScopes,
    canAccessRoute,
    canAccessTargetMember,
  };
}
