// src/lib/hq/hqRouteUtils.ts

export function isHqSubdomainHost(rawHost?: string | null): boolean {
  if (!rawHost) return false;
  const host = rawHost.toLowerCase().split(":")[0].trim();
  return (
    host === "hq.logicaclass.com" ||
    host === "hq.localhost" ||
    host.startsWith("hq.")
  );
}

/**
 * 서브도메인(hq.logicaclass.com/leaves)과 로컬 경로(/hq/leaves) 모두를
 * 내부 표준 경로('/hq/leaves', '/hq', '/hq/login' 등)로 정규화합니다.
 */
export function toCanonicalHqPath(pathname?: string | null): string {
  if (!pathname || pathname === "/" || pathname === "/hq") return "/hq";
  if (pathname.startsWith("/hq/")) return pathname;
  return `/hq${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/**
 * 서브도메인(hq.logicaclass.com) 접속 시 '/hq/leaves' -> '/leaves', '/hq' -> '/'로 변환하여
 * 주소창을 깔끔한 루트 경로로 유지합니다.
 */
export function formatHqHref(href: string, isSubdomain: boolean): string {
  if (!isSubdomain) return href;
  if (href === "/hq") return "/";
  if (href.startsWith("/hq?")) return `/${href.slice(3)}`;
  if (href.startsWith("/hq/")) return href.slice(3);
  return href;
}

export const HQ_ROUTE_TAB_TITLES: Record<string, string> = {
  "/hq": "본부 홈 대시보드",
  "/hq/m": "본부 모바일 워크스페이스",
  "/hq/login": "본부 로그인",
  "/hq/signup": "본부 임직원 계정 등록",
  "/hq/notices": "사내 공지사항",
  "/hq/members": "구성원 · 인사 정보 관리",
  "/hq/org-chart": "본부 조직도",
  "/hq/meetings": "미팅 · 회의록",
  "/hq/attendance": "근무 · 유연근무",
  "/hq/leaves": "내 휴가",
  "/hq/work-management": "근무 관리",
  "/hq/leave-management": "휴가 관리",
  "/hq/approvals": "워크플로우",
  "/hq/contracts": "전자계약 · 저작권",
  "/hq/expenses": "비용 · 경비 정산",
  "/hq/payroll": "급여 · 인세 · 원천세",
  "/hq/year-end-tax": "연말정산",
  "/hq/insights": "인사이트",
  "/hq/publishing": "출판 공정 · ISBN 보드",
  "/hq/editorial": "집필 · 문항 분류 스튜디오",
  "/hq/messenger": "사내 메신저",
  "/hq/analytics": "진단평가 분석",
  "/hq/contest-db": "사고력 · 문장제 문제 DB",
  "/hq/permissions": "포털 권한 관리",
  "/hq/dev-tools": "개발자 데이터 관리 (Lv.6)",
  "/hq/settings": "본부 환경 설정",
};
