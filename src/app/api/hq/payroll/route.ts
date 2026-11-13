// src/app/api/hq/payroll/route.ts
import { NextRequest, NextResponse } from "next/server";
import { calculatePayrollAmounts } from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqPayrollStatus, HqPayrollType } from "@/lib/hq/types";

export const runtime = "nodejs";

function generateStatementNo(payMonth: string): string {
  const ym = payMonth.replace("-", "");
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `PAY-${ym}-${rand}`;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const month = req.nextUrl.searchParams.get("month") || defaultMonth;

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from("hq_payroll")
      .select("*")
      .order("pay_month", { ascending: false })
      .order("created_at", { ascending: false });

    if (month !== "ALL") {
      query = query.eq("pay_month", month);
    }

    // 일반 구성원은 본인의 확정/지급완료된 급여명세서만 조회 가능
    if (!caller.isHrManager) {
      query = query
        .eq("member_id", caller.userId)
        .in("status", ["CONFIRMED", "PAID"]);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: { records: [], isHrManager: caller.isHrManager },
        });
      }
      return apiFail(`급여·정산 내역 조회 실패: ${error.message}`, 500);
    }

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        records: data || [],
        isHrManager: caller.isHrManager,
      },
    });
  } catch (e: any) {
    console.error("HQ payroll GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHrManager) {
      return apiFail(
        "급여 및 원천징수 정산 등록은 인사·재무 관리자(대표·임원·경영지원)만 가능합니다.",
        403
      );
    }

    const body = await req.json();
    const action = String(body?.action || "CREATE_SINGLE").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 전월 급여대장 복사 또는 재직 구성원 일괄 초안 생성
    if (action === "COPY_PREV_OR_SEED") {
      const payMonth = String(body?.pay_month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(payMonth)) {
        return apiFail("귀속월(YYYY-MM) 형식이 올바르지 않습니다.");
      }

      const { data: existingRows, error: exErr } = await supabaseAdmin
        .from("hq_payroll")
        .select("member_id")
        .eq("pay_month", payMonth)
        .eq("pay_type", "EMPLOYEE");

      if (exErr && isMissingHqTableError(exErr)) {
        return apiFail(
          "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
          400
        );
      }

      const existingIds = new Set(
        (existingRows || [])
          .map((r: any) => r.member_id)
          .filter(Boolean)
      );

      // 직전월 계산
      const [y, m] = payMonth.split("-").map(Number);
      const prevDate = new Date(y, m - 2, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(
        prevDate.getMonth() + 1
      ).padStart(2, "0")}`;

      const { data: prevRows } = await supabaseAdmin
        .from("hq_payroll")
        .select("*")
        .eq("pay_month", prevMonth)
        .eq("pay_type", "EMPLOYEE");

      const prevMap = new Map<string, any>();
      (prevRows || []).forEach((r: any) => {
        if (r.member_id) prevMap.set(String(r.member_id), r);
      });

      const membersInput = Array.isArray(body?.members) ? body.members : [];
      const toInsert: Record<string, any>[] = [];

      membersInput.forEach((mem: any) => {
        if (!mem?.instructor_id || existingIds.has(mem.instructor_id)) return;
        if (mem.work_status && mem.work_status !== "재직") return;

        const prev = prevMap.get(String(mem.instructor_id));
        const basePay = prev ? Number(prev.base_pay) : 2_800_000;
        const meal = prev ? Number(prev.meal_allowance) : 200_000;
        const calc = calculatePayrollAmounts({
          payType: "EMPLOYEE",
          basePay,
          mealAllowance: meal,
          overtimePay: 0,
          bonusPay: 0,
        });

        const bankText = [mem.bank_name, mem.bank_account, mem.account_holder]
          .filter(Boolean)
          .join(" ");

        toInsert.push({
          statement_no: generateStatementNo(payMonth),
          pay_month: payMonth,
          pay_type: "EMPLOYEE",
          member_id: mem.instructor_id,
          payee_name: mem.name,
          department_or_role: `${mem.department || "본부"} · ${mem.job_title || "사원"}`,
          bank_info: bankText || prev?.bank_info || null,
          base_pay: basePay,
          meal_allowance: meal,
          overtime_pay: 0,
          bonus_pay: 0,
          gross_amount: calc.grossAmount,
          national_pension: calc.nationalPension,
          health_insurance: calc.healthInsurance,
          long_term_care: calc.longTermCare,
          employment_insurance: calc.employmentInsurance,
          income_tax: calc.incomeTax,
          local_income_tax: calc.localIncomeTax,
          deduction_total: calc.deductionTotal,
          net_amount: calc.netAmount,
          status: "DRAFT",
          pay_date: `${payMonth}-25`,
          memo: prev ? `${prevMonth} 급여 기준 자동 생성` : "기본 급여 초안 (금액 확인 후 확정)",
          created_at: nowIso,
          updated_at: nowIso,
        });
      });

      if (toInsert.length === 0) {
        return NextResponse.json({
          success: true,
          data: { createdCount: 0 },
        });
      }

      const { error: insErr } = await supabaseAdmin
        .from("hq_payroll")
        .insert(toInsert);

      if (insErr) return apiFail(`일괄 생성 실패: ${insErr.message}`, 500);
      return NextResponse.json({
        success: true,
        data: { createdCount: toInsert.length },
      });
    }

    // 단건 정산 등록 (임직원 급여 / 외주 3.3% / 기타소득 8.8% / 저자 인세)
    const payMonth = String(body?.pay_month || "").trim();
    const payType = String(body?.pay_type || "EMPLOYEE") as HqPayrollType;
    const payeeName = String(body?.payee_name || "").trim();

    if (!payMonth || !payeeName) {
      return apiFail("귀속월과 수령인 성명은 필수입니다.");
    }

    const basePay = Math.max(0, Math.round(Number(body?.base_pay || 0)));
    const mealAllowance = Math.max(0, Math.round(Number(body?.meal_allowance || 0)));
    const overtimePay = Math.max(0, Math.round(Number(body?.overtime_pay || 0)));
    const bonusPay = Math.max(0, Math.round(Number(body?.bonus_pay || 0)));

    const autoCalc = calculatePayrollAmounts({
      payType,
      basePay,
      mealAllowance,
      overtimePay,
      bonusPay,
    });

    const nationalPension =
      body?.national_pension !== undefined
        ? Number(body.national_pension)
        : autoCalc.nationalPension;
    const healthInsurance =
      body?.health_insurance !== undefined
        ? Number(body.health_insurance)
        : autoCalc.healthInsurance;
    const longTermCare =
      body?.long_term_care !== undefined
        ? Number(body.long_term_care)
        : autoCalc.longTermCare;
    const employmentInsurance =
      body?.employment_insurance !== undefined
        ? Number(body.employment_insurance)
        : autoCalc.employmentInsurance;
    const incomeTax =
      body?.income_tax !== undefined
        ? Number(body.income_tax)
        : autoCalc.incomeTax;
    const localIncomeTax =
      body?.local_income_tax !== undefined
        ? Number(body.local_income_tax)
        : autoCalc.localIncomeTax;

    const grossAmount =
      payType === "EMPLOYEE"
        ? basePay + mealAllowance + overtimePay + bonusPay
        : basePay + bonusPay;
    const deductionTotal =
      nationalPension +
      healthInsurance +
      longTermCare +
      employmentInsurance +
      incomeTax +
      localIncomeTax;
    const netAmount = Math.max(0, grossAmount - deductionTotal);

    const payload = {
      statement_no: generateStatementNo(payMonth),
      pay_month: payMonth,
      pay_type: payType,
      member_id: body?.member_id || null,
      payee_name: payeeName,
      department_or_role: String(body?.department_or_role || "").trim(),
      bank_info: String(body?.bank_info || "").trim() || null,
      book_or_project: String(body?.book_or_project || "").trim() || null,
      base_pay: basePay,
      meal_allowance: mealAllowance,
      overtime_pay: overtimePay,
      bonus_pay: bonusPay,
      gross_amount: grossAmount,
      national_pension: nationalPension,
      health_insurance: healthInsurance,
      long_term_care: longTermCare,
      employment_insurance: employmentInsurance,
      income_tax: incomeTax,
      local_income_tax: localIncomeTax,
      deduction_total: deductionTotal,
      net_amount: netAmount,
      calc_meta: body?.calc_meta || {},
      status: (body?.status || "CONFIRMED") as HqPayrollStatus,
      pay_date: body?.pay_date || `${payMonth}-25`,
      memo: String(body?.memo || "").trim() || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: created, error } = await supabaseAdmin
      .from("hq_payroll")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if (isMissingHqTableError(error)) {
        return apiFail(
          "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
          400
        );
      }
      return apiFail(`정산 등록 실패: ${error.message}`, 500);
    }

    return NextResponse.json({ success: true, data: created });
  } catch (e: any) {
    console.error("HQ payroll POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHrManager) {
      return apiFail("인사·재무 관리자만 수정할 수 있습니다.", 403);
    }

    const body = await req.json();
    const ids: string[] = Array.isArray(body?.payroll_ids)
      ? body.payroll_ids
      : body?.payroll_id
      ? [String(body.payroll_id)]
      : [];

    if (ids.length === 0) return apiFail("대상 정산 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 상태 일괄 변경 (명세서 배부 확정 / 이체 완료)
    if (body?.status && ids.length >= 1 && body?.base_pay === undefined) {
      const nextStatus = String(body.status) as HqPayrollStatus;
      const { error } = await supabaseAdmin
        .from("hq_payroll")
        .update({ status: nextStatus, updated_at: nowIso })
        .in("payroll_id", ids);

      if (error) return apiFail(`상태 변경 실패: ${error.message}`, 500);
      return NextResponse.json({ success: true });
    }

    // 단건 금액 수정
    const payType = String(body?.pay_type || "EMPLOYEE") as HqPayrollType;
    const basePay = Math.max(0, Math.round(Number(body?.base_pay || 0)));
    const mealAllowance = Math.max(0, Math.round(Number(body?.meal_allowance || 0)));
    const overtimePay = Math.max(0, Math.round(Number(body?.overtime_pay || 0)));
    const bonusPay = Math.max(0, Math.round(Number(body?.bonus_pay || 0)));
    const calc = calculatePayrollAmounts({
      payType,
      basePay,
      mealAllowance,
      overtimePay,
      bonusPay,
    });

    const { data: updated, error } = await supabaseAdmin
      .from("hq_payroll")
      .update({
        payee_name: body?.payee_name,
        department_or_role: body?.department_or_role,
        bank_info: body?.bank_info || null,
        book_or_project: body?.book_or_project || null,
        base_pay: basePay,
        meal_allowance: mealAllowance,
        overtime_pay: overtimePay,
        bonus_pay: bonusPay,
        gross_amount: calc.grossAmount,
        national_pension: calc.nationalPension,
        health_insurance: calc.healthInsurance,
        long_term_care: calc.longTermCare,
        employment_insurance: calc.employmentInsurance,
        income_tax: calc.incomeTax,
        local_income_tax: calc.localIncomeTax,
        deduction_total: calc.deductionTotal,
        net_amount: calc.netAmount,
        status: body?.status || "CONFIRMED",
        pay_date: body?.pay_date || null,
        memo: body?.memo || null,
        updated_at: nowIso,
      })
      .eq("payroll_id", ids[0])
      .select("*")
      .single();

    if (error) return apiFail(`수정 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    console.error("HQ payroll PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHrManager) {
      return apiFail("인사·재무 관리자만 삭제할 수 있습니다.", 403);
    }

    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return apiFail("삭제할 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("hq_payroll")
      .delete()
      .eq("payroll_id", id);

    if (error) return apiFail(`삭제 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ payroll DELETE error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
