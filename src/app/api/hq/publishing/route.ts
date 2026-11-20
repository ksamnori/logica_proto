// src/app/api/hq/publishing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PUB_STAGES } from "@/lib/hq/constants";
import {
  formatEditionLabel,
  getPrintHistory,
  newClientId,
  normalizeIsbn,
  parseEditionLabel,
  sanitizePubMeta,
  validateIsbn13,
} from "@/lib/hq/publishingRights";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqColumnError,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqPrintRunItem,
  HqPublicationMeta,
  HqPubPriority,
  HqPubStage,
} from "@/lib/hq/types";

export const runtime = "nodejs";

type Admin = ReturnType<typeof getSupabaseAdmin>;

function generateBookCode(): string {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `BK-${year}-${rand}`;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * ISBN 검증: 체크기호 오류 및 타 도서와의 중복 발급을 차단.
 * (중쇄는 같은 ISBN을 유지하므로 별도 행을 만들지 말고 [중쇄 등록]을 사용)
 */
async function checkIsbn(
  supabaseAdmin: Admin,
  rawIsbn: string,
  selfPubId?: string
): Promise<string | null> {
  if (!rawIsbn) return null;
  const v = validateIsbn13(rawIsbn);
  if (!v.ok) return `ISBN 확인 필요: ${v.message}`;
  const { data } = await supabaseAdmin
    .from("hq_publication")
    .select("pub_id, title, isbn")
    .not("isbn", "is", null);
  const dup = (data || []).find(
    (r: any) => r.pub_id !== selfPubId && normalizeIsbn(r.isbn) === v.digits
  );
  if (dup) {
    return `이미 「${dup.title}」에 등록된 ISBN입니다. 중쇄라면 해당 도서에서 [중쇄 등록]을 사용하고, 개정판은 새 ISBN을 발급받아야 합니다.`;
  }
  return null;
}

function checkExtraMetaIsbns(rawMeta: unknown, printIsbn: string | null): string | null {
  if (!rawMeta || typeof rawMeta !== "object") return null;
  const r = rawMeta as Record<string, any>;
  const pNorm = normalizeIsbn(printIsbn);
  if (r.set_isbn) {
    const v = validateIsbn13(r.set_isbn);
    if (!v.ok) return `세트 ISBN 확인 필요: ${v.message}`;
    if (pNorm && v.digits === pNorm) {
      return "세트 ISBN은 낱권 ISBN과 별도로 발급된 번호여야 합니다.";
    }
  }
  if (r.ebook_isbn) {
    const v = validateIsbn13(r.ebook_isbn);
    if (!v.ok) return `전자책 ISBN 확인 필요: ${v.message}`;
    if (pNorm && v.digits === pNorm) {
      return "전자책 ISBN은 종이책 ISBN과 별도로 발급된 번호여야 합니다.";
    }
  }
  return null;
}

async function writePublication(
  supabaseAdmin: Admin,
  mode: "insert" | "update",
  fields: Record<string, any>,
  pubId?: string
) {
  const run = (f: Record<string, any>) =>
    mode === "insert"
      ? supabaseAdmin.from("hq_publication").insert(f).select("*").single()
      : supabaseAdmin
          .from("hq_publication")
          .update(f)
          .eq("pub_id", pubId as string)
          .select("*")
          .single();
  let res = await run(fields);
  let degraded = false;
  if (res.error && isMissingHqColumnError(res.error) && "pub_meta" in fields) {
    degraded = true;
    const { pub_meta: _omit, ...rest } = fields;
    void _omit;
    res = await run(rest);
  }
  return { data: res.data, error: res.error, degraded };
}

function mergeMeta(
  existing: HqPublicationMeta | null | undefined,
  incoming: unknown,
  isbn: string | null
): HqPublicationMeta {
  // 쇄 이력은 [중쇄 등록] 액션으로만 변경 (오래된 화면 데이터로 덮어쓰기 방지)
  const inc = sanitizePubMeta(incoming);
  delete inc.print_history;
  const next: HqPublicationMeta = { ...(existing || {}), ...inc };
  // 유효 ISBN이 입력되면 발급 완료로 간주
  if (isbn && validateIsbn13(isbn).ok && (!next.isbn_status || next.isbn_status === "NONE")) {
    next.isbn_status = "ISSUED";
    if (!next.isbn_issued_at) next.isbn_issued_at = todayYmd();
  }
  return next;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("hq_publication")
      .select("*")
      .order("press_deadline", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: { books: [], extSchemaMissing: true },
        });
      }
      return apiFail(`출판 공정 조회 실패: ${error.message}`, 500);
    }

    const rows = data || [];
    let extSchemaMissing = false;
    if (rows.length > 0) {
      extSchemaMissing = !("pub_meta" in rows[0]);
    } else {
      const probe = await supabaseAdmin.from("hq_publication").select("pub_id, pub_meta").limit(1);
      extSchemaMissing = Boolean(probe.error && isMissingHqColumnError(probe.error));
    }

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: { books: rows, extSchemaMissing },
    });
  } catch (e: any) {
    console.error("HQ publishing GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const title = String(body?.title || "").trim();
    if (!title) return apiFail("도서명(또는 가제)을 입력해 주세요.");

    const stage = (body?.stage || "PLANNING") as HqPubStage;
    const stageMeta = PUB_STAGES.find((s) => s.code === stage) || PUB_STAGES[0];
    const nowIso = new Date().toISOString();

    const hasExplicitEditor =
      body !== null &&
      typeof body === "object" &&
      ("editor_id" in body || "editor_name" in body);

    const editorId = hasExplicitEditor ? body?.editor_id || null : caller.userId;
    const editorName = hasExplicitEditor
      ? String(body?.editor_name || "").trim() || null
      : caller.name;

    const supabaseAdmin = getSupabaseAdmin();
    const isbn = String(body?.isbn || "").trim() || null;
    const isbnErr =
      (await checkIsbn(supabaseAdmin, isbn || "")) ||
      checkExtraMetaIsbns(body?.pub_meta, isbn);
    if (isbnErr) return apiFail(isbnErr);

    const editionInfo = String(body?.edition_info || "초판 1쇄").trim();
    const parsedEd = parseEditionLabel(editionInfo);
    const meta = mergeMeta(
      { current_edition: parsedEd.edition, current_printing: parsedEd.printing },
      body?.pub_meta,
      isbn
    );

    const manualBookCode = String(body?.book_code || "").trim();
    const basePayload = {
      title,
      subtitle: String(body?.subtitle || "").trim() || null,
      series_name: String(body?.series_name || "").trim() || null,
      target_grade: String(body?.target_grade || "").trim() || null,
      stage: stageMeta.code,
      proof_round: String(body?.proof_round || "초교").trim(),
      progress_pct:
        body?.progress_pct !== undefined
          ? Math.min(100, Math.max(0, Number(body.progress_pct)))
          : stageMeta.defaultPct,
      author_name: String(body?.author_name || "").trim() || null,
      editor_id: editorId,
      editor_name: editorName,
      designer_name: String(body?.designer_name || "").trim() || null,
      isbn,
      edition_info: editionInfo,
      list_price: Math.max(0, Math.round(Number(body?.list_price || 0))),
      print_run: Math.max(0, Math.round(Number(body?.print_run || 0))),
      print_vendor: String(body?.print_vendor || "").trim() || null,
      press_deadline: body?.press_deadline || null,
      publish_date: body?.publish_date || null,
      priority: (body?.priority || "NORMAL") as HqPubPriority,
      memo: String(body?.memo || "").trim() || null,
      pub_meta: meta,
      created_at: nowIso,
      updated_at: nowIso,
    };

    let created = null;
    let lastError: any = null;
    let degraded = false;
    const maxAttempts = manualBookCode ? 1 : 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const book_code = manualBookCode || generateBookCode();
      const res = await writePublication(supabaseAdmin, "insert", {
        book_code,
        ...basePayload,
      });
      degraded = degraded || res.degraded;

      if (!res.error) {
        created = res.data;
        lastError = null;
        break;
      }

      lastError = res.error;
      if (res.error.code !== "23505") break; // 중복 키가 아니면 즉시 중단
    }

    if (lastError) {
      if (isMissingHqTableError(lastError)) {
        return apiFail(
          "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
          400
        );
      }
      return apiFail(`도서 등록 실패: ${lastError.message}`, 500);
    }

    return NextResponse.json({ success: true, data: created, extSchemaMissing: degraded });
  } catch (e: any) {
    console.error("HQ publishing POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const pubId = String(body?.pub_id || "");
    if (!pubId) return apiFail("도서 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: existing, error: findErr } = await supabaseAdmin
      .from("hq_publication")
      .select("*")
      .eq("pub_id", pubId)
      .maybeSingle();
    if (findErr || !existing) return apiFail("도서를 찾을 수 없습니다.", 404);
    const existingMeta: HqPublicationMeta = existing.pub_meta || {};

    // ── 중쇄(같은 ISBN) / 개정판(새 ISBN) 발행 등록 ──
    if (body?.action === "REPRINT") {
      const kind = body?.kind === "NEW_EDITION" ? "NEW_EDITION" : "REPRINT";
      const copies = Math.max(0, Math.round(Number(body?.copies || 0)));
      const printDate = String(body?.print_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(printDate)) return apiFail("발행일(판권면 기준)을 입력해 주세요.");
      if (copies <= 0) return apiFail("인쇄 부수를 입력해 주세요.");
      if (!("pub_meta" in existing)) {
        return apiFail(
          "쇄 이력 기능을 쓰려면 supabase/hq_patch_publishing_rights.sql을 1회 실행해 주세요.",
          400
        );
      }

      const hist = getPrintHistory(existing);
      const parsed = parseEditionLabel(existing.edition_info);
      const curEdition = existingMeta.current_edition || parsed.edition;
      const curPrinting = existingMeta.current_printing || parsed.printing;

      // 쇄 이력이 비어 있는데 기존 초쇄 정보가 있으면 현재 판·쇄를 1행으로 보존
      if (hist.length === 0 && (existing.print_run > 0 || existing.publish_date)) {
        hist.push({
          id: newClientId("pr"),
          edition_no: curEdition,
          printing_no: curPrinting,
          print_date: existing.publish_date || printDate,
          copies: Math.max(0, Number(existing.print_run || 0)),
          vendor: existing.print_vendor || undefined,
          isbn: existing.isbn || undefined,
          memo: "기존 등록 정보에서 자동 이관",
        });
      }

      let nextEdition = curEdition;
      let nextPrinting = curPrinting + 1;
      let nextIsbn: string | null = existing.isbn;
      if (kind === "NEW_EDITION") {
        nextEdition = curEdition + 1;
        nextPrinting = 1;
        nextIsbn = String(body?.isbn || "").trim() || null;
        if (!nextIsbn) return apiFail("개정판은 새 ISBN이 필요합니다. 발급받은 ISBN을 입력해 주세요.");
        const isbnErr = await checkIsbn(supabaseAdmin, nextIsbn, pubId);
        if (isbnErr) return apiFail(isbnErr);
        if (normalizeIsbn(nextIsbn) === normalizeIsbn(existing.isbn)) {
          return apiFail("개정판은 기존 판과 다른 ISBN이어야 합니다.");
        }
      } else if (hist.length === 0) {
        // 아직 한 번도 인쇄 기록이 없으면 이번이 1쇄
        nextPrinting = curPrinting;
      }

      const vendor = String(body?.vendor || existing.print_vendor || "").trim();
      const entry: HqPrintRunItem = {
        id: newClientId("pr"),
        edition_no: nextEdition,
        printing_no: nextPrinting,
        print_date: printDate,
        copies,
        vendor: vendor || undefined,
        isbn: nextIsbn || undefined,
        memo: String(body?.memo || "").trim().slice(0, 200) || undefined,
      };

      const nextMeta: HqPublicationMeta = {
        ...existingMeta,
        current_edition: nextEdition,
        current_printing: nextPrinting,
        print_history: [...hist, entry],
      };
      if (kind === "NEW_EDITION") {
        nextMeta.isbn_status = "ISSUED";
        nextMeta.isbn_issued_at = todayYmd();
        nextMeta.colophon_checked = false;
        nextMeta.barcode_ready = false;
        nextMeta.legal_deposit_status = "NONE"; // 개정판은 새로 납본 대상
        nextMeta.legal_deposit_date = undefined;
      }

      const { data: updated, error } = await writePublication(
        supabaseAdmin,
        "update",
        {
          edition_info: formatEditionLabel(nextEdition, nextPrinting),
          print_run: copies,
          print_vendor: vendor || null,
          isbn: nextIsbn,
          publish_date: kind === "NEW_EDITION" ? printDate : existing.publish_date || printDate,
          pub_meta: nextMeta,
          updated_at: nowIso,
        },
        pubId
      );
      if (error) return apiFail(`쇄 이력 등록 실패: ${error.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    // ── 빠른 공정 단계 이동 (칸반 카드 이동) ──
    if (body?.quick_stage) {
      const nextStage = String(body.quick_stage) as HqPubStage;
      const stageMeta = PUB_STAGES.find((s) => s.code === nextStage);
      if (!stageMeta) return apiFail("유효하지 않은 공정 단계입니다.");

      const updateFields: Record<string, any> = {
        stage: stageMeta.code,
        progress_pct: stageMeta.defaultPct,
        updated_at: nowIso,
      };
      if (body?.proof_round) {
        updateFields.proof_round = String(body.proof_round).trim();
      }

      // 출간 완료 처리 시: 발행일 기록(납본 30일 기산) + 초쇄 이력 자동 생성
      if (stageMeta.code === "PUBLISHED") {
        const pubDate = existing.publish_date || todayYmd();
        updateFields.publish_date = pubDate;
        updateFields.proof_round = "납품완료";
        if ("pub_meta" in existing && getPrintHistory(existing).length === 0) {
          const parsed = parseEditionLabel(existing.edition_info);
          updateFields.pub_meta = {
            ...existingMeta,
            current_edition: existingMeta.current_edition || parsed.edition,
            current_printing: existingMeta.current_printing || parsed.printing,
            legal_deposit_status: existingMeta.legal_deposit_status || "NONE",
            print_history: [
              {
                id: newClientId("pr"),
                edition_no: existingMeta.current_edition || parsed.edition,
                printing_no: existingMeta.current_printing || parsed.printing,
                print_date: pubDate,
                copies: Math.max(0, Number(existing.print_run || 0)),
                vendor: existing.print_vendor || undefined,
                isbn: existing.isbn || undefined,
              },
            ],
          };
        }
      }

      const { data: updated, error } = await writePublication(
        supabaseAdmin,
        "update",
        updateFields,
        pubId
      );

      if (error) return apiFail(`공정 단계 변경 실패: ${error.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    // ── 전체 정보 수정 ──
    const title = String(body?.title || "").trim();
    if (!title) return apiFail("도서명(또는 가제)을 입력해 주세요.");

    const stage = (body?.stage || "PLANNING") as HqPubStage;
    const stageMeta = PUB_STAGES.find((s) => s.code === stage) || PUB_STAGES[0];
    const isbn = String(body?.isbn || "").trim() || null;
    const isbnErr =
      (await checkIsbn(supabaseAdmin, isbn || "", pubId)) ||
      checkExtraMetaIsbns(body?.pub_meta, isbn);
    if (isbnErr) return apiFail(isbnErr);

    const editionInfo = String(body?.edition_info || "").trim() || null;
    const parsedEd = parseEditionLabel(editionInfo);
    const baseMeta: HqPublicationMeta = {
      ...existingMeta,
      current_edition: parsedEd.edition,
      current_printing: parsedEd.printing,
    };

    const { data: updated, error, degraded } = await writePublication(
      supabaseAdmin,
      "update",
      {
        title,
        subtitle: String(body?.subtitle || "").trim() || null,
        series_name: String(body?.series_name || "").trim() || null,
        target_grade: String(body?.target_grade || "").trim() || null,
        stage: stageMeta.code,
        proof_round: String(body?.proof_round || "").trim() || null,
        progress_pct: Math.min(
          100,
          Math.max(0, Number(body?.progress_pct ?? stageMeta.defaultPct))
        ),
        author_name: String(body?.author_name || "").trim() || null,
        editor_id: body?.editor_id || null,
        editor_name: String(body?.editor_name || "").trim() || null,
        designer_name: String(body?.designer_name || "").trim() || null,
        isbn,
        edition_info: editionInfo,
        list_price: Math.max(0, Math.round(Number(body?.list_price || 0))),
        print_run: Math.max(0, Math.round(Number(body?.print_run || 0))),
        print_vendor: String(body?.print_vendor || "").trim() || null,
        press_deadline: body?.press_deadline || null,
        publish_date: body?.publish_date || null,
        priority: (body?.priority || "NORMAL") as HqPubPriority,
        memo: String(body?.memo || "").trim() || null,
        pub_meta: mergeMeta(baseMeta, body?.pub_meta, isbn),
        updated_at: nowIso,
      },
      pubId
    );

    if (error) return apiFail(`도서 정보 수정 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true, data: updated, extSchemaMissing: degraded });
  } catch (e: any) {
    console.error("HQ publishing PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHrManager && caller.rankLevel < 3) {
      return apiFail("도서 공정 삭제는 팀장/편집장(Lv.3) 이상만 가능합니다.", 403);
    }

    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return apiFail("삭제할 도서 ID가 필요합니다.");

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("hq_publication")
      .delete()
      .eq("pub_id", id);

    if (error) return apiFail(`삭제 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ publishing DELETE error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
