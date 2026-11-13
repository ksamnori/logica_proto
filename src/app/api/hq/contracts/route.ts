// src/app/api/hq/contracts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_CATEGORIES } from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
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

function generateContractNo(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `CTR-${ym}-${rand}`;
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
          data: { contracts: [], myUnsignedCount: 0 },
        });
      }
      return apiFail(`전자계약 목록 조회 실패: ${error.message}`, 500);
    }

    const allRows = data || [];

    // 열람 권한 필터:
    // - HR 관리자(임원·경영지원 팀장·포털관리자): 전체 계약 열람
    // - 부서 팀장/편집장(Lv.3): 외부 저자/외주 계약 전체 + 본인 내부 계약 + 본인이 발송한 계약
    // - 일반 구성원: 본인 대상 내부 계약 + 본인이 작성한 외주/저자 계약 (타 직원의 연봉·근로계약 철저 보호)
    const visible = allRows.filter((row: any) => {
      if (caller.isHrManager) return true;
      if (row.target_member_id === caller.userId) return true;
      if (row.created_by === caller.userId) return true;
      if (caller.rankLevel >= 3 && row.target_type === "EXTERNAL") return true;
      return false;
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
      status: (body?.status === "DRAFT" ? "DRAFT" : "SENT") as HqContractStatus,
      company_signer_name:
        String(body?.company_signer_name || "").trim() ||
        "천종현수학연구소 대표이사",
      company_signed_at: nowIso,
      created_by: caller.userId,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: created, error } = await supabaseAdmin
      .from("hq_contract")
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
      return apiFail(`전자계약 발송 실패: ${error.message}`, 500);
    }

    return NextResponse.json({ success: true, data: created });
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
      // 외부 저자·프리랜서 계약은 대면/전자 서명 수집으로 HR 관리자·작성자·팀장 이상 서명 처리 가능
      const isTargetSelf =
        existing.target_member_id && existing.target_member_id === caller.userId;
      const canSignExternal =
        existing.target_type === "EXTERNAL" &&
        (caller.isHrManager ||
          caller.rankLevel >= 3 ||
          existing.created_by === caller.userId);

      if (!isTargetSelf && !canSignExternal && !caller.isHrManager) {
        return apiFail("본 계약서의 서명 권한이 없습니다.", 403);
      }

      const signatureData = String(body?.party_signature_data || "").trim();
      if (!signatureData) {
        return apiFail("전자서명 패드에 서명을 입력해 주세요.");
      }

      const { data: updated, error: updErr } = await supabaseAdmin
        .from("hq_contract")
        .update({
          status: "SIGNED",
          party_signature_data: signatureData,
          party_signed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("contract_id", contractId)
        .select("*")
        .single();

      if (updErr) return apiFail(`서명 처리 실패: ${updErr.message}`, 500);

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

    if (action === "CANCEL") {
      if (!caller.isHrManager && existing.created_by !== caller.userId) {
        return apiFail("계약 회수/파기 권한이 없습니다.", 403);
      }
      const { data: updated, error: updErr } = await supabaseAdmin
        .from("hq_contract")
        .update({ status: "CANCELLED", updated_at: nowIso })
        .eq("contract_id", contractId)
        .select("*")
        .single();

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
    if (!caller.isHrManager && existing.created_by !== caller.userId) {
      return apiFail("삭제 권한이 없습니다.", 403);
    }
    if (existing.status === "SIGNED" && !caller.isHrManager) {
      return apiFail("체결 완료된 계약서는 인사관리자만 삭제할 수 있습니다.", 403);
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
