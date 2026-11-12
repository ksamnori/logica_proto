// src/app/clinic/ta/taAccess.ts
//
// 조교(TA) 및 클리닉 패드/채점 화면이 공유하는 인증·직책·로그아웃 유틸리티.
// 로그인 시 저장된 실명(logica_instructor_name)과 직책(logica_instructor_position)을 우선 사용하며,
// 세션이 살아있을 경우 instructor 테이블에서 최신 이름·직책을 동기화한다.

export const TA_NAME_STORAGE_KEY = 'logica_ta_name';
export const TA_POSITION_STORAGE_KEY = 'logica_ta_position';

export const resolvePositionLabel = (
  position?: string | null,
  role?: string | null
): string => {
  const cleanPos = String(position || '').trim();
  if (cleanPos) return cleanPos;

  const r = String(role || '').trim().toUpperCase();
  if (r === 'SUPER_ADMIN') return '최고관리자';
  if (r === 'PRINCIPAL' || r === 'DIRECTOR') return '원장';
  if (r === 'VICE_ADMIN') return '부원장';
  if (r === 'ADMIN' || r === 'MANAGER') return '실장';
  if (r === 'TA') return '조교';
  if (r === 'GUEST') return '게스트';
  if (r === 'TEACHER') return '강사';
  return '';
};

export const getInstructorName = (): string => {
  if (typeof window === 'undefined') return '';
  return (
    localStorage.getItem('logica_instructor_name')?.trim() ||
    localStorage.getItem(TA_NAME_STORAGE_KEY)?.trim() ||
    ''
  );
};

export const getInstructorPosition = (): string => {
  if (typeof window === 'undefined') return '';
  const storedPos =
    localStorage.getItem('logica_instructor_position') ||
    localStorage.getItem(TA_POSITION_STORAGE_KEY) ||
    '';
  const storedRole = localStorage.getItem('logica_instructor_role') || '';
  return resolvePositionLabel(storedPos, storedRole);
};

export const seedTaTenantId = () => {
  if (typeof window === 'undefined') return;
  const tenantId = process.env.NEXT_PUBLIC_TA_TENANT_ID || '';
  if (tenantId && !localStorage.getItem('logica_tenant_id')) {
    localStorage.setItem('logica_tenant_id', tenantId);
  }
};

export async function syncInstructorProfile(supabaseClient: any): Promise<{
  instructorId: string;
  name: string;
  position: string;
}> {
  if (typeof window === 'undefined') {
    return { instructorId: '', name: '', position: '' };
  }

  let instId = localStorage.getItem('logica_instructor_id') || '';
  let name = getInstructorName();
  let position = getInstructorPosition();

  try {
    if (!instId && supabaseClient?.auth?.getSession) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.user?.id) {
        instId = session.user.id;
      }
    }

    if (instId && supabaseClient?.from) {
      const { data: inst } = await supabaseClient
        .from('instructor')
        .select('instructor_id, name, position, role, tenant_id')
        .eq('instructor_id', instId)
        .maybeSingle();

      if (inst) {
        name = String(inst.name || name || '').trim();
        position = resolvePositionLabel(inst.position, inst.role) || position;

        localStorage.setItem('logica_instructor_id', inst.instructor_id);
        if (name) {
          localStorage.setItem('logica_instructor_name', name);
          localStorage.setItem(TA_NAME_STORAGE_KEY, name);
        }
        if (inst.role) {
          localStorage.setItem('logica_instructor_role', inst.role);
        }
        localStorage.setItem('logica_instructor_position', inst.position || '');
        if (position) {
          localStorage.setItem(TA_POSITION_STORAGE_KEY, position);
        }
        if (inst.tenant_id && !localStorage.getItem('logica_tenant_id')) {
          localStorage.setItem('logica_tenant_id', inst.tenant_id);
        }
      }
    }
  } catch {
    // 네트워크 일시 오류 시 기존 로컬 캐시 값 유지
  }

  if (name) {
    localStorage.setItem(TA_NAME_STORAGE_KEY, name);
    seedTaTenantId();
  }
  if (position) {
    localStorage.setItem(TA_POSITION_STORAGE_KEY, position);
  }

  return { instructorId: instId, name, position };
}

export async function performTaLogout(supabaseClient: any): Promise<void> {
  if (typeof window === 'undefined') return;
  const preservedKioskId = localStorage.getItem('__kiosk_test_device_id');

  try {
    await supabaseClient?.auth?.signOut?.();
  } catch {
    // 세션 만료 상태에서도 로컬 정리는 계속 수행
  }

  localStorage.clear();
  if (preservedKioskId) {
    localStorage.setItem('__kiosk_test_device_id', preservedKioskId);
  }
  sessionStorage.clear();
  document.cookie = 'sb-access-token=; path=/; max-age=0;';
  document.cookie = 'logica_tenant_id=; path=/; max-age=0;';
}
