// src/app/api/hq/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  FALLBACK_HQ_TENANT_ID,
  getRankLevel,
  getRankMeta,
  HQ_RANKS,
  inferRankFromPosition,
} from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqMember, HqRankCode, HqWorkStatus } from "@/lib/hq/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const hqIds = Array.from(caller.hqTenantIds);

    // HQ 테넌트 소속 임직원 전체 조회 (+ 타 테넌트 소속 최고관리자가 접속한 경우 본인 포함)
    const { data: instRows, error: instErr } = await supabaseAdmin
      .from("instructor")
      .select("*")
      .order("created_at", { ascending: true });

    if (instErr) return apiFail(instErr.message, 500);

    const hqInstructors = (instRows || []).filter((row: any) => {
      const tId = row.tenant_id ? String(row.tenant_id) : "";
      if (caller.hqTenantIds.has(tId)) return true;
      if (String(row.instructor_id) === caller.userId) return true;
      return false;
    });

    let profileMap = new Map<string, any>();
    let schemaMissing = caller.schemaMissing;

    if (!schemaMissing) {
      const { data: profRows, error: profErr } = await supabaseAdmin
        .from("hq_member_profile")
        .select("*");

      if (profErr) {
        if (isMissingHqTableError(profErr)) {
          schemaMissing = true;
        } else {
          return apiFail(profErr.message, 500);
        }
      } else {
        (profRows || []).forEach((p: any) => {
          profileMap.set(String(p.instructor_id), p);
        });

        // 아직 hq_member_profile에 행이 없는 기존 본부 구성원 자동 초기화
        const missingRows = hqInstructors
          .filter((inst: any) => !profileMap.has(String(inst.instructor_id)))
          .map((inst: any, idx: number) => {
            const inf = inferRankFromPosition(inst.chat_position, inst.position);
            const seq = String(profileMap.size + idx + 1).padStart(3, "0");
            const year = inst.created_at
              ? new Date(inst.created_at).getFullYear()
              : new Date().getFullYear();
            const workStatus: HqWorkStatus =
              inst.status === "퇴사" || inst.status === "퇴직" ? "퇴직" : "재직";
            return {
              instructor_id: inst.instructor_id,
              employee_no: `HQ-${year}-${seq}-${String(inst.instructor_id).slice(0, 4).toUpperCase()}`,
              department: (inst.department || "미지정").trim() || "미지정",
              rank_code: inf.rankCode,
              job_title: inf.jobTitle,
              is_dept_head: inf.isDeptHead,
              employment_type: inf.rankCode === "CEO" || inf.rankCode === "DIRECTOR" ? "임원" : "정규직",
              work_status: workStatus,
              hire_date: inst.created_at ? String(inst.created_at).slice(0, 10) : null,
              annual_leave_total: 15.0,
              annual_leave_used: 0.0,
            };
          });

        if (missingRows.length > 0) {
          const { data: inserted } = await supabaseAdmin
            .from("hq_member_profile")
            .upsert(missingRows, { onConflict: "instructor_id" })
            .select("*");
          (inserted || []).forEach((p: any) => {
            profileMap.set(String(p.instructor_id), p);
          });
        }
      }
    }

    const members: HqMember[] = hqInstructors.map((inst: any, idx: number) => {
      const id = String(inst.instructor_id);
      const prof = profileMap.get(id);
      const inf = inferRankFromPosition(inst.chat_position, inst.position);
      const rankCode: HqRankCode =
        prof?.rank_code && prof.rank_code in HQ_RANKS
          ? (prof.rank_code as HqRankCode)
          : inf.rankCode;
      const rankMeta = getRankMeta(rankCode);
      const canSeePrivate = caller.isHrManager || id === caller.userId;

      const totalLeave = Number(prof?.annual_leave_total ?? 15);
      const usedLeave = Number(prof?.annual_leave_used ?? 0);
      const workStatus: HqWorkStatus =
        (prof?.work_status as HqWorkStatus) ||
        (inst.status === "퇴사" || inst.status === "퇴직" ? "퇴직" : "재직");

      const tId = inst.tenant_id ? String(inst.tenant_id) : null;

      return {
        instructor_id: id,
        name: inst.name || "이름 미등록",
        email: inst.email || "",
        phone: inst.phone || "",
        profile_image_url: inst.profile_image_url || inst.profile_image || null,
        tenant_id: tId,
        tenant_name:
          (tId && caller.tenantNames[tId]) ||
          (hqIds.includes(tId || "") ? "본사" : "본사 겸직"),
        is_hq_tenant: Boolean(tId && caller.hqTenantIds.has(tId)),
        employee_no:
          prof?.employee_no || `HQ-TEMP-${String(idx + 1).padStart(3, "0")}`,
        department: (prof?.department || inst.department || "미지정").trim() || "미지정",
        rank_code: rankCode,
        rank_level: getRankLevel(rankCode),
        rank_label: rankMeta.shortLabel,
        job_title: prof?.job_title || inf.jobTitle,
        is_dept_head: Boolean(prof?.is_dept_head ?? inf.isDeptHead),
        employment_type: prof?.employment_type || "정규직",
        work_status: workStatus,
        hire_date: prof?.hire_date || (inst.created_at ? String(inst.created_at).slice(0, 10) : null),
        resign_date: prof?.resign_date || null,
        birth_date: canSeePrivate ? prof?.birth_date || null : null,
        annual_leave_total: totalLeave,
        annual_leave_used: usedLeave,
        annual_leave_remain: Math.max(0, Number((totalLeave - usedLeave).toFixed(1))),
        bank_name: canSeePrivate ? prof?.bank_name || "" : "",
        bank_account: canSeePrivate ? prof?.bank_account || "" : "",
        account_holder: canSeePrivate ? prof?.account_holder || "" : "",
        extension_no: prof?.extension_no || "",
        emergency_contact: canSeePrivate ? prof?.emergency_contact || "" : "",
        address: canSeePrivate ? prof?.address || "" : "",
        job_description: prof?.job_description || "",
        hr_memo: caller.isHrManager ? prof?.hr_memo || "" : "",
        has_profile_row: Boolean(prof),
      };
    });

    members.sort((a, b) => {
      if (a.work_status !== b.work_status) {
        if (a.work_status === "재직") return -1;
        if (b.work_status === "재직") return 1;
      }
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      if (a.is_dept_head !== b.is_dept_head) return a.is_dept_head ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });

    return NextResponse.json({
      success: true,
      schemaMissing,
      extSchemaMissing: caller.extSchemaMissing,
      data: {
        meId: caller.userId,
        isHrManager: caller.isHrManager,
        isHqAdmin: caller.isHqAdmin,
        members,
      },
    });
  } catch (e: any) {
    console.error("HQ members GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHrManager) {
      return apiFail("인사 관리 권한(임원·경영지원·권한관리자)이 필요합니다.", 403);
    }
    if (caller.schemaMissing) {
      return apiFail("먼저 본부 전용 DB 테이블(hq_schema.sql)을 생성해 주세요.", 400);
    }

    const body = await req.json();
    const name = String(body?.name || "").trim();
    const rawPhone = String(body?.phone || "").trim();
    const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
    const password = String(body?.password || "").trim();
    const department = String(body?.department || "미지정").trim() || "미지정";
    const rankCode = (body?.rank_code as HqRankCode) || "STAFF";
    const jobTitle =
      String(body?.job_title || "").trim() || getRankMeta(rankCode).defaultTitle;

    if (!name || !cleanPhone || !password) {
      return apiFail("이름, 연락처(로그인 ID), 초기 비밀번호는 필수입니다.");
    }
    if (!/^010\d{8}$/.test(cleanPhone)) {
      return apiFail("올바른 휴대폰 번호 11자리(010-XXXX-XXXX)를 입력해주세요.");
    }
    if (password.length < 6) {
      return apiFail("초기 비밀번호는 최소 6자리 이상이어야 합니다.");
    }
    if (!(rankCode in HQ_RANKS)) {
      return apiFail("유효하지 않은 직급 코드입니다.");
    }

    const formattedPhone = `${cleanPhone.slice(0, 3)}-${cleanPhone.slice(3, 7)}-${cleanPhone.slice(7, 11)}`;
    const authEmail = `${cleanPhone}@logica.com`;
    const displayEmail = String(body?.email || "").trim() || authEmail;

    const supabaseAdmin = getSupabaseAdmin();
    const hqTenantId =
      Array.from(caller.hqTenantIds)[0] || FALLBACK_HQ_TENANT_ID;

    // 1. Supabase Auth 계정 생성 (현재 로그인된 관리자 세션을 덮어쓰지 않음!)
    const { data: createdAuth, error: authErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
      });

    if (authErr || !createdAuth?.user?.id) {
      const msg = authErr?.message || "";
      if (/already|registered|exists/i.test(msg)) {
        return apiFail("이미 등록된 연락처(계정)입니다.");
      }
      return apiFail(`계정 생성 실패: ${msg}`, 400);
    }

    const newUid = createdAuth.user.id;
    const hireDate = body?.hire_date || new Date().toISOString().slice(0, 10);
    const year = String(hireDate).slice(0, 4) || String(new Date().getFullYear());
    const empNo =
      String(body?.employee_no || "").trim() ||
      `HQ-${year}-${newUid.slice(0, 4).toUpperCase()}`;

    // 2. 메신저·공통 인증 호환용 instructor 행 생성 (HQ 테넌트 지정)
    const { error: instErr } = await supabaseAdmin.from("instructor").insert({
      instructor_id: newUid,
      login_id: cleanPhone,
      name,
      email: displayEmail,
      phone: formattedPhone,
      position: "본사 임직원",
      chat_position: jobTitle,
      role: rankCode === "CEO" || rankCode === "DIRECTOR" ? "SUPER_ADMIN" : "ADMIN",
      tenant_id: hqTenantId,
      department,
      status: "재직",
    });

    if (instErr) {
      await supabaseAdmin.auth.admin.deleteUser(newUid).catch(() => {});
      return apiFail(`구성원 기본 등록 실패: ${instErr.message}`, 500);
    }

    // 3. 본부 전용 Core HR 프로필 저장
    const { error: profErr } = await supabaseAdmin
      .from("hq_member_profile")
      .upsert(
        {
          instructor_id: newUid,
          employee_no: empNo,
          department,
          rank_code: rankCode,
          job_title: jobTitle,
          is_dept_head: Boolean(body?.is_dept_head),
          employment_type: String(body?.employment_type || "정규직"),
          work_status: "재직",
          hire_date: hireDate,
          annual_leave_total: Number(body?.annual_leave_total ?? 15),
          annual_leave_used: 0,
          bank_name: body?.bank_name || null,
          bank_account: body?.bank_account || null,
          account_holder: body?.account_holder || name,
          extension_no: body?.extension_no || null,
          emergency_contact: body?.emergency_contact || null,
          address: body?.address || null,
          job_description: body?.job_description || null,
          hr_memo: body?.hr_memo || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instructor_id" }
      );

    if (profErr) {
      return apiFail(`인사 프로필 저장 실패: ${profErr.message}`, 500);
    }

    return NextResponse.json({
      success: true,
      data: { instructor_id: newUid, name },
    });
  } catch (e: any) {
    console.error("HQ members POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (caller.schemaMissing) {
      return apiFail("먼저 본부 전용 DB 테이블(hq_schema.sql)을 생성해 주세요.", 400);
    }

    const body = await req.json();
    const targetId = String(body?.instructor_id || "").trim();
    if (!targetId) return apiFail("대상 구성원 ID가 없습니다.");

    const isSelf = targetId === caller.userId;
    if (!caller.isHrManager && !isSelf) {
      return apiFail("본인 정보 또는 인사관리자만 수정할 수 있습니다.", 403);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const profilePatch: Record<string, any> = { updated_at: nowIso };
    const instPatch: Record<string, any> = {};

    // 본인도 수정 가능한 셀프서비스 필드
    if (body.extension_no !== undefined) profilePatch.extension_no = body.extension_no || null;
    if (body.emergency_contact !== undefined) profilePatch.emergency_contact = body.emergency_contact || null;
    if (body.address !== undefined) profilePatch.address = body.address || null;
    if (body.birth_date !== undefined) profilePatch.birth_date = body.birth_date || null;
    if (body.bank_name !== undefined) profilePatch.bank_name = body.bank_name || null;
    if (body.bank_account !== undefined) profilePatch.bank_account = body.bank_account || null;
    if (body.account_holder !== undefined) profilePatch.account_holder = body.account_holder || null;
    if (body.job_description !== undefined) profilePatch.job_description = body.job_description || null;
    if (body.phone !== undefined) instPatch.phone = body.phone || null;
    if (body.email !== undefined) instPatch.email = body.email || null;

    // 인사관리자 전용 인사 발령/직급/연차/계약 필드
    if (caller.isHrManager) {
      if (body.name !== undefined && String(body.name).trim()) {
        instPatch.name = String(body.name).trim();
      }
      if (body.employee_no !== undefined) {
        profilePatch.employee_no = String(body.employee_no).trim() || null;
      }
      if (body.department !== undefined) {
        const dept = String(body.department).trim() || "미지정";
        profilePatch.department = dept;
        instPatch.department = dept;
      }
      if (body.rank_code !== undefined && body.rank_code in HQ_RANKS) {
        profilePatch.rank_code = body.rank_code;
      }
      if (body.job_title !== undefined) {
        const jt = String(body.job_title).trim() || "사원";
        profilePatch.job_title = jt;
        instPatch.chat_position = jt;
      }
      if (body.is_dept_head !== undefined) {
        profilePatch.is_dept_head = Boolean(body.is_dept_head);
      }
      if (body.employment_type !== undefined) {
        profilePatch.employment_type = String(body.employment_type);
      }
      if (body.work_status !== undefined) {
        const ws = String(body.work_status) as HqWorkStatus;
        profilePatch.work_status = ws;
        instPatch.status = ws === "퇴직" ? "퇴사" : "재직";
      }
      if (body.hire_date !== undefined) profilePatch.hire_date = body.hire_date || null;
      if (body.resign_date !== undefined) profilePatch.resign_date = body.resign_date || null;
      if (body.annual_leave_total !== undefined) {
        profilePatch.annual_leave_total = Number(body.annual_leave_total);
      }
      if (body.annual_leave_used !== undefined) {
        profilePatch.annual_leave_used = Number(body.annual_leave_used);
      }
      if (body.hr_memo !== undefined) {
        profilePatch.hr_memo = body.hr_memo || null;
      }
    }

    if (Object.keys(instPatch).length > 0) {
      const { error: instErr } = await supabaseAdmin
        .from("instructor")
        .update(instPatch)
        .eq("instructor_id", targetId);
      if (instErr) return apiFail(`기본 정보 수정 실패: ${instErr.message}`, 500);
    }

    const { error: profErr } = await supabaseAdmin
      .from("hq_member_profile")
      .upsert({ instructor_id: targetId, ...profilePatch }, { onConflict: "instructor_id" });

    if (profErr) return apiFail(`인사 프로필 수정 실패: ${profErr.message}`, 500);

    return NextResponse.json({ success: true, data: { instructor_id: targetId } });
  } catch (e: any) {
    console.error("HQ members PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
