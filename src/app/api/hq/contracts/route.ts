// src/app/api/hq/contracts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_CATEGORIES } from "@/lib/hq/constants";
import {
  computeContractDocHash,
  generateSignToken,
  getRequestIp,
  getRequestUa,
  signLinkExpiry,
} from "@/lib/hq/contractSignServer";
import { sanitizeRightsMeta } from "@/lib/hq/publishingRights";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqColumnError,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqContractCategory,
  HqContractStatus,
  HqContractTargetType,
  HqContractTaxType,
} from "@/lib/hq/types";

export const runtime = "nodejs";

// 출판권·서명감사 확장 컬럼 (hq_patch_publishing_rights.sql 실행 전에는 자동 제외하고 저장)
const EXT_COLUMNS = ["pub_id", "rights_meta", "sign_meta", "sign_token"] as const;

function stripExtColumns<T extends Record<string, any>>(row: T): T {
  const copy: Record<string, any> = { ...row };
  EXT_COLUMNS.forEach((k) => delete copy[k]);
  return copy as T;
}

function generateContractNo(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `CTR-${ym}-${rand}`;
}

function cleanUuid(v: unknown): string | null {
  const s = String(v || "").trim();
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
}

async function insertContractRows(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  rows: Record<string, any>[]
) {
  let res = await supabaseAdmin.from("hq_contract").insert(rows).select("*");
  let degraded = false;
  if (res.error && isMissingHqColumnError(res.error)) {
    degraded = true;
    res = await supabaseAdmin
      .from("hq_contract")
      .insert(rows.map(stripExtColumns))
      .select("*");
  }
  return { data: res.data, error: res.error, degraded };
}

async function updateContract(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  contractId: string,
  fields: Record<string, any>,
  requireStatus?: HqContractStatus
) {
  const run = (f: Record<string, any>) => {
    let q = supabaseAdmin.from("hq_contract").update(f).eq("contract_id", contractId);
    if (requireStatus) q = q.eq("status", requireStatus);
    return q.select("*").maybeSingle();
  };
  let res = await run(fields);
  let degraded = false;
  if (res.error && isMissingHqColumnError(res.error)) {
    degraded = true;
    res = await run(stripExtColumns(fields));
  }
  return { data: res.data, error: res.error, degraded };
}

