// src/lib/localLogout.ts
// ============================================================================
// 로컬 기기 한정 로그아웃 유틸리티 (Supabase signOut 기본 global 범위 차단)
// - Supabase JS의 auth.signOut()은 인자를 생략하면 기본값이 scope: 'global'로 동작하여
//   동일 계정으로 접속 중인 다른 PC·스마트패드의 세션과 리프레시 토큰까지 일괄 폐기합니다.
// - 반드시 localStorage를 비우기 전에 signOut({ scope: 'local' })을 먼저 실행하고,
//   패드/키오스크 하드웨어 고유 식별 키는 보존한 채 인증 스토리지와 쿠키만 정리합니다.
// ============================================================================

const PRESERVED_DEVICE_KEYS = [
  '__kiosk_test_device_id',
  'logica_fallback_device_id',
  'logica_ta_client_id',
] as const;

export function clearLocalAuthStorage(): void {
  if (typeof window === 'undefined') return;

  const preserved: Array<[string, string]> = [];
  for (const key of PRESERVED_DEVICE_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      preserved.push([key, val]);
    }
  }

  localStorage.clear();
  for (const [key, val] of preserved) {
    localStorage.setItem(key, val);
  }

  sessionStorage.clear();
  document.cookie = 'sb-access-token=; path=/; max-age=0;';
  document.cookie = 'logica_tenant_id=; path=/; max-age=0;';
}

export async function signOutLocalSession(
  supabaseClient: any,
  options?: { clearStorage?: boolean }
): Promise<void> {
  try {
    await supabaseClient?.auth?.signOut?.({ scope: 'local' });
  } catch {
    // 네트워크 일시 오류 또는 이미 만료된 세션이어도 로컬 정리는 계속 수행
  }

  if (options?.clearStorage !== false) {
    clearLocalAuthStorage();
  }
}
