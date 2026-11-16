// src/app/api/hq/auth/login-policy/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  appendHqAuditLog,
  readLoginAttemptRecords,
  writeLoginAttemptRecords,
} from "@/lib/hq/auditLogServer";
import { readCompanySettingsServer } from "@/lib/hq/companySettingsServer";
import {
  DEFAULT_SECURITY_SETTINGS,
  parseAutoLogoutSeconds,
} from "@/lib/hq/defaultSecuritySettings";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";

export const runtime = "nodejs";

function normalizeLoginKey(raw: string): string {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (/^[0-9-]+$/.test(trimmed)) {
    return trimmed.replace(/[^0-9]/g, "");
  }
  return trimmed;
}

function parseMaxAttempts(label?: string): number {
  const m = /(\d+)/.exec(String(label || "5회"));
  return m ? Math.max(1, Number(m[1])) : 5;
}

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { settings } = await readCompanySettingsServer(supabaseAdmin);
    const sec = {
      ...DEFAULT_SECURITY_SETTINGS,
      ...(settings.extra_settings?.security_settings || {}),
    };

    return NextResponse.json({
      success: true,
      data: {
        allow_email_login: sec.allow_email_login,
        allow_phone_login: sec.allow_phone_login,
        allow_passkey_login: sec.allow_passkey_login,
        login_max_attempts: sec.login_max_attempts,
        pc_auto_logout: sec.pc_auto_logout,
        pc_auto_logout_seconds: parseAutoLogoutSeconds(sec.pc_auto_logout),
        mobile_auto_logout: sec.mobile_auto_logout,
        mobile_auto_logout_seconds: parseAutoLogoutSeconds(
          sec.mobile_auto_logout
        ),
        allow_on_leave_login: sec.allow_on_leave_login,
      },
    });
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdmin();
    const { settings } = await readCompanySettingsServer(supabaseAdmin);
    const sec = {
      ...DEFAULT_SECURITY_SETTINGS,
      ...(settings.extra_settings?.security_settings || {}),
    };

    // 관리자 잠금 해제 액션
    if (action === "UNLOCK") {
      const caller = await requireHqCaller(req);
      if (caller instanceof NextResponse) return caller;
      if (!caller.isHrManager && !caller.isHqAdmin) {
        return apiFail("잠금 해제는 인사관리자·최고관리자만 가능합니다.", 403);
      }

      const key = normalizeLoginKey(body?.identifier || "");
      const records = await readLoginAttemptRecords(supabaseAdmin);
      if (key && records[key]) {
        delete records[key];
        await writeLoginAttemptRecords(supabaseAdmin, records);
      }
      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "권한 변경",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "수정",
        info_type: "인사정보",
        description: `로그인 잠금 해제 (${key || "전체"})`,
        delegated: caller.isDelegatedHrAdmin,
      });
      return NextResponse.json({ success: true });
    }

    const key = normalizeLoginKey(body?.identifier || "");
    if (!key) return NextResponse.json({ success: true, locked: false });

    const records = await readLoginAttemptRecords(supabaseAdmin);
    const existing = records[key];
    const now = Date.now();

    if (action === "CHECK") {
      if (existing?.locked_until) {
        const untilMs = new Date(existing.locked_until).getTime();
        if (untilMs > now) {
          const remainMin = Math.max(1, Math.ceil((untilMs - now) / 60000));
          return NextResponse.json({
            success: true,
            locked: true,
            remainMinutes: remainMin,
            failCount: existing.fail_count,
          });
        }
      }
      return NextResponse.json({ success: true, locked: false });
    }

    if (action === "FAIL") {
      const maxAttempts = parseMaxAttempts(sec.login_max_attempts);
      const prevCount =
        existing?.locked_until &&
        new Date(existing.locked_until).getTime() <= now
          ? 0
          : Number(existing?.fail_count || 0);
      const nextCount = prevCount + 1;
      const isNowLocked = nextCount >= maxAttempts;
      const lockedUntil = isNowLocked
        ? new Date(now + 15 * 60 * 1000).toISOString()
        : null;

      records[key] = {
        identifier: key,
        fail_count: nextCount,
        locked_until: lockedUntil,
        last_failed_at: new Date(now).toISOString(),
      };
      await writeLoginAttemptRecords(supabaseAdmin, records);

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "인증",
        user_name: key,
        user_email: key.includes("@") ? key : `${key}@logica.com`,
        event_type: "생성",
        info_type: "-",
        description: isNowLocked
          ? `로그인 실패 누적(${nextCount}/${maxAttempts}회) — 계정 15분 잠금`
          : `로그인 실패 (${nextCount}/${maxAttempts}회)`,
      });

      return NextResponse.json({
        success: true,
        locked: isNowLocked,
        failCount: nextCount,
        maxAttempts,
        remainMinutes: isNowLocked ? 15 : 0,
      });
    }

    if (action === "SUCCESS") {
      if (records[key]) {
        delete records[key];
        await writeLoginAttemptRecords(supabaseAdmin, records);
      }
      const userName = String(body?.user_name || "본부 구성원");
      const userEmail = String(body?.user_email || "-");
      const department = String(body?.department || "");
      const userId = String(body?.user_id || "");

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "인증",
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        department,
        event_type: "생성",
        info_type: "-",
        description: "로그인 성공",
      });
      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "인증",
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        department,
        event_type: "생성",
        info_type: "-",
        description: "인증토큰 생성",
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ login-policy POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
