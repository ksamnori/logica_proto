// src/app/api/hq/publishing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PUB_STAGES } from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqPubPriority, HqPubStage } from "@/lib/hq/types";

export const runtime = "nodejs";

function generateBookCode(): string {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `BK-${year}-${rand}`;
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
          data: { books: [] },
        });
      }
      return apiFail(`출판 공정 조회 실패: ${error.message}`, 500);
    }

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: { books: data || [] },
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
      isbn: String(body?.isbn || "").trim() || null,
      edition_info: String(body?.edition_info || "초판 1쇄").trim(),
      list_price: Math.max(0, Math.round(Number(body?.list_price || 0))),
      print_run: Math.max(0, Math.round(Number(body?.print_run || 0))),
      print_vendor: String(body?.print_vendor || "").trim() || null,
      press_deadline: body?.press_deadline || null,
      publish_date: body?.publish_date || null,
      priority: (body?.priority || "NORMAL") as HqPubPriority,
      memo: String(body?.memo || "").trim() || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const supabaseAdmin = getSupabaseAdmin();

    let created = null;
    let lastError: any = null;
    const maxAttempts = manualBookCode ? 1 : 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const book_code = manualBookCode || generateBookCode();
      const { data, error } = await supabaseAdmin
        .from("hq_publication")
        .insert({ book_code, ...basePayload })
        .select("*")
        .single();

      if (!error) {
        created = data;
        lastError = null;
        break;
      }

      lastError = error;
      if (error.code !== "23505") break; // 중복 키가 아니면 즉시 중단
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

    return NextResponse.json({ success: true, data: created });
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

    // 빠른 공정 단계 이동 (칸반 카드 이동)
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

      const { data: updated, error } = await supabaseAdmin
        .from("hq_publication")
        .update(updateFields)
        .eq("pub_id", pubId)
        .select("*")
        .single();

      if (error) return apiFail(`공정 단계 변경 실패: ${error.message}`, 500);
      return NextResponse.json({ success: true, data: updated });
    }

    const title = String(body?.title || "").trim();
    if (!title) return apiFail("도서명(또는 가제)을 입력해 주세요.");

    const stage = (body?.stage || "PLANNING") as HqPubStage;
    const stageMeta = PUB_STAGES.find((s) => s.code === stage) || PUB_STAGES[0];

    const { data: updated, error } = await supabaseAdmin
      .from("hq_publication")
      .update({
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
        isbn: String(body?.isbn || "").trim() || null,
        edition_info: String(body?.edition_info || "").trim() || null,
        list_price: Math.max(0, Math.round(Number(body?.list_price || 0))),
        print_run: Math.max(0, Math.round(Number(body?.print_run || 0))),
        print_vendor: String(body?.print_vendor || "").trim() || null,
        press_deadline: body?.press_deadline || null,
        publish_date: body?.publish_date || null,
        priority: (body?.priority || "NORMAL") as HqPubPriority,
        memo: String(body?.memo || "").trim() || null,
        updated_at: nowIso,
      })
      .eq("pub_id", pubId)
      .select("*")
      .single();

    if (error) return apiFail(`도서 정보 수정 실패: ${error.message}`, 500);
    return NextResponse.json({ success: true, data: updated });
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