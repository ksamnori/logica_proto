// src/app/api/hq/approvals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { LEAVE_TYPES } from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqApprovalDoc, HqApprovalDocType, HqApprovalStep } from "@/lib/hq/types";

export const runtime = "nodejs";

function generateDocNo(prefix: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `${prefix}-${ym}-${sec}${rand}`;
}

async function applyPostApprovalSideEffects(
  supabaseAdmin: SupabaseClient,
  doc: any,
  approverName: string
) {
  const nowIso = new Date().toISOString();

  // 1) 휴가·연차 신청서(LEAVE) 최종 승인 → 연차 사용 일수 자동 반영
  if (doc.doc_type === "LEAVE" && Number(doc.leave_days) > 0) {
    const leaveMeta = LEAVE_TYPES.find((lt) => lt.label === doc.leave_type);
    const shouldDeduct = leaveMeta ? leaveMeta.deductAnnual : true;
    if (shouldDeduct) {
      const { data: prof } = await supabaseAdmin
        .from("hq_member_profile")
        .select("annual_leave_used")
        .eq("instructor_id", doc.drafter_id)
        .maybeSingle();

      const prevUsed = Number(prof?.annual_leave_used ?? 0);
      const nextUsed = Number((prevUsed + Number(doc.leave_days)).toFixed(1));
      await supabaseAdmin
        .from("hq_member_profile")
        .upsert(
          {
            instructor_id: doc.drafter_id,
            annual_leave_used: nextUsed,
            updated_at: nowIso,
          },
          { onConflict: "instructor_id" }
        );
    }

    // 1-B) 근태 기록표(hq_attendance)에 승인된 휴가/반차 일정 자동 등록
    try {
      const startStr = String(doc.effective_date || nowIso.slice(0, 10));
      const endStr = String(doc.end_date || startStr);
      const startDt = new Date(`${startStr}T00:00:00`);
      const endDt = new Date(`${endStr}T00:00:00`);
      const isHalf = String(doc.leave_type || "").includes("반차");
      const attendanceRows: Record<string, any>[] = [];

      if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(endDt.getTime())) {
        const cursor = new Date(startDt);
        let guard = 0;
        while (cursor <= endDt && guard < 31) {
          const dow = cursor.getDay();
          if (dow !== 0 && dow !== 6) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, "0");
            const d = String(cursor.getDate()).padStart(2, "0");
            attendanceRows.push({
              instructor_id: doc.drafter_id,
              member_name: doc.drafter_name,
              department: doc.drafter_dept || "미지정",
              work_date: `${y}-${m}-${d}`,
              work_mode: "LEAVE",
              status: isHalf ? "HALF_LEAVE" : "LEAVE",
              worked_minutes: isHalf ? 240 : 0,
              overtime_minutes: 0,
              location_note: doc.leave_type || "연차휴가",
              memo: `[전자결재 ${doc.doc_no}] ${doc.title}`,
              approval_id: doc.approval_id,
              updated_at: nowIso,
            });
          }
          cursor.setDate(cursor.getDate() + 1);
          guard += 1;
        }
      }

      if (attendanceRows.length > 0) {
        await supabaseAdmin
          .from("hq_attendance")
          .upsert(attendanceRows, { onConflict: "instructor_id,work_date" });
      }
    } catch {
      // hq_attendance 미생성 상태에서도 기존 휴가 결재 승인이 중단되지 않도록 보호
    }
  }

  // 2) 지출결의서(EXPENSE) 최종 승인 → 비용관리 장부(hq_expense) 자동 등록
  if (doc.doc_type === "EXPENSE" && Number(doc.amount) > 0) {
    const isCorpCard = String(doc.payment_method || "").includes("법인카드");
    await supabaseAdmin.from("hq_expense").upsert(
      {
        expense_no: generateDocNo("EXP"),
        source_type: "APPROVAL",
        approval_id: doc.approval_id,
        requester_id: doc.drafter_id,
        requester_name: doc.drafter_name,
        department: doc.drafter_dept || "미지정",
        expense_date: doc.effective_date || nowIso.slice(0, 10),
        category: doc.expense_category || "기타",
        payment_method: doc.payment_method || "법인카드",
        merchant_name: doc.merchant_name || doc.title,
        amount: Number(doc.amount),
        tax_amount: Math.round(Number(doc.amount) / 11),
        card_last4: doc.card_last4 || null,
        description: `[전자결재 ${doc.doc_no}] ${doc.title}${doc.content ? ` — ${doc.content}` : ""}`,
        receipt_url: doc.receipt_url || null,
        settlement_status: isCorpCard ? "정산완료" : "정산대기",
        settled_by: isCorpCard ? `${approverName} (결재승인)` : null,
        settled_at: isCorpCard ? nowIso : null,
        updated_at: nowIso,
      },
      { onConflict: "approval_id" }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    if (caller.schemaMissing) {
      return NextResponse.json({
        success: true,
        schemaMissing: true,
        data: { docs: [], myPendingCount: 0, meId: caller.userId },
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const [docRes, stepRes] = await Promise.all([
      supabaseAdmin
        .from("hq_approval_doc")
        .select("*")
        .order("submitted_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("hq_approval_step")
        .select("*")
        .order("step_order", { ascending: true }),
    ]);

    if (docRes.error) {
      if (isMissingHqTableError(docRes.error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: { docs: [], myPendingCount: 0, meId: caller.userId },
        });
      }
      return apiFail(docRes.error.message, 500);
    }
    if (stepRes.error) return apiFail(stepRes.error.message, 500);

    const stepsByDoc = new Map<string, HqApprovalStep[]>();
    (stepRes.data || []).forEach((s: any) => {
      const key = String(s.approval_id);
      const list = stepsByDoc.get(key) || [];
      list.push({
        step_id: s.step_id,
        approval_id: key,
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
      stepsByDoc.set(key, list);
    });

    const allDocs: HqApprovalDoc[] = (docRes.data || []).map((d: any) => ({
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
      expense_category: d.expense_category || null,
      payment_method: d.payment_method || null,
      merchant_name: d.merchant_name || null,
      card_last4: d.card_last4 || null,
      receipt_url: d.receipt_url || null,
      items_json: Array.isArray(d.items_json) ? d.items_json : [],
      urgent: Boolean(d.urgent),
      submitted_at: d.submitted_at,
      completed_at: d.completed_at || null,
      updated_at: d.updated_at,
      steps: stepsByDoc.get(String(d.approval_id)) || [],
    }));

    // 직책/직급 맥락 기반 접근 제어
    const visibleDocs = allDocs.filter((doc) => {
      if (caller.isHrManager || caller.rankLevel >= 4) return true;
      if (doc.drafter_id === caller.userId) return true;
      if (doc.steps.some((s) => s.approver_id === caller.userId)) return true;
      if (caller.rankLevel === 3 && doc.drafter_dept === caller.department) return true;
      return false;
    });

    const myPendingCount = visibleDocs.filter((doc) => {
      if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") return false;
      const cur = doc.steps.find((s) => s.step_order === doc.current_step_order);
      return cur && cur.approver_id === caller.userId && cur.status === "CURRENT";
    }).length;

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        meId: caller.userId,
        rankLevel: caller.rankLevel,
        isHrManager: caller.isHrManager,
        myPendingCount,
        docs: visibleDocs,
      },
    });
  } catch (e: any) {
    console.error("HQ approvals GET error:", e);
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
    const docType = String(body?.doc_type || "GENERAL") as HqApprovalDocType;
    const title = String(body?.title || "").trim();
    if (!["GENERAL", "LEAVE", "PURCHASE", "EXPENSE"].includes(docType)) {
      return apiFail("유효하지 않은 결재 양식입니다.");
    }
    if (!title) {
      return apiFail("기안 제목을 입력해주세요.");
    }

    const rawSteps = Array.isArray(body?.steps) ? body.steps : [];
    const instantSelfApprove = caller.rankLevel >= 5 && rawSteps.length === 0;

    if (!instantSelfApprove && rawSteps.length === 0) {
      return apiFail("최소 1명 이상의 결재자를 지정해야 합니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const docNo = generateDocNo("APR");

    const docPayload = {
      doc_no: docNo,
      doc_type: docType,
      title,
      content: String(body?.content || "").trim(),
      drafter_id: caller.userId,
      drafter_name: caller.name,
      drafter_dept: caller.department,
      drafter_rank: caller.rankCode,
      drafter_title: caller.jobTitle,
      status: instantSelfApprove ? "APPROVED" : "PENDING",
      current_step_order: 1,
      total_steps: instantSelfApprove ? 1 : rawSteps.length,
      is_auto_delegated: Boolean(body?.is_auto_delegated || instantSelfApprove),
      amount: Math.max(0, Math.round(Number(body?.amount || 0))),
      effective_date: body?.effective_date || null,
      end_date: body?.end_date || null,
      leave_type: body?.leave_type || null,
      leave_days: Number(body?.leave_days || 0),
      handover_name: body?.handover_name || null,
      expense_category: body?.expense_category || null,
      payment_method: body?.payment_method || null,
      merchant_name: body?.merchant_name || null,
      card_last4: body?.card_last4 || null,
      receipt_url: body?.receipt_url || null,
      items_json: Array.isArray(body?.items_json) ? body.items_json : [],
      urgent: Boolean(body?.urgent),
      submitted_at: nowIso,
      completed_at: instantSelfApprove ? nowIso : null,
      updated_at: nowIso,
    };

    const { data: createdDoc, error: docErr } = await supabaseAdmin
      .from("hq_approval_doc")
      .insert(docPayload)
      .select("*")
      .single();

    if (docErr || !createdDoc) {
      return apiFail(`결재 문서 상신 실패: ${docErr?.message || ""}`, 500);
    }

    const stepRows = instantSelfApprove
      ? [
          {
            approval_id: createdDoc.approval_id,
            step_order: 1,
            step_role: "DELEGATED_FINAL",
            approver_id: caller.userId,
            approver_name: caller.name,
            approver_dept: caller.department,
            approver_rank: caller.rankCode,
            approver_title: caller.jobTitle,
            status: "APPROVED",
            comment: "최고결재권자 기안 즉시 전결 승인",
            acted_at: nowIso,
          },
        ]
      : rawSteps.map((s: any, idx: number) => ({
          approval_id: createdDoc.approval_id,
          step_order: idx + 1,
          step_role: s.step_role || (idx + 1 === rawSteps.length ? "FINAL_APPROVER" : "REVIEWER"),
          approver_id: s.approver_id,
          approver_name: s.approver_name,
          approver_dept: s.approver_dept || "",
          approver_rank: s.approver_rank || "TEAM_LEAD",
          approver_title: s.approver_title || "",
          status: idx === 0 ? "CURRENT" : "WAITING",
          comment: null,
          acted_at: null,
        }));

    const { error: stepErr } = await supabaseAdmin
      .from("hq_approval_step")
      .insert(stepRows);

    if (stepErr) {
      await supabaseAdmin
        .from("hq_approval_doc")
        .delete()
        .eq("approval_id", createdDoc.approval_id);
      return apiFail(`결재선 저장 실패: ${stepErr.message}`, 500);
    }

    if (instantSelfApprove) {
      await applyPostApprovalSideEffects(supabaseAdmin, createdDoc, caller.name);
    }

    return NextResponse.json({
      success: true,
      data: { approval_id: createdDoc.approval_id, doc_no: docNo },
    });
  } catch (e: any) {
    console.error("HQ approvals POST error:", e);
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
    const approvalId = String(body?.approval_id || "").trim();
    const action = String(body?.action || "").toUpperCase();
    const comment = String(body?.comment || "").trim();

    if (!approvalId) return apiFail("결재 문서 ID가 없습니다.");
    if (!["APPROVE", "FINAL_APPROVE", "REJECT", "CANCEL"].includes(action)) {
      return apiFail("지원하지 않는 결재 처리 명령입니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const [docRes, stepRes] = await Promise.all([
      supabaseAdmin
        .from("hq_approval_doc")
        .select("*")
        .eq("approval_id", approvalId)
        .maybeSingle(),
      supabaseAdmin
        .from("hq_approval_step")
        .select("*")
        .eq("approval_id", approvalId)
        .order("step_order", { ascending: true }),
    ]);

    if (docRes.error || !docRes.data) {
      return apiFail("결재 문서를 찾을 수 없습니다.", 404);
    }
    const doc = docRes.data;
    const steps = stepRes.data || [];

    // 기안자 상신 회수 (1차 결재 시작 전 PENDING 상태에서만 허용)
    if (action === "CANCEL") {
      if (String(doc.drafter_id) !== caller.userId) {
        return apiFail("기안자 본인만 문서를 회수할 수 있습니다.", 403);
      }
      if (doc.status !== "PENDING") {
        return apiFail("이미 결재가 진행 중이거나 완료된 문서는 회수할 수 없습니다.", 400);
      }
      await supabaseAdmin
        .from("hq_approval_doc")
        .update({ status: "CANCELLED", completed_at: nowIso, updated_at: nowIso })
        .eq("approval_id", approvalId);
      await supabaseAdmin
        .from("hq_approval_step")
        .update({ status: "SKIPPED", comment: "기안자 상신 회수" })
        .eq("approval_id", approvalId);

      return NextResponse.json({ success: true, data: { status: "CANCELLED" } });
    }

    if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") {
      return apiFail("이미 처리가 완료된 문서입니다.", 400);
    }

    const currentStep = steps.find(
      (s: any) => Number(s.step_order) === Number(doc.current_step_order)
    );
    if (!currentStep) {
      return apiFail("현재 결재 단계 정보를 찾을 수 없습니다.", 400);
    }

    const isAssignedApprover = String(currentStep.approver_id) === caller.userId;
    const isExecutiveOverride = caller.rankLevel >= 5 || caller.isHqAdmin;

    if (!isAssignedApprover && !isExecutiveOverride) {
      return apiFail("현재 결재 순서의 결재권자만 처리할 수 있습니다.", 403);
    }

    const noteWithProxy =
      !isAssignedApprover && isExecutiveOverride
        ? `${comment ? `${comment} ` : ""}(대결: ${caller.name} ${caller.jobTitle})`.trim()
        : comment || null;

    if (action === "REJECT") {
      if (!comment) {
        return apiFail("반려 시에는 반려 사유(의견)를 반드시 입력해주세요.", 400);
      }
      await supabaseAdmin
        .from("hq_approval_step")
        .update({
          status: "REJECTED",
          comment: noteWithProxy,
          acted_at: nowIso,
        })
        .eq("step_id", currentStep.step_id);

      await supabaseAdmin
        .from("hq_approval_step")
        .update({ status: "SKIPPED" })
        .eq("approval_id", approvalId)
        .gt("step_order", doc.current_step_order);

      await supabaseAdmin
        .from("hq_approval_doc")
        .update({
          status: "REJECTED",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("approval_id", approvalId);

      return NextResponse.json({ success: true, data: { status: "REJECTED" } });
    }

    // APPROVE 또는 FINAL_APPROVE(전결)
    const isLastStep = Number(doc.current_step_order) >= Number(doc.total_steps);
    const wantsDelegatedFinal = action === "FINAL_APPROVE" && caller.rankLevel >= 3;

    if (isLastStep || wantsDelegatedFinal) {
      await supabaseAdmin
        .from("hq_approval_step")
        .update({
          status: "APPROVED",
          comment:
            wantsDelegatedFinal && !isLastStep
              ? `${noteWithProxy ? `${noteWithProxy} · ` : ""}[전결 승인]`
              : noteWithProxy,
          acted_at: nowIso,
        })
        .eq("step_id", currentStep.step_id);

      if (!isLastStep) {
        await supabaseAdmin
          .from("hq_approval_step")
          .update({
            status: "SKIPPED",
            comment: `${caller.name} ${caller.jobTitle} 전결 처리로 생략`,
          })
          .eq("approval_id", approvalId)
          .gt("step_order", doc.current_step_order);
      }

      await supabaseAdmin
        .from("hq_approval_doc")
        .update({
          status: "APPROVED",
          is_auto_delegated: Boolean(doc.is_auto_delegated || wantsDelegatedFinal),
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("approval_id", approvalId);

      await applyPostApprovalSideEffects(supabaseAdmin, doc, caller.name);

      return NextResponse.json({ success: true, data: { status: "APPROVED" } });
    }

    // 다음 결재 단계로 승급
    const nextOrder = Number(doc.current_step_order) + 1;
    await supabaseAdmin
      .from("hq_approval_step")
      .update({
        status: "APPROVED",
        comment: noteWithProxy,
        acted_at: nowIso,
      })
      .eq("step_id", currentStep.step_id);

    await supabaseAdmin
      .from("hq_approval_step")
      .update({ status: "CURRENT" })
      .eq("approval_id", approvalId)
      .eq("step_order", nextOrder);

    await supabaseAdmin
      .from("hq_approval_doc")
      .update({
        status: "IN_PROGRESS",
        current_step_order: nextOrder,
        updated_at: nowIso,
      })
      .eq("approval_id", approvalId);

    return NextResponse.json({
      success: true,
      data: { status: "IN_PROGRESS", current_step_order: nextOrder },
    });
  } catch (e: any) {
    console.error("HQ approvals PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
