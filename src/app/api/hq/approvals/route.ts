// src/app/api/hq/approvals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { LEAVE_TYPES } from "@/lib/hq/constants";
import {
  notifySlackIfEnabled,
  syncApprovalDocToGoogleCalendar,
} from "@/lib/hq/integrationServer";
import {
  isNonPositionSystemLabel,
  resolveMemberDisplayPosition,
} from "@/lib/hq/orgTreeHelper";
import {
  readRecognizedWorkSchedulesServer,
  writeRecognizedWorkSchedulesServer,
} from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqApprovalStep,
  HqWorkflowDocMeta,
} from "@/lib/hq/types";
import {
  readWorkflowMetaPayload,
  writeWorkflowMetaPayload,
} from "@/lib/hq/workflowStorageServer";

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

  // 1) 휴가·연차 신청서(LEAVE) 최종 승인 → 연차 차감 대상(연차·반차·시간차)만 차감 반영
  if (doc.doc_type === "LEAVE" && Number(doc.leave_days) > 0) {
    const leaveLabel = String(doc.leave_type || "");
    const leaveMeta = LEAVE_TYPES.find((lt) => lt.label === leaveLabel);
    const shouldDeduct = leaveMeta
      ? leaveMeta.deductAnnual
      : leaveLabel.includes("연차") ||
        leaveLabel.includes("반차") ||
        leaveLabel.includes("시간차");
    if (shouldDeduct) {
      const { data: prof } = await supabaseAdmin
        .from("hq_member_profile")
        .select("annual_leave_used")
        .eq("instructor_id", doc.drafter_id)
        .maybeSingle();

      const prevUsed = Number(prof?.annual_leave_used ?? 0);
      const nextUsed = Number((prevUsed + Number(doc.leave_days)).toFixed(4));
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
      const isHalf =
        leaveLabel.includes("반차") || leaveLabel.includes("시간차");
      const attendanceRows: Record<string, any>[] = [];

      if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(endDt.getTime())) {
        const cursor = new Date(startDt);
        let guard = 0;
        while (cursor <= endDt && guard < 130) {
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
              memo: `[워크플로우 ${doc.doc_no}] ${doc.title}`,
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
        description: `[워크플로우 ${doc.doc_no}] ${doc.title}${doc.content ? ` — ${doc.content}` : ""}`,
        receipt_url: doc.receipt_url || null,
        settlement_status: isCorpCard ? "정산완료" : "정산대기",
        settled_by: isCorpCard ? `${approverName} (승인)` : null,
        settled_at: isCorpCard ? nowIso : null,
        updated_at: nowIso,
      },
      { onConflict: "approval_id" }
    );
  }

  // 2-B) 인정 근무 등록·수정 승인 문서(work_edit_payload) 최종 승인 → hq_attendance에 즉시 반영
  try {
    const wfStore = await readWorkflowMetaPayload(supabaseAdmin);
    const docMeta = wfStore.docMetaById?.[String(doc.approval_id)];
    const wp = docMeta?.work_edit_payload;
    if (wp && wp.target_member_id && wp.work_date) {
      const schedKey = `${wp.target_member_id}__${wp.work_date}`;
      if (wp.action_mode === "DELETE") {
        if (wp.attendance_id) {
          await supabaseAdmin
            .from("hq_attendance")
            .delete()
            .eq("attendance_id", wp.attendance_id);
        } else {
          await supabaseAdmin
            .from("hq_attendance")
            .delete()
            .eq("instructor_id", wp.target_member_id)
            .eq("work_date", wp.work_date);
        }
        try {
          const prevMap = await readRecognizedWorkSchedulesServer(supabaseAdmin);
          if (prevMap[schedKey]) {
            const nextMap = { ...prevMap };
            delete nextMap[schedKey];
            await writeRecognizedWorkSchedulesServer(supabaseAdmin, nextMap);
          }
        } catch {
          // ignore
        }
      } else {
        const toHm = (mins: number) => {
          const c = ((Math.round(mins) % 1440) + 1440) % 1440;
          return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(
            c % 60
          ).padStart(2, "0")}`;
        };
        const inHm = toHm(wp.after.in_minutes);
        const outHm = toHm(wp.after.out_minutes);
        const [wy, wm, wd] = wp.work_date.split("-").map(Number);
        const nextDayYmd = new Date(
          Date.UTC(wy, (wm || 1) - 1, (wd || 1) + 1)
        )
          .toISOString()
          .slice(0, 10);
        const outDate = outHm < inHm ? nextDayYmd : wp.work_date;

        await supabaseAdmin.from("hq_attendance").upsert(
          {
            instructor_id: wp.target_member_id,
            member_name: wp.target_member_name,
            department: wp.department || "미지정",
            work_date: wp.work_date,
            work_mode: wp.after.work_mode || "OFFICE",
            status: "DONE",
            check_in_at: `${wp.work_date}T${inHm}:00+09:00`,
            check_out_at: `${outDate}T${outHm}:00+09:00`,
            break_minutes: wp.after.break_minutes,
            worked_minutes: wp.after.worked_minutes,
            overtime_minutes: wp.after.overtime_minutes,
            location_note: wp.after.location_note || "본사 편집·연구실",
            memo:
              wp.after.memo ||
              `[승인 완료: ${doc.doc_no}] ${wp.reason_note || wp.triggered_reasons.join(", ")}`,
            approval_id: doc.approval_id,
            updated_at: nowIso,
          },
          { onConflict: "instructor_id,work_date" }
        );

        try {
          const prevMap = await readRecognizedWorkSchedulesServer(supabaseAdmin);
          const nextSegments =
            Array.isArray(wp.after.segments) && wp.after.segments.length > 0
              ? wp.after.segments
              : [
                  {
                    id: "seg-approved-1",
                    work_mode: wp.after.work_mode || "OFFICE",
                    policy_name: wp.after.policy_name || "근무",
                    in_minutes: wp.after.in_minutes,
                    out_minutes: wp.after.out_minutes,
                    location_note: wp.after.location_note,
                    memo: wp.after.memo,
                  },
                ];
          const nextBreaks = (wp.after.breaks || []).map((b, idx) => ({
            id: `brk-approved-${idx}`,
            start_minutes: b.start_minutes,
            end_minutes: b.end_minutes,
          }));
          await writeRecognizedWorkSchedulesServer(supabaseAdmin, {
            ...prevMap,
            [schedKey]: {
              key: schedKey,
              instructor_id: wp.target_member_id,
              work_date: wp.work_date,
              segments: nextSegments,
              breaks: nextBreaks,
              updated_at: nowIso,
            },
          });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // 인정 근무 승인 후처리 중 예외가 결재 완료 자체를 막지 않도록 안전 처리
  }

  // 3) 외부 서비스 연동: Google Calendar 자동 일정 등록 & Slack 알림 (비동기 안전 처리)
  syncApprovalDocToGoogleCalendar(supabaseAdmin, doc).catch(() => {});
  notifySlackIfEnabled(
    supabaseAdmin,
    doc.doc_type === "LEAVE" ? "LEAVE" : "APPROVAL",
    `📌 *[워크플로우 승인완료]* ${doc.drafter_name}(${doc.drafter_dept || "본부"}) — ${doc.title} (${doc.effective_date || ""}${doc.end_date && doc.end_date !== doc.effective_date ? ` ~ ${doc.end_date}` : ""})`
  ).catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const targetApprovalId = (req.nextUrl.searchParams.get("id") || "").trim();

    if (caller.schemaMissing) {
      return NextResponse.json({
        success: true,
        schemaMissing: true,
        data: targetApprovalId
          ? { doc: null }
          : {
              docs: [],
              myPendingCount: 0,
              meId: caller.userId,
              canViewCompanyArchive: false,
              canDeleteCompanyDoc: false,
            },
      });
    }

    if (
      targetApprovalId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        targetApprovalId
      )
    ) {
      return apiFail("유효하지 않은 문서 ID입니다.", 400);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const [docRes, stepRes, profRes, metaPayload] = await Promise.all([
      targetApprovalId
        ? supabaseAdmin
            .from("hq_approval_doc")
            .select("*")
            .eq("approval_id", targetApprovalId)
        : supabaseAdmin
            .from("hq_approval_doc")
            .select("*")
            .order("submitted_at", { ascending: false })
            .limit(500),
      targetApprovalId
        ? supabaseAdmin
            .from("hq_approval_step")
            .select("*")
            .eq("approval_id", targetApprovalId)
            .order("step_order", { ascending: true })
        : supabaseAdmin
            .from("hq_approval_step")
            .select("*")
            .order("step_order", { ascending: true }),
      supabaseAdmin
        .from("hq_member_profile")
        .select(
          "instructor_id, department, rank_code, job_title, is_dept_head, profile_extra"
        ),
      readWorkflowMetaPayload(supabaseAdmin),
    ]);

    if (docRes.error) {
      if (isMissingHqTableError(docRes.error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: targetApprovalId
            ? { doc: null }
            : {
                docs: [],
                myPendingCount: 0,
                meId: caller.userId,
                canViewCompanyArchive: false,
                canDeleteCompanyDoc: false,
              },
        });
      }
      return apiFail(docRes.error.message, 500);
    }
    if (stepRes.error) return apiFail(stepRes.error.message, 500);

    const profById = new Map<string, any>();
    (profRes.data || []).forEach((p: any) => {
      profById.set(String(p.instructor_id), p);
    });

    const stepsByDoc = new Map<string, HqApprovalStep[]>();
    (stepRes.data || []).forEach((s: any) => {
      const key = String(s.approval_id);
      const approverId = String(s.approver_id);
      const liveProf = profById.get(approverId);
      const rawDept = String(
        s.approver_dept || liveProf?.department || ""
      ).trim();
      const resolvedDept = rawDept === "미지정" ? "" : rawDept;
      const resolvedTitle = liveProf
        ? resolveMemberDisplayPosition(liveProf)
        : !isNonPositionSystemLabel(s.approver_title)
          ? String(s.approver_title).trim()
          : "";
      const list = stepsByDoc.get(key) || [];
      list.push({
        step_id: s.step_id,
        approval_id: key,
        step_order: Number(s.step_order),
        step_role: s.step_role,
        approver_id: approverId,
        approver_name: s.approver_name,
        approver_dept: resolvedDept,
        approver_rank: s.approver_rank || "",
        approver_title: resolvedTitle,
        status: s.status,
        comment: s.comment || null,
        acted_at: s.acted_at || null,
      });
      stepsByDoc.set(key, list);
    });

    // 자동 진행(D+N) 기한 도래 승인 단계 자동 승인 처리
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    for (const d of docRes.data || []) {
      if (d.status !== "PENDING" && d.status !== "IN_PROGRESS") continue;
      const idStr = String(d.approval_id);
      const docMeta = metaPayload.docMetaById[idStr];
      const autoMap = docMeta?.step_auto_proceed;
      if (!autoMap || typeof autoMap !== "object") continue;

      const docSteps = stepsByDoc.get(idStr) || [];
      let curOrder = Number(d.current_step_order || 1);
      const totalSteps = Number(d.total_steps || docSteps.length || 1);
      let safety = 0;

      while (safety < 10) {
        safety += 1;
        const rule = autoMap[String(curOrder)];
        if (!rule?.enabled) break;
        const curStep = docSteps.find((s) => s.step_order === curOrder);
        if (!curStep || curStep.status !== "CURRENT") break;

        const prevStep =
          curOrder > 1
            ? docSteps.find((s) => s.step_order === curOrder - 1)
            : null;
        const baseTimeStr = prevStep?.acted_at || d.submitted_at;
        const baseMs = baseTimeStr ? new Date(baseTimeStr).getTime() : NaN;
        const waitDays = Math.max(1, Number(rule.days || 1));
        if (Number.isNaN(baseMs) || nowMs < baseMs + waitDays * 86400_000) {
          break;
        }

        const autoComment = `자동 진행 설정(D+${waitDays})에 의해 자동 승인됨`;
        curStep.status = "APPROVED";
        curStep.comment = autoComment;
        curStep.acted_at = nowIso;

        if (curStep.step_id) {
          await supabaseAdmin
            .from("hq_approval_step")
            .update({
              status: "APPROVED",
              comment: autoComment,
              acted_at: nowIso,
            })
            .eq("step_id", curStep.step_id);
        }

        if (curOrder >= totalSteps) {
          d.status = "APPROVED";
          d.completed_at = nowIso;
          d.updated_at = nowIso;
          await supabaseAdmin
            .from("hq_approval_doc")
            .update({
              status: "APPROVED",
              completed_at: nowIso,
              updated_at: nowIso,
            })
            .eq("approval_id", idStr);
          await applyPostApprovalSideEffects(
            supabaseAdmin,
            d,
            `${curStep.approver_name} (자동 진행)`
          );
          break;
        } else {
          const nextOrder = curOrder + 1;
          const nextStep = docSteps.find((s) => s.step_order === nextOrder);
          if (nextStep) {
            nextStep.status = "CURRENT";
            if (nextStep.step_id) {
              await supabaseAdmin
                .from("hq_approval_step")
                .update({ status: "CURRENT" })
                .eq("step_id", nextStep.step_id);
            }
          }
          d.status = "IN_PROGRESS";
          d.current_step_order = nextOrder;
          d.updated_at = nowIso;
          await supabaseAdmin
            .from("hq_approval_doc")
            .update({
              status: "IN_PROGRESS",
              current_step_order: nextOrder,
              updated_at: nowIso,
            })
            .eq("approval_id", idStr);
          curOrder = nextOrder;
        }
      }
    }

    const allDocs: HqApprovalDoc[] = (docRes.data || []).map((d: any) => {
      const idStr = String(d.approval_id);
      return {
        approval_id: idStr,
        doc_no: d.doc_no,
        doc_type: d.doc_type,
        title: d.title,
        content: d.content || "",
        drafter_id: String(d.drafter_id),
        drafter_name: d.drafter_name,
        drafter_dept:
          String(
            d.drafter_dept || profById.get(String(d.drafter_id))?.department || ""
          ).trim() === "미지정"
            ? ""
            : String(
                d.drafter_dept ||
                  profById.get(String(d.drafter_id))?.department ||
                  ""
              ).trim(),
        drafter_rank: d.drafter_rank || "STAFF",
        drafter_title: profById.has(String(d.drafter_id))
          ? resolveMemberDisplayPosition(profById.get(String(d.drafter_id)))
          : !isNonPositionSystemLabel(d.drafter_title)
            ? String(d.drafter_title).trim()
            : "",
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
        steps: stepsByDoc.get(idStr) || [],
        workflow_meta: metaPayload.docMetaById[idStr] || null,
      };
    });

    const canViewFullCompanyArchive =
      caller.isHqAdmin || caller.isHrManager || caller.rankLevel >= 4;
    const canViewDeptCompanyArchive = caller.rankLevel === 3;
    const canViewCompanyArchive =
      canViewFullCompanyArchive || canViewDeptCompanyArchive;
    const canDeleteCompanyDoc =
      caller.isHqAdmin || caller.isHrManager || caller.rankLevel >= 5;

    const visibleDocs = allDocs.filter((doc) => {
      if (canViewFullCompanyArchive) return true;
      if (doc.drafter_id === caller.userId) return true;
      if (doc.steps.some((s) => s.approver_id === caller.userId)) return true;
      const ccIds = doc.workflow_meta?.cc_member_ids || [];
      const ccNames = doc.workflow_meta?.cc_member_names || [];
      if (ccIds.includes(caller.userId) || ccNames.includes(caller.name)) {
        return true;
      }
      if (canViewDeptCompanyArchive && doc.drafter_dept === caller.department) {
        return true;
      }
      return false;
    });

    if (targetApprovalId) {
      if (allDocs.length === 0) {
        return apiFail("연결된 품의 문서를 찾을 수 없습니다.", 404);
      }
      if (visibleDocs.length === 0) {
        return apiFail("해당 품의 문서의 열람 권한이 없습니다.", 403);
      }
      return NextResponse.json({
        success: true,
        schemaMissing: false,
        data: { doc: visibleDocs[0] },
      });
    }

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
        canViewCompanyArchive,
        canDeleteCompanyDoc,
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
      return apiFail("문서 제목을 입력해주세요.");
    }

    const rawSteps = Array.isArray(body?.steps) ? body.steps : [];
    const allowZeroSteps = Boolean(body?.allow_zero_steps);
    const instantComplete =
      rawSteps.length === 0 && (allowZeroSteps || caller.rankLevel >= 5);

    if (!instantComplete && rawSteps.length === 0) {
      return apiFail("최소 1명 이상의 승인자를 지정해야 합니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const docNo = generateDocNo("APR");

    // 프리셋(더미) 구성원(예: preset:천종현)이 승인자에 포함된 경우 FK(uuid) 안전 매핑 (이름·직함은 그대로 보존!)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const hasNonUuidStep = rawSteps.some(
      (s: any) => !uuidRegex.test(String(s?.approver_id || "").trim())
    );
    let instByName = new Map<string, string>();
    let fallbackApproverUuid = caller.userId;

    if (hasNonUuidStep) {
      const { data: instRows } = await supabaseAdmin
        .from("instructor")
        .select("instructor_id, name, position, role, status, tenant_id")
        .neq("status", "퇴사")
        .neq("status", "퇴직");

      const hqCandidates = (instRows || []).filter((r: any) => {
        const tid = r.tenant_id ? String(r.tenant_id) : "";
        return (
          caller.hqTenantIds.has(tid) ||
          String(r.role || "").toUpperCase() === "HQ"
        );
      });
      const pool = hqCandidates.length > 0 ? hqCandidates : instRows || [];
      pool.forEach((r: any) => {
        if (r?.name && r?.instructor_id) {
          instByName.set(String(r.name).trim(), String(r.instructor_id));
        }
      });

      const nonSelfExec = pool.find(
        (r: any) =>
          String(r.instructor_id) !== caller.userId &&
          /대표|원장|본부장|이사/.test(String(r.position || ""))
      );
      const nonSelfAny = pool.find(
        (r: any) => String(r.instructor_id) !== caller.userId
      );
      fallbackApproverUuid = String(
        nonSelfExec?.instructor_id ||
          nonSelfAny?.instructor_id ||
          caller.userId
      );
    }

    const resolveValidApproverUuid = (s: any): string => {
      const rawId = String(s?.approver_id || "").trim();
      if (uuidRegex.test(rawId)) return rawId;
      const byName = instByName.get(String(s?.approver_name || "").trim());
      return byName || fallbackApproverUuid;
    };

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
      status: instantComplete ? "APPROVED" : "PENDING",
      current_step_order: 1,
      total_steps: instantComplete ? 1 : rawSteps.length,
      is_auto_delegated: Boolean(body?.is_auto_delegated),
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
      completed_at: instantComplete ? nowIso : null,
      updated_at: nowIso,
    };

    const { data: createdDoc, error: docErr } = await supabaseAdmin
      .from("hq_approval_doc")
      .insert(docPayload)
      .select("*")
      .single();

    if (docErr || !createdDoc) {
      return apiFail(`워크플로우 문서 작성 실패: ${docErr?.message || ""}`, 500);
    }

    const stepRows = instantComplete
      ? [
          {
            approval_id: createdDoc.approval_id,
            step_order: 1,
            step_role: "FINAL_APPROVER",
            approver_id: caller.userId,
            approver_name: caller.name,
            approver_dept: caller.department,
            approver_rank: caller.rankCode,
            approver_title: caller.jobTitle,
            status: "APPROVED",
            comment: "승인 단계 없음 (작성 즉시 완료)",
            acted_at: nowIso,
          },
        ]
      : rawSteps.map((s: any, idx: number) => ({
          approval_id: createdDoc.approval_id,
          step_order: idx + 1,
          step_role:
            s.step_role || (idx + 1 === rawSteps.length ? "FINAL_APPROVER" : "REVIEWER"),
          approver_id: resolveValidApproverUuid(s),
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
      return apiFail(`승인 단계 저장 실패: ${stepErr.message}`, 500);
    }

    // 워크플로우 양식 메타데이터 (양식명, 참조자, 커스텀 필드값, 참조문서, 다중첨부) 저장
    const rawMeta = body?.workflow_meta;
    if (rawMeta && typeof rawMeta === "object") {
      try {
        const metaStore = await readWorkflowMetaPayload(supabaseAdmin);
        const approvalIdStr = String(createdDoc.approval_id);
        const docMeta: HqWorkflowDocMeta = {
          approval_id: approvalIdStr,
          form_id: rawMeta.form_id ? String(rawMeta.form_id) : null,
          form_title: String(rawMeta.form_title || ""),
          form_icon: String(rawMeta.form_icon || "📋"),
          cc_member_ids: Array.isArray(rawMeta.cc_member_ids)
            ? rawMeta.cc_member_ids.map(String)
            : [],
          cc_member_names: Array.isArray(rawMeta.cc_member_names)
            ? rawMeta.cc_member_names.map(String)
            : [],
          field_values:
            rawMeta.field_values && typeof rawMeta.field_values === "object"
              ? rawMeta.field_values
              : {},
          field_labels:
            rawMeta.field_labels && typeof rawMeta.field_labels === "object"
              ? rawMeta.field_labels
              : {},
          step_auto_proceed:
            rawMeta.step_auto_proceed &&
            typeof rawMeta.step_auto_proceed === "object"
              ? rawMeta.step_auto_proceed
              : undefined,
          ref_doc_id: rawMeta.ref_doc_id ? String(rawMeta.ref_doc_id) : null,
          ref_doc_no: rawMeta.ref_doc_no ? String(rawMeta.ref_doc_no) : null,
          ref_doc_title: rawMeta.ref_doc_title ? String(rawMeta.ref_doc_title) : null,
          attachments: Array.isArray(rawMeta.attachments)
            ? rawMeta.attachments
            : [],
          comments: [],
        };
        metaStore.docMetaById[approvalIdStr] = docMeta;
        await writeWorkflowMetaPayload(supabaseAdmin, metaStore);
      } catch {
        // 메타 저장 실패 시에도 본문 상신 유지
      }
    }

    if (instantComplete) {
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

    if (!approvalId) return apiFail("문서 ID가 없습니다.");
    if (!["APPROVE", "REJECT", "CANCEL", "DELETE_DOC"].includes(action)) {
      return apiFail("지원하지 않는 처리 명령입니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 회사 문서함 관리자 및 Lv.6 수퍼어드민 문서 강제 삭제 (연결된 경비·출퇴근 FK 해제 포함)
    if (action === "DELETE_DOC") {
      if (
        !caller.isDevSuperAdmin &&
        !caller.isHqAdmin &&
        !caller.isHrManager &&
        caller.rankLevel < 5
      ) {
        return apiFail("회사 문서함 삭제 권한이 없습니다.", 403);
      }
      await Promise.all([
        supabaseAdmin
          .from("hq_expense")
          .update({ approval_id: null })
          .eq("approval_id", approvalId),
        supabaseAdmin
          .from("hq_attendance")
          .update({ approval_id: null })
          .eq("approval_id", approvalId),
        supabaseAdmin
          .from("hq_approval_step")
          .delete()
          .eq("approval_id", approvalId),
      ]);
      const { error: delErr } = await supabaseAdmin
        .from("hq_approval_doc")
        .delete()
        .eq("approval_id", approvalId);
      if (delErr) return apiFail(`문서 삭제 실패: ${delErr.message}`, 500);
      return NextResponse.json({ success: true, data: { deleted: true } });
    }

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
      return apiFail("워크플로우 문서를 찾을 수 없습니다.", 404);
    }
    const doc = docRes.data;
    const steps = stepRes.data || [];

    // 작성자 문서 취소(회수) — 1단계 승인 전(PENDING) 상태에서만 가능
    if (action === "CANCEL") {
      if (String(doc.drafter_id) !== caller.userId) {
        return apiFail("작성자 본인만 문서를 취소할 수 있습니다.", 403);
      }
      if (doc.status !== "PENDING") {
        return apiFail(
          "이미 승인이 진행되었거나 완료된 문서는 취소할 수 없습니다.",
          400
        );
      }
      await supabaseAdmin
        .from("hq_approval_doc")
        .update({ status: "CANCELLED", completed_at: nowIso, updated_at: nowIso })
        .eq("approval_id", approvalId);
      await supabaseAdmin
        .from("hq_approval_step")
        .update({ status: "SKIPPED", comment: "작성자 요청 취소" })
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
      return apiFail("현재 승인 단계 정보를 찾을 수 없습니다.", 400);
    }

    const isAssignedApprover = String(currentStep.approver_id) === caller.userId;
    const isExecutiveOverride = caller.rankLevel >= 5 || caller.isHqAdmin;

    if (!isAssignedApprover && !isExecutiveOverride) {
      return apiFail("현재 차례의 승인자만 처리할 수 있습니다.", 403);
    }

    const noteWithProxy =
      !isAssignedApprover && isExecutiveOverride
        ? `${comment ? `${comment} ` : ""}(대결: ${caller.name} ${caller.jobTitle})`.trim()
        : comment || null;

    if (action === "REJECT") {
      if (!comment) {
        return apiFail("반려 시에는 반려 사유를 입력해 주세요.", 400);
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

    // 순차 승인 (APPROVE)
    const isLastStep = Number(doc.current_step_order) >= Number(doc.total_steps);

    if (isLastStep) {
      await supabaseAdmin
        .from("hq_approval_step")
        .update({
          status: "APPROVED",
          comment: noteWithProxy,
          acted_at: nowIso,
        })
        .eq("step_id", currentStep.step_id);

      await supabaseAdmin
        .from("hq_approval_doc")
        .update({
          status: "APPROVED",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("approval_id", approvalId);

      await applyPostApprovalSideEffects(supabaseAdmin, doc, caller.name);

      return NextResponse.json({ success: true, data: { status: "APPROVED" } });
    }

    // 다음 승인 단계로 이동
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
