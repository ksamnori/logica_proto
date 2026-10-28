// src/app/actions/examActions.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 🌟 [핵심 변경] JWT 해독 대신, 방금 로그인 창에서 구운 직관적인 쿠키를 읽어옵니다.
async function getTenantId() {
  const cookieStore = await cookies();
  return cookieStore.get("logica_tenant_id")?.value;
}

function parseGradeFromCodeOrText(taxIdRaw: string, fallbackText: string = ""): string {
  const taxId = String(taxIdRaw || "").trim().toUpperCase();
  if (taxId.length >= 3) {
    const schoolType = taxId[0];
    const grade = taxId[1];
    const semester = taxId[2];
    let schoolName = "";
    if (schoolType === "E") schoolName = "초등";
    else if (schoolType === "M") schoolName = "중등";
    else if (schoolType === "H") schoolName = "고등";
    if (schoolName && !isNaN(Number(grade)) && !isNaN(Number(semester))) {
      return `${schoolName} ${grade}-${semester}`;
    }
  }
  const s = String(fallbackText || "");
  const mMid = s.match(/중(?:등)?\s*([1-3]-[1-2])/);
  if (mMid) return `중등 ${mMid[1]}`;
  const mMidCompact = s.match(/중(?:등)?\s*([1-3])([1-2])(?:[^0-9]|$)/);
  if (mMidCompact) return `중등 ${mMidCompact[1]}-${mMidCompact[2]}`;
  const mMid7 = s.match(/(?:^|[^0-9])7-([1-2])(?:[^0-9]|$)/);
  if (mMid7) return `중등 1-${mMid7[1]}`;
  const mElem = s.match(/(?:초(?:등)?\s*)?([1-6]-[1-2])/);
  if (mElem) return `초등 ${mElem[1]}`;
  const mLevelCompact = s.match(/(?:^|[^0-9A-Za-z])(?:[UMATHumath]|초(?:등)?)\s*([1-6])([1-2])(?:[^0-9]|$)/);
  if (mLevelCompact) return `초등 ${mLevelCompact[1]}-${mLevelCompact[2]}`;
  return "";
}

