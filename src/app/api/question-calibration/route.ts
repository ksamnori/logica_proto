// src/app/api/question-calibration/route.ts
import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { verifyQuestionMutationCaller } from "@/lib/questionSafeDeleteServer";
import {
  getCalibrationSystemStatus,
  getSupabaseAdminForCalibration,
  runBatchQuestionCalibration,
  runRealtimeQuestionCalibration,
} from "@/lib/questionRateCalibrationServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extractAccessToken(req: NextRequest, bodyToken?: string | null): string | null {
  if (bodyToken && String(bodyToken).trim()) return String(bodyToken).trim();
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const tok = authHeader.slice(7).trim();
    if (tok) return tok;
  }
  const cookieTok = req.cookies.get("sb-access-token")?.value;
  if (cookieTok && cookieTok.trim()) return cookieTok.trim();
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get("mode") || "status";
    const supabaseAdmin = getSupabaseAdminForCalibration();

    if (mode === "sql") {
      const sqlFile = path.join(process.cwd(), "supabase", "question_rate_calibration.sql");
      const sql = await fs.readFile(sqlFile, "utf-8");
      return NextResponse.json({ success: true, sql });
    }

    const status = await getCalibrationSystemStatus(supabaseAdmin);
    return NextResponse.json({ success: true, status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "보정 상태 조회 실패";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdminForCalibration();

    // 1. 채점·수정·삭제 직후 호출되는 실시간 단건/소량 보정 (DB의 실제 정오답 행만 재집계하므로 무결성 보장)
    if (action === "realtime") {
      const result = await runRealtimeQuestionCalibration(supabaseAdmin, {
        questionIds: body?.questionIds,
        tqIds: body?.tqIds,
        assignmentIds: body?.assignmentIds,
        examIds: body?.examIds,
        homeworkIds: body?.homeworkIds,
        studentIds: body?.studentIds,
      });
      return NextResponse.json({ success: true, ...result });
    }

    // 2. 전체 DB 시뮬레이션(dry_run) 및 일괄 보정(batch_apply)은 교직원 세션 토큰 검증
    if (action === "dry_run" || action === "batch_apply") {
      const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
      const token = extractAccessToken(req, body?.accessToken);
      const caller = await verifyQuestionMutationCaller(supabaseAdmin, token, hasServiceKey);
      if (!caller.ok) {
        return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
      }

      const dryRun = action === "dry_run";
      const result = await runBatchQuestionCalibration(supabaseAdmin, dryRun);
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ success: false, error: "지원하지 않는 action입니다." }, { status: 400 });
  } catch (err: unknown) {
    console.error("[question-calibration] 오류:", err);
    const msg = err instanceof Error ? err.message : "문항 정답률 보정 중 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
