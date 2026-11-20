// src/lib/hq/contractSignServer.ts
// 전자계약 서명 감사 추적(Audit Trail) · 원격 서명 링크 토큰 (서버 전용)
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";

export const SIGN_LINK_VALID_DAYS = 14;

/** 서명 시점 계약 내용의 SHA-256 지문 (사후 위·변조 여부 확인용) */
export function computeContractDocHash(row: Record<string, any>): string {
  const canonical = JSON.stringify({
    contract_no: row.contract_no || "",
    category: row.category || "",
    counterparty_name: row.counterparty_name || "",
    title: row.title || "",
    book_title: row.book_title || "",
    start_date: row.start_date || "",
    end_date: row.end_date || "",
    contract_amount: Number(row.contract_amount || 0),
    royalty_rate: row.royalty_rate ?? null,
    tax_type: row.tax_type || "",
    body_text: row.body_text || "",
    special_terms: row.special_terms || "",
    rights_meta: row.rights_meta || {},
    company_signer_name: row.company_signer_name || "",
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function generateSignToken(): string {
  return randomBytes(24).toString("base64url");
}

export function signLinkExpiry(fromIso = new Date().toISOString()): string {
  const d = new Date(fromIso);
  d.setDate(d.getDate() + SIGN_LINK_VALID_DAYS);
  return d.toISOString();
}

export function getRequestIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "";
}

export function getRequestUa(req: NextRequest): string {
  return (req.headers.get("user-agent") || "").slice(0, 300);
}

/** 이름 비교(공백·괄호 표기 무시) — 원격 서명 시 본인 성명 재확인 */
export function normalizePersonName(name: string): string {
  return String(name || "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
