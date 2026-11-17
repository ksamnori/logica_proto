// src/app/api/hq/leaves/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import {
  readLeavesLedgerServer,
  writeLeavesLedgerServer,
} from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqAnnualLeavePlanItem,
  HqApprovalDoc,
  HqApprovalStep,
  HqCustomLeaveGrantItem,
  HqCustomLeaveGrantPeriodMode,
  HqLeaveAdjustmentCategory,
  HqLeaveAdjustmentItem,
  HqLeavePromotionTargetItem,
  HqPromotionKind,
} from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const ledger = await readLeavesLedgerServer(supabaseAdmin);
    const canManage =
      caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3;

    // 기한 지난 촉진 요청 상태 실시간 판정 (GET 요청 시 부작용 쓰기 방지로 동시성 경합 차단)
    const todayYmd = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const normalizedPromotionTargets = ledger.promotionTargets.map((t) =>
      t.status === "PENDING" && t.due_date && t.due_date < todayYmd
        ? { ...t, status: "EXPIRED" as const }
        : t
    );

    let leaveDocs: HqApprovalDoc[] = [];
    if (!caller.schemaMissing) {
      let query = supabaseAdmin
        .from("hq_approval_doc")
        .select("*")
        .eq("doc_type", "LEAVE")
        .order("effective_date", { ascending: false })
        .limit(800);

      if (!canManage) {
        query = query.eq("drafter_id", caller.userId);
      }

      const { data: rows, error } = await query;
      if (!error && rows && rows.length > 0) {
        const ids = rows.map((r: any) => r.approval_id);
        const { data: stepRows } = await supabaseAdmin
          .from("hq_approval_step")
          .select("*")
          .in("approval_id", ids)
          .order("step_order", { ascending: true });

        const stepMap = new Map<string, HqApprovalStep[]>();
        (stepRows || []).forEach((s: any) => {
          const k = String(s.approval_id);
          const list = stepMap.get(k) || [];
          list.push({
            step_id: s.step_id,
            approval_id: k,
            step_order: Number(s.step_order),
            step_role: s.step_role,
            approver_id: String(s.approver_id),
            approver_name: s.approver_name,
            approver_dept: s.approver_dept || "",
            approver_rank: s.approver_rank || "",
            approver_title: s.approver_title || "",
            status: s.status,
            comment: s.comment || null,
            acted_at: s.acted_at || null,
          });
          stepMap.set(k, list);
        });

        leaveDocs = rows.map((d: any) => ({
          approval_id: String(d.approval_id),
          doc_no: d.doc_no,
          doc_type: d.doc_type,
          title: d.title,
          content: d.content || "",
          drafter_id: String(d.drafter_id),
          drafter_name: d.drafter_name,
          drafter_dept: d.drafter_dept || "",
          drafter_rank: d.drafter_rank || "STAFF",
          drafter_title: d.drafter_title || "",
          status: d.status,
          current_step_order: Number(d.current_step_order || 1),
          total_steps: Number(d.total_steps || 1),
          is_auto_delegated: Boolean(d.is_auto_delegated),
          amount: Number(d.amount || 0),
          effective_date: d.effective_date || null,
          end_date: d.end_date || null,
          leave_type: d.leave_type || null,
          leave_days: Number(d.leave_days || 0),
          handover_name: d.handover_name || null,
          expense_category: null,
          payment_method: null,
          merchant_name: null,
          card_last4: null,
          receipt_url: null,
          items_json: [],
          urgent: Boolean(d.urgent),
          submitted_at: d.submitted_at,
          completed_at: d.completed_at || null,
          updated_at: d.updated_at,
          steps: stepMap.get(String(d.approval_id)) || [],
        }));
      } else if (error && !isMissingHqTableError(error)) {
        return apiFail(error.message, 500);
      }
    }

    const visibleAdjustments = canManage
      ? ledger.adjustments
      : ledger.adjustments.filter((a) => a.member_id === caller.userId);

    const visiblePlans = canManage
      ? ledger.plans
      : ledger.plans.filter((p) => p.member_id === caller.userId);

    const visibleCustomGrants = canManage
      ? ledger.customGrants
      : ledger.customGrants.filter((g) => g.member_id === caller.userId);

    const visibleUploadedMonthly = canManage
      ? ledger.uploadedMonthly
      : ledger.uploadedMonthly.filter((u) => u.member_id === caller.userId);

    const visiblePromoTargets = canManage
      ? normalizedPromotionTargets
      : normalizedPromotionTargets.filter((t) => t.member_id === caller.userId);

    return NextResponse.json(
      {
        success: true,
        data: {
          canManage,
          adjustments: visibleAdjustments,
          promotions: ledger.promotions,
          promotionTargets: visiblePromoTargets,
          plans: visiblePlans,
          customGrants: visibleCustomGrants,
          uploadedMonthly: visibleUploadedMonthly,
          leaveDocs,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const canManage = caller.isHrManager || caller.isHqAdmin;
    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const ledger = await readLeavesLedgerServer(supabaseAdmin);
    const nowIso = new Date().toISOString();

    if (action === "ADD_ADJUSTMENT" || action === "BATCH_ADJUSTMENT") {
      if (!canManage) {
        return apiFail("연차 조정은 인사담당자·최고관리자만 가능합니다.", 403);
      }

      const targets: {
        member_id: string;
        member_name: string;
        department?: string;
        delta_days?: number;
        before_remain_days?: number;
        after_remain_days?: number;
      }[] =
        action === "BATCH_ADJUSTMENT" && Array.isArray(body?.targets)
          ? body.targets
          : [
              {
                member_id: String(body?.member_id || "").trim(),
                member_name: String(body?.member_name || "").trim(),
                department: body?.department ? String(body.department) : undefined,
              },
            ];

      const yearMonth = String(body?.year_month || "").trim();
      const defaultDeltaDays = Number(body?.delta_days || 0);
      const unitMode: "DAYS" | "HOURS" =
        body?.unit_mode === "HOURS" ? "HOURS" : "DAYS";
      const rawInputAmount =
        typeof body?.raw_input_amount === "number"
          ? body.raw_input_amount
          : undefined;
      const adjustmentCategory: HqLeaveAdjustmentCategory =
        body?.adjustment_category === "ACTIVE_SETTLEMENT" ||
        body?.adjustment_category === "RETIREE_SETTLEMENT"
          ? body.adjustment_category
          : "MANUAL";
      const reason = String(body?.reason || "").trim() || "관리자 연차 조정";

      const validTargets = targets.filter((t) => {
        if (!t?.member_id) return false;
        const d =
          typeof t.delta_days === "number" ? t.delta_days : defaultDeltaDays;
        return d !== 0 && !Number.isNaN(d);
      });

      if (validTargets.length === 0 || !/^\d{4}-\d{2}$/.test(yearMonth)) {
        return apiFail("대상자, 적용 연월, 조정 일수를 확인해 주세요.");
      }

      validTargets.forEach((t, idx) => {
        const effDelta =
          typeof t.delta_days === "number" ? t.delta_days : defaultDeltaDays;
        const item: HqLeaveAdjustmentItem = {
          id: `lvadj-${Date.now()}-${idx}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          member_id: String(t.member_id),
          member_name: String(t.member_name || ""),
          department: t.department || undefined,
          year_month: yearMonth,
          delta_days: Math.round(effDelta * 1000) / 1000,
          unit_mode: unitMode,
          raw_input_amount: rawInputAmount,
          adjustment_category: adjustmentCategory,
          before_remain_days:
            typeof t.before_remain_days === "number"
              ? t.before_remain_days
              : undefined,
          after_remain_days:
            typeof t.after_remain_days === "number"
              ? t.after_remain_days
              : undefined,
          reason,
          actor_name: caller.name,
          created_at: nowIso,
        };
        ledger.adjustments.unshift(item);
      });

      await writeLeavesLedgerServer(supabaseAdmin, ledger);

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "수정",
        info_type: "휴가정보",
        description: `연차 수동 조정 (${validTargets.length}명 · ${reason})`,
        delegated: caller.isDelegatedHrAdmin,
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { adjustments: ledger.adjustments },
      });
    }

    if (action === "DELETE_ADJUSTMENT") {
      if (!canManage) return apiFail("권한이 없습니다.", 403);
      const id = String(body?.id || "").trim();
      ledger.adjustments = ledger.adjustments.filter((a) => a.id !== id);
      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { adjustments: ledger.adjustments },
      });
    }

    if (action === "GRANT_CUSTOM_LEAVE") {
      if (!canManage) {
        return apiFail("맞춤 휴가 부여는 인사관리자만 가능합니다.", 403);
      }
      const targets: {
        member_id: string;
        member_name: string;
        department?: string;
      }[] = Array.isArray(body?.targets) ? body.targets : [];
      const leaveId = String(body?.leave_id || "").trim();
      const leaveName = String(body?.leave_name || "").trim();
      const grantedAmount = Number(body?.granted_amount || 0);
      const grantUnitMode: "DAYS" | "HOURS" =
        body?.grant_unit_mode === "HOURS" ? "HOURS" : "DAYS";
      const grantedHours =
        typeof body?.granted_hours === "number"
          ? body.granted_hours
          : undefined;
      const periodMode: HqCustomLeaveGrantPeriodMode =
        body?.period_mode === "RANGE" ||
        body?.period_mode === "START_ONLY" ||
        body?.period_mode === "END_ONLY"
          ? body.period_mode
          : "ALWAYS";
      const validFrom = body?.valid_from ? String(body.valid_from).trim() : null;
      const expiresAt = body?.expires_at ? String(body.expires_at).trim() : null;
      const reason = String(body?.reason || "").trim() || "맞춤 휴가 직접 부여";

      if (targets.length === 0 || !leaveId || grantedAmount <= 0) {
        return apiFail("부여 대상자, 맞춤 휴가 항목, 부여 시간을 확인해 주세요.");
      }

      targets.forEach((t, idx) => {
        if (!t.member_id) return;
        const g: HqCustomLeaveGrantItem = {
          id: `clg-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          member_id: String(t.member_id),
          member_name: String(t.member_name || ""),
          department: t.department || undefined,
          leave_id: leaveId,
          leave_name: leaveName,
          granted_amount: Math.round(grantedAmount * 1000) / 1000,
          grant_unit_mode: grantUnitMode,
          granted_hours: grantedHours,
          period_mode: periodMode,
          valid_from: validFrom,
          expires_at: expiresAt,
          reason,
          actor_name: caller.name,
          created_at: nowIso,
        };
        ledger.customGrants.unshift(g);
      });

      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { customGrants: ledger.customGrants },
      });
    }

    if (action === "DELETE_CUSTOM_GRANT") {
      if (!canManage) return apiFail("권한이 없습니다.", 403);
      const id = String(body?.id || "").trim();
      ledger.customGrants = ledger.customGrants.filter((g) => g.id !== id);
      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { customGrants: ledger.customGrants },
      });
    }

    if (action === "UPLOAD_MONTHLY_USAGE") {
      if (!canManage) {
        return apiFail("연차 사용 내역 업로드는 인사관리자만 가능합니다.", 403);
      }
      const year = Number(body?.year || new Date().getFullYear());
      const rows: { member_id: string; member_name: string; months: number[] }[] =
        Array.isArray(body?.rows) ? body.rows : [];

      if (rows.length === 0) {
        return apiFail("업로드할 월별 연차 사용 내역 행이 없습니다.");
      }

      rows.forEach((r) => {
        if (!r.member_id) return;
        const cleanMonths = Array.from({ length: 12 }, (_, idx) =>
          Math.max(0, Number(r.months?.[idx] || 0))
        );
        const existingIdx = ledger.uploadedMonthly.findIndex(
          (u) => u.member_id === r.member_id && u.year === year
        );
        const nextItem = {
          member_id: String(r.member_id),
          member_name: String(r.member_name || ""),
          year,
          months: cleanMonths,
          updated_at: nowIso,
        };
        if (existingIdx >= 0) {
          ledger.uploadedMonthly[existingIdx] = nextItem;
        } else {
          ledger.uploadedMonthly.push(nextItem);
        }
      });

      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: {
          count: rows.length,
          uploadedMonthly: ledger.uploadedMonthly,
        },
      });
    }

    if (action === "REQUEST_PROMOTION_PLANS") {
      if (!canManage) {
        return apiFail("연차 사용계획 요청 권한이 없습니다.", 403);
      }
      const year = Number(body?.year || new Date().getFullYear());
      const promoType = (body?.promo_type || "연차") as HqPromotionKind;
      const dueDate = String(body?.due_date || "").trim();
      const targets: {
        member_id: string;
        member_name: string;
        department: string;
        employee_no?: string;
        expire_date?: string;
      }[] = Array.isArray(body?.targets) ? body.targets : [];

      if (!dueDate || targets.length === 0) {
        return apiFail("요청 대상과 작성 기한을 선택해 주세요.");
      }

      targets.forEach((t, idx) => {
        const defaultExpire = `${year + 1}-01-01`; // 당해 연말(12.31) 경과 익일 0시 소멸일 표기
        const existingIdx = ledger.promotionTargets.findIndex(
          (p) =>
            p.year === year &&
            p.member_id === t.member_id &&
            p.promo_type === promoType
        );
        const entry: HqLeavePromotionTargetItem = {
          id:
            existingIdx >= 0
              ? ledger.promotionTargets[existingIdx].id
              : `prmt-${Date.now()}-${idx}`,
          year,
          member_id: String(t.member_id),
          member_name: String(t.member_name || ""),
          department: String(t.department || ""),
          employee_no: t.employee_no || "",
          promo_type: promoType,
          expire_date: t.expire_date || defaultExpire,
          due_date: dueDate,
          status: "PENDING",
          requested_by: caller.name,
          requested_at: nowIso,
        };
        if (existingIdx >= 0) {
          ledger.promotionTargets[existingIdx] = entry;
        } else {
          ledger.promotionTargets.unshift(entry);
        }
      });

      // 해당 연도 캠페인도 자동 활성화
      const campIdx = ledger.promotions.findIndex((c) => c.year === year);
      if (campIdx >= 0) {
        ledger.promotions[campIdx].is_active = true;
        ledger.promotions[campIdx].due_date = dueDate;
      } else {
        ledger.promotions.push({
          year,
          is_active: true,
          due_date: dueDate,
          started_by: caller.name,
          started_at: nowIso,
        });
      }

      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: {
          promotionTargets: ledger.promotionTargets,
          promotions: ledger.promotions,
        },
      });
    }

    if (action === "DELETE_PROMOTION_TARGET") {
      if (!canManage) return apiFail("권한이 없습니다.", 403);
      const id = String(body?.id || "").trim();
      ledger.promotionTargets = ledger.promotionTargets.filter(
        (t) => t.id !== id
      );
      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { promotionTargets: ledger.promotionTargets },
      });
    }

    if (action === "TOGGLE_PROMOTION") {
      if (!canManage) {
        return apiFail("연차 촉진 실행 권한이 없습니다.", 403);
      }
      const year = Number(body?.year || new Date().getFullYear());
      const isActive = Boolean(body?.is_active);
      const dueDate = String(body?.due_date || "").trim() || `${year}-12-15`;

      const idx = ledger.promotions.findIndex((p) => p.year === year);
      if (idx >= 0) {
        ledger.promotions[idx] = {
          ...ledger.promotions[idx],
          is_active: isActive,
          due_date: dueDate,
          started_by: caller.name,
          started_at: nowIso,
        };
      } else {
        ledger.promotions.push({
          year,
          is_active: isActive,
          due_date: dueDate,
          started_by: caller.name,
          started_at: nowIso,
        });
      }

      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { promotions: ledger.promotions },
      });
    }

    if (action === "SAVE_PLAN") {
      const year = Number(body?.year || new Date().getFullYear());
      const plannedDates: string[] = Array.isArray(body?.planned_dates)
        ? Array.from(
            new Set<string>(
              body.planned_dates
                .map((d: any) => String(d).trim())
                .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            )
          ).sort()
        : [];
      const memo = String(body?.memo || "").trim();

      const existingIdx = ledger.plans.findIndex(
        (p) => p.year === year && p.member_id === caller.userId
      );
      const planItem: HqAnnualLeavePlanItem = {
        id:
          existingIdx >= 0
            ? ledger.plans[existingIdx].id
            : `lvplan-${Date.now()}`,
        year,
        member_id: caller.userId,
        member_name: caller.name,
        department: caller.department,
        planned_dates: plannedDates,
        memo,
        submitted_at: nowIso,
      };

      if (existingIdx >= 0) {
        ledger.plans[existingIdx] = planItem;
      } else {
        ledger.plans.unshift(planItem);
      }

      // 본인에게 요청된 연차 촉진 항목 상태도 'COMPLETED(완료)'로 자동 전환
      ledger.promotionTargets = ledger.promotionTargets.map((t) =>
        t.year === year && t.member_id === caller.userId
          ? { ...t, status: "COMPLETED" }
          : t
      );

      await writeLeavesLedgerServer(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: {
          plans: ledger.plans,
          promotionTargets: ledger.promotionTargets,
        },
      });
    }

    if (action === "ADMIN_REGISTER_LEAVE") {
      if (!canManage) {
        return apiFail("구성원 휴가 대리 등록은 인사관리자만 가능합니다.", 403);
      }
      if (caller.schemaMissing) {
        return apiFail("먼저 본부 전용 DB 테이블(hq_schema.sql)을 생성해 주세요.", 400);
      }

      const targetId = String(body?.member_id || "").trim();
      const targetName = String(body?.member_name || "").trim();
      const targetDept = String(body?.department || "미지정").trim();
      const leaveType = String(body?.leave_type || "연차").trim();
      const startDate = String(body?.start_date || "").trim();
      const endDate = String(body?.end_date || startDate).trim();
      const leaveDays = Number(body?.leave_days || 1);
      const reason = String(body?.reason || "").trim();

      if (!targetId || !startDate || leaveDays <= 0) {
        return apiFail("대상 구성원, 휴가 시작일, 사용 일수를 확인해 주세요.");
      }

      const ym = startDate.slice(0, 7).replace("-", "");
      const docNo = `APR-${ym}-${String(Math.floor(1000 + Math.random() * 9000))}`;

      const { data: createdDoc, error: docErr } = await supabaseAdmin
        .from("hq_approval_doc")
        .insert({
          doc_no: docNo,
          doc_type: "LEAVE",
          title: `[${leaveType}] ${targetName} 휴가 등록`,
          content: reason || `인사관리자(${caller.name}) 휴가 등록`,
          drafter_id: targetId,
          drafter_name: targetName,
          drafter_dept: targetDept,
          drafter_rank: "STAFF",
          drafter_title: "",
          status: "APPROVED",
          current_step_order: 1,
          total_steps: 1,
          is_auto_delegated: false,
          amount: 0,
          effective_date: startDate,
          end_date: endDate,
          leave_type: leaveType,
          leave_days: leaveDays,
          submitted_at: nowIso,
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .select("*")
        .single();

      if (docErr || !createdDoc) {
        return apiFail(`휴가 등록 실패: ${docErr?.message || ""}`, 500);
      }

      await supabaseAdmin.from("hq_approval_step").insert({
        approval_id: createdDoc.approval_id,
        step_order: 1,
        step_role: "FINAL_APPROVER",
        approver_id: caller.userId,
        approver_name: caller.name,
        approver_dept: caller.department,
        approver_rank: caller.rankCode,
        approver_title: caller.jobTitle,
        status: "APPROVED",
        comment: "인사관리자 직접 등록",
        acted_at: nowIso,
      });

      return NextResponse.json({
        success: true,
        data: { approval_id: createdDoc.approval_id },
      });
    }

    if (action === "ADMIN_CANCEL_LEAVE_DOC") {
      if (!canManage) {
        return apiFail("휴가 기록 취소 권한이 없습니다.", 403);
      }
      const approvalId = String(body?.approval_id || "").trim();
      if (!approvalId) return apiFail("문서 ID가 없습니다.");
      await supabaseAdmin
        .from("hq_approval_doc")
        .update({ status: "CANCELLED", updated_at: nowIso })
        .eq("approval_id", approvalId);
      await supabaseAdmin
        .from("hq_attendance")
        .delete()
        .eq("approval_id", approvalId);
      return NextResponse.json({ success: true, data: { cancelled: true } });
    }

    return apiFail("지원하지 않는 휴가 요청입니다.");
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}
