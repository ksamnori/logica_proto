// src/lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfwlmbwornivkrvoeqdh.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmd2xtYndvcm5pdmtydm9lcWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDUzNzQsImV4cCI6MjA5NTMyMTM3NH0.Kh9MPHzUxf9xLRYTH_UqoIhxOm4lybA_OL8Z60H9vqo';

function getSupabaseSingleton(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  const g = window as any;
  if (!g._supabaseInstance) {
    g._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 토큰 자동 갱신(TOKEN_REFRESHED) 및 세션 복원(INITIAL_SESSION) 시 쿠키도 최신 상태로 동기화
    if (!g._supabaseAuthListenerBound) {
      g._supabaseAuthListenerBound = true;
      g._supabaseInstance.auth.onAuthStateChange((event: string, session: any) => {
        if (
          (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
          session?.access_token
        ) {
          document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=604800;`;
          try {
            const cachedInstId = localStorage.getItem('logica_instructor_id');
            const cachedTenantId = (localStorage.getItem('logica_tenant_id') || '').trim();
            if (
              cachedInstId &&
              cachedInstId === session.user?.id &&
              cachedTenantId &&
              cachedTenantId !== 'hq' &&
              cachedTenantId !== 'null' &&
              cachedTenantId !== 'undefined'
            ) {
              document.cookie = `logica_tenant_id=${cachedTenantId}; path=/; max-age=604800;`;
            }
          } catch {
            // 스토리지 접근 불가 환경 무시
          }
        }
      });
    }
  }
  return g._supabaseInstance;
}

export const supabase = getSupabaseSingleton();
export const CLINIC_ROOM = 'logica-clinic-room';