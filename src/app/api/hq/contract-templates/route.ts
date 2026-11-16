// src/app/api/hq/contract-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import { SETTINGS_STORAGE_BUCKET } from "@/lib/hq/companySettingsServer";
import { DEFAULT_SEEDED_CONTRACT_TEMPLATES } from "@/lib/hq/contractTemplateEngine";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqContractCategory,
  HqContractCustomField,
  HqContractTemplateItem,
} from "@/lib/hq/types";

export const runtime = "nodejs";

const CONTRACT_TEMPLATES_PATH = "hq_system_config/contract_templates.json";

interface StoredContractTemplatesPayload {
  categories: string[];
  customFields: HqContractCustomField[];
  templates: HqContractTemplateItem[];
  reflectedContractIds: string[];
}

const DEFAULT_PAYLOAD: StoredContractTemplatesPayload = {
  categories: ["자동계약서", "인사·서약서", "출판·외주 계약서"],
  customFields: [
    { id: "cf-pages", label: "원고매수", token: "{{원고매수}}", default_value: "200쪽" },
    { id: "cf-print-run", label: "초판발행부수", token: "{{초판발행부수}}", default_value: "2,000부" },
  ],
  templates: DEFAULT_SEEDED_CONTRACT_TEMPLATES,
  reflectedContractIds: [],
};

async function readTemplatesPayload(
  supabaseAdmin: SupabaseClient
): Promise<StoredContractTemplatesPayload> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .download(CONTRACT_TEMPLATES_PATH);
    if (error || !blob) return DEFAULT_PAYLOAD;
    const parsed = JSON.parse(await blob.text());
    return {
      categories:
        Array.isArray(parsed?.categories) && parsed.categories.length > 0
          ? parsed.categories
          : DEFAULT_PAYLOAD.categories,
      customFields: Array.isArray(parsed?.customFields)
        ? parsed.customFields
        : DEFAULT_PAYLOAD.customFields,
      templates:
        Array.isArray(parsed?.templates) && parsed.templates.length > 0
          ? parsed.templates
          : DEFAULT_PAYLOAD.templates,
      reflectedContractIds: Array.isArray(parsed?.reflectedContractIds)
        ? parsed.reflectedContractIds
        : [],
    };
  } catch {
    return DEFAULT_PAYLOAD;
  }
}

