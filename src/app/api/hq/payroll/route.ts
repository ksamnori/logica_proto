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
export const dynamic = "force-dynamic";

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
    const defaultMonth = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;
    const month = req.nextUrl.searchParams.get("month") || defaultMonth;
    const memberIdParam = req.nextUrl.searchParams.get("member_id") || "";
    const includeContext =
      req.nextUrl.searchParams.get("include_context") === "1";

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
    } else if (memberIdParam) {
      query = query.eq("member_id", memberIdParam);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: {
            records: [],
            isHrManager: caller.isHrManager,
            attendanceRows: [],
            leaveDocs: [],
            publications: [],
            externalContracts: [],
          },
        });
      }
      return apiFail(`급여·정산 내역 조회 실패: ${error.message}`, 500);
    }

    let attendanceRows: any[] = [];
    let leaveDocs: any[] = [];
    let publications: any[] = [];
    let externalContracts: any[] = [];

    // 인사·재무 관리자용 보조 데이터 (세무사 전달용 월간 근태·휴가 집계 + 출판 도서 빠른 선택)
    if (caller.isHrManager && includeContext) {
      const promises: Promise<void>[] = [];

      if (/^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split("-").map(Number);
        const startDate = `${month}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

        promises.push(
          (async () => {
            const { data: attData } = await supabaseAdmin
              .from("hq_attendance")
              .select(
                "attendance_id, instructor_id, member_name, department, work_date, work_mode, status, worked_minutes, overtime_minutes"
              )
              .gte("work_date", startDate)
              .lte("work_date", endDate);
            attendanceRows = attData || [];
          })().catch(() => {})
        );

        promises.push(
          (async () => {
            const { data: lvData } = await supabaseAdmin
              .from("hq_approval_doc")
              .select(
                "approval_id, doc_no, doc_type, title, drafter_id, drafter_name, drafter_dept, status, effective_date, end_date, leave_type, leave_days"
              )
              .eq("doc_type", "LEAVE")
              .eq("status", "APPROVED")
              .lte("effective_date", endDate)
              .order("effective_date", { ascending: false })
              .limit(300);
            leaveDocs = (lvData || []).filter((d: any) => {
              const eff = d.effective_date || "";
              const end = d.end_date || eff;
              return eff && end >= startDate && eff <= endDate;
            });
          })().catch(() => {})
        );
      }

      promises.push(
        (async () => {
          const { data: pubData } = await supabaseAdmin
            .from("hq_publication")
            .select("pub_id, book_code, title, author_name, list_price, print_run, isbn")
            .order("updated_at", { ascending: false })
            .limit(100);
          publications = pubData || [];
        })().catch(() => {})
      );

      promises.push(
        (async () => {
          const { data: ctrData } = await supabaseAdmin
            .from("hq_contract")
            .select("*")
            .eq("target_type", "EXTERNAL")
            .eq("status", "SIGNED")
            .order("created_at", { ascending: false })
            .limit(150);
          externalContracts = ctrData || [];
        })().catch(() => {})
      );

      await Promise.all(promises);
    }

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        records: data || [],
        isHrManager: caller.isHrManager,
        attendanceRows,
        leaveDocs,
        publications,
        externalContracts,
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

    // 1. 세무사 급여대장 엑셀/CSV 일괄 업로드 (확정 공제액 1원 오차 없이 보존)
    if (action === "BULK_UPSERT_LEDGER") {
      const payMonth = String(body?.pay_month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(payMonth)) {
        return apiFail("귀속월(YYYY-MM) 형식이 올바르지 않습니다.");
      }

      const rowsInput = Array.isArray(body?.rows) ? body.rows : [];
      if (rowsInput.length === 0) {
        return apiFail("업로드할 급여대장 행 데이터가 없습니다.");
      }

      const publishImmediately = Boolean(body?.publish_immediately);
      const overwriteExisting = body?.overwrite_existing !== false;
      const defaultPayDate = String(body?.pay_date || `${payMonth}-25`).trim();
      const targetStatus: HqPayrollStatus = publishImmediately
        ? "CONFIRMED"
        : "DRAFT";

      const { data: existingRows, error: exErr } = await supabaseAdmin
        .from("hq_payroll")
        .select("*")
        .eq("pay_month", payMonth)
        .eq("pay_type", "EMPLOYEE");

      if (exErr) {
        if (isMissingHqTableError(exErr)) {
          return apiFail(
            "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
            400
          );
        }
        return apiFail(`기존 급여대장 확인 실패: ${exErr.message}`, 500);
      }

      const existingByMemberId = new Map<string, any>();
      const existingByName = new Map<string, any>();
      (existingRows || []).forEach((r: any) => {
        if (r.member_id) existingByMemberId.set(String(r.member_id), r);
        if (r.payee_name) existingByName.set(String(r.payee_name).trim(), r);
      });

      const toInsert: Record<string, any>[] = [];
      let updatedCount = 0;
      let skippedCount = 0;

      for (const row of rowsInput) {
        const payeeName = String(row?.payeeName || "").trim();
        if (!payeeName) continue;

        const memberId = row?.matchedMemberId ? String(row.matchedMemberId) : null;
        const basePay = Math.max(0, Math.round(Number(row?.basePay || 0)));
        const mealAllowance = Math.max(
          0,
          Math.round(Number(row?.mealAllowance || 0))
        );
        const overtimePay = Math.max(
          0,
          Math.round(Number(row?.overtimePay || 0))
        );
        const bonusPay = Math.round(Number(row?.bonusPay || 0));
        const grossAmount = Math.max(
          0,
          Math.round(
            Number(
              row?.grossAmount ??
                basePay + mealAllowance + overtimePay + bonusPay
            )
          )
        );

        const deductionMode =
          row?.deductionMode === "AUTO" ? "AUTO" : "EXACT";

        let np = Math.round(Number(row?.nationalPension || 0));
        let hi = Math.round(Number(row?.healthInsurance || 0));
        let ltc = Math.round(Number(row?.longTermCare || 0));
        let ei = Math.round(Number(row?.employmentInsurance || 0));
        let incomeTax = Math.round(Number(row?.incomeTax || 0));
        let localTax = Math.round(Number(row?.localIncomeTax || 0));
        let otherDeduct = Math.round(Number(row?.otherDeduction || 0));
        let deductionTotal = Math.round(
          Number(
            row?.deductionTotal ??
              np + hi + ltc + ei + incomeTax + localTax + otherDeduct
          )
        );
        let netAmount = Math.round(
          Number(row?.netAmount ?? Math.max(0, grossAmount - deductionTotal))
        );

        if (deductionMode === "AUTO") {
          const auto = calculatePayrollAmounts({
            payType: "EMPLOYEE",
            basePay,
            mealAllowance,
            overtimePay,
            bonusPay: Math.max(0, bonusPay),
          });
          np = auto.nationalPension;
          hi = auto.healthInsurance;
          ltc = auto.longTermCare;
          ei = auto.employmentInsurance;
          incomeTax = auto.incomeTax;
          localTax = auto.localIncomeTax;
          otherDeduct = 0;
          deductionTotal = auto.deductionTotal;
          netAmount = auto.netAmount;
        }

        const calcMeta = {
          deduction_mode: deductionMode,
          source: "TAX_LEDGER_UPLOAD",
          employee_no: row?.employeeNo || "",
          other_deduction: otherDeduct,
          extra_allowances: Array.isArray(row?.extraAllowances)
            ? row.extraAllowances
            : [],
          extra_deductions: Array.isArray(row?.extraDeductions)
            ? row.extraDeductions
            : [],
          uploaded_at: nowIso,
        };

        const existing =
          (memberId && existingByMemberId.get(memberId)) ||
          existingByName.get(payeeName);

        if (existing) {
          if (!overwriteExisting) {
            skippedCount++;
            continue;
          }
          const preservedPaid =
            existing.status === "PAID" && !publishImmediately
              ? "PAID"
              : publishImmediately
              ? existing.status === "PAID"
                ? "PAID"
                : "CONFIRMED"
              : "DRAFT";

          const { error: updErr } = await supabaseAdmin
            .from("hq_payroll")
            .update({
              member_id: memberId || existing.member_id || null,
              payee_name: payeeName,
              department_or_role:
                String(row?.departmentOrRole || "").trim() ||
                existing.department_or_role,
              bank_info:
                String(row?.bankInfo || "").trim() || existing.bank_info || null,
              base_pay: basePay,
              meal_allowance: mealAllowance,
              overtime_pay: overtimePay,
              bonus_pay: bonusPay,
              gross_amount: grossAmount,
              national_pension: np,
              health_insurance: hi,
              long_term_care: ltc,
              employment_insurance: ei,
              income_tax: incomeTax,
              local_income_tax: localTax,
              deduction_total: deductionTotal,
              net_amount: netAmount,
              calc_meta: { ...(existing.calc_meta || {}), ...calcMeta },
              status: preservedPaid,
              pay_date: row?.payDate || defaultPayDate,
              memo:
                String(row?.memo || "").trim() ||
                existing.memo ||
                "세무사 급여대장 업로드 확정분",
              updated_at: nowIso,
            })
            .eq("payroll_id", existing.payroll_id);

          if (updErr) {
            return apiFail(`급여대장 업데이트 실패: ${updErr.message}`, 500);
          }
          updatedCount++;
        } else {
          toInsert.push({
            statement_no: generateStatementNo(payMonth),
            pay_month: payMonth,
            pay_type: "EMPLOYEE",
            member_id: memberId,
            payee_name: payeeName,
            department_or_role:
              String(row?.departmentOrRole || "").trim() || "본부 임직원",
            bank_info: String(row?.bankInfo || "").trim() || null,
            base_pay: basePay,
            meal_allowance: mealAllowance,
            overtime_pay: overtimePay,
            bonus_pay: bonusPay,
            gross_amount: grossAmount,
            national_pension: np,
            health_insurance: hi,
            long_term_care: ltc,
            employment_insurance: ei,
            income_tax: incomeTax,
            local_income_tax: localTax,
            deduction_total: deductionTotal,
            net_amount: netAmount,
            calc_meta: calcMeta,
            status: targetStatus,
            pay_date: row?.payDate || defaultPayDate,
            memo:
              String(row?.memo || "").trim() || "세무사 급여대장 업로드 확정분",
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("hq_payroll")
          .insert(toInsert);
        if (insErr) {
          return apiFail(`급여대장 일괄 등록 실패: ${insErr.message}`, 500);
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          createdCount: toInsert.length,
          updatedCount,
          skippedCount,
        },
      });
    }

    // 2. 전월 급여대장 복사 또는 재직 구성원 일괄 초안 생성 (임금계약 연동 포함)
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
        (existingRows || []).map((r: any) => r.member_id).filter(Boolean)
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
        const wc = mem.profile_extra?.wage_contract;
        const lc = mem.profile_extra?.labor_contract;
        const pi = mem.profile_extra?.pay_payment_info;
        const piItems = Array.isArray(pi?.items) ? pi!.items : [];
        const piBaseItem = piItems.find(
          (x: any) => x.pay_item_id === "pay-fixed-base" || x.name === "기본급"
        );
        const piOtItem = piItems.find(
          (x: any) => x.pay_item_id === "pay-fixed-ot" || String(x.name || "").includes("고정초과")
        );
        const piMealItem = piItems.find(
          (x: any) => x.pay_item_id === "pay-fixed-meal" || String(x.name || "").includes("식")
        );

        const contractMeal =
          piMealItem && Number(piMealItem.amount) > 0
            ? Number(piMealItem.amount)
            : wc?.meal_allowance !== undefined
              ? Number(wc.meal_allowance)
              : 200_000;
        const rawContractBase =
          piBaseItem && Number(piBaseItem.amount) > 0
            ? Number(piBaseItem.amount)
            : wc?.monthly_base
              ? Number(wc.monthly_base)
              : wc?.annual_salary
                ? Math.max(0, Math.round(Number(wc.annual_salary) / 12) - contractMeal)
                : 2_800_000;
        const rawFixedOt =
          piOtItem && Number(piOtItem.amount) > 0
            ? Number(piOtItem.amount)
            : Number(wc?.fixed_overtime_allowance || 0);

        // 수습 기간 중 급여지급률(%) 반영
        const inProbation =
          Boolean(lc?.probation_end_date && lc.probation_end_date >= `${payMonth}-01`) &&
          (!lc?.probation_start_date || lc.probation_start_date <= `${payMonth}-31`);
        const payRateRatio =
          inProbation &&
          lc?.salary_pay_rate !== undefined &&
          lc?.salary_pay_rate !== null &&
          Number(lc.salary_pay_rate) > 0 &&
          Number(lc.salary_pay_rate) < 100
            ? Number(lc.salary_pay_rate) / 100
            : 1;

        const contractBase = Math.round(rawContractBase * payRateRatio);
        const contractOvertime = Math.round(rawFixedOt * payRateRatio);

        const basePay = prev ? Number(prev.base_pay) : contractBase;
        const meal = prev ? Number(prev.meal_allowance) : contractMeal;
        const overtimePay = prev ? Number(prev.overtime_pay || 0) : contractOvertime;
        const calc = calculatePayrollAmounts({
          payType: "EMPLOYEE",
          basePay,
          mealAllowance: meal,
          overtimePay,
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
          overtime_pay: overtimePay,
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
          calc_meta: {
            deduction_mode: "AUTO",
            employee_no: mem.employee_no || "",
          },
          status: "DRAFT",
          pay_date: `${payMonth}-25`,
          memo: prev
            ? `${prevMonth} 급여 기준 초안`
            : wc?.monthly_base || wc?.annual_salary
            ? "임금계약 기준 초안"
            : "기본 급여 초안 (금액 확인 후 확정)",
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

    // 3. 단건 정산 등록 (임직원 급여 / 외주 3.3% / 기타소득 8.8% / 저자 인세)
    const payMonth = String(body?.pay_month || "").trim();
    const payType = String(body?.pay_type || "EMPLOYEE") as HqPayrollType;
    const payeeName = String(body?.payee_name || "").trim();

    if (!payMonth || !payeeName) {
      return apiFail("귀속월과 수령인 성명은 필수입니다.");
    }

    const basePay = Math.max(0, Math.round(Number(body?.base_pay || 0)));
    const mealAllowance = Math.max(
      0,
      Math.round(Number(body?.meal_allowance || 0))
    );
    const overtimePay = Math.max(
      0,
      Math.round(Number(body?.overtime_pay || 0))
    );
    const bonusPay = Math.round(Number(body?.bonus_pay || 0));

    const autoCalc = calculatePayrollAmounts({
      payType,
      basePay,
      mealAllowance,
      overtimePay,
      bonusPay: Math.max(0, bonusPay),
      royaltyTaxMode: body?.calc_meta?.royalty_tax_mode ?? null,
    });

    const deductionMode =
      body?.deduction_mode === "EXACT" ? "EXACT" : "AUTO";
    const otherDeduction =
      deductionMode === "EXACT"
        ? Math.round(Number(body?.other_deduction || 0))
        : 0;

    const nationalPension =
      deductionMode === "EXACT" && body?.national_pension !== undefined
        ? Math.round(Number(body.national_pension))
        : autoCalc.nationalPension;
    const healthInsurance =
      deductionMode === "EXACT" && body?.health_insurance !== undefined
        ? Math.round(Number(body.health_insurance))
        : autoCalc.healthInsurance;
    const longTermCare =
      deductionMode === "EXACT" && body?.long_term_care !== undefined
        ? Math.round(Number(body.long_term_care))
        : autoCalc.longTermCare;
    const employmentInsurance =
      deductionMode === "EXACT" && body?.employment_insurance !== undefined
        ? Math.round(Number(body.employment_insurance))
        : autoCalc.employmentInsurance;
    const incomeTax =
      deductionMode === "EXACT" && body?.income_tax !== undefined
        ? Math.round(Number(body.income_tax))
        : autoCalc.incomeTax;
    const localIncomeTax =
      deductionMode === "EXACT" && body?.local_income_tax !== undefined
        ? Math.round(Number(body.local_income_tax))
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
      localIncomeTax +
      otherDeduction;
    const netAmount = Math.max(0, grossAmount - deductionTotal);

    const calcMeta = {
      ...(body?.calc_meta || {}),
      deduction_mode: deductionMode,
      other_deduction: otherDeduction,
      resident_or_biz_no: String(body?.resident_or_biz_no || "").trim(),
    };

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
      calc_meta: calcMeta,
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
    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 당월 초안(DRAFT) 전 건 1클릭 명세서 배부 확정
    if (body?.action === "PUBLISH_ALL_DRAFTS") {
      const payMonth = String(body?.pay_month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(payMonth)) {
        return apiFail("귀속월(YYYY-MM)이 필요합니다.");
      }
      const { data: updatedRows, error } = await supabaseAdmin
        .from("hq_payroll")
        .update({ status: "CONFIRMED", updated_at: nowIso })
        .eq("pay_month", payMonth)
        .eq("status", "DRAFT")
        .select("payroll_id");

      if (error) return apiFail(`일괄 배부 실패: ${error.message}`, 500);
      return NextResponse.json({
        success: true,
        data: { updatedCount: (updatedRows || []).length },
      });
    }

    const ids: string[] = Array.isArray(body?.payroll_ids)
      ? body.payroll_ids
      : body?.payroll_id
      ? [String(body.payroll_id)]
      : [];

    if (ids.length === 0) return apiFail("대상 정산 ID가 필요합니다.");

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

    // 단건 정산 수정 (요율 자동계산 또는 세무사 확정 공제액 보존)
    const { data: existingRow } = await supabaseAdmin
      .from("hq_payroll")
      .select("calc_meta, status")
      .eq("payroll_id", ids[0])
      .maybeSingle();

    const payType = String(body?.pay_type || "EMPLOYEE") as HqPayrollType;
    const basePay = Math.max(0, Math.round(Number(body?.base_pay || 0)));
    const mealAllowance = Math.max(
      0,
      Math.round(Number(body?.meal_allowance || 0))
    );
    const overtimePay = Math.max(
      0,
      Math.round(Number(body?.overtime_pay || 0))
    );
    const bonusPay = Math.round(Number(body?.bonus_pay || 0));

    const autoCalc = calculatePayrollAmounts({
      payType,
      basePay,
      mealAllowance,
      overtimePay,
      bonusPay: Math.max(0, bonusPay),
      royaltyTaxMode:
        body?.calc_meta?.royalty_tax_mode ??
        existingRow?.calc_meta?.royalty_tax_mode ??
        null,
    });

    const deductionMode =
      body?.deduction_mode === "EXACT" ? "EXACT" : "AUTO";
    const otherDeduction =
      deductionMode === "EXACT"
        ? Math.round(Number(body?.other_deduction || 0))
        : 0;

    const nationalPension =
      deductionMode === "EXACT" && body?.national_pension !== undefined
        ? Math.round(Number(body.national_pension))
        : autoCalc.nationalPension;
    const healthInsurance =
      deductionMode === "EXACT" && body?.health_insurance !== undefined
        ? Math.round(Number(body.health_insurance))
        : autoCalc.healthInsurance;
    const longTermCare =
      deductionMode === "EXACT" && body?.long_term_care !== undefined
        ? Math.round(Number(body.long_term_care))
        : autoCalc.longTermCare;
    const employmentInsurance =
      deductionMode === "EXACT" && body?.employment_insurance !== undefined
        ? Math.round(Number(body.employment_insurance))
        : autoCalc.employmentInsurance;
    const incomeTax =
      deductionMode === "EXACT" && body?.income_tax !== undefined
        ? Math.round(Number(body.income_tax))
        : autoCalc.incomeTax;
    const localIncomeTax =
      deductionMode === "EXACT" && body?.local_income_tax !== undefined
        ? Math.round(Number(body.local_income_tax))
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
      localIncomeTax +
      otherDeduction;
    const netAmount = Math.max(0, grossAmount - deductionTotal);

    const nextCalcMeta = {
      ...(existingRow?.calc_meta || {}),
      ...(body?.calc_meta || {}),
      deduction_mode: deductionMode,
      other_deduction: otherDeduction,
      resident_or_biz_no:
        body?.resident_or_biz_no !== undefined
          ? String(body.resident_or_biz_no).trim()
          : existingRow?.calc_meta?.resident_or_biz_no || "",
    };

    const { data: updated, error } = await supabaseAdmin
      .from("hq_payroll")
      .update({
        pay_type: payType,
        payee_name: body?.payee_name,
        department_or_role: body?.department_or_role,
        bank_info: body?.bank_info || null,
        book_or_project: body?.book_or_project || null,
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
        calc_meta: nextCalcMeta,
        status: body?.status || existingRow?.status || "CONFIRMED",
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
    const idsCsv = req.nextUrl.searchParams.get("ids") || "";
    const targetIds = idsCsv
      ? idsCsv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : id
      ? [id]
      : [];

    if (targetIds.length === 0) return apiFail("삭제할 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("hq_payroll")
      .delete()
      .in("payroll_id", targetIds);

    if (error) return apiFail(`삭제 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ payroll DELETE error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