export async function getExamsAction() {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "소속 지점 정보(쿠키)가 없어 문제지를 불러올 수 없습니다.", data: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("exam_master")
      .select("*, exam_assignment(assignment_id), instructor(name)")
      .eq('tenant_id', tenantId) // 🌟 [절대 방어막] 내 지점 시험지만 가져옵니다.
      .order("created_at", { ascending: false });

    if (error) throw error;
    const exams = data || [];

    // 🌟 기존 시험지 중 major_grade가 비어 있거나("공통 과정") scope_start가 비어 있는("분류 없음") 시험지들을
    // 문항들의 taxonomy_id 순서(제일 앞 depth6 ~ 제일 뒤 depth6) 및 주요 학년·학기로 자동 계산 및 DB 백필!
    const needsEnrichExams = exams.filter(
      (e: any) =>
        !e.major_grade ||
        e.major_grade === "공통 과정" ||
        !e.scope_start ||
        e.scope_start === "분류 없음" ||
        e.scope_start === "유형 분류 없음" ||
        e.scope_start === "전 범위"
    );

    if (needsEnrichExams.length > 0) {
      try {
        const targetExamIds = needsEnrichExams.map((e: any) => e.exam_id).filter(Boolean);
        let allExamItems: any[] = [];
        for (let i = 0; i < targetExamIds.length; i += 100) {
          const chunk = targetExamIds.slice(i, i + 100);
          const { data: eItems } = await supabaseAdmin
            .from("exam_item")
            .select("exam_id, question_id, sort_order, question_db(taxonomy_id, item_id, taxonomy_name, pdf_source, source_book_name, book_name)")
            .in("exam_id", chunk);
          if (eItems) allExamItems = allExamItems.concat(eItems);
        }

        const rawTaxIdsSet = new Set<string>();
        allExamItems.forEach((it: any) => {
          const q = Array.isArray(it.question_db) ? it.question_db[0] : it.question_db;
          if (!q) return;
          const tid = String(q.taxonomy_id || q.item_id || "").trim().toUpperCase();
          if (tid && tid !== "NULL" && tid !== "UNDEFINED" && tid !== "미분류") {
            rawTaxIdsSet.add(tid);
          }
        });

        const rawTaxIds = Array.from(rawTaxIdsSet);
        const catIdByTaxId = new Map<string, string>();
        const catIdsToFetch = new Set<string>();

        for (let i = 0; i < rawTaxIds.length; i += 150) {
          const chunk = rawTaxIds.slice(i, i + 150);
          const { data: mItems } = await supabaseAdmin
            .from("master_item")
            .select("item_id, category_id")
            .in("item_id", chunk);
          if (mItems) {
            mItems.forEach((row: any) => {
              const iId = String(row.item_id || "").trim().toUpperCase();
              if (row.category_id) {
                const cId = String(row.category_id || "").trim().toUpperCase();
                catIdByTaxId.set(iId, cId);
                catIdsToFetch.add(cId);
              }
            });
          }
          chunk.forEach((tid) => {
            if (!catIdByTaxId.has(tid)) {
              const parts = tid.split("-");
              if (parts.length >= 6) {
                const parentCat = parts.slice(0, -1).join("-");
                catIdByTaxId.set(tid, parentCat);
                catIdsToFetch.add(parentCat);
              }
              catIdsToFetch.add(tid);
            }
          });
        }

        const catIdsArr = Array.from(catIdsToFetch);
        const catMap = new Map<string, any>();
        for (let i = 0; i < catIdsArr.length; i += 150) {
          const chunk = catIdsArr.slice(i, i + 150);
          const { data: mCats } = await supabaseAdmin
            .from("master_category")
            .select("category_id, depth2, depth3, depth5, depth6")
            .in("category_id", chunk);
          if (mCats) {
            mCats.forEach((c: any) => {
              catMap.set(String(c.category_id || "").trim().toUpperCase(), c);
            });
          }
        }

        const itemsByExamId = new Map<string, any[]>();
        allExamItems.forEach((it: any) => {
          const eid = String(it.exam_id);
          if (!itemsByExamId.has(eid)) itemsByExamId.set(eid, []);
          itemsByExamId.get(eid)!.push(it);
        });

        const dbUpdates: Promise<any>[] = [];

        needsEnrichExams.forEach((exam: any) => {
          const eid = String(exam.exam_id);
          const eItems = itemsByExamId.get(eid) || [];
          const qRows = eItems
            .map((it: any) => (Array.isArray(it.question_db) ? it.question_db[0] : it.question_db))
            .filter(Boolean);

          const gradeCount: Record<string, number> = {};
          const taxWithD6: { taxKey: string; d6: string }[] = [];

          qRows.forEach((q: any) => {
            const tid = String(q.taxonomy_id || q.item_id || "").trim().toUpperCase();
            const cId = (tid && catIdByTaxId.get(tid)) || tid;
            const cat = (cId && catMap.get(cId)) || (tid && catMap.get(tid)) || null;

            let gStr = parseGradeFromCodeOrText(
              tid,
              `${cat?.depth2 || ""} ${cat?.depth3 || ""} ${q.taxonomy_name || ""} ${q.source_book_name || ""} ${q.book_name || ""} ${q.pdf_source || ""}`
            );
            if (gStr) {
              gradeCount[gStr] = (gradeCount[gStr] || 0) + 1;
            }

            let d6 = cat?.depth6 || cat?.depth5 || "";
            if (!d6 && q.taxonomy_name) {
              const parts = String(q.taxonomy_name)
                .split(">")
                .map((p: string) => p.trim())
                .filter(Boolean);
              if (parts.length >= 6) d6 = parts[5];
              else if (parts.length > 0) d6 = parts[parts.length - 1];
            }

            if (d6 && d6 !== "분류 없음" && d6 !== "유형 분류 없음") {
              taxWithD6.push({
                taxKey: tid || String(q.taxonomy_name || ""),
                d6,
              });
            }
          });

          let computedGrade = "";
          let maxCnt = 0;
          for (const [gr, cnt] of Object.entries(gradeCount)) {
            if (cnt > maxCnt) {
              maxCnt = cnt;
              computedGrade = gr;
            }
          }
          if (!computedGrade) {
            computedGrade = parseGradeFromCodeOrText(
              "",
              `${exam.sub_title || ""} ${exam.title || ""} ${exam.target_grade || ""}`
            );
          }

          let computedScopeStart = "";
          let computedScopeEnd = "";
          if (taxWithD6.length > 0) {
            taxWithD6.sort((a, b) => a.taxKey.localeCompare(b.taxKey, "ko", { numeric: true }));
            computedScopeStart = taxWithD6[0].d6;
            computedScopeEnd = taxWithD6[taxWithD6.length - 1].d6;
          }

          const patch: Record<string, any> = {};
          if (computedGrade && (!exam.major_grade || exam.major_grade === "공통 과정")) {
            exam.major_grade = computedGrade;
            patch.major_grade = computedGrade;
          }
          if (
            computedScopeStart &&
            (!exam.scope_start ||
              exam.scope_start === "분류 없음" ||
              exam.scope_start === "유형 분류 없음" ||
              exam.scope_start === "전 범위")
          ) {
            exam.scope_start = computedScopeStart;
            exam.scope_end = computedScopeEnd || computedScopeStart;
            patch.scope_start = exam.scope_start;
            patch.scope_end = exam.scope_end;
          }

          if (Object.keys(patch).length > 0 && dbUpdates.length < 150) {
            dbUpdates.push(
              Promise.resolve(
                supabaseAdmin
                  .from("exam_master")
                  .update(patch)
                  .eq("exam_id", exam.exam_id)
              ).catch(() => {})
            );
          }
        });

        if (dbUpdates.length > 0) {
          await Promise.all(dbUpdates);
        }
      } catch (enrichErr) {
        console.error("문제지 범위/학년 자동 보완 중 경고:", enrichErr);
      }
    }

    return { success: true, data: exams };
  } catch (err: any) {
    console.error("문제지 조회 에러:", err);
    return { success: false, message: "문제지 목록을 불러오지 못했습니다.", data: [] };
  }
}

