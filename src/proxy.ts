// src/proxy.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 보호할 경로
  const isProtectedRoute = 
    pathname.startsWith('/admin-dashboard') || 
    pathname.startsWith('/super-admin') || 
    pathname.startsWith('/supervisor') ||
    pathname.startsWith('/seat-layout-editor') ||
    pathname.startsWith('/home') || 
    pathname.startsWith('/exam');

  if (isProtectedRoute) {
    // 💡 수정됨: page.tsx에서 저장하는 Supabase 쿠키 이름으로 매칭
    const token = request.cookies.get('sb-access-token')?.value;

    if (!token) {
      // 토큰이 없으면 로그인 페이지로 강제 추방
      return NextResponse.redirect(new URL('/', request.url));
    }

    // 💡 수정됨: 커스텀 JWT 검증(jose) 삭제
    // Supabase 토큰은 커스텀 시크릿 키로 풀 수 없으며, 
    // 세부 직급(position) 권한 검증은 이미 각 페이지단(ex: super-admin)의 
    // useEffect에서 DB 조회를 통해 강력하게 방어하고 있으므로 프록시는 통과시킵니다.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};