// src/proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const STATIC_ASSET_EXT =
  /\.(?:svg|png|ico|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|otf|mjs|js|css|map|pdf|txt|xml|json)$/i;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";
  const host = rawHost.toLowerCase().split(":")[0].trim();

  const isHqHost =
    host === "hq.logicaclass.com" ||
    host === "hq.localhost" ||
    host.startsWith("hq.");

  const isAcademyProdHost =
    host === "logicaclass.com" ||
    host === "www.logicaclass.com" ||
    host === "app.logicaclass.com";

  // =========================================================================
  // 1. 본부 전용 서브도메인 (hq.logicaclass.com / hq.localhost)
  // =========================================================================
  if (isHqHost) {
    if (pathname === "/favicon.ico") {
      const iconUrl = request.nextUrl.clone();
      iconUrl.pathname = "/favicon-hq.ico";
      return NextResponse.rewrite(iconUrl);
    }
    if (pathname === "/favicon.png") {
      const iconUrl = request.nextUrl.clone();
      iconUrl.pathname = "/favicon-hq.png";
      return NextResponse.rewrite(iconUrl);
    }

    // public 정적 파일은 그대로 서빙
    if (STATIC_ASSET_EXT.test(pathname) || pathname.startsWith("/fonts/")) {
      return NextResponse.next();
    }

    // 구 경로 호환 리다이렉트
    if (pathname === "/hq-login") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (pathname === "/hq-signup") {
      const url = request.nextUrl.clone();
      url.pathname = "/signup";
      return NextResponse.redirect(url);
    }

    // hq.logicaclass.com/hq/... 접속 시 주소창을 깔끔한 루트 경로(/...)로 정리
    if (pathname === "/hq" || pathname.startsWith("/hq/")) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.pathname = pathname.slice(3) || "/";
      return NextResponse.redirect(cleanUrl);
    }

    // hq.logicaclass.com/... -> 내부 라우트 /hq/... 로 Rewrite (주소창 유지)
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === "/" ? "/hq" : `/hq${pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // =========================================================================
  // 2. 일반 학원 운영 도메인(logicaclass.com)에서 본부(/hq) 직접 접근 원천 차단
  // =========================================================================
  if (
    isAcademyProdHost &&
    (pathname === "/hq" ||
      pathname.startsWith("/hq/") ||
      pathname === "/hq-login" ||
      pathname === "/hq-signup")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 로컬 개발(localhost:3000) 구 경로 호환
  if (pathname === "/hq-login") {
    return NextResponse.redirect(new URL("/hq/login", request.url));
  }
  if (pathname === "/hq-signup") {
    return NextResponse.redirect(new URL("/hq/signup", request.url));
  }

  // =========================================================================
  // 3. 학원 포털 보호 경로 체크
  // =========================================================================
  const isProtectedRoute =
    pathname.startsWith("/admin-dashboard") ||
    pathname.startsWith("/super-admin") ||
    pathname.startsWith("/supervisor") ||
    pathname.startsWith("/seat-layout-editor") ||
    pathname.startsWith("/home") ||
    pathname.startsWith("/exam") ||
    pathname.startsWith("/contest-db");

  if (isProtectedRoute) {
    const token = request.cookies.get("sb-access-token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};
