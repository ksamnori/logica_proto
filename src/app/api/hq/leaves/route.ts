// src/app/api/hq/leaves/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import { SETTINGS_STORAGE_BUCKET } from "@/lib/hq/companySettingsServer";
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
  HqLeaveAdjustmentItem,
  HqLeavePromotionCampaign,
} from "@/lib/hq/types";

export const runtime = "nodejs";

const LEAVES_LEDGER_PATH = "hq_system_config/leaves_ledger.json";

interface StoredLeavesLedger {
  adjustments: HqLeaveAdjustmentItem[];
  promotions: HqLeavePromotionCampaign[];
  plans: HqAnnualLeavePlanItem[];
}

const EMPTY_LEDGER: StoredLeavesLedger = {
  adjustments: [],
  promotions: [],
  plans: [],
};

async function readLeavesLedger(
  supabaseAdmin: SupabaseClient
): Promise<StoredLeavesLedger> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .download(LEAVES_LEDGER_PATH);
    if (error || !blob) return EMPTY_LEDGER;
    const parsed = JSON.parse(await blob.text());
    return {
      adjustments: Array.isArray(parsed?.adjustments) ? parsed.adjustments : [],
      promotions: Array.isArray(parsed?.promotions) ? parsed.promotions : [],
      plans: Array.isArray(parsed?.plans) ? parsed.plans : [],
    };
  } catch {
    return EMPTY_LEDGER;
  }
}

async function writeLeavesLedger(
  supabaseAdmin: SupabaseClient,
  ledger: StoredLeavesLedger
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(ledger, null, 2));
  await supabaseAdmin.storage
    .from(SETTINGS_STORAGE_BUCKET)
    .upload(LEAVES_LEDGER_PATH, bytes, {
      contentType: "application/json",
      upsert: true,
    });
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const ledger = await readLeavesLedger(supabaseAdmin);
    const canManage = caller.isHrManager || caller.isHqAdmin;

    let leaveDocs: HqApprovalDoc[] = [];
    if (!caller.schemaMissing) {
      let query = supabaseAdmin
        .from("hq_approval_doc")
        .select("*")
        .eq("doc_type", "LEAVE")
        .order("effective_date", { ascending: false })
        .limit(500);

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

    return NextResponse.json({
      success: true,
      data: {
        canManage,
        adjustments: visibleAdjustments,
        promotions: ledger.promotions,
        plans: visiblePlans,
        leaveDocs,
      },
    });
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
    const ledger = await readLeavesLedger(supabaseAdmin);
    const nowIso = new Date().toISOString();

    if (action === "ADD_ADJUSTMENT") {
      if (!canManage) {
        return apiFail("연차 수동 조정은 인사담당자·최고관리자만 가능합니다.", 403);
      }
      const memberId = String(body?.member_id || "").trim();
      const memberName = String(body?.member_name || "").trim();
      const yearMonth = String(body?.year_month || "").trim();
      const deltaDays = Number(body?.delta_days || 0);
      const reason = String(body?.reason || "").trim() || "관리자 연차 조정";

      if (!memberId || !/^\d{4}-\d{2}$/.test(yearMonth) || !deltaDays) {
        return apiFail("대상자, 적용 연월, 조정 일수를 확인해 주세요.");
      }

      const item: HqLeaveAdjustmentItem = {
        id: `lvadj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        member_id: memberId,
        member_name: memberName,
        year_month: yearMonth,
        delta_days: deltaDays,
        reason,
        actor_name: caller.name,
        created_at: nowIso,
      };
      ledger.adjustments.unshift(item);
      await writeLeavesLedger(supabaseAdmin, ledger);

      // hq_member_profile의 총 부여연차에도 동기 반영
      try {
        const { data: prof } = await supabaseAdmin
          .from("hq_member_profile")
          .select("annual_leave_total")
          .eq("instructor_id", memberId)
          .maybeSingle();
        if (prof) {
          const nextTotal = Math.max(
            0,
            Number((Number(prof.annual_leave_total ?? 15) + deltaDays).toFixed(2))
          );
          await supabaseAdmin
            .from("hq_member_profile")
            .update({ annual_leave_total: nextTotal, updated_at: nowIso })
            .eq("instructor_id", memberId);
        }
      } catch {
        // ignore if profile table missing
      }

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "수정",
        info_type: "휴가정보",
        description: `${memberName} 연차 조정 (${deltaDays > 0 ? `+${deltaDays}` : deltaDays}일 · ${reason})`,
        delegated: caller.isDelegatedHrAdmin,
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { adjustments: ledger.adjustments },
      });
    }

    if (action === "DELETE_ADJUSTMENT") {
      if (!canManage) {
        return apiFail("권한이 없습니다.", 403);
      }
      const id = String(body?.id || "").trim();
      const target = ledger.adjustments.find((a) => a.id === id);
      if (!target) return apiFail("조정 내역을 찾을 수 없습니다.", 404);

      ledger.adjustments = ledger.adjustments.filter((a) => a.id !== id);
      await writeLeavesLedger(supabaseAdmin, ledger);

      try {
        const { data: prof } = await supabaseAdmin
          .from("hq_member_profile")
          .select("annual_leave_total")
          .eq("instructor_id", target.member_id)
          .maybeSingle();
        if (prof) {
          const nextTotal = Math.max(
            0,
            Number(
              (Number(prof.annual_leave_total ?? 15) - target.delta_days).toFixed(2)
            )
          );
          await supabaseAdmin
            .from("hq_member_profile")
            .update({ annual_leave_total: nextTotal, updated_at: nowIso })
            .eq("instructor_id", target.member_id);
        }
      } catch {
        // ignore
      }

      return NextResponse.json({
        success: true,
        data: { adjustments: ledger.adjustments },
      });
    }

    if (action === "TOGGLE_PROMOTION") {
      if (!canManage) {
        return apiFail("연차 촉진 실행 권한이 없습니다.", 403);
      }
      const year = Number(body?.year || new Date().getFullYear());
      const isActive = Boolean(body?.is_active);
      const dueDate =
        String(body?.due_date || "").trim() || `${year}-12-15`;

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

      await writeLeavesLedger(supabaseAdmin, ledger);
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

      await writeLeavesLedger(supabaseAdmin, ledger);
      return NextResponse.json({
        success: true,
        data: { plans: ledger.plans },
      });
    }

    return apiFail("지원하지 않는 휴가 요청입니다.");
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}