export async function deleteExamAction(examId: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "삭제 권한이 없습니다." };

  try {
    // 🌟 [보안] 해커가 남의 지점 시험지를 지우는 것을 방지
    const { data: targetExam } = await supabaseAdmin
      .from("exam_master")
      .select("exam_id")
      .eq("exam_id", examId)
      .eq("tenant_id", tenantId) // 👈 내 지점 시험지가 맞는지 먼저 검증!
      .maybeSingle();

    if (!targetExam) return { success: false, message: "삭제 권한이 없거나 존재하지 않는 문제지입니다." };

    const { data: assignments, error: checkError } = await supabaseAdmin
      .from("exam_assignment")
      .select("assignment_id")
      .eq("exam_id", examId);

    if (checkError) throw checkError;
    if (assignments && assignments.length > 0) {
      return { success: false, message: "🚨 이 문제지는 아직 학생에게 출제된 기록이 남아있어 삭제할 수 없습니다." };
    }

    await supabaseAdmin.from("exam_item").delete().eq("exam_id", examId);
    await supabaseAdmin.from("exam_master").delete().eq("exam_id", examId);

    return { success: true, message: "✅ 문제지가 성공적으로 삭제되었습니다." };
  } catch (err: any) {
    console.error("문제지 삭제 에러:", err);
    return { success: false, message: "서버 통신 중 오류가 발생하여 삭제하지 못했습니다." };
  }
}
