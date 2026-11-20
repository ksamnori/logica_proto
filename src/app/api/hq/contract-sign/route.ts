// src/app/api/hq/contract-sign/route.ts
// 외부 저자·프리랜서 원격 전자서명 (로그인 없이 1회용 토큰 링크로 본인 서명)
import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_CATEGORIES, CONTRACT_TAX_LABELS } from "@/lib/hq/constants";
import {
  computeContractDocHash,
  getRequestIp,
  getRequestUa,
  normalizePersonName,
} from "@/lib/hq/contractSignServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqColumnError,
} from "@/lib/hq/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanToken(raw: unknown): string {
  const t = String(raw || "").trim();
  return /^[A-Za-z0-9_-]{20,64}$/.test(t) ? t : "";
}

async function findByToken(token: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("hq_contract")
    .select("*")
    .eq("sign_token", token)
    .maybeSingle();
  return { data, error, supabaseAdmin };
}

function linkProblem(row: any): string | null {
  if (!row) return "유효하지 않거나 이미 사용된 서명 링크입니다. 담당자에게 새 링크를 요청해 주세요.";
  if (row.status !== "SENT") {
    return row.status === "SIGNED"
      ? "이미 서명이 완료된 계약입니다."
      : "회수되었거나 서명할 수 없는 상태의 계약입니다.";
  }
  if (row.target_type !== "EXTERNAL") return "이 링크로 서명할 수 없는 계약입니다.";
  const exp = row.sign_meta?.link_expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) {
    return "서명 링크 유효기간이 만료되었습니다. 담당자에게 재발급을 요청해 주세요.";
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const token = cleanToken(req.nextUrl.searchParams.get("token"));
    if (!token) return apiFail("서명 링크가 올바르지 않습니다.", 400);

    const { data: row, error, supabaseAdmin } = await findByToken(token);
    if (error) {
      if (isMissingHqColumnError(error)) {
        return apiFail("원격 서명 기능이 아직 활성화되지 않았습니다.", 503);
      }
      return apiFail("계약 정보를 불러오지 못했습니다.", 500);
    }
    const problem = linkProblem(row);
    if (problem) return apiFail(problem, 410);

    const { data: company } = await supabaseAdmin
      .from("hq_company_settings")
      .select("company_name, ceo_names, address, seals_json")
      .eq("setting_key", "MAIN")
      .maybeSingle();

    const seals: any[] = Array.isArray(company?.seals_json) ? company!.seals_json : [];
    const seal = seals.find((s) => s?.is_default) || seals[0] || null;

    // 최초 열람 시각 기록 (감사 추적)
    if (!row.sign_meta?.link_viewed_at) {
      await supabaseAdmin
        .from("hq_contract")
        .update({
          sign_meta: { ...(row.sign_meta || {}), link_viewed_at: new Date().toISOString() },
        })
        .eq("contract_id", row.contract_id)
        .then(
          () => {},
          () => {}
        );
    }

    return NextResponse.json({
      success: true,
      data: {
        contract_no: row.contract_no,
        category_label: CONTRACT_CATEGORIES[row.category as keyof typeof CONTRACT_CATEGORIES]?.label || row.title,
        title: row.title,
        book_title: row.book_title,
        counterparty_name: row.counterparty_name,
        counterparty_role: row.counterparty_role,
        start_date: row.start_date,
        end_date: row.end_date,
        contract_amount: row.contract_amount,
        royalty_rate: row.royalty_rate,
        tax_label: CONTRACT_TAX_LABELS[row.tax_type as keyof typeof CONTRACT_TAX_LABELS] || "",
        body_text: row.body_text,
        special_terms: row.special_terms,
        company_name: company?.company_name || "(주)천종현수학연구소",
        company_signer_name: row.company_signer_name,
        company_signed_at: row.company_signed_at,
        seal_image_path: seal?.image_url || null,
        link_expires_at: row.sign_meta?.link_expires_at || null,
      },
    });
  } catch (e: any) {
    console.error("HQ contract-sign GET error:", e);
    return apiFail("요청 처리 중 오류가 발생했습니다.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanToken(body?.token);
    if (!token) return apiFail("서명 링크가 올바르지 않습니다.", 400);

    const signatureData = String(body?.signature_data || "");
    if (!signatureData.startsWith("data:image/png;base64,") || signatureData.length > 400_000) {
      return apiFail("서명 이미지를 확인할 수 없습니다. 다시 서명해 주세요.");
    }
    if (body?.agree !== true) {
      return apiFail("계약 내용 확인 및 전자서명 동의에 체크해 주세요.");
    }

    const { data: row, error, supabaseAdmin } = await findByToken(token);
    if (error) return apiFail("계약 정보를 불러오지 못했습니다.", 500);
    const problem = linkProblem(row);
    if (problem) return apiFail(problem, 410);

    if (
      normalizePersonName(String(body?.signer_name || "")) !==
      normalizePersonName(row.counterparty_name)
    ) {
      return apiFail("계약서에 기재된 성명(상호)과 입력한 성명이 일치하지 않습니다.");
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("hq_contract")
      .update({
        status: "SIGNED",
        party_signature_data: signatureData,
        party_signed_at: nowIso,
        sign_token: null,
        updated_at: nowIso,
        sign_meta: {
          ...(row.sign_meta || {}),
          doc_hash: computeContractDocHash(row),
          signed_via: "REMOTE_LINK",
          signer_ip: getRequestIp(req),
          signer_ua: getRequestUa(req),
          signed_by_user_id: null,
          signed_by_name: String(body?.signer_name || "").trim().slice(0, 60),
        },
      })
      .eq("contract_id", row.contract_id)
      .eq("status", "SENT")
      .eq("sign_token", token)
      .select("contract_no, party_signed_at, sign_meta")
      .maybeSingle();

    if (updErr) return apiFail("서명 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.", 500);
    if (!updated) return apiFail("이미 처리된 서명 링크입니다.", 409);

    return NextResponse.json({
      success: true,
      data: {
        contract_no: updated.contract_no,
        signed_at: updated.party_signed_at,
        doc_hash: updated.sign_meta?.doc_hash || "",
      },
    });
  } catch (e: any) {
    console.error("HQ contract-sign POST error:", e);
    return apiFail("요청 처리 중 오류가 발생했습니다.", 500);
  }
}
