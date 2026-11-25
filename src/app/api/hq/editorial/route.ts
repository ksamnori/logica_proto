// src/app/api/hq/editorial/route.ts
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  analyzeCaptureImageWithGemini,
  buildBootstrapPayload,
  buildTargetContext,
  buildUnitDetailPayload,
  type GeneratedSolutionItem,
  generateSolutionsForProblems,
  getEditorialServerIndex,
  invalidateEditorialServerCache,
  queryQuestionsPayload,
} from "@/lib/hq/editorialServerEngine";
import type { EditorialCountFilter } from "@/lib/hq/editorialTypes";
import { apiFail, getSupabaseAdmin, requireHqCaller } from "@/lib/hq/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseCountFilter(sp: URLSearchParams): EditorialCountFilter {
  const includeDerived = sp.get("includeDerived") !== "false";
  const includeSubTaxonomy = sp.get("includeSubTaxonomy") === "true";
  const rawCurr = sp.get("curriculum");
  const curriculum =
    rawCurr === "2022" || rawCurr === "2015" ? rawCurr : "all";
  return { includeDerived, includeSubTaxonomy, curriculum };
}

function clampStr(
  val: unknown,
  maxLen: number,
  fallback: string | null = null
): string | null {
  const s = String(val ?? "").trim();
  if (!s) return fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const sp = req.nextUrl.searchParams;
    const action = sp.get("action") || "bootstrap";
    const forceRefresh = sp.get("refresh") === "true";
    const filter = parseCountFilter(sp);

    const supabaseAdmin = getSupabaseAdmin();
    const index = await getEditorialServerIndex(supabaseAdmin, forceRefresh);

    if (action === "bootstrap") {
      const data = buildBootstrapPayload(index, filter);
      return NextResponse.json({ success: true, data });
    }

    if (action === "unit_detail") {
      const rawIds = sp.get("categoryIds") || "";
      const categoryIds = rawIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const data = buildUnitDetailPayload(index, categoryIds, filter);
      return NextResponse.json({ success: true, data });
    }

    if (action === "questions") {
      const modeRaw = sp.get("mode");
      const mode =
        modeRaw === "thinking" || modeRaw === "all" ? modeRaw : "curriculum";
      const categoryIds = (sp.get("categoryIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const itemIds = (sp.get("itemIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const thkIds = (sp.get("thkIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const directOnly = sp.get("directOnly") === "true";
      const difficulty = sp.get("difficulty") || "ALL";
      const cognitiveLevel = sp.get("cognitiveLevel") || "ALL";
      const bookName = sp.get("bookName") || "ALL";
      const keyword = sp.get("keyword") || "";
      const page = parseInt(sp.get("page") || "1", 10) || 1;
      const pageSize = parseInt(sp.get("pageSize") || "20", 10) || 20;

      const data = await queryQuestionsPayload(supabaseAdmin, index, {
        mode,
        categoryIds,
        itemIds,
        directOnly,
        thkIds,
        filter,
        difficulty,
        cognitiveLevel,
        bookName,
        keyword,
        page,
        pageSize,
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === "target_context") {
      const taxonomyId = sp.get("taxonomyId") || "";
      const thkTaxonomyId = sp.get("thkTaxonomyId") || "";
      const data = buildTargetContext(index, taxonomyId, thkTaxonomyId, filter);
      return NextResponse.json({ success: true, data });
    }

    return apiFail(`지원하지 않는 action입니다: ${action}`, 400);
  } catch (err: unknown) {
    console.error("[GET /api/hq/editorial] 오류:", err);
    const msg = err instanceof Error ? err.message : "서버 조회 중 오류가 발생했습니다.";
    return apiFail(msg, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");
    const supabaseAdmin = getSupabaseAdmin();

    if (action === "analyze_image") {
      const imageBase64 = String(body.imageBase64 || "");
      if (!imageBase64) {
        return apiFail("분석할 캡처 이미지 데이터가 없습니다.", 400);
      }
      const mimeType = body.mimeType ? String(body.mimeType) : undefined;
      const gradeHint = body.gradeHint ? String(body.gradeHint) : "ALL";
      const applyThinking = Boolean(body.applyThinking);

      const index = await getEditorialServerIndex(supabaseAdmin, false);
      const data = await analyzeCaptureImageWithGemini(index, {
        imageBase64,
        mimeType,
        gradeHint,
        applyThinking,
      });

      return NextResponse.json({ success: true, data });
    }

    if (action === "generate_solution") {
      const problems = Array.isArray(body.problems)
        ? (body.problems as Record<string, unknown>[])
        : [];
      if (problems.length === 0) {
        return apiFail("해설을 생성할 문항이 없습니다.", 400);
      }
      const solutions = await generateSolutionsForProblems({
        imageBase64: body.imageBase64 ? String(body.imageBase64) : null,
        mimeType: body.mimeType ? String(body.mimeType) : undefined,
        problems: problems.map((p) => ({
          temp_id: String(p.temp_id || ""),
          question_number: String(p.question_number || "1"),
          question: String(p.question || ""),
        })),
      });
      return NextResponse.json({ success: true, data: { solutions } });
    }

    if (action === "save_questions") {
      const rawProblems = Array.isArray(body.problems)
        ? (body.problems as Record<string, unknown>[])
        : [];
      if (rawProblems.length === 0) {
        return apiFail("저장할 문항을 선택해 주세요.", 400);
      }

      const bookName = String(body.bookName || "").trim() || "집필팀 캡처 등록 문항";
      const pageNumber = String(body.pageNumber || "").trim();
      const attachImage = Boolean(body.attachImage);
      const generateSolution = Boolean(body.generateSolution);
      const imageBase64 = body.imageBase64 ? String(body.imageBase64) : null;
      const mimeType = body.mimeType ? String(body.mimeType) : "image/png";

      const index = await getEditorialServerIndex(supabaseAdmin, false);

      let generatedMap: Record<string, GeneratedSolutionItem> = {};
      if (generateSolution) {
        const needSolve = rawProblems.filter(
          (p) => !String(p.answer || "").trim() || !String(p.step_1_concept || "").trim()
        );
        if (needSolve.length > 0) {
          generatedMap = await generateSolutionsForProblems({
            imageBase64,
            mimeType,
            problems: needSolve.map((p) => ({
              temp_id: String(p.temp_id || ""),
              question_number: String(p.question_number || "1"),
              question: String(p.question || ""),
            })),
          });
        }
      }

      let sharedImageUrl: string | null = null;
      if (attachImage && imageBase64) {
        const cleanB64 = imageBase64.includes(",")
          ? imageBase64.split(",")[1]
          : imageBase64;
        const ext =
          mimeType.includes("jpeg") || mimeType.includes("jpg")
            ? "jpg"
            : mimeType.includes("webp")
              ? "webp"
              : "png";
        const fileName = `editorial_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
        const buf = Buffer.from(cleanB64, "base64");

        const { error: upErr } = await supabaseAdmin.storage
          .from("question_images")
          .upload(fileName, buf, { contentType: mimeType, upsert: true });

        if (!upErr) {
          sharedImageUrl = supabaseAdmin.storage
            .from("question_images")
            .getPublicUrl(fileName).data.publicUrl;
        } else {
          console.warn("[save_questions] 캡처 이미지 업로드 경고:", upErr.message);
        }
      }

      const nowIso = new Date().toISOString();
      const payloads = rawProblems.map((p) => {
        const qId = randomUUID();
        const gen = generatedMap[String(p.temp_id || "")];
        const finalPage = pageNumber || String(p.final_printed_page || "1").trim() || "1";
        const pageInt = parseInt(finalPage, 10) || 1;

        const taxId = String(p.taxonomy_id || "").trim() || null;
        const thkId = String(p.thk_taxonomy_id || "").trim() || null;

        let resolvedItemId: string | null = null;
        let resolvedTaxName: string | null = p.taxonomy_name
          ? String(p.taxonomy_name).trim()
          : null;
        if (taxId) {
          const hitItem = index.itemByUpper.get(taxId.toUpperCase());
          if (hitItem) {
            resolvedItemId = hitItem.item_id;
            const cat = index.catByUpper.get(hitItem.category_id.toUpperCase());
            if (cat && !resolvedTaxName) {
              resolvedTaxName = [
                cat.depth1,
                cat.depth2,
                cat.depth3,
                cat.depth4,
                cat.depth5,
                cat.depth6,
                cat.depth7,
                hitItem.depth8,
              ]
                .filter(Boolean)
                .join(" > ");
            }
          }
        }

        let resolvedThkName: string | null = p.thk_taxonomy_name
          ? String(p.thk_taxonomy_name).trim()
          : null;
        if (thkId && !resolvedThkName) {
          const hitThk = index.thkByUpper.get(thkId.toUpperCase());
          if (hitThk) resolvedThkName = hitThk.full_path;
        }

        const answer = String(p.answer || gen?.answer || "").trim() || null;
        const s1 = String(p.step_1_concept || gen?.step_1_concept || "").trim() || null;
        const s2 = String(p.step_2_approach || gen?.step_2_approach || "").trim() || null;
        const s3 = String(p.step_3_process || gen?.step_3_process || "").trim() || null;
        const s4 = String(p.step_4_conclusion || gen?.step_4_conclusion || "").trim() || null;
        const pTypeStr = String(p.problem_type || "");
        const diffStr = String(p.difficulty || "");
        const cogStr = String(p.cognitive_level || "");

        return {
          question_id: qId,
          item_id: resolvedItemId,
          book_name: bookName,
          source_book_name: bookName,
          pdf_source: bookName,
          detected_page_num: pageInt,
          final_printed_page: clampStr(finalPage, 20, "1"),
          question_number: clampStr(p.question_number || "1", 20, "1"),
          sub_num: Number(p.sub_num || 0),
          sub_sub_num: Number(p.sub_sub_num || 0),
          problem_type: ["MULTIPLE_CHOICE", "SUBJECTIVE", "DESCRIPTIVE"].includes(
            pTypeStr
          )
            ? pTypeStr
            : "SUBJECTIVE",
          difficulty: ["최하", "하", "중", "상", "최상"].includes(diffStr)
            ? diffStr
            : "중",
          solving_probability:
            typeof p.solving_probability === "number" && Number.isFinite(p.solving_probability)
              ? Math.round(p.solving_probability)
              : 60,
          cognitive_level: ["이해 및 연산", "적용 및 응용", "추론 및 문제 해결"].includes(
            cogStr
          )
            ? cogStr
            : "적용 및 응용",
          taxonomy_id: taxId,
          taxonomy_name: resolvedTaxName,
          thk_taxonomy_id: thkId,
          thk_taxonomy_name: resolvedThkName,
          question: String(p.question || "").trim() || "집필팀 캡처 문항",
          answer,
          step_1_concept: s1,
          step_2_approach: s2,
          step_3_process: s3,
          step_4_conclusion: s4,
          image_url: sharedImageUrl,
          ai_status: answer ? "완료" : "대기",
          classification_status: taxId ? "COMPLETE" : "PENDING",
          verification_status: "APPROVED",
          is_human_verified: true,
          is_hidden: false,
          ai_gradable: true,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      let { error: dbErr } = await supabaseAdmin
        .from("question_db")
        .upsert(payloads, { onConflict: "question_id" });

      if (dbErr && dbErr.code === "22001") {
        const clamped = payloads.map((row) => ({
          ...row,
          taxonomy_id: clampStr(row.taxonomy_id, 20, null),
          thk_taxonomy_id: clampStr(row.thk_taxonomy_id, 20, null),
        }));
        const retry = await supabaseAdmin
          .from("question_db")
          .upsert(clamped, { onConflict: "question_id" });
        dbErr = retry.error;
      }

      if (dbErr) {
        return apiFail(`question_db 저장 실패: ${dbErr.message}`, 500);
      }

      try {
        const { data: tb } = await supabaseAdmin
          .from("textbook")
          .select("book_id")
          .eq("title", bookName)
          .maybeSingle();
        if (tb?.book_id) {
          const tqRows = payloads.map((q) => ({
            book_id: tb.book_id,
            question_id: q.question_id,
            page_number: q.detected_page_num,
            question_number: q.question_number,
            question: q.question,
            answer: q.answer,
            taxonomy_id: q.taxonomy_id,
            taxonomy_name: q.taxonomy_name,
            thk_taxonomy_id: q.thk_taxonomy_id,
            thk_taxonomy_name: q.thk_taxonomy_name,
            question_category: "일반",
          }));
          await supabaseAdmin.from("textbook_question").insert(tqRows);
        }
      } catch {
        // 선택 매핑 실패 무시
      }

      invalidateEditorialServerCache();

      return NextResponse.json({
        success: true,
        data: {
          savedCount: payloads.length,
          bookName,
          imageUrl: sharedImageUrl,
          savedIds: payloads.map((p) => p.question_id),
        },
      });
    }

    return apiFail(`지원하지 않는 POST action입니다: ${action}`, 400);
  } catch (err: unknown) {
    console.error("[POST /api/hq/editorial] 오류:", err);
    const msg = err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.";
    return apiFail(msg, 500);
  }
}
