// src/components/hq/messenger/HqMessengerLeftHub.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HqCalendarEventItem } from "@/app/api/hq/calendar/route";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";
import {
  normalizeOrgNodes,
  resolveMemberDisplayPosition,
} from "@/lib/hq/orgTreeHelper";
import type {
  HqAttendanceRecord,
  HqMember,
  HqNoticeItem,
  HqOrgChartNode,
} from "@/lib/hq/types";

interface LeaveLite {
  drafter_id: string;
  leave_type: string | null;
  status: string;
}

interface ExtractedLinkItem {
  messageId: string;
  url: string;
  domain: string;
  senderName: string;
  createdAt: string;
}

interface Props {
  activeRoomId: string | null;
  activeRoomName: string;
  roomType?: string;
  roomMembers: any[];
  messages: any[];
  allInstructors: any[];
  myInstId: string;
  myMember: HqMember | null;
  hqMembers: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  canAccessMenu: (path: string) => boolean;
  pinnedText: string;
  onSavePinnedText: (text: string) => void;
  msgSearchOpen: boolean;
  msgSearchQuery: string;
  msgMatchCount: number;
  onToggleMsgSearch: () => void;
  onChangeMsgSearch: (q: string) => void;
  onQuickStartDirect?: (inst: any) => void;
}

