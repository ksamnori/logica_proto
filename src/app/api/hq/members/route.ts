// src/app/api/hq/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
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
import {
  generateEmployeeNoByPolicy,
  readCompanySettingsServer,
} from "@/lib/hq/companySettingsServer";
import { DEFAULT_ANNUAL_LEAVE_POLICY } from "@/lib/hq/defaultLeaveSettings";
import {
  computeMemberAnnualLeaveLedgerForYear,
  roundLeave4,
  type LeaveLedgerDocLite,
} from "@/lib/hq/leaveBalanceEngine";
import { readLeavesLedgerServer } from "@/lib/hq/leavesLedgerServer";
import type {
  HqMember,
  HqProfileExtra,
  HqRankCode,
  HqWorkStatus,
} from "@/lib/hq/types";

export const runtime = "nodejs";

function inferGenderFromRrnDigit(digit?: unknown): "" | "남" | "여" {
  const d = String(digit || "").trim();
  if (["1", "3", "5", "7"].includes(d)) return "남";
  if (["2", "4", "6", "8"].includes(d)) return "여";
  return "";
}

function sanitizeExtraForViewer(
  raw: any,
  canSeePrivate: boolean
): HqProfileExtra {
  const src: HqProfileExtra =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  // 성별은 오직 주민등록번호 뒷 첫자리(1~8)로만 자동 판별
  const inferredGender = inferGenderFromRrnDigit(src.rrn_gender_digit);

  if (!canSeePrivate) {
    return {
      nickname: src.nickname || "",
      bio: src.bio || "",
      gender: inferredGender,
      hr_effective_date: src.hr_effective_date || "",
      hr_jobs_selected: Array.isArray(src.hr_jobs_selected)
        ? src.hr_jobs_selected
        : [],
      hr_job_group: src.hr_job_group || "",
      hr_position: src.hr_position || "",
      hr_grade: src.hr_grade || "",
      org_assignments: Array.isArray(src.org_assignments)
        ? src.org_assignments
        : [],
      work_schedule_type: src.work_schedule_type || "기본 9시",
      work_schedule_mode: src.work_schedule_mode || "고정",
      weekly_work_hours: Number(src.weekly_work_hours ?? 40),
    };
  }

  return {
    nickname: src.nickname || "",
    bio: src.bio || "",
    personal_email: src.personal_email || "",
    group_hire_date: src.group_hire_date || "",
    hire_type: src.hire_type || "",
    hr_effective_date: src.hr_effective_date || "",
    hr_appointment_label: src.hr_appointment_label || "",
    hr_appointment_memo: src.hr_appointment_memo || "",
    hr_jobs_selected: Array.isArray(src.hr_jobs_selected)
      ? src.hr_jobs_selected
      : [],
    hr_job_group: src.hr_job_group || "",
    hr_position: src.hr_position || "",
    hr_grade: src.hr_grade || "",
    org_assignments: Array.isArray(src.org_assignments)
      ? src.org_assignments
      : [],
    rrn_front: src.rrn_front
      ? String(src.rrn_front).replace(/[^0-9]/g, "").slice(0, 6)
      : "",
    rrn_gender_digit: src.rrn_gender_digit
      ? String(src.rrn_gender_digit).replace(/[^0-9]/g, "").slice(0, 1)
      : "",
    gender: inferredGender,
    nationality: src.nationality || "대한민국(KOR)",
    postal_code: src.postal_code || "",
    work_schedule_type: src.work_schedule_type || "기본 9시",
    work_schedule_mode: src.work_schedule_mode || "고정",
    weekly_work_hours: Number(src.weekly_work_hours ?? 40),
    leave_policy_name: src.leave_policy_name || "기본 연차 정책",
    leave_policy_tags: Array.isArray(src.leave_policy_tags)
      ? src.leave_policy_tags
      : ["회계일 기준 부여", "시간 단위 사용", "연차 촉진 사용"],
    holiday_policy_name: src.holiday_policy_name || "기본 (14일)",
    holiday_summary:
      src.holiday_summary ||
      "1월 1일, 설날, 3·1절, 부처님 오신 날, 노동절, 어린이날, 현충일, 제헌절, 광복절, 추석, 개천절, 한글날, 성탄절...",
    special_notes: src.special_notes || "",
    labor_contract: src.labor_contract || {},
    wage_contract: src.wage_contract || {},
    leave_histories: Array.isArray(src.leave_histories) ? src.leave_histories : [],
    awards: Array.isArray(src.awards) ? src.awards : [],
    disciplines: Array.isArray(src.disciplines) ? src.disciplines : [],
    careers: Array.isArray(src.careers) ? src.careers : [],
    educations: Array.isArray(src.educations) ? src.educations : [],
    families: Array.isArray(src.families) ? src.families : [],
    growth_goals: Array.isArray(src.growth_goals) ? src.growth_goals : [],
    trainings: Array.isArray(src.trainings) ? src.trainings : [],
    change_logs: Array.isArray(src.change_logs) ? src.change_logs : [],
  };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const hqIds = Array.from(caller.hqTenantIds);

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

    const profileMap = new Map<string, any>();
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
              employment_type:
                inf.rankCode === "CEO" || inf.rankCode === "DIRECTOR"
                  ? "임원"
                  : "정규직",
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

    // 회사 연차 정책(당해 연말 12월 31일 사용 기준 포함)에 맞춰 올해 잔여 연차를 정밀 산정
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const curYear = kstNow.getUTCFullYear();
    const curMonth = kstNow.getUTCMonth() + 1;

    const [companySettings, leavesLedger, leaveDocsRes] = await Promise.all([
      readCompanySettingsServer(supabaseAdmin).catch(() => null),
      readLeavesLedgerServer(supabaseAdmin),
      !schemaMissing
        ? supabaseAdmin
            .from("hq_approval_doc")
            .select(
              "approval_id, drafter_id, status, effective_date, end_date, leave_type, leave_days"
            )
            .eq("doc_type", "LEAVE")
            .gte("effective_date", `${curYear}-01-01`)
            .lte("effective_date", `${curYear}-12-31`)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const activeAnnualPolicy =
      companySettings?.settings?.extra_settings?.annual_leave_settings
        ?.policies?.[0] || DEFAULT_ANNUAL_LEAVE_POLICY;
    const yearLeaveDocs: LeaveLedgerDocLite[] = (
      leaveDocsRes?.data || []
    ).map((r: any) => ({
      approval_id: String(r.approval_id),
      drafter_id: String(r.drafter_id),
      status: String(r.status),
      effective_date: r.effective_date || null,
      end_date: r.end_date || null,
      leave_type: r.leave_type || null,
      leave_days: Number(r.leave_days || 0),
    }));

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

      const resolvedHireDate =
        prof?.hire_date ||
        (inst.created_at ? String(inst.created_at).slice(0, 10) : null);
      const rawProfileExtra =
        prof?.profile_extra && typeof prof.profile_extra === "object"
          ? prof.profile_extra
          : {};

      const ledgerSummary = computeMemberAnnualLeaveLedgerForYear({
        memberId: id,
        hireDate: resolvedHireDate,
        groupHireDate: rawProfileExtra.group_hire_date || null,
        year: curYear,
        currentYear: curYear,
        currentMonth: curMonth,
        policy: activeAnnualPolicy,
        leaveDocs: yearLeaveDocs,
        adjustments: leavesLedger.adjustments,
        uploadedMonthly: leavesLedger.uploadedMonthly,
      });

      const totalLeave = roundLeave4(
        ledgerSummary.totalAutoGrantYearEnd + ledgerSummary.totalAdjustedYear
      );
      const usedLeave = ledgerSummary.totalUsedYear;
      const remainLeave = ledgerSummary.availableRemainDays;

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
        auto_reply_active: Boolean(inst.auto_reply_active),
        chat_allow_start: inst.chat_allow_start || "09:00",
        chat_allow_end: inst.chat_allow_end || "18:00",
        auto_reply_message: inst.auto_reply_message || "",
        employee_no:
          prof?.employee_no || `HQ-TEMP-${String(idx + 1).padStart(3, "0")}`,
        department:
          (prof?.department || inst.department || "미지정").trim() || "미지정",
        rank_code: rankCode,
        rank_level: getRankLevel(rankCode),
        rank_label: rankMeta.shortLabel,
        job_title: prof?.job_title || inf.jobTitle,
        is_dept_head: Boolean(prof?.is_dept_head ?? inf.isDeptHead),
        employment_type: prof?.employment_type || "정규직",
        work_status: workStatus,
        hire_date: resolvedHireDate,
        resign_date: prof?.resign_date || null,
        birth_date: canSeePrivate ? prof?.birth_date || null : null,
        annual_leave_total: totalLeave,
        annual_leave_used: usedLeave,
        annual_leave_remain: remainLeave,
        bank_name: canSeePrivate ? prof?.bank_name || "" : "",
        bank_account: canSeePrivate ? prof?.bank_account || "" : "",
        account_holder: canSeePrivate ? prof?.account_holder || "" : "",
        extension_no: prof?.extension_no || "",
        emergency_contact: canSeePrivate ? prof?.emergency_contact || "" : "",
        address: canSeePrivate ? prof?.address || "" : "",
        job_description: prof?.job_description || "",
        hr_memo: caller.isHrManager ? prof?.hr_memo || "" : "",
        profile_extra: sanitizeExtraForViewer(prof?.profile_extra, canSeePrivate),
        can_view_private: canSeePrivate,
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
      return apiFail(
        "인사 관리 권한(임원·경영지원·권한관리자)이 필요합니다.",
        403
      );
    }
    if (caller.schemaMissing) {
      return apiFail(
        "먼저 본부 전용 DB 테이블(hq_schema.sql)을 생성해 주세요.",
        400
      );
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
    const employmentType = String(body?.employment_type || "정규직");
    const { settings: companySettings } =
      await readCompanySettingsServer(supabaseAdmin);
    const empNo =
      String(body?.employee_no || "").trim() ||
      (await generateEmployeeNoByPolicy(
        supabaseAdmin,
        companySettings,
        employmentType,
        hireDate,
        newUid
      ));

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

    const nowIso = new Date().toISOString();

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
          updated_at: nowIso,
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

    const body = await req.json();
    const targetId = String(body?.instructor_id || "").trim();
    if (!targetId) return apiFail("대상 구성원 ID가 없습니다.");

    const isSelf = targetId === caller.userId;
    if (!caller.isHrManager && !isSelf) {
      return apiFail("본인 정보 또는 인사관리자만 수정할 수 있습니다.", 403);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const instPatch: Record<string, any> = {};
    const changedLabels: string[] = [];

    if (body.phone !== undefined) {
      instPatch.phone = body.phone || null;
      changedLabels.push("휴대전화");
    }
    if (body.email !== undefined) {
      instPatch.email = body.email || null;
      changedLabels.push("이메일");
    }
    if (body.profile_image_url !== undefined) {
      instPatch.profile_image_url = body.profile_image_url || null;
      changedLabels.push("프로필 사진");
    }
    if (body.auto_reply_active !== undefined) {
      instPatch.auto_reply_active = Boolean(body.auto_reply_active);
      changedLabels.push("부재중 자동응답");
    }
    if (body.chat_allow_start !== undefined) {
      instPatch.chat_allow_start = body.chat_allow_start || null;
    }
    if (body.chat_allow_end !== undefined) {
      instPatch.chat_allow_end = body.chat_allow_end || null;
    }
    if (body.auto_reply_message !== undefined) {
      instPatch.auto_reply_message = body.auto_reply_message || null;
    }

    if (caller.isHrManager) {
      if (body.name !== undefined && String(body.name).trim()) {
        instPatch.name = String(body.name).trim();
        changedLabels.push("이름");
      }
      if (body.department !== undefined) {
        instPatch.department = String(body.department).trim() || "미지정";
      }
      if (body.job_title !== undefined) {
        instPatch.chat_position = String(body.job_title).trim() || "사원";
      }
      if (body.work_status !== undefined) {
        const ws = String(body.work_status) as HqWorkStatus;
        instPatch.status = ws === "퇴직" ? "퇴사" : "재직";
      }
    }

    if (Object.keys(instPatch).length > 0) {
      const { error: instErr } = await supabaseAdmin
        .from("instructor")
        .update(instPatch)
        .eq("instructor_id", targetId);
      if (instErr) return apiFail(`기본 정보 수정 실패: ${instErr.message}`, 500);
    }

    if (caller.schemaMissing) {
      if (
        body.profile_extra === undefined &&
        body.bank_name === undefined &&
        body.address === undefined &&
        body.rank_code === undefined &&
        Object.keys(instPatch).length > 0
      ) {
        return NextResponse.json({ success: true, data: { instructor_id: targetId } });
      }
      return apiFail(
        "본부 상세 인사 프로필을 저장하려면 먼저 상단 안내 배너에서 DB 스키마(hq_schema.sql)를 실행해 주세요.",
        400
      );
    }

    const { data: existingProf } = await supabaseAdmin
      .from("hq_member_profile")
      .select("*")
      .eq("instructor_id", targetId)
      .maybeSingle();

    const profilePatch: Record<string, any> = { updated_at: nowIso };

    if (body.extension_no !== undefined) {
      profilePatch.extension_no = body.extension_no || null;
      changedLabels.push("내선번호");
    }
    if (body.emergency_contact !== undefined) {
      profilePatch.emergency_contact = body.emergency_contact || null;
      changedLabels.push("비상연락망");
    }
    if (body.address !== undefined) {
      profilePatch.address = body.address || null;
      changedLabels.push("주소");
    }
    if (body.birth_date !== undefined) {
      profilePatch.birth_date = body.birth_date || null;
      changedLabels.push("생년월일");
    }
    if (body.bank_name !== undefined) {
      profilePatch.bank_name = body.bank_name || null;
      changedLabels.push("급여계좌");
    }
    if (body.bank_account !== undefined) {
      profilePatch.bank_account = body.bank_account || null;
    }
    if (body.account_holder !== undefined) {
      profilePatch.account_holder = body.account_holder || null;
    }
    if (body.job_description !== undefined) {
      profilePatch.job_description = body.job_description || null;
      changedLabels.push("담당 직무");
    }

    if (caller.isHrManager) {
      if (body.employee_no !== undefined) {
        const nextEmpNo = String(body.employee_no).trim() || null;
        const prevEmpNo = existingProf?.employee_no
          ? String(existingProf.employee_no).trim()
          : null;
        if (prevEmpNo && nextEmpNo !== prevEmpNo) {
          const { settings: compSettings } =
            await readCompanySettingsServer(supabaseAdmin);
          if (compSettings.extra_settings?.emp_no_locked) {
            return apiFail(
              "현재 [설정 > 인사·구성원 정보 > 사번 수정 잠금]이 활성화되어 있어 생성된 사번을 변경할 수 없습니다.",
              400
            );
          }
        }
        if (nextEmpNo !== prevEmpNo) {
          profilePatch.employee_no = nextEmpNo;
          changedLabels.push("사번");
        }
      }
      if (body.department !== undefined) {
        profilePatch.department = String(body.department).trim() || "미지정";
        changedLabels.push("소속 부서");
      }
      if (body.rank_code !== undefined && body.rank_code in HQ_RANKS) {
        profilePatch.rank_code = body.rank_code;
        changedLabels.push("직급");
      }
      if (body.job_title !== undefined) {
        profilePatch.job_title = String(body.job_title).trim() || "사원";
        changedLabels.push("직책");
      }
      if (body.is_dept_head !== undefined) {
        profilePatch.is_dept_head = Boolean(body.is_dept_head);
      }
      if (body.employment_type !== undefined) {
        profilePatch.employment_type = String(body.employment_type);
        changedLabels.push("고용형태");
      }
      if (body.work_status !== undefined) {
        profilePatch.work_status = String(body.work_status) as HqWorkStatus;
        changedLabels.push("재직상태");
      }
      if (body.hire_date !== undefined) {
        profilePatch.hire_date = body.hire_date || null;
        changedLabels.push("입사일");
      }
      if (body.resign_date !== undefined) {
        profilePatch.resign_date = body.resign_date || null;
      }
      if (body.annual_leave_total !== undefined) {
        profilePatch.annual_leave_total = Number(body.annual_leave_total);
        changedLabels.push("부여 연차");
      }
      if (body.annual_leave_used !== undefined) {
        profilePatch.annual_leave_used = Number(body.annual_leave_used);
        changedLabels.push("사용 연차");
      }
      if (body.hr_memo !== undefined) {
        profilePatch.hr_memo = body.hr_memo || null;
        changedLabels.push("인사 메모");
      }
    }

    const prevExtra: HqProfileExtra =
      existingProf?.profile_extra &&
      typeof existingProf.profile_extra === "object" &&
      !Array.isArray(existingProf.profile_extra)
        ? { ...existingProf.profile_extra }
        : {};

    const incomingExtra =
      body.profile_extra &&
      typeof body.profile_extra === "object" &&
      !Array.isArray(body.profile_extra)
        ? (body.profile_extra as Partial<HqProfileExtra>)
        : null;

    const shouldTouchExtra = incomingExtra !== null || existingProf?.profile_extra !== undefined;

    if (incomingExtra) {
      const selfEditableKeys: (keyof HqProfileExtra)[] = [
        "nickname",
        "bio",
        "personal_email",
        "rrn_front",
        "rrn_gender_digit",
        "gender",
        "nationality",
        "postal_code",
        "special_notes",
        "careers",
        "educations",
        "families",
        "awards",
        "growth_goals",
        "trainings",
      ];

      for (const key of selfEditableKeys) {
        if (incomingExtra[key] !== undefined) {
          if (key === "rrn_front") {
            prevExtra.rrn_front = String(incomingExtra.rrn_front || "")
              .replace(/[^0-9]/g, "")
              .slice(0, 6);
          } else if (key === "rrn_gender_digit") {
            prevExtra.rrn_gender_digit = String(
              incomingExtra.rrn_gender_digit || ""
            )
              .replace(/[^1-8]/g, "")
              .slice(0, 1);
          } else if (key === "gender") {
            // 수동 성별 입력 무시 — 아래에서 주민등록번호 뒷 첫자리 기준으로만 동기화
          } else {
            (prevExtra as any)[key] = incomingExtra[key];
          }
        }
      }
      prevExtra.gender = inferGenderFromRrnDigit(prevExtra.rrn_gender_digit);
      if (
        profilePatch.birth_date === undefined &&
        !existingProf?.birth_date &&
        prevExtra.rrn_front &&
        /^\d{6}$/.test(prevExtra.rrn_front) &&
        prevExtra.rrn_gender_digit
      ) {
        const yy = prevExtra.rrn_front.slice(0, 2);
        const mm = prevExtra.rrn_front.slice(2, 4);
        const dd = prevExtra.rrn_front.slice(4, 6);
        const century = ["1", "2", "5", "6"].includes(prevExtra.rrn_gender_digit)
          ? "19"
          : "20";
        profilePatch.birth_date = `${century}${yy}-${mm}-${dd}`;
      }

      if (caller.isHrManager) {
        const hrOnlyKeys: (keyof HqProfileExtra)[] = [
          "group_hire_date",
          "hire_type",
          "hr_effective_date",
          "hr_appointment_label",
          "hr_appointment_memo",
          "hr_jobs_selected",
          "hr_job_group",
          "hr_position",
          "hr_grade",
          "org_assignments",
          "work_schedule_type",
          "work_schedule_mode",
          "weekly_work_hours",
          "leave_policy_name",
          "leave_policy_tags",
          "holiday_policy_name",
          "holiday_summary",
          "labor_contract",
          "wage_contract",
          "leave_histories",
          "disciplines",
        ];
        for (const key of hrOnlyKeys) {
          if (incomingExtra[key] !== undefined) {
            (prevExtra as any)[key] = incomingExtra[key];
          }
        }
      }

      if (body.change_summary) {
        changedLabels.push(String(body.change_summary));
      } else {
        changedLabels.push("상세 프로필");
      }
    }

    if (shouldTouchExtra) {
      const summaryText =
        String(body.change_summary || "").trim() ||
        (changedLabels.length > 0
          ? `${Array.from(new Set(changedLabels)).join(", ")} 수정`
          : "인사 정보 업데이트");

      const prevLogs = Array.isArray(prevExtra.change_logs)
        ? prevExtra.change_logs
        : [];
      prevExtra.change_logs = [
        {
          at: nowIso,
          actor_name: `${caller.name} (${caller.jobTitle})`,
          summary: summaryText,
        },
        ...prevLogs,
      ].slice(0, 50);

      profilePatch.profile_extra = prevExtra;
    }

    const { error: profErr } = await supabaseAdmin
      .from("hq_member_profile")
      .upsert(
        { instructor_id: targetId, ...profilePatch },
        { onConflict: "instructor_id" }
      );

    if (profErr) {
      if (/profile_extra/i.test(profErr.message || "")) {
        return apiFail(
          "DB에 profile_extra 컬럼이 아직 없습니다. Supabase SQL Editor에서 최신 supabase/hq_schema.sql을 한 번 실행해 주세요.",
          400
        );
      }
      return apiFail(`인사 프로필 수정 실패: ${profErr.message}`, 500);
    }

    appendHqAuditLog(supabaseAdmin, req, {
      activity_type: "개인정보 접근",
      user_id: caller.userId,
      user_name: caller.name,
      user_email: caller.email,
      department: caller.department,
      event_type: "수정",
      info_type: "개인정보",
      description:
        changedLabels.length > 0
          ? `구성원 정보 수정 (${Array.from(new Set(changedLabels)).join(", ")})`
          : "구성원 인사 · 개인정보 수정",
      delegated: caller.isDelegatedHrAdmin,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { instructor_id: targetId },
    });
  } catch (e: any) {
    console.error("HQ members PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
