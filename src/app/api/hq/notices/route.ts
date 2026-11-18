// src/app/api/hq/notices/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import { readHqKvPayload, writeHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqNoticeItem } from "@/lib/hq/types";

export const runtime = "nodejs";

const NOTICES_SETTING_KEY = "HQ_NOTICES";
const NOTICES_STORAGE_PATH = "hq_system_config/notices.json";

interface StoredNoticesPayload {
  categories: string[];
  notices: HqNoticeItem[];
}

const DEFAULT_NOTICES_DATA: StoredNoticesPayload = {
  categories: ["공지사항", "인사 · 복리후생", "출판 · 편집", "전사 안내"],
  notices: [
    {
      id: "notice-seed-20201202",
      category: "공지사항",
      title: "제목 없는 공지",
      content: [
        "1. 비용 처리",
        "1)일반적인 비용: 교재 인쇄,소모품,커피,택배 외 기타 빈번하고 일상적인 비용 등은 사전 품의없이 사후지출품의서만 작성",
        "워크플로우-> 1.지출품의서(사후)",
        "",
        "2)일반적이지 않은 비용",
        "워크플로우->1.지출품의서(사전) : 예산포함 내용 자세히 기재후 승인 여부 확인하기",
        "",
        "지출품의서(사전) 승인완료되면",
        "워크플로우->1.지출품의서(사후) 승인요청",
        "",
        "",
        "2.연차사용",
        "워크플로우->2.연차 사용 계획 작성 -> 근무.휴가 -> 오른쪽 상단 '휴가사용'->연차 작성 승인요청",
      ].join("\n"),
      author_name: "천종현",
      target_scope: "ALL",
      target_label: "이현아 외 6명",
      status: "PUBLISHED",
      scheduled_at: null,
      expires_at: null,
      is_pinned: false,
      reactions: {},
      comments: [],
      created_at: "2020-12-02T04:57:00+09:00",
      updated_at: "2020-12-02T04:57:00+09:00",
    },
  ],
};

function cloneDefaultNoticesData(): StoredNoticesPayload {
  return {
    categories: [...DEFAULT_NOTICES_DATA.categories],
    notices: DEFAULT_NOTICES_DATA.notices.map((n) => ({
      ...n,
      reactions: { ...(n.reactions || {}) },
      comments: [...(n.comments || [])],
    })),
  };
}

async function readNoticesPayload(
  supabaseAdmin: SupabaseClient
): Promise<StoredNoticesPayload> {
  try {
    const parsed = await readHqKvPayload<Partial<StoredNoticesPayload>>(
      supabaseAdmin,
      NOTICES_SETTING_KEY,
      NOTICES_STORAGE_PATH
    );
    if (!parsed) return cloneDefaultNoticesData();
    const categories =
      Array.isArray(parsed.categories) && parsed.categories.length > 0
        ? parsed.categories
        : [...DEFAULT_NOTICES_DATA.categories];
    const notices = Array.isArray(parsed.notices)
      ? parsed.notices
      : cloneDefaultNoticesData().notices;
    return { categories, notices };
  } catch {
    return cloneDefaultNoticesData();
  }
}

async function writeNoticesPayload(
  supabaseAdmin: SupabaseClient,
  payload: StoredNoticesPayload
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    NOTICES_SETTING_KEY,
    payload,
    NOTICES_STORAGE_PATH
  );
}

