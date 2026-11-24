// src/lib/hq/messengerDirectoryClient.ts
import { FALLBACK_TENANT_NAMES } from "@/lib/hq/constants";
import {
  isHqTenantName,
  isInactiveForMessengerOrg,
  isItStrategyMember,
  shouldHideAcademyItStrategyInOrg,
} from "@/lib/hq/messengerOrgFilter";
import type { HqMember } from "@/lib/hq/types";
import { supabase } from "@/lib/supabase";

export interface DirectoryInstructorRow {
  instructor_id: string;
  name: string;
  position?: string;
  chat_position?: string;
  profile_image_url?: string | null;
  department?: string;
  tenant_id?: string | null;
  role?: string;
  status?: string;
  work_status?: string;
  is_hq_tenant?: boolean;
  is_explicit_ghost?: boolean;
  is_ghost?: boolean;
  is_dev_super_admin?: boolean;
  is_it_strategy?: boolean;
  academy_tenant?: { name: string };
}

export interface MessengerDirectoryResult {
  instructors: DirectoryInstructorRow[];
  callerIsItStrategy: boolean;
}

/**
 * 본부 메신저(PC 드로어 · PC 전체화면 · 모바일)에서 공통으로 사용하는 조직도 조회 클라이언트.
 * 서버 /api/chat/org-directory를 우선 호출하여 유령·휴직·퇴직 및 학원측 IT전략팀 비노출 규칙을 일괄 적용하고,
 * 예외 상황 시 클라이언트 폴백에도 동일한 필터를 적용합니다.
 */
export async function fetchHqMessengerDirectory(params: {
  myInstId: string;
  myMember?: HqMember | null;
}): Promise<MessengerDirectoryResult> {
  const { myInstId, myMember } = params;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/chat/org-directory", {
      cache: "no-store",
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
    });

    if (res.ok) {
      const json = (await res.json()) as {
        success?: boolean;
        data?: {
          instructors?: DirectoryInstructorRow[];
          callerIsItStrategy?: boolean;
        };
      };
      if (json?.success && json.data) {
        const callerIsIt =
          typeof json.data.callerIsItStrategy === "boolean"
            ? json.data.callerIsItStrategy
            : isItStrategyMember({
                hqDept: myMember?.department,
                orgAssignments: myMember?.profile_extra?.org_assignments,
              });
        return {
          instructors: json.data.instructors || [],
          callerIsItStrategy: callerIsIt,
        };
      }
    }
  } catch {
    // 폴백으로 진행
  }

  const safeTenantMap: Record<string, string> = {
    ...FALLBACK_TENANT_NAMES,
  };
  try {
    const { data: tenantData } = await supabase
      .from("academy_tenant")
      .select("tenant_id, name");
    if (tenantData) {
      (tenantData as Array<{ tenant_id: string; name: string }>).forEach(
        (t) => {
          safeTenantMap[String(t.tenant_id)] = t.name;
        }
      );
    }
  } catch {
    // ignore
  }

  const { data: instData } = await supabase
    .from("instructor")
    .select("*")
    .eq("status", "재직")
    .order("name");

  const rawRows = (instData || []) as DirectoryInstructorRow[];
  const meRow = rawRows.find(
    (r) => String(r.instructor_id) === String(myInstId)
  );
  const callerIsItStrategy = isItStrategyMember({
    instDept: meRow?.department,
    hqDept: myMember?.department,
    orgAssignments: myMember?.profile_extra?.org_assignments,
  });

  const filtered: DirectoryInstructorRow[] = [];
  rawRows.forEach((inst) => {
    const tName = safeTenantMap[String(inst.tenant_id)] || "소속 미지정";
    const isHqTenant = Boolean(inst.is_hq_tenant) || isHqTenantName(tName);
    const isTargetItStrategy = isItStrategyMember({
      instDept: inst.department,
    });

    if (
      isInactiveForMessengerOrg({
        instStatus: inst.status,
        workStatus: inst.work_status,
        isGhost: inst.is_ghost,
        isExplicitGhost: inst.is_explicit_ghost,
      })
    ) {
      return;
    }

    if (
      shouldHideAcademyItStrategyInOrg({
        isHqTenant,
        isTargetItStrategy,
        viewerIsItStrategy: callerIsItStrategy,
      })
    ) {
      return;
    }

    filtered.push({
      ...inst,
      is_hq_tenant: isHqTenant,
      is_it_strategy: isTargetItStrategy,
      academy_tenant: { name: tName },
    });
  });

  return {
    instructors: filtered,
    callerIsItStrategy,
  };
}
