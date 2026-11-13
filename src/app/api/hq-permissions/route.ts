// src/app/api/hq-permissions/route.ts
// 하위 호환용 위임 엔드포인트 (실제 로직은 src/app/api/hq/permissions/route.ts 에 분리 관리)
export const runtime = "nodejs";
export { GET, POST } from "@/app/api/hq/permissions/route";
