// src/lib/hq/messengerOrgFilter.ts

export interface OrgAssignmentLike {
  org_name?: string | null;
}

/**
 * 테넌트명이 본사(본부/천종현수학연구소)인지 판별합니다.
 */
export function isHqTenantName(name?: string | null): boolean {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed) return false;
  return (
    trimmed === "본사" ||
    trimmed.includes("천종현") ||
    trimmed.includes("본부")
  );
}

/**
 * 부서명이 IT전략팀(대소문자·공백 무관: 'IT전략팀', 'it전략팀', 'IT 전략팀', 'IT전략' 등)인지 판별합니다.
 */
export function isItStrategyDept(dept?: string | null): boolean {
  if (!dept) return false;
  const normalized = String(dept).replace(/\s+/g, "").toLowerCase();
  return normalized.includes("it전략");
}

/**
 * 강사/본부 프로필·겸직 조직 정보를 종합하여 IT전략팀 소속 구성원인지 판별합니다.
 */
export function isItStrategyMember(params: {
  instDept?: string | null;
  hqDept?: string | null;
  orgAssignments?: OrgAssignmentLike[] | null;
}): boolean {
  if (isItStrategyDept(params.instDept)) return true;
  if (isItStrategyDept(params.hqDept)) return true;
  if (Array.isArray(params.orgAssignments)) {
    for (const asg of params.orgAssignments) {
      if (isItStrategyDept(asg?.org_name)) return true;
    }
  }
  return false;
}

/**
 * 메신저 조직도에서 비활성(유령 계정, 휴직, 퇴직/퇴사) 구성원인지 판별합니다.
 */
export function isInactiveForMessengerOrg(params: {
  instStatus?: string | null;
  workStatus?: string | null;
  isGhost?: boolean | null;
  isExplicitGhost?: boolean | null;
}): boolean {
  if (params.isGhost || params.isExplicitGhost) return true;
  const ws = params.workStatus ? String(params.workStatus).trim() : "";
  if (ws === "퇴직" || ws === "휴직" || ws === "퇴사") return true;
  const st = params.instStatus ? String(params.instStatus).trim() : "";
  if (st && st !== "재직") return true;
  return false;
}

/**
 * '학원쪽 IT전략팀' 조직도 비노출 규칙:
 * - 접속자 본인이(본부 또는 학원) IT전략팀 소속이 아니라면,
 *   학원 소속(비본부) IT전략팀 계정은 모든 메신저 조직도에서 숨깁니다.
 * - 본부 소속 IT전략팀은 일반 구성원에게도 정상 노출됩니다.
 * - IT전략팀 본인(학원/본부 무관)이 접속하면 모든 IT전략팀을 볼 수 있습니다.
 */
export function shouldHideAcademyItStrategyInOrg(params: {
  isHqTenant: boolean;
  isTargetItStrategy: boolean;
  viewerIsItStrategy: boolean;
}): boolean {
  if (params.isHqTenant) return false;
  if (!params.isTargetItStrategy) return false;
  return !params.viewerIsItStrategy;
}