function refreshScheduledAndExpiredStatuses(
  notices: HqNoticeItem[]
): { updated: boolean; list: HqNoticeItem[] } {
  const nowMs = Date.now();
  let updated = false;
  const list = notices.map((n) => {
    let nextStatus = n.status;
    if (
      nextStatus === "SCHEDULED" &&
      n.scheduled_at &&
      new Date(n.scheduled_at).getTime() <= nowMs
    ) {
      nextStatus = "PUBLISHED";
    }
    if (
      nextStatus === "PUBLISHED" &&
      n.expires_at &&
      new Date(n.expires_at).getTime() < nowMs
    ) {
      nextStatus = "EXPIRED";
    }
    if (nextStatus !== n.status) {
      updated = true;
      return { ...n, status: nextStatus };
    }
    return n;
  });
  return { updated, list };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readNoticesPayload(supabaseAdmin);
    const synced = refreshScheduledAndExpiredStatuses(payload.notices);
    if (synced.updated) {
      payload.notices = synced.list;
      await writeNoticesPayload(supabaseAdmin, payload).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      data: {
        canManage: caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3,
        categories: payload.categories,
        notices: payload.notices,
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
    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readNoticesPayload(supabaseAdmin);
    const nowIso = new Date().toISOString();

    // 1) 이모지 리액션 토글 (전 구성원 가능)
    if (action === "TOGGLE_REACTION") {
      const noticeId = String(body?.notice_id || "");
      const emoji = String(body?.emoji || "👍");
      payload.notices = payload.notices.map((n) => {
        if (n.id !== noticeId) return n;
        const curList = Array.isArray(n.reactions?.[emoji])
          ? n.reactions[emoji]
          : [];
        const exists = curList.includes(caller.name);
        const nextList = exists
          ? curList.filter((nm) => nm !== caller.name)
          : [...curList, caller.name];
        const nextReactions = { ...(n.reactions || {}) };
        if (nextList.length === 0) delete nextReactions[emoji];
        else nextReactions[emoji] = nextList;
        return { ...n, reactions: nextReactions };
      });
      await writeNoticesPayload(supabaseAdmin, payload);
      return NextResponse.json({ success: true, data: payload });
    }

    // 2) 댓글 등록 (전 구성원 가능)
    if (action === "ADD_COMMENT") {
      const noticeId = String(body?.notice_id || "");
      const content = String(body?.content || "").trim();
      if (!content) return apiFail("댓글 내용을 입력해주세요.");

      payload.notices = payload.notices.map((n) => {
        if (n.id !== noticeId) return n;
        return {
          ...n,
          comments: [
            ...(n.comments || []),
            {
              id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              author_id: caller.userId,
              author_name: caller.name,
              content,
              created_at: nowIso,
            },
          ],
        };
      });
      await writeNoticesPayload(supabaseAdmin, payload);
      return NextResponse.json({ success: true, data: payload });
    }

    // 3) 댓글 삭제 (본인 또는 관리자)
    if (action === "DELETE_COMMENT") {
      const noticeId = String(body?.notice_id || "");
      const commentId = String(body?.comment_id || "");
      payload.notices = payload.notices.map((n) => {
        if (n.id !== noticeId) return n;
        return {
          ...n,
          comments: (n.comments || []).filter((c) => {
            if (c.id !== commentId) return true;
            if (canManage || c.author_name === caller.name) return false;
            return true;
          }),
        };
      });
      await writeNoticesPayload(supabaseAdmin, payload);
      return NextResponse.json({ success: true, data: payload });
    }

    if (!canManage) {
      return apiFail(
        "공지 작성·수정·설정은 팀장급 이상 또는 인사·최고관리자만 가능합니다.",
        403
      );
    }

    // 4) 공지 카테고리 설정 저장
    if (action === "SAVE_CATEGORIES") {
      const cats = Array.isArray(body?.categories)
        ? body.categories.map((c: any) => String(c).trim()).filter(Boolean)
        : [];
      if (cats.length === 0) return apiFail("최소 1개 이상의 카테고리가 필요합니다.");
      payload.categories = cats;
      await writeNoticesPayload(supabaseAdmin, payload);
      return NextResponse.json({ success: true, data: payload });
    }

    // 5) 공지 신규 등록 / 수정
    if (action === "UPSERT") {
      const incoming = body?.notice || {};
      const title = String(incoming.title || "").trim() || "제목 없는 공지";
      const content = String(incoming.content || "");
      const category =
        String(incoming.category || "").trim() || payload.categories[0] || "공지사항";
      const targetScope = incoming.target_scope === "DEPT" ? "DEPT" : "ALL";
      const targetDepts = Array.isArray(incoming.target_departments)
        ? incoming.target_departments
        : [];
      const targetLabel =
        String(incoming.target_label || "").trim() ||
        (targetScope === "DEPT" && targetDepts.length > 0
          ? targetDepts.join(", ")
          : "전사 구성원");

      const scheduledAt = incoming.scheduled_at || null;
      const expiresAt = incoming.expires_at || null;
      let status: HqNoticeItem["status"] = incoming.status || "PUBLISHED";
      if (
        scheduledAt &&
        new Date(scheduledAt).getTime() > Date.now() &&
        status !== "HIDDEN"
      ) {
        status = "SCHEDULED";
      }

      if (incoming.id) {
        payload.notices = payload.notices.map((n) =>
          n.id === incoming.id
            ? {
                ...n,
                category,
                title,
                content,
                target_scope: targetScope,
                target_departments: targetDepts,
                target_label: targetLabel,
                status,
                scheduled_at: scheduledAt,
                expires_at: expiresAt,
                is_pinned: Boolean(incoming.is_pinned),
                updated_at: nowIso,
              }
            : n
        );
      } else {
        const created: HqNoticeItem = {
          id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          category,
          title,
          content,
          author_id: caller.userId,
          author_name: caller.name,
          target_scope: targetScope,
          target_departments: targetDepts,
          target_label: targetLabel,
          status,
          scheduled_at: scheduledAt,
          expires_at: expiresAt,
          is_pinned: Boolean(incoming.is_pinned),
          reactions: {},
          comments: [],
          created_at: scheduledAt || nowIso,
          updated_at: nowIso,
        };
        payload.notices = [created, ...payload.notices];
      }

      await writeNoticesPayload(supabaseAdmin, payload);
      appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "권한 변경",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: incoming.id ? "수정" : "생성",
        info_type: "인사정보",
        description: `사내 공지 ${incoming.id ? "수정" : "등록"}: ${title}`,
      }).catch(() => {});

      return NextResponse.json({ success: true, data: payload });
    }

    // 6) 상태 일괄 변경 / 삭제
    if (action === "BULK_ACTION") {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
      const subAction = String(body?.sub_action || "");
      if (subAction === "DELETE") {
        payload.notices = payload.notices.filter((n) => !ids.includes(n.id));
      } else if (subAction === "HIDE") {
        payload.notices = payload.notices.map((n) =>
          ids.includes(n.id) ? { ...n, status: "HIDDEN", updated_at: nowIso } : n
        );
      } else if (subAction === "PUBLISH") {
        payload.notices = payload.notices.map((n) =>
          ids.includes(n.id)
            ? { ...n, status: "PUBLISHED", updated_at: nowIso }
            : n
        );
      } else if (subAction === "PIN_TOGGLE") {
        payload.notices = payload.notices.map((n) =>
          ids.includes(n.id) ? { ...n, is_pinned: !n.is_pinned } : n
        );
      }
      await writeNoticesPayload(supabaseAdmin, payload);
      return NextResponse.json({ success: true, data: payload });
    }

    return apiFail("알 수 없는 공지 요청입니다.");
  } catch (e: any) {
    console.error("HQ notices POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}