async function writeTemplatesPayload(
  supabaseAdmin: SupabaseClient,
  payload: StoredContractTemplatesPayload
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  await supabaseAdmin.storage
    .from(SETTINGS_STORAGE_BUCKET)
    .upload(CONTRACT_TEMPLATES_PATH, bytes, {
      contentType: "application/json",
      upsert: true,
    });
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readTemplatesPayload(supabaseAdmin);

    return NextResponse.json({
      success: true,
      data: {
        canManage:
          caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3,
        categories: payload.categories,
        customFields: payload.customFields,
        templates: payload.templates,
        reflectedContractIds: payload.reflectedContractIds,
      },
    });
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const canManage =
      caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3;
    if (!canManage) {
      return apiFail(
        "전자계약 서식 관리는 팀장급 이상 또는 인사관리자만 가능합니다.",
        403
      );
    }

    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readTemplatesPayload(supabaseAdmin);
    const nowIso = new Date().toISOString();

    if (action === "SAVE_TEMPLATE") {
      const id = String(body?.id || "").trim();
      const name = String(body?.name || "").trim();
      const description = String(body?.description || "").trim();
      const categoryName =
        String(body?.category_name || "").trim() || "자동계약서";
      const mappedCategory = (body?.mapped_category ||
        "LABOR") as HqContractCategory;
      const bodyText = String(body?.body_text || "").trim();
      const tags: string[] = Array.isArray(body?.tags)
        ? body.tags.map((t: any) => String(t).trim()).filter(Boolean)
        : [];

      if (!name || !bodyText) {
        return apiFail("서식 이름과 서식 본문 내용을 모두 입력해 주세요.");
      }

      if (!payload.categories.includes(categoryName)) {
        payload.categories.push(categoryName);
      }

      if (id) {
        const idx = payload.templates.findIndex((t) => t.id === id);
        if (idx === -1) return apiFail("수정할 서식을 찾을 수 없습니다.", 404);
        payload.templates[idx] = {
          ...payload.templates[idx],
          name,
          description,
          category_name: categoryName,
          mapped_category: mappedCategory,
          tags,
          body_text: bodyText,
          updated_by: caller.name,
          updated_at: nowIso,
        };
      } else {
        const created: HqContractTemplateItem = {
          id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          description,
          category_name: categoryName,
          mapped_category: mappedCategory,
          tags,
          body_text: bodyText,
          is_archived: false,
          updated_by: caller.name,
          updated_at: nowIso,
          created_at: nowIso,
        };
        payload.templates.unshift(created);
      }

      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: {
          categories: payload.categories,
          templates: payload.templates,
        },
      });
    }

    if (action === "ARCHIVE_TEMPLATE" || action === "RESTORE_TEMPLATE") {
      const id = String(body?.id || "").trim();
      const nextArchived = action === "ARCHIVE_TEMPLATE";
      payload.templates = payload.templates.map((t) =>
        t.id === id
          ? {
              ...t,
              is_archived: nextArchived,
              updated_by: caller.name,
              updated_at: nowIso,
            }
          : t
      );
      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { templates: payload.templates },
      });
    }

    if (action === "DUPLICATE_TEMPLATE") {
      const id = String(body?.id || "").trim();
      const src = payload.templates.find((t) => t.id === id);
      if (!src) return apiFail("복제할 서식을 찾을 수 없습니다.", 404);
      const dup: HqContractTemplateItem = {
        ...src,
        id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: `${src.name} (사본)`,
        is_archived: false,
        is_system_seed: false,
        updated_by: caller.name,
        updated_at: nowIso,
        created_at: nowIso,
      };
      payload.templates.unshift(dup);
      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { templates: payload.templates },
      });
    }

    if (action === "DELETE_TEMPLATE") {
      const id = String(body?.id || "").trim();
      payload.templates = payload.templates.filter((t) => t.id !== id);
      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { templates: payload.templates },
      });
    }

    if (action === "ADD_CATEGORY") {
      const name = String(body?.name || "").trim();
      if (!name) return apiFail("카테고리 이름을 입력해 주세요.");
      if (!payload.categories.includes(name)) {
        payload.categories.push(name);
        await writeTemplatesPayload(supabaseAdmin, payload);
      }
      return NextResponse.json({
        success: true,
        data: { categories: payload.categories },
      });
    }

    if (action === "DELETE_CATEGORY") {
      const name = String(body?.name || "").trim();
      payload.categories = payload.categories.filter((c) => c !== name);
      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { categories: payload.categories },
      });
    }

    if (action === "ADD_CUSTOM_FIELD") {
      const label = String(body?.label || "").trim();
      const defaultValue = String(body?.default_value || "").trim();
      if (!label) return apiFail("커스텀 필드 이름을 입력해 주세요.");
      const cleanLabel = label.replace(/[{}]/g, "");
      const token = `{{${cleanLabel}}}`;
      if (!payload.customFields.some((f) => f.token === token)) {
        payload.customFields.push({
          id: `cf-${Date.now()}`,
          label: cleanLabel,
          token,
          default_value: defaultValue,
        });
        await writeTemplatesPayload(supabaseAdmin, payload);
      }
      return NextResponse.json({
        success: true,
        data: { customFields: payload.customFields },
      });
    }

    if (action === "DELETE_CUSTOM_FIELD") {
      const id = String(body?.id || "").trim();
      payload.customFields = payload.customFields.filter((f) => f.id !== id);
      await writeTemplatesPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { customFields: payload.customFields },
      });
    }

    // 체결 완료된 근로/연봉계약 조건을 구성원 인사·임금 프로필에 원클릭 반영
    if (action === "REFLECT_TO_MEMBER_PROFILE") {
      if (!caller.isHrManager && !caller.isHqAdmin) {
        return apiFail(
          "구성원 인사·임금 정보 반영은 인사관리자만 실행할 수 있습니다.",
          403
        );
      }
      const contractId = String(body?.contract_id || "").trim();
      const memberId = String(body?.member_id || "").trim();
      const memberName = String(body?.member_name || "").trim();
      const category = String(body?.category || "SALARY");
      const contractAmount = Math.max(0, Math.round(Number(body?.contract_amount || 0)));
      const startDate = String(body?.start_date || "").trim();
      const endDate = String(body?.end_date || "").trim();

      if (!contractId || !memberId) {
        return apiFail("계약 ID와 대상 구성원 정보가 필요합니다.");
      }

      const { data: prof } = await supabaseAdmin
        .from("hq_member_profile")
        .select("profile_extra")
        .eq("instructor_id", memberId)
        .maybeSingle();

      const prevExtra =
        prof?.profile_extra && typeof prof.profile_extra === "object"
          ? prof.profile_extra
          : {};

      const nextExtra = { ...prevExtra };
      if (category === "SALARY" || contractAmount > 0) {
        nextExtra.wage_contract = {
          ...(prevExtra.wage_contract || {}),
          wage_type: "연봉제 (포괄임금)",
          annual_salary: contractAmount,
          monthly_base: Math.round(contractAmount / 12),
          effective_date: startDate || nowIso.slice(0, 10),
        };
      }
      if (category === "LABOR") {
        nextExtra.labor_contract = {
          ...(prevExtra.labor_contract || {}),
          contract_type: "정규직",
          start_date: startDate || prevExtra.labor_contract?.start_date || "",
          end_date: endDate || prevExtra.labor_contract?.end_date || "",
        };
      }

      const prevLogs = Array.isArray(prevExtra.change_logs)
        ? prevExtra.change_logs
        : [];
      nextExtra.change_logs = [
        {
          at: nowIso,
          actor_name: caller.name,
          summary: `전자계약(${category === "SALARY" ? "연봉계약" : "근로계약"}) 체결 정보 프로필 반영`,
        },
        ...prevLogs,
      ].slice(0, 30);

      await supabaseAdmin.from("hq_member_profile").upsert(
        {
          instructor_id: memberId,
          profile_extra: nextExtra,
          updated_at: nowIso,
        },
        { onConflict: "instructor_id" }
      );

      if (!payload.reflectedContractIds.includes(contractId)) {
        payload.reflectedContractIds.push(contractId);
        await writeTemplatesPayload(supabaseAdmin, payload);
      }

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "수정",
        info_type: "근로소득",
        description: `${memberName} 전자계약 체결 내역 인사·임금 프로필 반영`,
        delegated: caller.isDelegatedHrAdmin,
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { reflectedContractIds: payload.reflectedContractIds },
      });
    }

    return apiFail("지원하지 않는 서식 관리 요청입니다.");
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}
