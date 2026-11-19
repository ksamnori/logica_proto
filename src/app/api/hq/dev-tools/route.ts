// src/app/api/hq/dev-tools/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendHqAuditLog, readHqAuditLogs, readLoginAttemptRecords, writeLoginAttemptRecords } from "@/lib/hq/auditLogServer";
import { readHqKvPayload, writeHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import {
  LEAVES_LEDGER_PATH,
  LEAVES_LEDGER_SETTING_KEY,
  readLeavesLedgerServer,
  readRealtimeWorkLogsServer,
  readWorkMgmtStateServer,
  writeLeavesLedgerServer,
  writeRealtimeWorkLogsServer,
  writeWorkMgmtStateServer,
} from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqAuditLogItem, HqYearEndTaxYearStore } from "@/lib/hq/types";
import {
  WORKFLOW_FORMS_STORAGE_PATH,
  WORKFLOW_META_STORAGE_PATH,
  type StoredWorkflowFormsPayload,
  type StoredWorkflowMetaPayload,
} from "@/lib/hq/workflowStorageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DevToolDomainKey =
  | "members"
  | "approvals"
  | "expenses"
  | "attendance"
  | "contracts"
  | "payroll"
  | "publishing"
  | "chat_rooms"
  | "chat_messages"
  | "notices"
  | "meetings"
  | "leave_items"
  | "work_mgmt_items"
  | "realtime_work_logs"
  | "workflow_forms"
  | "contract_templates"
  | "year_end_tax"
  | "audit_logs"
  | "login_attempts";

export interface DevToolRecordItem {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  createdAt?: string | null;
  raw: unknown;
}

const NOTICES_SETTING_KEY = "HQ_NOTICES";
const NOTICES_STORAGE_PATH = "hq_system_config/notices.json";
const MEETINGS_SETTING_KEY = "HQ_MEETINGS";
const MEETINGS_STORAGE_PATH = "hq_system_config/meetings.json";
const CONTRACT_TEMPLATES_SETTING_KEY = "HQ_CONTRACT_TEMPLATES";
const CONTRACT_TEMPLATES_PATH = "hq_system_config/contract_templates.json";
const AUDIT_LOGS_STORAGE_PATH = "hq_system_config/audit_logs.json";

