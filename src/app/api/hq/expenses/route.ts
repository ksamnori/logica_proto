// src/app/api/hq/expenses/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqExpense, HqSettlementStatus } from "@/lib/hq/types";

export const runtime = "nodejs";

function generateExpenseNo(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `EXP-${ym}-${sec}${rand}`;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    if (caller.schemaMissing) {
      return NextResponse.json({
        success: true,
        schemaMissing: true,
        data: { expenses: [], canSettle: false, meId: caller.userId },
      });
    }

    const monthParam = req.nextUrl.searchParams.get("month") || "";
    const supabaseAdmin = getSupabaseAdmin();

    let query = supabaseAdmin
      .from("hq_expense")
      .select("*, hq_approval_doc(doc_no)")
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);

    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      query = query
        .gte("expense_date", `${monthParam}-01`)
        .lte("expense_date", `${monthParam}-${String(lastDay).padStart(2, "0")}`);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: { expenses: [], canSettle: false, meId: caller.userId },
        });
      }
      return apiFail(error.message, 500);
    }

    const canSettle = caller.isHrManager || caller.rankLevel >= 3;

    const mapped: HqExpense[] = (data || [])
      .filter((row: any) => {
        if (caller.isHrManager || caller.rankLevel >= 4) return true;
        if (caller.rankLevel === 3 && row.department === caller.department) return true;
        return String(row.requester_id) === caller.userId;
      })
      .map((row: any) => {
        const apr = Array.isArray(row.hq_approval_doc)
          ? row.hq_approval_doc[0]
          : row.hq_approval_doc;
        return {
          expense_id: String(row.expense_id),
          expense_no: row.expense_no,
          source_type: row.source_type || "DIRECT",
          approval_id: row.approval_id || null,
          approval_doc_no: apr?.doc_no || null,
          requester_id: String(row.requester_id),
          requester_name: row.requester_name,
          department: row.department || "",
          expense_date: row.expense_date,
          category: row.category,
          payment_method: row.payment_method,
          merchant_name: row.merchant_name,
          amount: Number(row.amount || 0),
          tax_amount: Number(row.tax_amount || 0),
          card_last4: row.card_last4 || null,
          description: row.description || null,
          receipt_url: row.receipt_url || null,
          settlement_status: row.settlement_status as HqSettlementStatus,
          settled_by: row.settled_by || null,
          settled_at: row.settled_at || null,
          admin_memo: row.admin_memo || null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        meId: caller.userId,
        canSettle,
        isHrManager: caller.isHrManager,
        expenses: mapped,
      },
    });
  } catch (e: any) {
    console.error("HQ expenses GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (caller.schemaMissing) {
      return apiFail("먼저 본부 전용 DB 테이블(hq_schema.sql)을 생성해 주세요.", 400);
    }

    const body = await req.json();
    const merchantName = String(body?.merchant_name || "").trim();
    const amount = Math.round(Number(body?.amount || 0));
    const category = String(body?.category || "기타").trim();
    const paymentMethod = String(body?.payment_method || "법인카드").trim();
    const expenseDate =
      String(body?.expense_date || "").trim() || new Date().toISOString().slice(0, 10);

    if (!merchantName) return apiFail("사용처(가맹점·거래처명)를 입력해주세요.");
    if (amount <= 0) return apiFail("금액은 0원보다 커야 합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("hq_expense")
      .insert({
        expense_no: generateExpenseNo(),
        source_type: "DIRECT",
        requester_id: caller.userId,
        requester_name: caller.name,
        department: caller.department,
        expense_date: expenseDate,
        category,
        payment_method: paymentMethod,
        merchant_name: merchantName,
        amount,
        tax_amount:
          body?.tax_amount !== undefined
            ? Math.round(Number(body.tax_amount))
            : Math.round(amount / 11),
        card_last4: body?.card_last4 ? String(body.card_last4).trim() : null,
        description: body?.description ? String(body.description).trim() : null,
        receipt_url: body?.receipt_url || null,
        settlement_status: "정산대기",
        updated_at: nowIso,
      })
      .select("expense_id, expense_no")
      .single();

    if (error || !data) {
      return apiFail(`비용 내역 등록 실패: ${error?.message || ""}`, 500);
    }

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    console.error("HQ expenses POST error:", e);
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
    const expenseIds: string[] = Array.isArray(body?.expense_ids)
      ? body.expense_ids.map(String)
      : body?.expense_id
        ? [String(body.expense_id)]
        : [];

    if (expenseIds.length === 0) return apiFail("대상 비용 내역 ID가 없습니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 정산 상태 변경 (정산완료 / 반려 / 정산대기)
    if (body?.settlement_status !== undefined) {
      const canSettle = caller.isHrManager || caller.rankLevel >= 3;
      if (!canSettle) {
        return apiFail("정산 처리는 팀장급 이상 또는 경영지원/관리자만 가능합니다.", 403);
      }
      const nextStatus = String(body.settlement_status) as HqSettlementStatus;
      if (!["정산대기", "정산완료", "반려"].includes(nextStatus)) {
        return apiFail("올바르지 않은 정산 상태입니다.");
      }

      const { error } = await supabaseAdmin
        .from("hq_expense")
        .update({
          settlement_status: nextStatus,
          settled_by:
            nextStatus === "정산대기" ? null : `${caller.name} ${caller.jobTitle}`.trim(),
          settled_at: nextStatus === "정산대기" ? null : nowIso,
          admin_memo:
            body.admin_memo !== undefined ? String(body.admin_memo).trim() || null : undefined,
          updated_at: nowIso,
        })
        .in("expense_id", expenseIds);

      if (error) return apiFail(`정산 상태 변경 실패: ${error.message}`, 500);
      return NextResponse.json({ success: true, data: { updated: expenseIds.length } });
    }

    // 일반 필드 수정 (정산대기 상태일 때 본인 또는 관리자)
    const targetId = expenseIds[0];
    const { data: existing } = await supabaseAdmin
      .from("hq_expense")
      .select("requester_id, settlement_status")
      .eq("expense_id", targetId)
      .maybeSingle();

    if (!existing) return apiFail("내역을 찾을 수 없습니다.", 404);
    if (!caller.isHrManager && String(existing.requester_id) !== caller.userId) {
      return apiFail("본인이 등록한 내역만 수정할 수 있습니다.", 403);
    }

    const patch: Record<string, any> = { updated_at: nowIso };
    if (body.expense_date !== undefined) patch.expense_date = body.expense_date;
    if (body.category !== undefined) patch.category = body.category;
    if (body.payment_method !== undefined) patch.payment_method = body.payment_method;
    if (body.merchant_name !== undefined) patch.merchant_name = String(body.merchant_name).trim();
    if (body.amount !== undefined) {
      const amt = Math.round(Number(body.amount));
      patch.amount = amt;
      patch.tax_amount = Math.round(amt / 11);
    }
    if (body.card_last4 !== undefined) patch.card_last4 = body.card_last4 || null;
    if (body.description !== undefined) patch.description = body.description || null;
    if (body.receipt_url !== undefined) patch.receipt_url = body.receipt_url || null;

    const { error } = await supabaseAdmin
      .from("hq_expense")
      .update(patch)
      .eq("expense_id", targetId);

    if (error) return apiFail(`수정 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ expenses PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const expenseId = req.nextUrl.searchParams.get("id") || "";
    if (!expenseId) return apiFail("삭제할 비용 내역 ID가 없습니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { data: row } = await supabaseAdmin
      .from("hq_expense")
      .select("requester_id, settlement_status, source_type")
      .eq("expense_id", expenseId)
      .maybeSingle();

    if (!row) return apiFail("내역을 찾을 수 없습니다.", 404);
    if (row.source_type === "APPROVAL" && !caller.isHrManager) {
      return apiFail("전자결재 승인 연동 내역은 임의로 삭제할 수 없습니다.", 403);
    }
    if (!caller.isHrManager && String(row.requester_id) !== caller.userId) {
      return apiFail("본인이 등록한 내역만 삭제할 수 있습니다.", 403);
    }
    if (!caller.isHrManager && row.settlement_status === "정산완료") {
      return apiFail("정산 완료된 내역은 삭제할 수 없습니다.", 400);
    }

    const { error } = await supabaseAdmin
      .from("hq_expense")
      .delete()
      .eq("expense_id", expenseId);

    if (error) return apiFail(`삭제 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ expenses DELETE error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
