// src/app/api/hq/insights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readCompanySettingsServer } from "@/lib/hq/companySettingsServer";
import { resolveMemberPermissions } from "@/lib/hq/hqPermissionEngine";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildRecentMonths(count: number): string[] {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-indexed
  const list: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1));
    list.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return list;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const { settings } = await readCompanySettingsServer(supabaseAdmin);

    const resolved = resolveMemberPermissions({
      member: {
        instructor_id: caller.userId,
        name: caller.name,
        is_dept_head: caller.rankLevel >= 3,
        rank_code: caller.rankCode,
      },
      rawSettings: settings.extra_settings?.permission_settings,
      isDbHqAdmin: caller.isHqAdmin,
    });

    if (!resolved.canAccessRoute("/hq/insights") && !caller.isHqAdmin) {
      return apiFail("인사이트 열람 권한이 없습니다.", 403);
    }

    const monthsCount =
      Number(req.nextUrl.searchParams.get("months")) === 12 ? 12 : 6;
    const monthKeys = buildRecentMonths(monthsCount);
    const firstMonth = monthKeys[0];
    const startDate = `${firstMonth}-01`;

    const [payRes, expRes, attRes, pubRes] = await Promise.all([
      supabaseAdmin
        .from("hq_payroll")
        .select(
          "pay_month, pay_type, payee_name, department_or_role, book_or_project, gross_amount, net_amount, deduction_total, status"
        )
        .gte("pay_month", firstMonth)
        .order("pay_month", { ascending: true }),
      supabaseAdmin
        .from("hq_expense")
        .select(
          "expense_date, department, category, amount, settlement_status"
        )
        .gte("expense_date", startDate),
      supabaseAdmin
        .from("hq_attendance")
        .select(
          "instructor_id, department, work_date, work_mode, status, worked_minutes, overtime_minutes"
        )
        .gte("work_date", startDate),
      supabaseAdmin
        .from("hq_publication")
        .select(
          "pub_id, book_code, title, series_name, stage, proof_round, progress_pct, author_name, editor_name, list_price, print_run, press_deadline, publish_date, priority"
        )
        .order("updated_at", { ascending: false }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        monthKeys,
        payrollRows: payRes.data || [],
        expenseRows: (expRes.data || []).filter(
          (e: any) => e.settlement_status !== "반려"
        ),
        attendanceRows: attRes.data || [],
        publications: pubRes.data || [],
      },
    });
  } catch (e: any) {
    console.error("HQ insights GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
