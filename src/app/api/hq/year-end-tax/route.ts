// src/app/api/hq/year-end-tax/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readHqKvPayload, writeHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqYearEndMemberSubmission,
  HqYearEndTaxYearStore,
} from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function defaultTaxYear(): number {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  // 1~4월에는 전년도 귀속 연말정산이 진행·조회되므로 전년도 기본 선택
  return m <= 4 ? y - 1 : y;
}

function buildDefaultStore(year: number): HqYearEndTaxYearStore {
  return {
    year,
    deadline_date: `${year + 1}-01-22`,
    notice_memo:
      "국세청 홈택스 [연말정산 간소화 자료]를 비밀번호 설정 없이 PDF 한 파일로 내려받아 업로드해 주세요. (당해 입사자는 전 근무지 근로소득 원천징수영수증 첨부 필수)",
    submissions: {},
  };
}

function emptySubmission(memberId: string): HqYearEndMemberSubmission {
  return {
    member_id: memberId,
    status: "NOT_SUBMITTED",
    hometax_pdf: null,
    extra_files: [],
    dependent_change_note: "",
    tax_reduction_check: false,
    prev_workplace_check: false,
    employee_memo: "",
    submitted_at: null,
    admin_supplement_note: "",
    settlement_tax_diff: null,
    receipt_pdf: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const rawYear = Number(req.nextUrl.searchParams.get("year"));
    const year =
      Number.isFinite(rawYear) && rawYear >= 2020 && rawYear <= 2040
        ? rawYear
        : defaultTaxYear();

    const supabaseAdmin = getSupabaseAdmin();
    const settingKey = `year_end_tax_${year}`;
    const stored = await readHqKvPayload<HqYearEndTaxYearStore>(
      supabaseAdmin,
      settingKey
    );
    const store = stored
      ? { ...buildDefaultStore(year), ...stored, year }
      : buildDefaultStore(year);

    // 일반 직원은 본인의 제출·원천징수영수증 데이터만 수신
    if (!caller.isHrManager) {
      const mine = store.submissions?.[caller.userId] || emptySubmission(caller.userId);
      return NextResponse.json({
        success: true,
        data: {
          year,
          deadline_date: store.deadline_date,
          notice_memo: store.notice_memo,
          mySubmission: mine,
          submissions: { [caller.userId]: mine },
          annualPayrollSummary: {},
        },
      });
    }

    // 인사·재무 관리자용: 귀속연도 급여대장(hq_payroll) 누적 세전급여·기납부세액 참고 집계
    const annualPayrollSummary: Record<
      string,
      { grossSum: number; taxSum: number; monthsCount: number }
    > = {};

    try {
      const { data: payRows } = await supabaseAdmin
        .from("hq_payroll")
        .select("member_id, gross_amount, income_tax, local_income_tax")
        .eq("pay_type", "EMPLOYEE")
        .gte("pay_month", `${year}-01`)
        .lte("pay_month", `${year}-12`);

      (payRows || []).forEach((r: any) => {
        if (!r.member_id) return;
        const id = String(r.member_id);
        const cur = annualPayrollSummary[id] || {
          grossSum: 0,
          taxSum: 0,
          monthsCount: 0,
        };
        cur.grossSum += Number(r.gross_amount || 0);
        cur.taxSum +=
          Number(r.income_tax || 0) + Number(r.local_income_tax || 0);
        cur.monthsCount += 1;
        annualPayrollSummary[id] = cur;
      });
    } catch {
      // ignore if payroll table not yet initialized
    }

    return NextResponse.json({
      success: true,
      data: {
        year,
        deadline_date: store.deadline_date,
        notice_memo: store.notice_memo,
        mySubmission:
          store.submissions?.[caller.userId] || emptySubmission(caller.userId),
        submissions: store.submissions || {},
        annualPayrollSummary,
      },
    });
  } catch (e: any) {
    console.error("HQ year-end-tax GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const rawYear = Number(body?.year);
    const year =
      Number.isFinite(rawYear) && rawYear >= 2020 && rawYear <= 2040
        ? rawYear
        : defaultTaxYear();

    const supabaseAdmin = getSupabaseAdmin();
    const settingKey = `year_end_tax_${year}`;
    const stored = await readHqKvPayload<HqYearEndTaxYearStore>(
      supabaseAdmin,
      settingKey
    );
    const store: HqYearEndTaxYearStore = stored
      ? {
          ...buildDefaultStore(year),
          ...stored,
          year,
          submissions: { ...(stored.submissions || {}) },
        }
      : buildDefaultStore(year);

    const nowIso = new Date().toISOString();

    // 1) 관리자: 제출 마감일 · 안내 공지 수정
    if (action === "UPDATE_CONFIG") {
      if (!caller.isHrManager) {
        return apiFail("인사·재무 관리자만 안내 설정을 변경할 수 있습니다.", 403);
      }
      store.deadline_date = String(body?.deadline_date || store.deadline_date).trim();
      store.notice_memo = String(body?.notice_memo ?? store.notice_memo).trim();
      store.updated_at = nowIso;
      await writeHqKvPayload(supabaseAdmin, settingKey, store);
      return NextResponse.json({ success: true });
    }

    // 2) 임직원 본인(또는 관리자 대리): 간소화 PDF · 추가 증빙 · 공제 메모 제출
    if (action === "SAVE_EMPLOYEE_SUBMISSION") {
      const targetMemberId =
        caller.isHrManager && body?.member_id
          ? String(body.member_id)
          : caller.userId;

      const prev =
        store.submissions[targetMemberId] || emptySubmission(targetMemberId);
      const markSubmitted = body?.mark_submitted !== false;

      const nextStatus =
        prev.status === "COMPLETED" && !body?.force_reopen
          ? "COMPLETED"
          : markSubmitted
          ? "SUBMITTED"
          : prev.status;

      store.submissions[targetMemberId] = {
        ...prev,
        member_id: targetMemberId,
        status: nextStatus,
        hometax_pdf:
          body?.hometax_pdf !== undefined ? body.hometax_pdf : prev.hometax_pdf,
        extra_files: Array.isArray(body?.extra_files)
          ? body.extra_files
          : prev.extra_files,
        dependent_change_note:
          body?.dependent_change_note !== undefined
            ? String(body.dependent_change_note).trim()
            : prev.dependent_change_note,
        tax_reduction_check:
          body?.tax_reduction_check !== undefined
            ? Boolean(body.tax_reduction_check)
            : prev.tax_reduction_check,
        prev_workplace_check:
          body?.prev_workplace_check !== undefined
            ? Boolean(body.prev_workplace_check)
            : prev.prev_workplace_check,
        employee_memo:
          body?.employee_memo !== undefined
            ? String(body.employee_memo).trim()
            : prev.employee_memo,
        submitted_at: markSubmitted ? nowIso : prev.submitted_at,
        updated_at: nowIso,
      };
      store.updated_at = nowIso;

      await writeHqKvPayload(supabaseAdmin, settingKey, store);
      return NextResponse.json({
        success: true,
        data: store.submissions[targetMemberId],
      });
    }

    // 3) 관리자: 서류 보완 요청 또는 세무사 확정 결과(환급/추징 세액 · 원천징수영수증 PDF) 배부
    if (action === "ADMIN_UPDATE_RESULT") {
      if (!caller.isHrManager) {
        return apiFail("인사·재무 관리자만 정산 결과를 등록할 수 있습니다.", 403);
      }
      const targetMemberId = String(body?.member_id || "").trim();
      if (!targetMemberId) return apiFail("대상 구성원 ID가 필요합니다.");

      const prev =
        store.submissions[targetMemberId] || emptySubmission(targetMemberId);
      const nextStatus = body?.status || prev.status;

      store.submissions[targetMemberId] = {
        ...prev,
        member_id: targetMemberId,
        status: nextStatus,
        admin_supplement_note:
          body?.admin_supplement_note !== undefined
            ? String(body.admin_supplement_note).trim()
            : prev.admin_supplement_note,
        settlement_tax_diff:
          body?.settlement_tax_diff === null ||
          body?.settlement_tax_diff === ""
            ? null
            : body?.settlement_tax_diff !== undefined
            ? Math.round(Number(body.settlement_tax_diff))
            : prev.settlement_tax_diff,
        receipt_pdf:
          body?.receipt_pdf !== undefined ? body.receipt_pdf : prev.receipt_pdf,
        completed_at:
          nextStatus === "COMPLETED" ? nowIso : prev.completed_at,
        updated_at: nowIso,
      };
      store.updated_at = nowIso;

      await writeHqKvPayload(supabaseAdmin, settingKey, store);
      return NextResponse.json({
        success: true,
        data: store.submissions[targetMemberId],
      });
    }

    return apiFail("지원하지 않는 요청입니다.");
  } catch (e: any) {
    console.error("HQ year-end-tax POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