async function fetchDomainItems(
  supabaseAdmin: SupabaseClient,
  domain: DevToolDomainKey,
  hqTenantIds: Set<string>
): Promise<DevToolRecordItem[]> {
  switch (domain) {
    case "members": {
      const [instRes, profRes] = await Promise.all([
        supabaseAdmin
          .from("instructor")
          .select("instructor_id, name, email, phone, department, position, chat_position, role, status, tenant_id, created_at")
          .order("created_at", { ascending: false }),
        supabaseAdmin.from("hq_member_profile").select("*"),
      ]);
      const profMap = new Map<string, any>();
      (profRes.data || []).forEach((p: any) => profMap.set(String(p.instructor_id), p));

      const items: DevToolRecordItem[] = [];
      for (const inst of instRes.data || []) {
        const id = String(inst.instructor_id);
        const prof = profMap.get(id);
        const isHqTenant = Boolean(inst.tenant_id && hqTenantIds.has(String(inst.tenant_id)));
        if (!prof && !isHqTenant && String(inst.role || "").toUpperCase() !== "HQ") {
          continue;
        }
        items.push({
          id,
          title: `${inst.name || "(이름 없음)"} · ${prof?.job_title || inst.chat_position || inst.position || "직책 미지정"}`,
          subtitle: `부서: ${prof?.department || inst.department || "미지정"} | 연락처: ${inst.phone || "-"} | 사번: ${prof?.employee_no || "미생성"} | ID: ${id}`,
          badge: `${prof?.rank_code || "UNSET"} · ${prof?.work_status || inst.status || "재직"}`,
          createdAt: prof?.created_at || inst.created_at || null,
          raw: { instructor: inst, hq_member_profile: prof || null },
        });
      }
      return items;
    }

    case "approvals": {
      const { data, error } = await supabaseAdmin
        .from("hq_approval_doc")
        .select("*")
        .order("submitted_at", { ascending: false })
        .limit(1000);
      if (error) return [];
      return (data || []).map((doc: any) => ({
        id: String(doc.approval_id),
        title: `[${doc.doc_no || doc.doc_type}] ${doc.title}`,
        subtitle: `기안자: ${doc.drafter_name} (${doc.drafter_dept || "-"}) | 금액: ${Number(doc.amount || 0).toLocaleString()}원 | 일자: ${doc.effective_date || "-"}`,
        badge: `${doc.status} · ${doc.doc_type}`,
        createdAt: doc.submitted_at || null,
        raw: doc,
      }));
    }

    case "expenses": {
      const { data, error } = await supabaseAdmin
        .from("hq_expense")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return [];
      return (data || []).map((row: any) => ({
        id: String(row.expense_id),
        title: `[${row.expense_no}] ${row.merchant_name} · ${Number(row.amount || 0).toLocaleString()}원`,
        subtitle: `청구자: ${row.requester_name} (${row.department || "-"}) | 분류: ${row.category} | 결제일: ${row.expense_date}`,
        badge: `${row.settlement_status} · ${row.source_type}`,
        createdAt: row.created_at || null,
        raw: row,
      }));
    }

    case "attendance": {
      const { data, error } = await supabaseAdmin
        .from("hq_attendance")
        .select("*")
        .order("work_date", { ascending: false })
        .limit(1500);
      if (error) return [];
      return (data || []).map((row: any) => ({
        id: String(row.attendance_id),
        title: `${row.work_date} · ${row.member_name} (${row.department || "-"})`,
        subtitle: `근무형태: ${row.work_mode} | 인정근무: ${row.worked_minutes || 0}분 | 메모: ${row.location_note || row.memo || "-"}`,
        badge: String(row.status || ""),
        createdAt: row.created_at || row.work_date || null,
        raw: row,
      }));
    }

    case "contracts": {
      const { data, error } = await supabaseAdmin
        .from("hq_contract")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return [];
      return (data || []).map((row: any) => ({
        id: String(row.contract_id),
        title: `[${row.contract_no}] ${row.title} (${row.counterparty_name})`,
        subtitle: `분류: ${row.category} | 금액: ${Number(row.contract_amount || 0).toLocaleString()}원 | 기간: ${row.start_date || "-"} ~ ${row.end_date || "-"}`,
        badge: `${row.status} · ${row.target_type}`,
        createdAt: row.created_at || null,
        raw: row,
      }));
    }

    case "payroll": {
      const { data, error } = await supabaseAdmin
        .from("hq_payroll")
        .select("*")
        .order("pay_month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) return [];
      return (data || []).map((row: any) => ({
        id: String(row.payroll_id),
        title: `[${row.pay_month}] ${row.payee_name} · 실지급 ${Number(row.net_amount || 0).toLocaleString()}원`,
        subtitle: `명세번호: ${row.statement_no} | 구분: ${row.pay_type} | 세전: ${Number(row.gross_amount || 0).toLocaleString()}원`,
        badge: String(row.status || ""),
        createdAt: row.created_at || null,
        raw: row,
      }));
    }

    case "publishing": {
      const { data, error } = await supabaseAdmin
        .from("hq_publication")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return [];
      return (data || []).map((row: any) => ({
        id: String(row.pub_id),
        title: `[${row.book_code}] ${row.title}`,
        subtitle: `저자: ${row.author_name || "-"} | 편집: ${row.editor_name || "-"} | 하판마감: ${row.press_deadline || "-"}`,
        badge: `${row.stage} (${row.progress_pct || 0}%)`,
        createdAt: row.created_at || null,
        raw: row,
      }));
    }

    case "chat_rooms": {
      const { data, error } = await supabaseAdmin
        .from("internal_chat_room")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return [];
      return (data || []).map((r: any) => ({
        id: String(r.room_id || r.id),
        title: r.title || `(제목 없는 ${r.room_type || "대화"}방)`,
        subtitle: `Room ID: ${r.room_id || r.id} | 유형: ${r.room_type || "-"}`,
        badge: String(r.room_type || "CHAT"),
        createdAt: r.created_at || null,
        raw: r,
      }));
    }

    case "chat_messages": {
      const { data, error } = await supabaseAdmin
        .from("internal_chat_message")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return [];
      return (data || []).map((m: any) => {
        const msgId = String(m.message_id ?? m.id);
        return {
          id: msgId,
          title: `${m.sender_name || m.sender_id || "발신자"}: ${String(m.content || m.message || "(첨부/빈 메시지)").slice(0, 80)}`,
          subtitle: `Room: ${m.room_id} | Msg ID: ${msgId}`,
          badge: m.file_url ? "첨부포함" : "메시지",
          createdAt: m.created_at || null,
          raw: m,
        };
      });
    }

    case "notices": {
      const parsed = await readHqKvPayload<{ categories?: string[]; notices?: any[] }>(
        supabaseAdmin,
        NOTICES_SETTING_KEY,
        NOTICES_STORAGE_PATH
      );
      const list = Array.isArray(parsed?.notices) ? parsed!.notices : [];
      return list.map((n: any) => ({
        id: String(n.id),
        title: `[${n.category || "공지"}] ${n.title}`,
        subtitle: `작성자: ${n.author_name || "-"} | 대상: ${n.target_label || n.target_scope || "전사"} | 댓글 ${(n.comments || []).length}개`,
        badge: String(n.status || "PUBLISHED"),
        createdAt: n.created_at || null,
        raw: n,
      }));
    }

    case "meetings": {
      const parsed = await readHqKvPayload<{ meetings?: any[] }>(
        supabaseAdmin,
        MEETINGS_SETTING_KEY,
        MEETINGS_STORAGE_PATH
      );
      const list = Array.isArray(parsed?.meetings) ? parsed!.meetings : [];
      return list.map((m: any) => ({
        id: String(m.id),
        title: m.title || "(제목 없는 미팅)",
        subtitle: `주최: ${m.organizer_name || "-"} (${m.organizer_dept || "-"}) | 일시: ${m.start_at || "일정 미지정"} | 참석 ${(m.attendees || []).length}명`,
        badge: m.has_schedule ? "일정포함" : "회의록",
        createdAt: m.created_at || null,
        raw: m,
      }));
    }

    case "leave_items": {
      const ledger = await readLeavesLedgerServer(supabaseAdmin);
      const out: DevToolRecordItem[] = [];
      ledger.adjustments.forEach((item: any) => {
        out.push({
          id: `adj::${item.id}`,
          title: `[연차조정] ${item.member_name || item.member_id} (${item.delta_days > 0 ? `+${item.delta_days}` : item.delta_days}일)`,
          subtitle: `연도: ${item.year} | 사유: ${item.reason || "-"} | 처리자: ${item.actor_name || "-"}`,
          badge: "ADJUSTMENT",
          createdAt: item.created_at || null,
          raw: item,
        });
      });
      ledger.customGrants.forEach((item: any) => {
        out.push({
          id: `cgrant::${item.id}`,
          title: `[맞춤휴가부여] ${item.member_name || item.member_id} · ${item.leave_name || item.custom_leave_id} (${item.granted_days}일)`,
          subtitle: `유효기한: ${item.expires_at || "없음"} | 사유: ${item.reason || "-"}`,
          badge: "CUSTOM_GRANT",
          createdAt: item.created_at || null,
          raw: item,
        });
      });
      ledger.promotions.forEach((item: any) => {
        out.push({
          id: `promo::${item.id}`,
          title: `[연차촉진 캠페인] ${item.title || item.year}`,
          subtitle: `단계: ${item.stage || "-"} | 기한: ${item.deadline_date || "-"}`,
          badge: "PROMOTION",
          createdAt: item.created_at || null,
          raw: item,
        });
      });
      ledger.promotionTargets.forEach((item: any) => {
        out.push({
          id: `ptarget::${item.id}`,
          title: `[촉진대상] ${item.member_name || item.member_id} (미사용 ${item.remain_days ?? "-"}일)`,
          subtitle: `캠페인 ID: ${item.campaign_id || "-"} | 상태: ${item.status || "-"}`,
          badge: "PROMO_TARGET",
          createdAt: item.updated_at || item.created_at || null,
          raw: item,
        });
      });
      ledger.plans.forEach((item: any) => {
        out.push({
          id: `plan::${item.id}`,
          title: `[연차사용계획] ${item.member_name || item.member_id} · ${item.planned_date || item.month || "-"}`,
          subtitle: `일수: ${item.days ?? 1}일 | 메모: ${item.note || "-"}`,
          badge: "LEAVE_PLAN",
          createdAt: item.created_at || null,
          raw: item,
        });
      });
      ledger.uploadedMonthly.forEach((item: any, idx: number) => {
        const uid = item.id || `${item.member_id}_${item.year}_${item.month}_${idx}`;
        out.push({
          id: `upmon::${uid}`,
          title: `[월별업로드] ${item.member_name || item.member_id} (${item.year}-${String(item.month || "").padStart(2, "0")})`,
          subtitle: `사용일수: ${item.used_days ?? 0}일`,
          badge: "UPLOADED_MONTHLY",
          createdAt: item.updated_at || null,
          raw: item,
        });
      });
      return out;
    }

    case "work_mgmt_items": {
      const wm = await readWorkMgmtStateServer(supabaseAdmin);
      const out: DevToolRecordItem[] = [];
      wm.compGrants.forEach((g: any) => {
        out.push({
          id: `comp::${g.id}`,
          title: `[보상휴가부여] ${g.member_name || g.member_id} (${g.granted_hours ?? g.granted_days ?? "-"})`,
          subtitle: `사유: ${g.reason || "-"} | 기준월/일: ${g.target_month || g.work_date || "-"}`,
          badge: "COMP_GRANT",
          createdAt: g.created_at || null,
          raw: g,
        });
      });
      wm.holidaySubstitutes.forEach((h: any) => {
        out.push({
          id: `holsub::${h.id}`,
          title: `[휴일대체] ${h.member_name || h.member_id} (${h.original_holiday_date || "-"} → ${h.substitute_off_date || "-"})`,
          subtitle: `사유: ${h.reason || "-"}`,
          badge: "HOLIDAY_SUB",
          createdAt: h.created_at || null,
          raw: h,
        });
      });
      wm.attendanceLocks.forEach((lk: any) => {
        out.push({
          id: `lock::${lk.id}`,
          title: `[근태마감잠금] ${lk.start_date} ~ ${lk.end_date}`,
          subtitle: `대상: ${lk.target_label || "전사"} | 잠금자: ${lk.locked_by || "-"}`,
          badge: "ATT_LOCK",
          createdAt: lk.created_at || null,
          raw: lk,
        });
      });
      return out;
    }

    case "realtime_work_logs": {
      const logsByKey = await readRealtimeWorkLogsServer(supabaseAdmin);
      return Object.entries(logsByKey).map(([key, val]: [string, any]) => ({
        id: key,
        title: `[실시간근무로그] ${key}`,
        subtitle: `상태: ${val?.status || "-"} | 시작: ${val?.started_at || "-"} | 메모: ${val?.note || "-"}`,
        badge: "REALTIME_LOG",
        createdAt: val?.updated_at || val?.started_at || null,
        raw: val,
      }));
    }

    case "workflow_forms": {
      const parsed = await readHqKvPayload<Partial<StoredWorkflowFormsPayload>>(
        supabaseAdmin,
        "WORKFLOW_FORMS",
        WORKFLOW_FORMS_STORAGE_PATH
      );
      const forms = Array.isArray(parsed?.forms) ? parsed!.forms! : [];
      return forms.map((f: any) => ({
        id: String(f.id),
        title: `[${f.category || "양식"}] ${f.name || f.title || f.id}`,
        subtitle: `문서유형: ${f.doc_type || "-"} | 설명: ${f.description || "-"}`,
        badge: f.is_builtin ? "기본양식" : "커스텀양식",
        createdAt: f.updated_at || null,
        raw: f,
      }));
    }

    case "contract_templates": {
      const parsed = await readHqKvPayload<{ templates?: any[]; customFields?: any[] }>(
        supabaseAdmin,
        CONTRACT_TEMPLATES_SETTING_KEY,
        CONTRACT_TEMPLATES_PATH
      );
      const out: DevToolRecordItem[] = [];
      (parsed?.templates || []).forEach((t: any) => {
        out.push({
          id: `tpl::${t.id}`,
          title: `[계약서식] ${t.name}`,
          subtitle: `카테고리: ${t.category_name || t.mapped_category || "-"} | 수정자: ${t.updated_by || "-"}`,
          badge: t.is_archived ? "보관됨" : "활성서식",
          createdAt: t.updated_at || t.created_at || null,
          raw: t,
        });
      });
      (parsed?.customFields || []).forEach((cf: any) => {
        out.push({
          id: `cf::${cf.id}`,
          title: `[커스텀필드] ${cf.label} (${cf.token})`,
          subtitle: `기본값: ${cf.default_value || "-"}`,
          badge: "CUSTOM_FIELD",
          createdAt: null,
          raw: cf,
        });
      });
      return out;
    }

    case "year_end_tax": {
      const { data } = await supabaseAdmin
        .from("hq_company_settings")
        .select("setting_key, extra_settings, updated_at")
        .like("setting_key", "year_end_tax_%");
      const out: DevToolRecordItem[] = [];
      for (const row of data || []) {
        const sk = String(row.setting_key);
        const yearStr = sk.replace("year_end_tax_", "");
        const store = (row.extra_settings as any)?.payload as HqYearEndTaxYearStore | undefined;
        const subs = store?.submissions || {};
        for (const [memberId, sub] of Object.entries(subs)) {
          out.push({
            id: `${sk}::${memberId}`,
            title: `[${yearStr}년 연말정산] 구성원 ID: ${memberId}`,
            subtitle: `상태: ${(sub as any)?.status || "-"} | 제출일: ${(sub as any)?.submitted_at || "-"}`,
            badge: String((sub as any)?.status || "SUBMISSION"),
            createdAt: (sub as any)?.updated_at || row.updated_at || null,
            raw: sub,
          });
        }
      }
      return out;
    }

    case "audit_logs": {
      const logs = await readHqAuditLogs(supabaseAdmin);
      return logs.map((log: HqAuditLogItem) => ({
        id: String(log.id),
        title: `[${log.activity_type} · ${log.event_type}] ${log.description}`,
        subtitle: `실행자: ${log.user_name} (${log.department || "-"}) | IP: ${log.ip_address || "-"}`,
        badge: log.info_type || "-",
        createdAt: log.created_at || null,
        raw: log,
      }));
    }

    case "login_attempts": {
      const map = await readLoginAttemptRecords(supabaseAdmin);
      return Object.entries(map).map(([key, rec]: [string, any]) => ({
        id: key,
        title: `계정 식별키: ${key}`,
        subtitle: `실패 횟수: ${rec?.fail_count ?? 0}회 | 잠금 해제 시각: ${rec?.locked_until || "잠금 없음"}`,
        badge: rec?.locked_until ? "LOCKED" : "ATTEMPT",
        createdAt: rec?.last_failed_at || null,
        raw: rec,
      }));
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isDevSuperAdmin) {
      return apiFail("개발자 수퍼어드민(Lv.6) 전용 기능입니다.", 403);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const mode = req.nextUrl.searchParams.get("mode") || "";

    if (mode === "summary") {
      const allDomains: DevToolDomainKey[] = [
        "members",
        "approvals",
        "expenses",
        "attendance",
        "contracts",
        "payroll",
        "publishing",
        "chat_rooms",
        "chat_messages",
        "notices",
        "meetings",
        "leave_items",
        "work_mgmt_items",
        "realtime_work_logs",
        "workflow_forms",
        "contract_templates",
        "year_end_tax",
        "audit_logs",
        "login_attempts",
      ];
      const countsEntries = await Promise.all(
        allDomains.map(async (d) => {
          try {
            const list = await fetchDomainItems(supabaseAdmin, d, caller.hqTenantIds);
            return [d, list.length] as const;
          } catch {
            return [d, 0] as const;
          }
        })
      );
      return NextResponse.json({
        success: true,
        data: { counts: Object.fromEntries(countsEntries) },
      });
    }

    const domain = (req.nextUrl.searchParams.get("domain") || "approvals") as DevToolDomainKey;
    const items = await fetchDomainItems(supabaseAdmin, domain, caller.hqTenantIds);

    return NextResponse.json({
      success: true,
      data: {
        domain,
        meId: caller.userId,
        items,
      },
    });
  } catch (e: any) {
    console.error("HQ dev-tools GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isDevSuperAdmin) {
      return apiFail("개발자 수퍼어드민(Lv.6) 전용 기능입니다.", 403);
    }

    const body = await req.json();
    const action = String(body?.action || "DELETE_ITEMS").toUpperCase();
    if (action !== "DELETE_ITEMS") {
      return apiFail("지원하지 않는 요청입니다.");
    }

    const domain = String(body?.domain || "") as DevToolDomainKey;
    const rawIds: string[] = Array.isArray(body?.ids)
      ? body.ids.map((v: any) => String(v).trim()).filter(Boolean)
      : [];
    const memberDeleteMode: "HQ_ONLY" | "FULL_ACCOUNT" =
      body?.memberDeleteMode === "FULL_ACCOUNT" ? "FULL_ACCOUNT" : "HQ_ONLY";

    if (!domain || rawIds.length === 0) {
      return apiFail("삭제할 도메인과 항목 ID 목록이 필요합니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const idSet = new Set(rawIds);

    switch (domain) {
      case "members": {
        if (idSet.has(caller.userId)) {
          return apiFail("현재 로그인 중인 본인 수퍼어드민 계정은 삭제할 수 없습니다.", 400);
        }
        const targetIds = Array.from(idSet);

        // 1) 본인이 기안한 결재 문서 조회 후 연결된 경비·근태 FK 해제 및 결재 삭제
        const { data: draftedDocs } = await supabaseAdmin
          .from("hq_approval_doc")
          .select("approval_id")
          .in("drafter_id", targetIds);
        const draftedDocIds = (draftedDocs || []).map((d: any) => String(d.approval_id));

        if (draftedDocIds.length > 0) {
          await supabaseAdmin
            .from("hq_expense")
            .update({ approval_id: null })
            .in("approval_id", draftedDocIds);
          await supabaseAdmin
            .from("hq_attendance")
            .update({ approval_id: null })
            .in("approval_id", draftedDocIds);
          await supabaseAdmin
            .from("hq_approval_step")
            .delete()
            .in("approval_id", draftedDocIds);
          await supabaseAdmin
            .from("hq_approval_doc")
            .delete()
            .in("approval_id", draftedDocIds);
        }

        // 타인 기안 문서에 결재자로 들어가 있는 단계(FK: approver_id) 제거
        await supabaseAdmin
          .from("hq_approval_step")
          .delete()
          .in("approver_id", targetIds);

        // 2) HQ 테이블 연관 데이터 정리
        await Promise.all([
          supabaseAdmin.from("hq_expense").delete().in("requester_id", targetIds),
          supabaseAdmin.from("hq_attendance").delete().in("instructor_id", targetIds),
          supabaseAdmin.from("hq_contract").update({ target_member_id: null }).in("target_member_id", targetIds),
          supabaseAdmin.from("hq_contract").update({ created_by: null }).in("created_by", targetIds),
          supabaseAdmin.from("hq_payroll").update({ member_id: null }).in("member_id", targetIds),
          supabaseAdmin.from("hq_publication").update({ editor_id: null }).in("editor_id", targetIds),
          supabaseAdmin.from("hq_permissions").delete().in("instructor_id", targetIds),
          supabaseAdmin.from("hq_member_profile").delete().in("instructor_id", targetIds),
        ]);

        // 3) KV 원장 내 해당 구성원 데이터 정리
        const [ledger, wm, rtLogs] = await Promise.all([
          readLeavesLedgerServer(supabaseAdmin),
          readWorkMgmtStateServer(supabaseAdmin),
          readRealtimeWorkLogsServer(supabaseAdmin),
        ]);
        await Promise.all([
          writeLeavesLedgerServer(supabaseAdmin, {
            adjustments: ledger.adjustments.filter((x: any) => !idSet.has(String(x.member_id))),
            promotions: ledger.promotions,
            promotionTargets: ledger.promotionTargets.filter((x: any) => !idSet.has(String(x.member_id))),
            plans: ledger.plans.filter((x: any) => !idSet.has(String(x.member_id))),
            customGrants: ledger.customGrants.filter((x: any) => !idSet.has(String(x.member_id))),
            uploadedMonthly: ledger.uploadedMonthly.filter((x: any) => !idSet.has(String(x.member_id))),
          }),
          writeWorkMgmtStateServer(supabaseAdmin, {
            compGrants: wm.compGrants.filter((x: any) => !idSet.has(String(x.member_id))),
            holidaySubstitutes: wm.holidaySubstitutes.filter((x: any) => !idSet.has(String(x.member_id))),
            attendanceLocks: wm.attendanceLocks,
          }),
          writeRealtimeWorkLogsServer(
            supabaseAdmin,
            Object.fromEntries(
              Object.entries(rtLogs).filter(
                ([k, v]: [string, any]) =>
                  !targetIds.some((tid) => k.includes(tid)) && !idSet.has(String(v?.member_id || ""))
              )
            )
          ),
        ]);

        // 4) 완전 삭제(FULL_ACCOUNT) 선택 시 instructor 및 Supabase Auth 계정까지 삭제
        if (memberDeleteMode === "FULL_ACCOUNT") {
          await Promise.all([
            supabaseAdmin.from("contest_db_access").delete().in("instructor_id", targetIds),
            supabaseAdmin.from("internal_chat_member").delete().in("instructor_id", targetIds),
            supabaseAdmin.from("internal_chat_message").delete().in("sender_id", targetIds),
          ]);
          const { error: instDelErr } = await supabaseAdmin
            .from("instructor")
            .delete()
            .in("instructor_id", targetIds);
          if (instDelErr && !isMissingHqTableError(instDelErr)) {
            return apiFail(
              `HQ 기록은 정리되었으나 instructor 원본 삭제 중 외래키 제약이 발생했습니다: ${instDelErr.message}`,
              400
            );
          }
          for (const uid of targetIds) {
            await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
          }
        }
        break;
      }

      case "approvals": {
        const targetIds = Array.from(idSet);
        await Promise.all([
          supabaseAdmin.from("hq_expense").update({ approval_id: null }).in("approval_id", targetIds),
          supabaseAdmin.from("hq_attendance").update({ approval_id: null }).in("approval_id", targetIds),
          supabaseAdmin.from("hq_approval_step").delete().in("approval_id", targetIds),
        ]);
        const { error } = await supabaseAdmin
          .from("hq_approval_doc")
          .delete()
          .in("approval_id", targetIds);
        if (error) return apiFail(`결재 문서 삭제 실패: ${error.message}`, 500);

        // 워크플로우 메타데이터 정리
        const wfMeta = await readHqKvPayload<Partial<StoredWorkflowMetaPayload>>(
          supabaseAdmin,
          "WORKFLOW_META",
          WORKFLOW_META_STORAGE_PATH
        );
        if (wfMeta?.docMetaById) {
          const nextDocMeta = { ...wfMeta.docMetaById };
          targetIds.forEach((id) => delete nextDocMeta[id]);
          await writeHqKvPayload(
            supabaseAdmin,
            "WORKFLOW_META",
            {
              docMetaById: nextDocMeta,
              starredByUser: wfMeta.starredByUser || {},
              savedViewsByUser: wfMeta.savedViewsByUser || {},
            },
            WORKFLOW_META_STORAGE_PATH
          );
        }
        break;
      }

      case "expenses": {
        const { error } = await supabaseAdmin
          .from("hq_expense")
          .delete()
          .in("expense_id", Array.from(idSet));
        if (error) return apiFail(`경비 내역 삭제 실패: ${error.message}`, 500);
        break;
      }

      case "attendance": {
        const { error } = await supabaseAdmin
          .from("hq_attendance")
          .delete()
          .in("attendance_id", Array.from(idSet));
        if (error) return apiFail(`출퇴근 기록 삭제 실패: ${error.message}`, 500);
        break;
      }

      case "contracts": {
        const targetIds = Array.from(idSet);
        const { error } = await supabaseAdmin
          .from("hq_contract")
          .delete()
          .in("contract_id", targetIds);
        if (error) return apiFail(`전자계약 삭제 실패: ${error.message}`, 500);

        const tplStore = await readHqKvPayload<any>(
          supabaseAdmin,
          CONTRACT_TEMPLATES_SETTING_KEY,
          CONTRACT_TEMPLATES_PATH
        );
        if (tplStore && Array.isArray(tplStore.reflectedContractIds)) {
          await writeHqKvPayload(
            supabaseAdmin,
            CONTRACT_TEMPLATES_SETTING_KEY,
            {
              ...tplStore,
              reflectedContractIds: tplStore.reflectedContractIds.filter(
                (cid: string) => !idSet.has(String(cid))
              ),
            },
            CONTRACT_TEMPLATES_PATH
          );
        }
        break;
      }

      case "payroll": {
        const { error } = await supabaseAdmin
          .from("hq_payroll")
          .delete()
          .in("payroll_id", Array.from(idSet));
        if (error) return apiFail(`급여 명세 삭제 실패: ${error.message}`, 500);
        break;
      }

      case "publishing": {
        const { error } = await supabaseAdmin
          .from("hq_publication")
          .delete()
          .in("pub_id", Array.from(idSet));
        if (error) return apiFail(`출판 공정 삭제 실패: ${error.message}`, 500);
        break;
      }

      case "chat_rooms": {
        const targetIds = Array.from(idSet);
        await supabaseAdmin.from("internal_chat_message").delete().in("room_id", targetIds);
        await supabaseAdmin.from("internal_chat_member").delete().in("room_id", targetIds);
        const { error } = await supabaseAdmin
          .from("internal_chat_room")
          .delete()
          .in("room_id", targetIds);
        if (error && /column .*room_id/i.test(error.message)) {
          await supabaseAdmin.from("internal_chat_room").delete().in("id", targetIds);
        } else if (error) {
          return apiFail(`대화방 삭제 실패: ${error.message}`, 500);
        }
        break;
      }

      case "chat_messages": {
        const targetIds = Array.from(idSet);
        const { error } = await supabaseAdmin
          .from("internal_chat_message")
          .delete()
          .in("message_id", targetIds);
        if (error && /column .*message_id/i.test(error.message)) {
          const { error: fallbackErr } = await supabaseAdmin
            .from("internal_chat_message")
            .delete()
            .in("id", targetIds);
          if (fallbackErr) return apiFail(`메시지 삭제 실패: ${fallbackErr.message}`, 500);
        } else if (error) {
          return apiFail(`메시지 삭제 실패: ${error.message}`, 500);
        }
        break;
      }

      case "notices": {
        const parsed = await readHqKvPayload<{ categories?: string[]; notices?: any[] }>(
          supabaseAdmin,
          NOTICES_SETTING_KEY,
          NOTICES_STORAGE_PATH
        );
        if (parsed) {
          await writeHqKvPayload(
            supabaseAdmin,
            NOTICES_SETTING_KEY,
            {
              categories: parsed.categories || [],
              notices: (parsed.notices || []).filter((n: any) => !idSet.has(String(n.id))),
            },
            NOTICES_STORAGE_PATH
          );
        }
        break;
      }

      case "meetings": {
        const parsed = await readHqKvPayload<{ meetings?: any[] }>(
          supabaseAdmin,
          MEETINGS_SETTING_KEY,
          MEETINGS_STORAGE_PATH
        );
        if (parsed) {
          await writeHqKvPayload(
            supabaseAdmin,
            MEETINGS_SETTING_KEY,
            {
              meetings: (parsed.meetings || []).filter((m: any) => !idSet.has(String(m.id))),
            },
            MEETINGS_STORAGE_PATH
          );
        }
        break;
      }

      case "leave_items": {
        const ledger = await readLeavesLedgerServer(supabaseAdmin);
        await writeLeavesLedgerServer(supabaseAdmin, {
          adjustments: ledger.adjustments.filter((x: any) => !idSet.has(`adj::${x.id}`)),
          customGrants: ledger.customGrants.filter((x: any) => !idSet.has(`cgrant::${x.id}`)),
          promotions: ledger.promotions.filter((x: any) => !idSet.has(`promo::${x.id}`)),
          promotionTargets: ledger.promotionTargets.filter((x: any) => !idSet.has(`ptarget::${x.id}`)),
          plans: ledger.plans.filter((x: any) => !idSet.has(`plan::${x.id}`)),
          uploadedMonthly: ledger.uploadedMonthly.filter((x: any, idx: number) => {
            const uid = x.id || `${x.member_id}_${x.year}_${x.month}_${idx}`;
            return !idSet.has(`upmon::${uid}`);
          }),
        });
        break;
      }

      case "work_mgmt_items": {
        const wm = await readWorkMgmtStateServer(supabaseAdmin);
        await writeWorkMgmtStateServer(supabaseAdmin, {
          compGrants: wm.compGrants.filter((x: any) => !idSet.has(`comp::${x.id}`)),
          holidaySubstitutes: wm.holidaySubstitutes.filter((x: any) => !idSet.has(`holsub::${x.id}`)),
          attendanceLocks: wm.attendanceLocks.filter((x: any) => !idSet.has(`lock::${x.id}`)),
        });
        break;
      }

      case "realtime_work_logs": {
        const logsByKey = await readRealtimeWorkLogsServer(supabaseAdmin);
        const next = { ...logsByKey };
        rawIds.forEach((k) => delete next[k]);
        await writeRealtimeWorkLogsServer(supabaseAdmin, next);
        break;
      }

      case "workflow_forms": {
        const parsed = await readHqKvPayload<Partial<StoredWorkflowFormsPayload>>(
          supabaseAdmin,
          "WORKFLOW_FORMS",
          WORKFLOW_FORMS_STORAGE_PATH
        );
        const prevDeleted = new Set<string>(parsed?.deletedFormIds || []);
        rawIds.forEach((id) => prevDeleted.add(id));
        await writeHqKvPayload(
          supabaseAdmin,
          "WORKFLOW_FORMS",
          {
            categories: parsed?.categories || [],
            forms: (parsed?.forms || []).filter((f: any) => !idSet.has(String(f.id))),
            deletedFormIds: Array.from(prevDeleted),
          },
          WORKFLOW_FORMS_STORAGE_PATH
        );
        break;
      }

      case "contract_templates": {
        const parsed = await readHqKvPayload<any>(
          supabaseAdmin,
          CONTRACT_TEMPLATES_SETTING_KEY,
          CONTRACT_TEMPLATES_PATH
        );
        if (parsed) {
          await writeHqKvPayload(
            supabaseAdmin,
            CONTRACT_TEMPLATES_SETTING_KEY,
            {
              ...parsed,
              templates: (parsed.templates || []).filter(
                (t: any) => !idSet.has(`tpl::${t.id}`)
              ),
              customFields: (parsed.customFields || []).filter(
                (cf: any) => !idSet.has(`cf::${cf.id}`)
              ),
            },
            CONTRACT_TEMPLATES_PATH
          );
        }
        break;
      }

      case "year_end_tax": {
        const bySettingKey = new Map<string, Set<string>>();
        for (const compositeId of rawIds) {
          const [sk, memberId] = compositeId.split("::");
          if (!sk || !memberId) continue;
          if (!bySettingKey.has(sk)) bySettingKey.set(sk, new Set());
          bySettingKey.get(sk)!.add(memberId);
        }
        for (const [sk, memberIds] of bySettingKey.entries()) {
          const stored = await readHqKvPayload<HqYearEndTaxYearStore>(supabaseAdmin, sk);
          if (!stored?.submissions) continue;
          const nextSubs = { ...stored.submissions };
          memberIds.forEach((mid) => delete nextSubs[mid]);
          await writeHqKvPayload(supabaseAdmin, sk, {
            ...stored,
            submissions: nextSubs,
          });
        }
        break;
      }

      case "audit_logs": {
        const logs = await readHqAuditLogs(supabaseAdmin);
        const filtered = logs.filter((l) => !idSet.has(String(l.id)));
        await writeHqKvPayload(
          supabaseAdmin,
          "AUDIT_LOGS",
          filtered,
          AUDIT_LOGS_STORAGE_PATH
        );
        break;
      }

      case "login_attempts": {
        const map = await readLoginAttemptRecords(supabaseAdmin);
        const next = { ...map };
        rawIds.forEach((k) => delete next[k]);
        await writeLoginAttemptRecords(supabaseAdmin, next);
        break;
      }

      default:
        return apiFail(`지원하지 않는 도메인입니다: ${domain}`);
    }

    if (domain !== "audit_logs") {
      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "권한 변경",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "삭제",
        info_type: "시스템관리",
        description: `[Lv.6 개발자 데이터 관리] ${domain} 항목 ${rawIds.length}건 강제 삭제`,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      data: { deletedCount: rawIds.length },
    });
  } catch (e: any) {
    console.error("HQ dev-tools POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
