// src/app/api/hq/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  FALLBACK_HQ_TENANT_ID,
  getRankMeta,
  HQ_RANKS,
} from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
} from "@/lib/hq/serverAuth";
import type { HqRankCode } from "@/lib/hq/types";

export const runtime = "nodejs";

async function checkHasTopAdmin(supabaseAdmin: ReturnType<typeof getSupabaseAdmin>) {
  let hqTenantId = FALLBACK_HQ_TENANT_ID;
  const { data: tenantRow } = await supabaseAdmin
    .from("academy_tenant")
    .select("tenant_id")
    .eq("tenant_type", "HQ")
    .limit(1)
    .maybeSingle();
  if (tenantRow?.tenant_id) hqTenantId = String(tenantRow.tenant_id);

  const [execProfRes, superInstRes] = await Promise.all([
    supabaseAdmin
      .from("hq_member_profile")
      .select("instructor_id", { count: "exact", head: true })
      .in("rank_code", ["CEO", "DIRECTOR"]),
    supabaseAdmin
      .from("instructor")
      .select("instructor_id", { count: "exact", head: true })
      .eq("tenant_id", hqTenantId)
      .eq("role", "SUPER_ADMIN")
      .eq("status", "재직"),
  ]);

  const hasTopAdmin =
    (execProfRes.count ?? 0) > 0 || (superInstRes.count ?? 0) > 0;
  return { hqTenantId, hasTopAdmin };
}

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { hasTopAdmin } = await checkHasTopAdmin(supabaseAdmin);
    return NextResponse.json({ success: true, data: { hasTopAdmin } });
  } catch {
    return NextResponse.json({ success: true, data: { hasTopAdmin: true } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    const rawPhone = String(body?.phone || "").trim();
    const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
    const password = String(body?.password || "").trim();
    const department = String(body?.department || "").trim();

    if (!name || !cleanPhone || !password || !department) {
      return apiFail("이름, 연락처, 비밀번호, 소속 부서를 모두 입력해주세요.");
    }
    if (!/^010\d{8}$/.test(cleanPhone)) {
      return apiFail("올바른 휴대폰 번호 11자리(010-XXXX-XXXX)를 입력해주세요.");
    }
    if (password.length < 6) {
      return apiFail("비밀번호는 최소 6자리 이상이어야 합니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { hqTenantId, hasTopAdmin } = await checkHasTopAdmin(supabaseAdmin);

    const requestedRank: HqRankCode =
      body?.rank_code && body.rank_code in HQ_RANKS
        ? (body.rank_code as HqRankCode)
        : "STAFF";

    // 최고관리자가 이미 존재하면 셀프 가입 시 사원(Lv.1)·선임(Lv.2)으로만 가입 가능 (팀장·임원·관리자는 최고관리자가 배정)
    const rankCode: HqRankCode =
      hasTopAdmin &&
      (requestedRank === "TEAM_LEAD" ||
        requestedRank === "DIRECTOR" ||
        requestedRank === "CEO")
        ? "STAFF"
        : requestedRank;

    const jobTitle =
      String(body?.job_title || "").trim() || getRankMeta(rankCode).defaultTitle;

    const formattedPhone = `${cleanPhone.slice(0, 3)}-${cleanPhone.slice(
      3,
      7
    )}-${cleanPhone.slice(7, 11)}`;
    const authEmail = `${cleanPhone}@logica.com`;

    const { data: createdAuth, error: authErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
      });

    if (authErr || !createdAuth?.user?.id) {
      const msg = authErr?.message || "";
      if (/already|registered|exists/i.test(msg)) {
        return apiFail(
          "이미 가입된 연락처입니다. 로그인 페이지에서 로그인해주세요."
        );
      }
      return apiFail(`계정 생성 실패: ${msg}`, 400);
    }

    const newUid = createdAuth.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);

    const { error: instErr } = await supabaseAdmin.from("instructor").insert({
      instructor_id: newUid,
      login_id: cleanPhone,
      name,
      email: authEmail,
      phone: formattedPhone,
      position: "본사 임직원",
      chat_position: jobTitle,
      role:
        !hasTopAdmin && (rankCode === "CEO" || rankCode === "DIRECTOR")
          ? "SUPER_ADMIN"
          : "ADMIN",
      tenant_id: hqTenantId,
      department,
      status: "재직",
    });

    if (instErr) {
      await supabaseAdmin.auth.admin.deleteUser(newUid).catch(() => {});
      return apiFail(`임직원 정보 등록 실패: ${instErr.message}`, 500);
    }

    const { error: profErr } = await supabaseAdmin
      .from("hq_member_profile")
      .upsert(
        {
          instructor_id: newUid,
          employee_no: `HQ-${year}-${newUid.slice(0, 4).toUpperCase()}`,
          department,
          rank_code: rankCode,
          job_title: jobTitle,
          is_dept_head:
            !hasTopAdmin &&
            (rankCode === "TEAM_LEAD" ||
              rankCode === "DIRECTOR" ||
              rankCode === "CEO"),
          employment_type:
            rankCode === "CEO" || rankCode === "DIRECTOR" ? "임원" : "정규직",
          work_status: "재직",
          hire_date: today,
          annual_leave_total: 15.0,
          annual_leave_used: 0.0,
          account_holder: name,
        },
        { onConflict: "instructor_id" }
      );

    if (profErr && !isMissingHqTableError(profErr)) {
      console.warn("hq_member_profile 가입 시 초기 저장 경고:", profErr.message);
    }

    return NextResponse.json({
      success: true,
      data: { instructor_id: newUid },
    });
  } catch (e: any) {
    console.error("HQ signup POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