const URL_REGEX = /https?:\/\/[^\s<>"')]+/gi;

function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildOrgBreadcrumb(
  deptName: string,
  orgNodes?: HqOrgChartNode[] | null
): string {
  const clean = (deptName || "").trim();
  if (!clean) return "부서 미지정";
  const nodes = normalizeOrgNodes(orgNodes).filter(
    (n) => !n.is_hidden && n.name !== "퇴직"
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const target = nodes.find((n) => n.name.trim() === clean);
  if (!target) return clean;

  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: HqOrgChartNode | undefined = target;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur.name.trim());
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  // 최상위 '대표'가 단독 루트여서 경로가 '대표 › 사업본부 › 사업부'인 경우 깔끔하게 표시
  if (chain.length > 1 && chain[0] === "대표") {
    return chain.slice(1).join(" › ");
  }
  return chain.join(" › ");
}

function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 shrink-0 ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

export default function HqMessengerLeftHub({
  activeRoomId,
  activeRoomName,
  roomType,
  roomMembers,
  messages,
  allInstructors,
  myInstId,
  myMember,
  hqMembers,
  orgNodes,
  canAccessMenu,
  pinnedText,
  onSavePinnedText,
  msgSearchOpen,
  msgSearchQuery,
  msgMatchCount,
  onToggleMsgSearch,
  onChangeMsgSearch,
  onQuickStartDirect,
}: Props) {
  const router = useRouter();
  const hqHref = useHqHref();

  // 카드별 접기/펼치기 (기본 모두 펼침)
  const [openSec1, setOpenSec1] = useState(true);
  const [openSec2, setOpenSec2] = useState(true);
  const [openSec3, setOpenSec3] = useState(true);

  // 대화방 공지 인라인 편집
  const [editingPin, setEditingPin] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [sec2Tab, setSec2Tab] = useState<"PIN" | "LINKS">("PIN");

  // 실시간 서버 데이터 (오늘 근태/휴가 + 최근 전사 공지 + 본부 주요 일정)
  const [todayAttByInst, setTodayAttByInst] = useState<
    Map<string, HqAttendanceRecord>
  >(new Map());
  const [todayLeaveByInst, setTodayLeaveByInst] = useState<
    Map<string, LeaveLite>
  >(new Map());
  const [recentNotices, setRecentNotices] = useState<HqNoticeItem[]>([]);
  const [upcomingIssues, setUpcomingIssues] = useState<HqCalendarEventItem[]>(
    []
  );
  const [previewNotice, setPreviewNotice] = useState<HqNoticeItem | null>(null);

  useEffect(() => {
    setEditingPin(false);
    setPinDraft(pinnedText);
  }, [activeRoomId, pinnedText]);

  const loadHubContextData = useCallback(async () => {
    const now = new Date();
    const todayYmd = toLocalYmd(now);
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [attRes, noticeRes, calRes] = await Promise.all([
      hqFetch<{
        success: boolean;
        data: {
          records?: HqAttendanceRecord[];
          leaveApprovals?: LeaveLite[];
        };
      }>(`/api/hq/attendance?start_date=${todayYmd}&end_date=${todayYmd}`).catch(
        () => null
      ),
      hqFetch<{
        success: boolean;
        data: { notices?: HqNoticeItem[] };
      }>("/api/hq/notices").catch(() => null),
      hqFetch<{
        success: boolean;
        data: { events?: HqCalendarEventItem[] };
      }>(`/api/hq/calendar?year=${year}&month=${month}`).catch(() => null),
    ]);

    if (attRes?.data) {
      const aMap = new Map<string, HqAttendanceRecord>();
      (attRes.data.records || []).forEach((r) => {
        aMap.set(String(r.instructor_id), r);
      });
      setTodayAttByInst(aMap);

      const lMap = new Map<string, LeaveLite>();
      (attRes.data.leaveApprovals || []).forEach((lv) => {
        if (lv.status === "APPROVED" || !lMap.has(String(lv.drafter_id))) {
          lMap.set(String(lv.drafter_id), lv);
        }
      });
      setTodayLeaveByInst(lMap);
    }

    if (noticeRes?.data?.notices) {
      const published = noticeRes.data.notices
        .filter((n) => n.status === "PUBLISHED")
        .sort((a, b) => {
          if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) {
            return a.is_pinned ? -1 : 1;
          }
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        })
        .slice(0, 4);
      setRecentNotices(published);
    }

    if (calRes?.data?.events) {
      const maxYmd = (() => {
        const d = new Date(now);
        d.setDate(d.getDate() + 14);
        return toLocalYmd(d);
      })();
      const issues = calRes.data.events
        .filter((ev) => {
          if (ev.endDate < todayYmd || ev.startDate > maxYmd) return false;
          if (ev.category === "HOLIDAY" || ev.category === "BIRTHDAY") {
            return ev.startDate === todayYmd;
          }
          // 장기 공구보다는 하판마감/미팅/특강/오늘 연차를 우선 노출
          if (ev.category === "GOOGLE" && /(공구|공동구매)/.test(ev.title)) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          const aPub = a.category === "PUBLISHING" ? 0 : 1;
          const bPub = b.category === "PUBLISHING" ? 0 : 1;
          if (aPub !== bPub) return aPub - bPub;
          return a.startDate.localeCompare(b.startDate);
        })
        .slice(0, 4);
      setUpcomingIssues(issues);
    }
  }, []);

  useEffect(() => {
    loadHubContextData();
  }, [loadHubContextData]);

  const hqMemberById = useMemo(() => {
    const map = new Map<string, HqMember>();
    hqMembers.forEach((m) => {
      if (m.work_status !== "퇴직" && !m.is_ghost) {
        map.set(String(m.instructor_id), m);
      }
    });
    return map;
  }, [hqMembers]);

  const instById = useMemo(() => {
    const map = new Map<string, any>();
    allInstructors.forEach((i: any) => map.set(String(i.instructor_id), i));
    return map;
  }, [allInstructors]);

  // 구성원 1명의 실시간 근무·휴가 상태 해석
  const resolveLiveStatusBadge = useCallback(
    (targetId: string) => {
      const rec = todayAttByInst.get(String(targetId));
      const lv = todayLeaveByInst.get(String(targetId));

      if (
        rec?.status === "LEAVE" ||
        rec?.work_mode === "LEAVE" ||
        (lv && !String(lv.leave_type || "").includes("반차"))
      ) {
        return {
          label: `🌴 ${lv?.leave_type || rec?.location_note || "연차·휴가중"}`,
          cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
          dot: "bg-emerald-500",
          detail: lv?.status !== "APPROVED" && lv ? "결재 진행중" : "종일 휴가",
        };
      }
      if (
        rec?.status === "HALF_LEAVE" ||
        (lv && String(lv.leave_type || "").includes("반차"))
      ) {
        return {
          label: `🌤️ ${lv?.leave_type || "반차"}`,
          cls: "bg-teal-50 text-teal-700 border-teal-200",
          dot: "bg-teal-500",
          detail: rec?.status === "WORKING" ? "현재 근무중" : "반차 일정",
        };
      }
      if (rec?.status === "WORKING") {
        if (rec.work_mode === "REMOTE") {
          return {
            label: "🏠 원격·집필중",
            cls: "bg-sky-50 text-sky-700 border-sky-200",
            dot: "bg-sky-500",
            detail: rec.memo || rec.location_note || "재택 원격근무",
          };
        }
        if (rec.work_mode === "OUTSIDE") {
          return {
            label: "🚗 외근·감리중",
            cls: "bg-amber-50 text-amber-800 border-amber-200",
            dot: "bg-amber-500",
            detail: rec.memo || rec.location_note || "외부 일정",
          };
        }
        const modeLabel =
          ATTENDANCE_MODES[rec.work_mode]?.shortLabel || "본사 근무중";
        return {
          label: `🟢 ${modeLabel === "본사 출근" ? "본사 근무중" : modeLabel}`,
          cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
          dot: "bg-emerald-500",
          detail: rec.memo || rec.location_note || "실시간 근무중",
        };
      }
      if (rec?.status === "DONE") {
        return {
          label: "⏰ 퇴근 완료",
          cls: "bg-slate-100 text-slate-600 border-slate-200",
          dot: "bg-slate-400",
          detail: rec.memo || "금일 근무 종료",
        };
      }

      const hm = hqMemberById.get(String(targetId));
      if (!hm) {
        const raw = instById.get(String(targetId));
        const branch = raw?.academy_tenant?.name;
        return {
          label: branch ? `🏫 ${branch}` : "소속 구성원",
          cls: "bg-slate-100 text-slate-600 border-slate-200",
          dot: "bg-slate-400",
          detail: raw?.department || "",
        };
      }

      return {
        label: "⚪ 출근 체크 전",
        cls: "bg-slate-100 text-slate-500 border-slate-200",
        dot: "bg-slate-300",
        detail: hm.profile_extra?.work_schedule_type || "기본 근무",
      };
    },
    [todayAttByInst, todayLeaveByInst, hqMemberById, instById]
  );

  // 현재 대화방 참여자 상세 정보
  const enrichedParticipants = useMemo(() => {
    if (!activeRoomId) return [];
    const list = roomMembers.map((rm: any) => {
      const id = String(rm.instructor_id);
      const hm = hqMemberById.get(id);
      const rawInst = Array.isArray(rm.instructor)
        ? rm.instructor[0]
        : rm.instructor || instById.get(id);
      const name = hm?.name || rawInst?.name || "구성원";
      const pos = hm
        ? resolveMemberDisplayPosition(hm)
        : rawInst?.chat_position || rawInst?.position || "구성원";
      const dept = hm
        ? hm.rank_code === "CEO" && !hm.department
          ? "대표"
          : hm.department || "본부"
        : rawInst?.department || rawInst?.academy_tenant?.name || "소속";
      const orgPath = hm ? buildOrgBreadcrumb(dept, orgNodes) : dept;
      const avatar = resolveStoragePublicUrl(
        hm?.profile_image_url || rawInst?.profile_image_url
      );
      const status = resolveLiveStatusBadge(id);

      return {
        id,
        isMe: id === String(myInstId),
        name,
        pos,
        dept,
        orgPath,
        avatar,
        hm,
        status,
      };
    });

    // 1:1 대화에서는 상대방을 맨 위로, 나와의 대화면 나를 표시
    return list.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? 1 : -1;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [
    activeRoomId,
    roomMembers,
    hqMemberById,
    instById,
    orgNodes,
    resolveLiveStatusBadge,
    myInstId,
  ]);

  // 대기 상태용: 본부 전체 오늘 근무 현황 카운트 + 내 부서 동료 목록
  const hqTodaySummary = useMemo(() => {
    let working = 0;
    let remoteOrOut = 0;
    let onLeave = 0;
    hqMemberById.forEach((m) => {
      const rec = todayAttByInst.get(String(m.instructor_id));
      const lv = todayLeaveByInst.get(String(m.instructor_id));
      if (rec?.status === "LEAVE" || rec?.work_mode === "LEAVE" || lv) {
        onLeave += 1;
      } else if (rec?.status === "WORKING") {
        working += 1;
        if (rec.work_mode === "REMOTE" || rec.work_mode === "OUTSIDE") {
          remoteOrOut += 1;
        }
      }
    });
    return { working, remoteOrOut, onLeave, total: hqMemberById.size };
  }, [hqMemberById, todayAttByInst, todayLeaveByInst]);

  const myTeamPeers = useMemo(() => {
    const myDept = (myMember?.department || "").trim();
    const peers: {
      id: string;
      name: string;
      pos: string;
      dept: string;
      avatar: string | null;
      status: ReturnType<typeof resolveLiveStatusBadge>;
      rawInst: any;
    }[] = [];

    hqMemberById.forEach((m) => {
      if (String(m.instructor_id) === String(myInstId)) return;
      if (myDept && (m.department || "").trim() !== myDept) return;
      const rawInst = instById.get(String(m.instructor_id)) || {
        instructor_id: m.instructor_id,
        name: m.name,
        position: m.job_title,
        profile_image_url: m.profile_image_url,
      };
      peers.push({
        id: m.instructor_id,
        name: m.name,
        pos: resolveMemberDisplayPosition(m),
        dept: m.department || "본부",
        avatar: resolveStoragePublicUrl(m.profile_image_url),
        status: resolveLiveStatusBadge(m.instructor_id),
        rawInst,
      });
    });

    return peers.slice(0, 5);
  }, [hqMemberById, myMember?.department, myInstId, instById, resolveLiveStatusBadge]);

  // 3순위: 대화 중 공유된 URL 링크 자동 추출 (최신순)
  const sharedLinks: ExtractedLinkItem[] = useMemo(() => {
    if (!activeRoomId || messages.length === 0) return [];
    const seen = new Set<string>();
    const out: ExtractedLinkItem[] = [];

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      const content = String(msg?.content || "");
      const matches = content.match(URL_REGEX);
      if (!matches) continue;

      const senderHm = hqMemberById.get(String(msg.sender_id));
      const senderInst = instById.get(String(msg.sender_id));
      const senderName =
        senderHm?.name || senderInst?.name || "구성원";

      for (const rawUrl of matches) {
        const cleanUrl = rawUrl.replace(/[.,;!?]+$/, "");
        if (seen.has(cleanUrl)) continue;
        seen.add(cleanUrl);
        let domain = cleanUrl;
        try {
          domain = new URL(cleanUrl).hostname.replace(/^www\./, "");
        } catch {
          // fallback raw
        }
        out.push({
          messageId: String(msg.message_id),
          url: cleanUrl,
          domain,
          senderName,
          createdAt: String(msg.created_at || ""),
        });
        if (out.length >= 12) break;
      }
      if (out.length >= 12) break;
    }
    return out;
  }, [activeRoomId, messages, hqMemberById, instById]);

  const counterpart = useMemo(() => {
    if (!activeRoomId || enrichedParticipants.length === 0) return null;
    if (roomType === "GROUP" || enrichedParticipants.length > 2) return null;
    return (
      enrichedParticipants.find((p) => !p.isMe) || enrichedParticipants[0]
    );
  }, [activeRoomId, enrichedParticipants, roomType]);

  return (
    <>
      <aside className="hidden lg:flex w-[356px] xl:w-[372px] shrink-0 bg-slate-50/80 border-r border-slate-200 flex-col h-full overflow-hidden select-none">
        {/* 좌측 허브 상단 타이틀 바 */}
        <div className="px-4 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h2 className="text-[13px] font-extrabold text-slate-900 flex items-center gap-1.5">
              <span>🧭</span>
              <span>소통 컨텍스트 허브</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              상대 근무상태 · 대화방 핀/링크 · 본부 공지·이슈
            </p>
          </div>
          <button
            type="button"
            onClick={loadHubContextData}
            title="실시간 근무·공지 현황 새로고침"
            className="w-7 h-7 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 text-xs flex items-center justify-center shrink-0 transition-colors"
          >
            🔄
          </button>
        </div>

        {/* 스크롤 가능한 3단 컨텍스트 카드 스택 */}
        <div className="flex-1 overflow-y-auto custom-scroll p-3.5 space-y-3">
          {/* =================================================================
              [1순위 카드] 대화 상대 실시간 근무·부서 컨텍스트 (미선택 시 본부 근무 요약)
             ================================================================= */}
          <section className="rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenSec1((v) => !v)}
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-left"
            >
              <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>👤</span>
                <span>
                  {activeRoomId
                    ? counterpart
                      ? "대화 상대 · 근무 컨텍스트"
                      : `참여 멤버 현황 (${enrichedParticipants.length}명)`
                    : "오늘 본부 근무 · 내 부서 동료"}
                </span>
              </span>
              <SectionChevron open={openSec1} />
            </button>

            {openSec1 && (
              <div className="p-3.5">
                {activeRoomId ? (
                  counterpart ? (
                    /* 1:1 대화 상대 상세 프로필 + 실시간 근무 상태 */
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="relative w-11 h-11 rounded-2xl bg-slate-200 border border-slate-200/80 flex items-center justify-center text-sm font-extrabold text-slate-700 overflow-hidden shrink-0">
                          <span>{counterpart.name.slice(0, 1)}</span>
                          {counterpart.avatar && (
                            <img
                              src={counterpart.avatar}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-extrabold text-slate-900">
                              {counterpart.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10.5px] font-bold">
                              {counterpart.pos}
                            </span>
                            {counterpart.isMe && (
                              <span className="px-1.5 py-0.5 rounded bg-brand text-white text-[10px] font-extrabold">
                                나와의 메모방
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500 mt-0.5 truncate">
                            🏢 {counterpart.orgPath}
                          </div>
                        </div>
                      </div>

                      {/* 실시간 근무·연차 배지 박스 */}
                      <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2 flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-extrabold shrink-0 ${counterpart.status.cls}`}
                        >
                          {counterpart.status.label}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium truncate">
                          {counterpart.status.detail}
                        </span>
                      </div>

                      {/* 담당 직무 / 내선 / 연락처 / 부재중 안내 */}
                      {(counterpart.hm?.job_description ||
                        counterpart.hm?.extension_no ||
                        counterpart.hm?.email ||
                        counterpart.hm?.auto_reply_active) && (
                        <div className="space-y-1 text-[11px] text-slate-600 pt-0.5">
                          {counterpart.hm?.job_description && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400 shrink-0">
                                담당 업무
                              </span>
                              <span className="font-semibold text-slate-700 truncate">
                                {counterpart.hm.job_description}
                              </span>
                            </div>
                          )}
                          {counterpart.hm?.extension_no && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400 shrink-0">
                                내선 번호
                              </span>
                              <span className="font-bold text-slate-700 tabular-nums">
                                {counterpart.hm.extension_no}
                              </span>
                            </div>
                          )}
                          {counterpart.hm?.email && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400 shrink-0">
                                이메일
                              </span>
                              <span className="font-medium text-slate-600 truncate">
                                {counterpart.hm.email}
                              </span>
                            </div>
                          )}
                          {counterpart.hm?.auto_reply_active &&
                            counterpart.hm?.auto_reply_message && (
                              <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-800 font-medium">
                                💬 자동응답: {counterpart.hm.auto_reply_message}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* 그룹 채팅방 참여자 목록 & 각자 오늘 근무 상태 */
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-slate-500 flex items-center justify-between">
                        <span className="truncate">{activeRoomName}</span>
                        <span className="text-slate-400 shrink-0">
                          총 {enrichedParticipants.length}명
                        </span>
                      </div>
                      <div className="max-h-44 overflow-y-auto custom-scroll space-y-1.5 pr-0.5">
                        {enrichedParticipants.map((p) => (
                          <div
                            key={p.id}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-50/80 border border-slate-200/70 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-800 truncate">
                                {p.name}{" "}
                                <span className="text-[10.5px] font-medium text-slate-400">
                                  {p.pos}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {p.orgPath}
                              </div>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-extrabold shrink-0 ${p.status.cls}`}
                            >
                              {p.status.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ) : (
                  /* 대화방 미선택 초기 상태: 본부 실시간 현황 칩 + 내 부서 동료 바로 대화 */
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/70 py-2 px-1">
                        <div className="text-[10px] font-bold text-emerald-700">
                          근무중
                        </div>
                        <div className="text-sm font-extrabold text-emerald-800 mt-0.5 tabular-nums">
                          {hqTodaySummary.working}명
                        </div>
                      </div>
                      <div className="rounded-xl bg-sky-50/70 border border-sky-200/70 py-2 px-1">
                        <div className="text-[10px] font-bold text-sky-700">
                          원격·외근
                        </div>
                        <div className="text-sm font-extrabold text-sky-800 mt-0.5 tabular-nums">
                          {hqTodaySummary.remoteOrOut}명
                        </div>
                      </div>
                      <div className="rounded-xl bg-violet-50/70 border border-violet-200/70 py-2 px-1">
                        <div className="text-[10px] font-bold text-violet-700">
                          연차·반차
                        </div>
                        <div className="text-sm font-extrabold text-violet-800 mt-0.5 tabular-nums">
                          {hqTodaySummary.onLeave}명
                        </div>
                      </div>
                    </div>

                    {myTeamPeers.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-extrabold text-slate-500 flex items-center justify-between">
                          <span>
                            내 부서 동료 ({myMember?.department || "본부"})
                          </span>
                        </div>
                        <div className="space-y-1">
                          {myTeamPeers.map((peer) => (
                            <div
                              key={peer.id}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 flex items-center justify-between gap-2 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${peer.status.dot}`}
                                  title={peer.status.label}
                                />
                                <span className="text-xs font-bold text-slate-800 truncate">
                                  {peer.name}
                                </span>
                                <span className="text-[10.5px] text-slate-400 shrink-0">
                                  {peer.pos}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-semibold text-slate-500">
                                  {peer.status.label.replace(/^[^\s]+\s/, "")}
                                </span>
                                {onQuickStartDirect && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onQuickStartDirect(peer.rawInst)
                                    }
                                    className="px-2 py-0.5 rounded-md bg-white hover:bg-brand hover:text-white border border-slate-200 text-[10.5px] font-bold text-slate-700 transition-colors"
                                  >
                                    대화
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* =================================================================
              [3순위 카드] 대화방 고정 핀(공지) · 공유 링크 모아보기 · 빠른 실행
             ================================================================= */}
          <section className="rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenSec2((v) => !v)}
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-left"
            >
              <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>📌</span>
                <span>
                  {activeRoomId
                    ? "대화방 핀 · 공유 링크 · 도구"
                    : "업무 바로가기 도구"}
                </span>
              </span>
              <SectionChevron open={openSec2} />
            </button>

            {openSec2 && (
              <div className="p-3.5 space-y-3">
                {activeRoomId ? (
                  <>
                    {/* 핀 공지 vs 공유 링크 미니 탭 */}
                    <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-slate-100">
                      <button
                        type="button"
                        onClick={() => setSec2Tab("PIN")}
                        className={`py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                          sec2Tab === "PIN"
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        📌 대화방 공지
                      </button>
                      <button
                        type="button"
                        onClick={() => setSec2Tab("LINKS")}
                        className={`py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                          sec2Tab === "LINKS"
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        🔗 공유 링크 ({sharedLinks.length})
                      </button>
                    </div>

                    {sec2Tab === "PIN" ? (
                      editingPin ? (
                        <div className="space-y-2">
                          <textarea
                            rows={3}
                            value={pinDraft}
                            onChange={(e) => setPinDraft(e.target.value)}
                            placeholder="이 대화방에서 기억해야 할 핵심 일정·원고 폴더·약속 사항을 고정해 두세요."
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 resize-none focus:outline-none focus:border-brand"
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            {pinnedText && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSavePinnedText("");
                                  setEditingPin(false);
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-rose-600 hover:bg-rose-50 mr-auto"
                              >
                                고정 해제
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setPinDraft(pinnedText);
                                setEditingPin(false);
                              }}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onSavePinnedText(pinDraft.trim());
                                setEditingPin(false);
                              }}
                              className="px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-extrabold hover:bg-brand-hover"
                            >
                              저장
                            </button>
                          </div>
                        </div>
                      ) : pinnedText ? (
                        <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3 space-y-2">
                          <p className="text-xs text-slate-800 font-semibold leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
                            {pinnedText}
                          </p>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setPinDraft(pinnedText);
                                setEditingPin(true);
                              }}
                              className="text-[11px] font-bold text-amber-800 hover:underline"
                            >
                              ✏️ 공지 수정
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPinDraft("");
                            setEditingPin(true);
                          }}
                          className="w-full py-3 px-3 rounded-xl border border-dashed border-slate-200 hover:border-slate-300 bg-slate-50/50 text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          + 이 대화방에 공지·메모 고정하기 (메시지의 📌 클릭도 가능)
                        </button>
                      )
                    ) : sharedLinks.length === 0 ? (
                      <div className="py-4 text-center text-[11px] font-medium text-slate-400">
                        아직 대화 중 공유된 URL 링크가 없습니다.
                      </div>
                    ) : (
                      <div className="max-h-40 overflow-y-auto custom-scroll space-y-1.5 pr-0.5">
                        {sharedLinks.map((lk) => (
                          <a
                            key={`${lk.messageId}-${lk.url}`}
                            href={lk.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block px-2.5 py-2 rounded-xl bg-slate-50 hover:bg-blue-50/60 border border-slate-200/80 hover:border-brand/30 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10.5px] font-bold text-brand">
                              <span className="truncate">🔗 {lk.domain}</span>
                              <span className="text-slate-400 font-medium shrink-0">
                                {lk.senderName}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600 truncate mt-0.5">
                              {lk.url}
                            </div>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* 대화 내 메시지 검색 인풋 */}
                    {msgSearchOpen && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-2 flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">🔍</span>
                        <input
                          autoFocus
                          value={msgSearchQuery}
                          onChange={(e) => onChangeMsgSearch(e.target.value)}
                          placeholder="대화 내용 키워드 검색..."
                          className="flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none min-w-0"
                        />
                        {msgSearchQuery && (
                          <span className="text-[10.5px] font-extrabold text-brand shrink-0">
                            {msgMatchCount}건
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onChangeMsgSearch("");
                            onToggleMsgSearch();
                          }}
                          className="text-xs text-slate-400 hover:text-slate-700 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* 빠른 실행 버튼 3종 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={onToggleMsgSearch}
                        className={`py-2 px-2 rounded-xl border text-[11px] font-bold transition-colors ${
                          msgSearchOpen
                            ? "bg-brand text-white border-brand"
                            : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                        }`}
                      >
                        🔍 대화 검색
                      </button>
                      {canAccessMenu("/hq/meetings") && (
                        <button
                          type="button"
                          onClick={() => router.push(hqHref("/hq/meetings"))}
                          className="py-2 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 transition-colors"
                        >
                          📅 미팅 잡기
                        </button>
                      )}
                      {canAccessMenu("/hq/approvals") && (
                        <button
                          type="button"
                          onClick={() => router.push(hqHref("/hq/approvals"))}
                          className="py-2 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 transition-colors"
                        >
                          📋 전자결재
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  /* 대기 상태 빠른 이동 버튼 */
                  <div className="grid grid-cols-2 gap-1.5">
                    {canAccessMenu("/hq/meetings") && (
                      <button
                        type="button"
                        onClick={() => router.push(hqHref("/hq/meetings"))}
                        className="py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 text-left flex items-center gap-1.5 transition-colors"
                      >
                        <span>📅</span>
                        <span>사내 미팅록</span>
                      </button>
                    )}
                    {canAccessMenu("/hq/approvals") && (
                      <button
                        type="button"
                        onClick={() => router.push(hqHref("/hq/approvals"))}
                        className="py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 text-left flex items-center gap-1.5 transition-colors"
                      >
                        <span>📋</span>
                        <span>워크플로우</span>
                      </button>
                    )}
                    {canAccessMenu("/hq/attendance") && (
                      <button
                        type="button"
                        onClick={() => router.push(hqHref("/hq/attendance"))}
                        className="py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 text-left flex items-center gap-1.5 transition-colors"
                      >
                        <span>⏱️</span>
                        <span>내 근무 현황</span>
                      </button>
                    )}
                    {canAccessMenu("/hq/publishing") && (
                      <button
                        type="button"
                        onClick={() => router.push(hqHref("/hq/publishing"))}
                        className="py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 text-left flex items-center gap-1.5 transition-colors"
                      >
                        <span>📚</span>
                        <span>출판 공정 보드</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* =================================================================
              [2순위 카드] 최근 전사 공지사항 & 오늘·다가오는 본부 주요 이슈
             ================================================================= */}
          <section className="rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setOpenSec3((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800 text-left"
              >
                <span>📢</span>
                <span>최근 공지 · 본부 주요 이슈</span>
                <SectionChevron open={openSec3} />
              </button>
              {canAccessMenu("/hq/notices") && (
                <button
                  type="button"
                  onClick={() => router.push(hqHref("/hq/notices"))}
                  className="text-[11px] font-bold text-brand hover:underline"
                >
                  전체보기 →
                </button>
              )}
            </div>

            {openSec3 && (
              <div className="p-3.5 space-y-3">
                {/* 최근 전사 공지 목록 */}
                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-extrabold text-slate-400">
                    전사 공지사항
                  </div>
                  {recentNotices.length === 0 ? (
                    <div className="py-2 text-[11px] text-slate-400 font-medium">
                      등록된 전사 공지가 없습니다.
                    </div>
                  ) : (
                    recentNotices.map((nt) => (
                      <button
                        key={nt.id}
                        type="button"
                        onClick={() => setPreviewNotice(nt)}
                        className="w-full text-left px-2.5 py-2 rounded-xl bg-slate-50/80 hover:bg-blue-50/50 border border-slate-200/70 hover:border-brand/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-extrabold text-brand bg-blue-50 px-1.5 py-0.2 rounded">
                            {nt.is_pinned ? "📌 고정" : nt.category || "공지"}
                          </span>
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            {String(nt.created_at || "").slice(5, 10).replace("-", ".")}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-slate-800 truncate mt-1">
                          {nt.title || "(제목 없음)"}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* 본부 주요 일정 / 하판 마감 / 미팅 이슈 */}
                {upcomingIssues.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="text-[10.5px] font-extrabold text-slate-400">
                      오늘 · 임박 본부 일정
                    </div>
                    {upcomingIssues.map((ev) => {
                      const badge =
                        ev.category === "PUBLISHING"
                          ? {
                              icon: "📚",
                              cls: "bg-rose-50 text-rose-700 border-rose-200",
                            }
                          : ev.category === "MEETING" ||
                              /(미팅|회의)/.test(ev.title)
                            ? {
                                icon: "💬",
                                cls: "bg-blue-50 text-blue-700 border-blue-200",
                              }
                            : /특강/.test(ev.title)
                              ? {
                                  icon: "🎤",
                                  cls: "bg-orange-50 text-orange-700 border-orange-200",
                                }
                              : {
                                  icon: "🗓️",
                                  cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
                                };
                      return (
                        <div
                          key={ev.id}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200/70 bg-white flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1.5 py-0.2 rounded border text-[10px] font-extrabold shrink-0 ${badge.cls}`}
                            >
                              {badge.icon}
                            </span>
                            <span className="text-[11.5px] font-bold text-slate-700 truncate">
                              {ev.title}
                            </span>
                          </div>
                          <span className="text-[10.5px] font-semibold text-slate-400 tabular-nums shrink-0">
                            {ev.startDate.slice(5).replace("-", ".")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </aside>

      {/* 공지사항 즉시 열람 모달 (채팅 흐름을 끊지 않고 바로 확인) */}
      {previewNotice && (
        <div
          onClick={() => setPreviewNotice(null)}
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="inline-block px-2 py-0.5 rounded-md bg-blue-50 text-brand text-[11px] font-extrabold">
                  {previewNotice.category || "공지사항"}
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-1.5 break-keep">
                  {previewNotice.title}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  작성자 {previewNotice.author_name} ·{" "}
                  {String(previewNotice.created_at || "").slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewNotice(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto custom-scroll text-xs text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
              {previewNotice.content}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              {canAccessMenu("/hq/notices") ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewNotice(null);
                    router.push(hqHref("/hq/notices"));
                  }}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  공지 게시판에서 보기 ↗
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setPreviewNotice(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