function canManageExternal(caller: any, existing: any): boolean {
  return (
    existing.target_type === "EXTERNAL" &&
    (caller.isHrManager ||
      caller.rankLevel >= 3 ||
      existing.created_by === caller.userId)
  );
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("hq_contract")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: { contracts: [], myUnsignedCount: 0, extSchemaMissing: true },
        });
      }
      return apiFail(`전자계약 목록 조회 실패: ${error.message}`, 500);
    }

    const allRows = data || [];

    // 확장 컬럼 존재 여부 (행이 있으면 키로 판별, 없으면 1회 probe)
    let extSchemaMissing = false;
    if (allRows.length > 0) {
      extSchemaMissing = !("rights_meta" in allRows[0]);
    } else {
      const probe = await supabaseAdmin
        .from("hq_contract")
        .select("contract_id, pub_id, rights_meta")
        .limit(1);
      extSchemaMissing = Boolean(probe.error && isMissingHqColumnError(probe.error));
    }

    // 열람 권한 필터:
    // - HR 관리자(임원·경영지원 팀장·포털관리자): 전체 계약 열람
    // - 부서 팀장/편집장(Lv.3): 외부 저자/외주 계약 전체 + 본인 내부 계약 + 본인이 발송한 계약
    // - 일반 구성원: 본인 대상 내부 계약 + 본인이 작성한 외주/저자 계약 (타 직원의 연봉·근로계약 철저 보호)
    const visible = allRows
      .filter((row: any) => {
        if (caller.isHrManager) return true;
        if (row.target_member_id === caller.userId) return true;
        if (row.created_by === caller.userId) return true;
        if (caller.rankLevel >= 3 && row.target_type === "EXTERNAL") return true;
        return false;
      })
      .map((row: any) => {
        // 원격 서명 토큰은 해당 외부 계약 관리 권한자에게만 노출
        if (row.sign_token && !canManageExternal(caller, row)) {
          return { ...row, sign_token: null };
        }
        return row;
      });

    const myUnsignedCount = visible.filter((row: any) => {
      if (row.status !== "SENT") return false;
      if (row.target_member_id === caller.userId) return true;
      if (caller.isHrManager && row.target_type === "EXTERNAL") return true;
      return false;
    }).length;

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        contracts: visible,
        myUnsignedCount,
        extSchemaMissing,
      },
    });
  } catch (e: any) {
    console.error("HQ contracts GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();

    // 서식 기반 다수 구성원 일괄 발송 (연봉재계약 / 보안서약서 등 전사 동시 발송)
    if (String(body?.action || "").toUpperCase() === "BATCH_CREATE") {
      if (!caller.isHrManager && !caller.isHqAdmin) {
        return apiFail(
          "다수 구성원 일괄 계약 발송은 인사관리자·최고관리자만 실행할 수 있습니다.",
          403
        );
      }
      const rawItems: any[] = Array.isArray(body?.items) ? body.items : [];
      if (rawItems.length === 0) {
        return apiFail("일괄 발송할 대상 계약 항목이 없습니다.");
      }

      const nowIso = new Date().toISOString();
      const supabaseAdmin = getSupabaseAdmin();
      const rowsToInsert = rawItems.slice(0, 100).map((it) => {
        const cat = (it.category || "SALARY") as HqContractCategory;
        const tType: HqContractTargetType =
          it.target_type === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
        const txType: HqContractTaxType =
          it.tax_type || CONTRACT_CATEGORIES[cat]?.taxDefault || "FOUR_INSURANCE";
        const isDraft = it.status === "DRAFT";
        return {
          contract_no: generateContractNo(),
          category: cat,
          target_type: tType,
          target_member_id:
            tType === "INTERNAL" && it.target_member_id
              ? String(it.target_member_id)
              : null,
          counterparty_name: String(it.counterparty_name || "").trim(),
          counterparty_role: String(it.counterparty_role || "").trim(),
          counterparty_phone: String(it.counterparty_phone || "").trim() || null,
          counterparty_email: String(it.counterparty_email || "").trim() || null,
          department: String(it.department || "").trim(),
          title: String(it.title || "").trim(),
          book_title: String(it.book_title || "").trim() || null,
          start_date: it.start_date || null,
          end_date: it.end_date || null,
          contract_amount: Math.max(
            0,
            Math.round(Number(it.contract_amount || 0))
          ),
          royalty_rate:
            it.royalty_rate !== undefined && it.royalty_rate !== null
              ? Number(it.royalty_rate)
              : null,
          tax_type: txType,
          body_text: String(it.body_text || "").trim(),
          special_terms: String(it.special_terms || "").trim() || null,
          status: (isDraft ? "DRAFT" : "SENT") as HqContractStatus,
          company_signer_name:
            String(it.company_signer_name || "").trim() ||
            "(주)천종현수학연구소 대표이사 천종현",
          company_signed_at: isDraft ? null : nowIso,
          created_by: caller.userId,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      const { data: inserted, error: batchErr } = await insertContractRows(
        supabaseAdmin,
        rowsToInsert
      );

      if (batchErr) {
        return apiFail(`일괄 계약 발송 실패: ${batchErr.message}`, 500);
      }

      return NextResponse.json({
        success: true,
        data: { count: inserted?.length || 0, contracts: inserted || [] },
      });
    }

    const category = String(body?.category || "LABOR") as HqContractCategory;
    if (!(category in CONTRACT_CATEGORIES)) {
      return apiFail("유효하지 않은 계약서 유형입니다.");
    }

    // 내부 근로·연봉계약 발송은 HR 관리자만 가능, 외주·저작권·NDA는 팀장급(Lv.3) 이상 또는 HR 관리자 가능
    if (
      (category === "LABOR" || category === "SALARY") &&
      !caller.isHrManager
    ) {
      return apiFail(
        "임직원 근로·연봉계약서 발송은 인사관리자(대표·임원·경영지원) 권한이 필요합니다.",
        403
      );
    }
    if (!caller.isHrManager && caller.rankLevel < 3) {
      return apiFail(
        "계약서 작성 및 발송은 팀장/편집장(Lv.3) 이상 또는 인사관리자만 가능합니다.",
        403
      );
    }

    const counterpartyName = String(body?.counterparty_name || "").trim();
    const title = String(body?.title || "").trim();
    const bodyText = String(body?.body_text || "").trim();

    if (!counterpartyName || !title || !bodyText) {
      return apiFail("계약 상대방 성명, 계약 제목, 계약 본문은 필수입니다.");
    }

    const nowIso = new Date().toISOString();
    const targetType: HqContractTargetType =
      body?.target_type === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
    const taxType: HqContractTaxType =
      body?.tax_type || CONTRACT_CATEGORIES[category].taxDefault;
    const isDraft = body?.status === "DRAFT";
    const issueLink = !isDraft && targetType === "EXTERNAL";

    const supabaseAdmin = getSupabaseAdmin();
    const payload = {
      contract_no: generateContractNo(),
      category,
      target_type: targetType,
      target_member_id:
        targetType === "INTERNAL" && body?.target_member_id
          ? String(body.target_member_id)
          : null,
      counterparty_name: counterpartyName,
      counterparty_role: String(body?.counterparty_role || "").trim(),
      counterparty_phone: String(body?.counterparty_phone || "").trim() || null,
      counterparty_email: String(body?.counterparty_email || "").trim() || null,
      department: String(body?.department || "").trim(),
      title,
      book_title: String(body?.book_title || "").trim() || null,
      start_date: body?.start_date || null,
      end_date: body?.end_date || null,
      contract_amount: Math.max(0, Math.round(Number(body?.contract_amount || 0))),
      royalty_rate:
        body?.royalty_rate !== undefined && body?.royalty_rate !== null && body?.royalty_rate !== ""
          ? Number(body.royalty_rate)
          : null,
      tax_type: taxType,
      body_text: bodyText,
      special_terms: String(body?.special_terms || "").trim() || null,
      status: (isDraft ? "DRAFT" : "SENT") as HqContractStatus,
      company_signer_name:
        String(body?.company_signer_name || "").trim() ||
        "천종현수학연구소 대표이사",
      // 임시저장은 회사 날인 전 상태 — 발송 시점에 회사 서명일시 기록
      company_signed_at: isDraft ? null : nowIso,
      created_by: caller.userId,
      created_at: nowIso,
      updated_at: nowIso,
      pub_id: cleanUuid(body?.pub_id),
      rights_meta: sanitizeRightsMeta(body?.rights_meta),
      sign_token: issueLink ? generateSignToken() : null,
      sign_meta: issueLink
        ? { link_issued_at: nowIso, link_expires_at: signLinkExpiry(nowIso) }
        : {},
    };

    const { data: createdRows, error, degraded } = await insertContractRows(
      supabaseAdmin,
      [payload]
    );

    if (error) {
      if (isMissingHqTableError(error)) {
        return apiFail(
          "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
          400
        );
      }
      return apiFail(`전자계약 발송 실패: ${error.message}`, 500);
    }

    return NextResponse.json({
      success: true,
      data: createdRows?.[0] || null,
      extSchemaMissing: degraded,
    });
  } catch (e: any) {
    console.error("HQ contracts POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const contractId = String(body?.contract_id || "");
    const action = String(body?.action || "SIGN").toUpperCase();
    if (!contractId) return apiFail("계약 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("hq_contract")
      .select("*")
      .eq("contract_id", contractId)
      .maybeSingle();

    if (findErr || !existing) {
      return apiFail("계약 문서를 찾을 수 없습니다.", 404);
    }

    const nowIso = new Date().toISOString();

    if (action === "SIGN") {
      // 내부 임직원 계약은 당사자 본인(또는 대면 서명 시 HR 관리자)이 서명 가능
      // 외부 저자·프리랜서 계약은 대면(현장 태블릿) 서명 수집으로 HR 관리자·작성자·팀장 이상 처리 가능
      // (원격 서명은 /api/hq/contract-sign 공개 링크로 상대방 본인이 직접 서명)
      const isTargetSelf =
        existing.target_member_id && existing.target_member_id === caller.userId;

      if (!isTargetSelf && !canManageExternal(caller, existing) && !caller.isHrManager) {
        return apiFail("본 계약서의 서명 권한이 없습니다.", 403);
      }
      if (existing.status !== "SENT") {
        return apiFail(
          existing.status === "SIGNED"
            ? "이미 체결 완료된 계약입니다."
            : "서명 요청(발송) 상태의 계약만 서명할 수 있습니다.",
          409
        );
      }

      const signatureData = String(body?.party_signature_data || "").trim();
      if (!signatureData.startsWith("data:image/")) {
        return apiFail("전자서명 패드에 서명을 입력해 주세요.");
      }

      const { data: updated, error: updErr } = await updateContract(
        supabaseAdmin,
        contractId,
        {
          status: "SIGNED",
          party_signature_data: signatureData,
          party_signed_at: nowIso,
          updated_at: nowIso,
          sign_token: null,
          sign_meta: {
            ...(existing.sign_meta || {}),
            doc_hash: computeContractDocHash(existing),
            signed_via: isTargetSelf ? "MEMBER_ACCOUNT" : "IN_PERSON",
            signer_ip: getRequestIp(req),
            signer_ua: getRequestUa(req),
            signed_by_user_id: caller.userId,
            signed_by_name: caller.name,
          },
        },
        "SENT"
      );

      if (updErr) return apiFail(`서명 처리 실패: ${updErr.message}`, 500);
      if (!updated) return apiFail("다른 사용자가 먼저 상태를 변경했습니다. 새로고침 해주세요.", 409);

      // 내부 근로·연봉계약 체결 시 구성원 인사 메모에 이력 자동 반영
      if (
        existing.target_member_id &&
        (existing.category === "LABOR" || existing.category === "SALARY")
      ) {
        try {
          const { data: prof } = await supabaseAdmin
            .from("hq_member_profile")
            .select("hr_memo")
            .eq("instructor_id", existing.target_member_id)
            .maybeSingle();
          const stamp = `[전자계약 체결 ${nowIso.slice(0, 10)}] ${existing.title} (${existing.contract_no})`;
          const nextMemo = prof?.hr_memo ? `${prof.hr_memo}\n${stamp}` : stamp;
          await supabaseAdmin
            .from("hq_member_profile")
            .upsert(
              {
                instructor_id: existing.target_member_id,
                hr_memo: nextMemo,
                updated_at: nowIso,
              },
              { onConflict: "instructor_id" }
            );
        } catch {
          // ignore non-critical profile sync errors
        }
      }

      return NextResponse.json({ success: true, data: updated });
    }

    if (action === "UPDATE_DRAFT") {
      if (!caller.isHrManager && existing.created_by !== caller.userId) {
        return apiFail("임시저장 계약 수정 권한이 없습니다.", 403);
      }
      // 발송·체결 이후의 계약 본문은 수정 불가 (재계약은 '복제하여 재계약 작성' 사용)
      if (existing.status !== "DRAFT") {
        return apiFail(
          "임시저장 상태의 계약만 수정할 수 있습니다. 발송된 계약은 회수 후 복제하여 다시 작성해 주세요.",
          409
        );
      }
      const nextStatus: HqContractStatus =
        body?.next_status === "SENT" ? "SENT" : "DRAFT";
      const nextTarget: HqContractTargetType =
        (body?.target_type || existing.target_type) === "EXTERNAL"
          ? "EXTERNAL"
          : "INTERNAL";
      const issueLink = nextStatus === "SENT" && nextTarget === "EXTERNAL";

      const { data: updated, error: updErr } = await updateContract(
        supabaseAdmin,
        contractId,
        {
          category: body?.category || existing.category,
          target_type: nextTarget,
          target_member_id:
            nextTarget === "INTERNAL" ? body?.target_member_id || null : null,
          counterparty_name:
            String(body?.counterparty_name || existing.counterparty_name).trim(),
          counterparty_role:
            String(body?.counterparty_role ?? existing.counterparty_role).trim(),
          counterparty_phone:
            String(body?.counterparty_phone ?? "").trim() || null,
          counterparty_email:
            String(body?.counterparty_email ?? "").trim() || null,
          department: String(body?.department ?? existing.department).trim(),
          title: String(body?.title || existing.title).trim(),
          book_title: String(body?.book_title ?? "").trim() || null,
          start_date: body?.start_date || null,
          end_date: body?.end_date || null,
          contract_amount: Math.max(
            0,
            Math.round(Number(body?.contract_amount ?? existing.contract_amount))
          ),
          royalty_rate:
            body?.royalty_rate !== undefined &&
            body?.royalty_rate !== null &&
            body?.royalty_rate !== ""
              ? Number(body.royalty_rate)
              : null,
          tax_type: body?.tax_type || existing.tax_type,
          body_text: String(body?.body_text || existing.body_text).trim(),
          special_terms: String(body?.special_terms ?? "").trim() || null,
          company_signer_name:
            String(body?.company_signer_name || "").trim() ||
            existing.company_signer_name,
          status: nextStatus,
          company_signed_at: nextStatus === "SENT" ? nowIso : null,
          updated_at: nowIso,
          pub_id:
            body?.pub_id !== undefined ? cleanUuid(body.pub_id) : existing.pub_id ?? null,
          rights_meta:
            body?.rights_meta !== undefined
              ? sanitizeRightsMeta(body.rights_meta)
              : existing.rights_meta || {},
          sign_token: issueLink ? generateSignToken() : null,
          sign_meta: issueLink
            ? {
                ...(existing.sign_meta || {}),
                link_issued_at: nowIso,
                link_expires_at: signLinkExpiry(nowIso),
              }
            : existing.sign_meta || {},
        },
        "DRAFT"
      );

      if (updErr) return apiFail(`임시저장 수정 실패: ${updErr.message}`, 500);
      if (!updated) return apiFail("계약 상태가 변경되어 저장하지 못했습니다.", 409);
      return NextResponse.json({ success: true, data: updated });
    }

    // 외부 저자·프리랜서에게 보낼 원격 서명 링크 발급/재발급 (기존 링크는 즉시 무효화)
    if (action === "ISSUE_SIGN_LINK") {
      if (!canManageExternal(caller, existing)) {
        return apiFail("외부 계약의 서명 링크 발급 권한이 없습니다.", 403);
      }
      if (existing.status !== "SENT") {
        return apiFail("서명 대기(발송) 상태의 계약만 서명 링크를 발급할 수 있습니다.", 409);
      }
      const token = generateSignToken();
      const { data: updated, error: updErr, degraded } = await updateContract(
        supabaseAdmin,
        contractId,
        {
          sign_token: token,
          sign_meta: {
            ...(existing.sign_meta || {}),
            link_issued_at: nowIso,
            link_expires_at: signLinkExpiry(nowIso),
          },
          updated_at: nowIso,
        },
        "SENT"
      );
      if (degraded) {
        return apiFail(
          "원격 서명 링크 기능을 쓰려면 supabase/hq_patch_publishing_rights.sql을 1회 실행해 주세요.",
          400
        );
      }
      if (updErr) return apiFail(`서명 링크 발급 실패: ${updErr.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    // 계약 ↔ 출판 공정 도서 연결 (계약 조건은 변경하지 않는 관리용 메타데이터)
    if (action === "LINK_PUBLICATION") {
      if (
        !caller.isHrManager &&
        caller.rankLevel < 3 &&
        existing.created_by !== caller.userId
      ) {
        return apiFail("도서 연결 권한이 없습니다.", 403);
      }
      const { data: updated, error: updErr, degraded } = await updateContract(
        supabaseAdmin,
        contractId,
        { pub_id: cleanUuid(body?.pub_id), updated_at: nowIso }
      );
      if (degraded) {
        return apiFail(
          "도서 연결 기능을 쓰려면 supabase/hq_patch_publishing_rights.sql을 1회 실행해 주세요.",
          400
        );
      }
      if (updErr) return apiFail(`도서 연결 실패: ${updErr.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    if (action === "CANCEL") {
      if (!caller.isHrManager && existing.created_by !== caller.userId) {
        return apiFail("계약 회수/파기 권한이 없습니다.", 403);
      }
      if (existing.status === "SIGNED" && !caller.isHrManager) {
        return apiFail("체결 완료된 계약의 해지는 인사관리자만 처리할 수 있습니다.", 403);
      }
      const { data: updated, error: updErr } = await updateContract(
        supabaseAdmin,
        contractId,
        {
          status: "CANCELLED",
          updated_at: nowIso,
          sign_token: null,
          sign_meta: {
            ...(existing.sign_meta || {}),
            cancelled_reason: String(body?.reason || "").trim().slice(0, 300) || undefined,
          },
        }
      );

      if (updErr) return apiFail(`상태 변경 실패: ${updErr.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    return apiFail("지원하지 않는 계약 요청입니다.");
  } catch (e: any) {
    console.error("HQ contracts PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const contractId = req.nextUrl.searchParams.get("id") || "";
    if (!contractId) return apiFail("삭제할 계약 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { data: existing } = await supabaseAdmin
      .from("hq_contract")
      .select("contract_id, status, created_by")
      .eq("contract_id", contractId)
      .maybeSingle();

    if (!existing) return apiFail("계약서를 찾을 수 없습니다.", 404);
    if (!caller.isDevSuperAdmin) {
      if (!caller.isHrManager && existing.created_by !== caller.userId) {
        return apiFail("삭제 권한이 없습니다.", 403);
      }
      if (existing.status === "SIGNED" && !caller.isHrManager) {
        return apiFail("체결 완료된 계약서는 인사관리자만 삭제할 수 있습니다.", 403);
      }
    }

    const { error } = await supabaseAdmin
      .from("hq_contract")
      .delete()
      .eq("contract_id", contractId);

    if (error) return apiFail(`삭제 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ contracts DELETE error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
