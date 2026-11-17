// src/app/api/hq/workflows/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readCompanySettingsServer } from "@/lib/hq/companySettingsServer";
import { DEFAULT_APPROVAL_TEMPLATES } from "@/lib/hq/defaultApprovalPolicies";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqWorkflowFormDef,
  HqWorkflowSavedView,
} from "@/lib/hq/types";
import {
  readWorkflowFormsPayload,
  readWorkflowMetaPayload,
  syncWorkflowFormsToCompanySettings,
  writeWorkflowFormsPayload,
  writeWorkflowMetaPayload,
} from "@/lib/hq/workflowStorageServer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const [formsPayload, metaPayload, { settings }] = await Promise.all([
      readWorkflowFormsPayload(supabaseAdmin),
      readWorkflowMetaPayload(supabaseAdmin),
      readCompanySettingsServer(supabaseAdmin),
    ]);

    const templates =
      settings.extra_settings?.approval_templates &&
      settings.extra_settings.approval_templates.length > 0
        ? settings.extra_settings.approval_templates
        : DEFAULT_APPROVAL_TEMPLATES;

    const canManageForms =
      caller.isHqAdmin || caller.isHrManager || caller.rankLevel >= 4;
    const canManageCompanyArchive =
      caller.isHqAdmin || caller.isHrManager || caller.rankLevel >= 4;

    return NextResponse.json({
      success: true,
      data: {
        categories: formsPayload.categories,
        forms: formsPayload.forms,
        starredDocIds: metaPayload.starredByUser[caller.userId] || [],
        savedViews: metaPayload.savedViewsByUser[caller.userId] || [],
        approvalTemplates: templates,
        canManageForms,
        canManageCompanyArchive,
      },
    });
  } catch (e: any) {
    console.error("HQ workflows GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const actorLabel = `${caller.name} (${caller.jobTitle})`;

    const canManageForms =
      caller.isHqAdmin || caller.isHrManager || caller.rankLevel >= 4;

    // 1) 개인 즐겨찾기(중요 ★) 토글
    if (action === "TOGGLE_STAR") {
      const approvalId = String(body?.approval_id || "").trim();
      if (!approvalId) return apiFail("문서 ID가 없습니다.");
      const meta = await readWorkflowMetaPayload(supabaseAdmin);
      const prev = new Set(meta.starredByUser[caller.userId] || []);
      if (prev.has(approvalId)) prev.delete(approvalId);
      else prev.add(approvalId);
      meta.starredByUser[caller.userId] = Array.from(prev);
      await writeWorkflowMetaPayload(supabaseAdmin, meta);
      return NextResponse.json({
        success: true,
        data: { starredDocIds: meta.starredByUser[caller.userId] },
      });
    }

    // 2) 보기 저장 / 삭제
    if (action === "SAVE_VIEW") {
      const view = body?.view as HqWorkflowSavedView | undefined;
      if (!view || !String(view.name || "").trim()) {
        return apiFail("저장할 보기 이름을 입력해 주세요.");
      }
      const meta = await readWorkflowMetaPayload(supabaseAdmin);
      const curList = meta.savedViewsByUser[caller.userId] || [];
      const newView: HqWorkflowSavedView = {
        ...view,
        id: view.id || `vw-${Date.now()}`,
        name: String(view.name).trim(),
      };
      const idx = curList.findIndex((v) => v.id === newView.id);
      if (idx >= 0) curList[idx] = newView;
      else curList.push(newView);
      meta.savedViewsByUser[caller.userId] = curList;
      await writeWorkflowMetaPayload(supabaseAdmin, meta);
      return NextResponse.json({
        success: true,
        data: { savedViews: curList },
      });
    }

    if (action === "DELETE_VIEW") {
      const viewId = String(body?.view_id || "").trim();
      const meta = await readWorkflowMetaPayload(supabaseAdmin);
      const nextList = (meta.savedViewsByUser[caller.userId] || []).filter(
        (v) => v.id !== viewId
      );
      meta.savedViewsByUser[caller.userId] = nextList;
      await writeWorkflowMetaPayload(supabaseAdmin, meta);
      return NextResponse.json({
        success: true,
        data: { savedViews: nextList },
      });
    }

    // 3) 문서 의견/코멘트 스레드 등록 (기안자·결재자·참조자 소통)
    if (action === "ADD_COMMENT") {
      const approvalId = String(body?.approval_id || "").trim();
      const content = String(body?.content || "").trim();
      if (!approvalId || !content) {
        return apiFail("의견 내용을 입력해 주세요.");
      }
      const meta = await readWorkflowMetaPayload(supabaseAdmin);
      const existing = meta.docMetaById[approvalId] || {
        approval_id: approvalId,
        form_id: null,
        form_title: "",
        form_icon: "📋",
        cc_member_ids: [],
        cc_member_names: [],
        field_values: {},
        attachments: [],
        comments: [],
      };
      existing.comments = [
        ...(existing.comments || []),
        {
          id: `cmt-${Date.now()}`,
          author_id: caller.userId,
          author_name: caller.name,
          author_dept: caller.department || "본부",
          content,
          created_at: nowIso,
        },
      ];
      meta.docMetaById[approvalId] = existing;
      await writeWorkflowMetaPayload(supabaseAdmin, meta);
      return NextResponse.json({
        success: true,
        data: { docMeta: existing },
      });
    }

    // 양식 관리(추가·수정·복제·삭제·분류수정) 권한 검사
    if (!canManageForms) {
      return apiFail(
        "워크플로우 양식 관리는 인사관리자 또는 임원·최고관리자만 가능합니다.",
        403
      );
    }

    const formsPayload = await readWorkflowFormsPayload(supabaseAdmin);

    if (action === "SAVE_FORM") {
      const incoming = body?.form as Partial<HqWorkflowFormDef> | undefined;
      const title = String(incoming?.title || "").trim();
      if (!title) return apiFail("양식 이름을 입력해 주세요.");

      const formId = String(incoming?.id || `wf-custom-${Date.now()}`).trim();
      const categoryName = String(
        incoming?.category_name || formsPayload.categories[0] || "일반 · 계정"
      ).trim();

      const nextCategories = formsPayload.categories.includes(categoryName)
        ? formsPayload.categories
        : [...formsPayload.categories, categoryName];

      const normalizedForm: HqWorkflowFormDef = {
        id: formId,
        category_name: categoryName,
        title,
        description: String(incoming?.description || "").trim(),
        icon: String(incoming?.icon || "📋").trim() || "📋",
        icon_bg: incoming?.icon_bg || "#f1f5f9",
        mapped_doc_type: (["GENERAL", "LEAVE", "PURCHASE", "EXPENSE"].includes(
          String(incoming?.mapped_doc_type)
        )
          ? incoming?.mapped_doc_type
          : "GENERAL") as HqWorkflowFormDef["mapped_doc_type"],
        fields: Array.isArray(incoming?.fields) ? incoming!.fields : [],
        body_template: String(incoming?.body_template || ""),
        ref_file_url: incoming?.ref_file_url || null,
        ref_file_name: incoming?.ref_file_name || null,
        attachment_mode:
          incoming?.attachment_mode === "NONE" ||
          incoming?.attachment_mode === "REQUIRED"
            ? incoming.attachment_mode
            : "OPTIONAL",
        use_body: incoming?.use_body !== false,
        allow_doc_edit: incoming?.allow_doc_edit !== false,
        is_smart_form: Boolean(incoming?.is_smart_form),
        allow_edit: incoming?.allow_edit !== false,
        per_requester: Boolean(incoming?.per_requester),
        cc_list: Array.isArray(incoming?.cc_list) ? incoming!.cc_list : [],
        steps: Array.isArray(incoming?.steps) ? incoming!.steps : [],
        requester_rules: Array.isArray(incoming?.requester_rules)
          ? incoming!.requester_rules
          : undefined,
        updated_at: nowIso,
      };

      const existingIdx = formsPayload.forms.findIndex((f) => f.id === formId);
      const nextForms = [...formsPayload.forms];
      if (existingIdx >= 0) nextForms[existingIdx] = normalizedForm;
      else nextForms.push(normalizedForm);

      const nextDeleted = (formsPayload.deletedFormIds || []).filter(
        (id) => id !== formId
      );

      await writeWorkflowFormsPayload(supabaseAdmin, {
        categories: nextCategories,
        forms: nextForms,
        deletedFormIds: nextDeleted,
      });
      await syncWorkflowFormsToCompanySettings(
        supabaseAdmin,
        nextForms,
        actorLabel
      );

      return NextResponse.json({
        success: true,
        data: { categories: nextCategories, forms: nextForms, savedForm: normalizedForm },
      });
    }

    if (action === "DUPLICATE_FORM") {
      const sourceId = String(body?.form_id || "").trim();
      const src = formsPayload.forms.find((f) => f.id === sourceId);
      if (!src) return apiFail("복제할 원본 양식을 찾을 수 없습니다.", 404);

      const cloned: HqWorkflowFormDef = {
        ...src,
        id: `wf-copy-${Date.now()}`,
        title: `${src.title} (복사본)`,
        updated_at: nowIso,
      };
      const nextForms = [...formsPayload.forms, cloned];
      await writeWorkflowFormsPayload(supabaseAdmin, {
        ...formsPayload,
        forms: nextForms,
      });
      await syncWorkflowFormsToCompanySettings(
        supabaseAdmin,
        nextForms,
        actorLabel
      );

      return NextResponse.json({
        success: true,
        data: { categories: formsPayload.categories, forms: nextForms },
      });
    }

    if (action === "DELETE_FORM") {
      const targetId = String(body?.form_id || "").trim();
      const nextForms = formsPayload.forms.filter((f) => f.id !== targetId);
      const nextDeleted = Array.from(
        new Set([...(formsPayload.deletedFormIds || []), targetId])
      );
      await writeWorkflowFormsPayload(supabaseAdmin, {
        ...formsPayload,
        forms: nextForms,
        deletedFormIds: nextDeleted,
      });
      await syncWorkflowFormsToCompanySettings(
        supabaseAdmin,
        nextForms,
        actorLabel
      );

      return NextResponse.json({
        success: true,
        data: { categories: formsPayload.categories, forms: nextForms },
      });
    }

    if (action === "SAVE_CATEGORIES") {
      const nextCats: string[] = Array.isArray(body?.categories)
        ? body.categories
            .map((c: any) => String(c || "").trim())
            .filter(Boolean)
        : formsPayload.categories;
      const renameMap: Record<string, string> =
        body?.renameMap && typeof body.renameMap === "object"
          ? body.renameMap
          : {};

      const fallbackCat = nextCats[0] || "일반 · 계정";
      const nextForms = formsPayload.forms.map((f) => {
        const mapped = renameMap[f.category_name] || f.category_name;
        return {
          ...f,
          category_name: nextCats.includes(mapped) ? mapped : fallbackCat,
        };
      });

      await writeWorkflowFormsPayload(supabaseAdmin, {
        ...formsPayload,
        categories: nextCats.length > 0 ? nextCats : [fallbackCat],
        forms: nextForms,
      });

      return NextResponse.json({
        success: true,
        data: {
          categories: nextCats.length > 0 ? nextCats : [fallbackCat],
          forms: nextForms,
        },
      });
    }

    return apiFail("지원하지 않는 요청입니다.");
  } catch (e: any) {
    console.error("HQ workflows POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
