// src/components/hq/settings/HqWorkTypeSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  ALL_WEEKDAYS,
  calcStandardCheckInOutPreview,
  calcWeeklyWorkHours,
  DEFAULT_WORK_RULES,
  formatHmToKoreanAmPm,
  formatWorkRuleSummary,
  patternShortBadge,
  TIME_OPTIONS_30M,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqWorkRuleAssignedMember,
  HqWorkRuleItem,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

type ModalSubPage =
  | "basic"
  | "members"
  | "overtime"
  | "realtime"
  | "auto_record"
  | "advanced";

interface Props {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export default function HqWorkTypeSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};
  const workRules: HqWorkRuleItem[] =
    ex.work_rules && ex.work_rules.length > 0
      ? ex.work_rules
      : DEFAULT_WORK_RULES;

  const visibleRules = workRules.filter((r) => !r.is_hidden);
  const hiddenRules = workRules.filter((r) => r.is_hidden);

  // 메인 화면 상태
  const [hideGuideTipOpen, setHideGuideTipOpen] = useState(true);
  const [topMoreOpen, setTopMoreOpen] = useState(false);
  const [hiddenDrawerOpen, setHiddenDrawerOpen] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);

  // 상세 설정 모달 상태 (Images 2 ~ 11)
  const [draft, setDraft] = useState<HqWorkRuleItem | null>(null);
  const [isNewRule, setIsNewRule] = useState(false);
  const [subPage, setSubPage] = useState<ModalSubPage>("basic");
  const [modalGuideTipOpen, setModalGuideTipOpen] = useState(false);
  const [modalTopMenuOpen, setModalTopMenuOpen] = useState(false);
  const [memberSubTab, setMemberSubTab] = useState<
    "ACTIVE" | "SCHEDULED" | "PAST"
  >("ACTIVE");

  // 적용 구성원 추가 서브 다이얼로그 상태
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedAddName, setSelectedAddName] = useState("");
  const [selectedAddStatus, setSelectedAddStatus] = useState<
    "ACTIVE" | "SCHEDULED"
  >("ACTIVE");
  const [selectedAddFromLabel, setSelectedAddFromLabel] =
    useState("입사일 부터 적용 중");

  // 구성원 후보 풀 (실제 재직 구성원 + Flex 기본 구성원 병합)
  const candidatePool = useMemo(() => {
    const map = new Map<
      string,
      { name: string; job_label: string; avatar_bg: string }
    >();
    const colors = [
      "#fb923c",
      "#34d399",
      "#f87171",
      "#38bdf8",
      "#a78bfa",
      "#4ade80",
      "#facc15",
    ];
    members
      .filter((m) => m.work_status === "재직")
      .forEach((m, idx) => {
        map.set(m.name, {
          name: m.name,
          job_label: m.job_description || m.department || m.job_title || "",
          avatar_bg: colors[idx % colors.length],
        });
      });

    [
      { name: "천종현", job_label: "경영", avatar_bg: "#9ba8cf" },
      { name: "김근식", job_label: "관리팀", avatar_bg: "#34d399" },
      { name: "김동현", job_label: "", avatar_bg: "#4ade80" },
      { name: "김문수", job_label: "편집", avatar_bg: "#f87171" },
      { name: "민세리", job_label: "", avatar_bg: "#fb7185" },
      { name: "박주원", job_label: "", avatar_bg: "#64748b" },
      { name: "백시연", job_label: "교재 집필", avatar_bg: "#2dd4bf" },
      { name: "심혜영", job_label: "디자인", avatar_bg: "#38bdf8" },
      { name: "원호준", job_label: "교재 집필", avatar_bg: "#fb923c" },
      { name: "이웅행", job_label: "", avatar_bg: "#facc15" },
      { name: "조원형", job_label: "마케팅", avatar_bg: "#fb923c" },
      { name: "최수연", job_label: "디자인", avatar_bg: "#fb923c" },
      { name: "한민서", job_label: "마케팅", avatar_bg: "#a78bfa" },
    ].forEach((p) => {
      if (!map.has(p.name)) map.set(p.name, p);
    });

    return Array.from(map.values());
  }, [members]);

  const openEditRuleModal = (
    rule: HqWorkRuleItem,
    initialTab: ModalSubPage = "basic"
  ) => {
    setOpenCardMenuId(null);
    setDraft(JSON.parse(JSON.stringify(rule)));
    setIsNewRule(false);
    setSubPage(initialTab);
    setMemberSubTab("ACTIVE");
    setModalTopMenuOpen(false);
    setModalGuideTipOpen(rule.id === "wr-parttime");
  };

  const openCreateRuleModal = () => {
    const fresh: HqWorkRuleItem = {
      ...JSON.parse(JSON.stringify(DEFAULT_WORK_RULES[3] || DEFAULT_WORK_RULES[0])),
      id: `wr-${uid()}`,
      name: "새 근무 유형",
      is_default: false,
      is_hidden: false,
      assigned_members: [],
      past_assigned_count: 0,
    };
    setDraft(fresh);
    setIsNewRule(true);
    setSubPage("basic");
    setMemberSubTab("ACTIVE");
    setModalTopMenuOpen(false);
    setModalGuideTipOpen(false);
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      alert("근무 유형 이름을 입력해주세요.");
      setSubPage("basic");
      return;
    }
    if (draft.paid_rest_days.length === 0) {
      alert("주휴일을 최소 1일 이상 선택해주세요.");
      setSubPage("basic");
      return;
    }

    const cleaned: HqWorkRuleItem = {
      ...draft,
      name: draft.name.trim(),
    };

    const nextRules = isNewRule
      ? [...workRules, cleaned]
      : workRules.map((r) => (r.id === cleaned.id ? cleaned : r));

    await onSaveExtra(
      { work_rules: nextRules },
      isNewRule
        ? `'${cleaned.name}' 근무 유형이 추가되었습니다.`
        : `'${cleaned.name}' 근무 유형 설정이 저장되었습니다.`
    );
    setDraft(null);
  };

  const handleSetDefaultRule = async (targetId: string) => {
    setOpenCardMenuId(null);
    setModalTopMenuOpen(false);
    const nextRules = workRules.map((r) => ({
      ...r,
      is_default: r.id === targetId,
    }));
    if (draft && draft.id === targetId) {
      setDraft({ ...draft, is_default: true });
    }
    await onSaveExtra(
      { work_rules: nextRules },
      "기본 근무 유형이 변경되었습니다."
    );
  };

  const handleToggleHideRule = async (rule: HqWorkRuleItem, hide: boolean) => {
    setOpenCardMenuId(null);
    setModalTopMenuOpen(false);
    if (hide && rule.is_default) {
      alert(
        "기본 근무 유형은 숨길 수 없습니다. 다른 유형을 기본으로 지정한 뒤 숨겨주세요."
      );
      return;
    }
    const nextRules = workRules.map((r) =>
      r.id === rule.id ? { ...r, is_hidden: hide } : r
    );
    await onSaveExtra(
      { work_rules: nextRules },
      hide
        ? `'${rule.name}' 근무 유형을 목록에서 숨겼습니다.`
        : `'${rule.name}' 근무 유형을 목록에 다시 표시합니다.`
    );
    if (hide && draft?.id === rule.id) {
      setDraft(null);
    }
  };

  const handleDeleteRule = async (rule: HqWorkRuleItem) => {
    setOpenCardMenuId(null);
    setModalTopMenuOpen(false);
    const activeCnt = rule.assigned_members.filter(
      (m) => m.status === "ACTIVE"
    ).length;
    if (activeCnt > 0) {
      alert("적용 중인 구성원이 있는 근무 유형은 삭제할 수 없습니다.");
      return;
    }
    if (rule.is_default) {
      alert("기본 근무 유형은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${rule.name}' 근무 유형을 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      { work_rules: workRules.filter((r) => r.id !== rule.id) },
      `'${rule.name}' 근무 유형이 삭제되었습니다.`
    );
    if (draft?.id === rule.id) setDraft(null);
  };

  return (
    <>
      <div className="space-y-8">
        {/* 상단 타이틀 + 우측 ⋯ (숨긴 근무 유형) & + 근무 유형 추가 */}
        <div className="flex flex-wrap items-center justify-between gap-3 relative">
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            근무 유형
          </h2>

          <div className="flex items-center gap-2 relative">
            <button
              type="button"
              onClick={() => {
                setTopMoreOpen((p) => !p);
                setHideGuideTipOpen(false);
              }}
              className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-600 font-bold flex items-center justify-center relative"
              title="숨긴 근무 유형 보기"
            >
              <span>⋯</span>
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 absolute top-2 right-2" />
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateRuleModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>근무 유형 추가</span>
              </button>
            )}

            {/* Image 1 우상단 온보딩 툴팁 */}
            {hideGuideTipOpen && (
              <div className="absolute right-0 top-12 z-30 w-64 rounded-xl bg-[#1e2329] text-white p-4 shadow-xl text-xs">
                <div className="font-extrabold mb-1">
                  이제 숨긴 근무 유형을 여기에서 볼 수 있어요.
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  이 버튼을 눌러 목록에서 숨겨진 근무 유형을 다시 확인해 보세요.
                </p>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setHideGuideTipOpen(false)}
                    className="text-[11px] font-bold text-white hover:underline"
                  >
                    확인
                  </button>
                </div>
              </div>
            )}

            {topMoreOpen && (
              <div className="absolute right-0 top-11 z-30 w-48 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setTopMoreOpen(false);
                    setHiddenDrawerOpen((p) => !p);
                  }}
                  className="w-full px-3.5 py-2 text-left font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-between"
                >
                  <span>숨긴 근무 유형 보기</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                    {hiddenRules.length}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 숨긴 근무 유형 복원 패널 */}
        {hiddenDrawerOpen && (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-800">
                🙈 숨긴 근무 유형 ({hiddenRules.length})
              </span>
              <button
                type="button"
                onClick={() => setHiddenDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                닫기
              </button>
            </div>
            {hiddenRules.length === 0 ? (
              <div className="text-slate-400 py-2">
                현재 숨겨진 근무 유형이 없어요.
              </div>
            ) : (
              hiddenRules.map((hr) => (
                <div
                  key={hr.id}
                  className="px-4 py-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-slate-800">{hr.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {formatWorkRuleSummary(hr)}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleToggleHideRule(hr, false)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700"
                    >
                      목록에 다시 표시
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 근무 유형 관리 카드 목록 (Image 1 동일) */}
        <section className="space-y-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              근무 유형 관리
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              근무 조건과 일정을 설정하고 유형 별로 관리해 보세요.
            </p>
          </div>

          <div className="space-y-2.5">
            {visibleRules.map((rule) => {
              const activeCount = rule.assigned_members.filter(
                (m) => m.status === "ACTIVE"
              ).length;
              return (
                <div
                  key={rule.id}
                  onClick={() => openEditRuleModal(rule, "basic")}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/30 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-extrabold text-slate-900">
                        {rule.name}
                      </span>
                      {rule.is_default && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                          기본
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-[10px] font-bold">
                        {patternShortBadge(rule.pattern_type)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 truncate">
                      {formatWorkRuleSummary(rule)}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {activeCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => openEditRuleModal(rule, "members")}
                        className="px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700"
                      >
                        {activeCount}명 적용중
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEditRuleModal(rule, "members")}
                        className="px-3 py-1 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-400"
                      >
                        적용 구성원 없음
                      </button>
                    )}

                    {canEdit && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenCardMenuId((p) =>
                              p === rule.id ? null : rule.id
                            )
                          }
                          className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold"
                        >
                          ⋯
                        </button>

                        {openCardMenuId === rule.id && (
                          <div className="absolute right-0 mt-1 w-44 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                            <button
                              type="button"
                              disabled={Boolean(rule.is_default)}
                              onClick={() => handleSetDefaultRule(rule.id)}
                              className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
                            >
                              <span>✓</span>
                              <span>기본 근무 유형으로 지정</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleHideRule(rule, true)}
                              className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <span>🙈</span>
                              <span>목록에서 숨기기</span>
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                            <button
                              type="button"
                              disabled={activeCount > 0 || Boolean(rule.is_default)}
                              onClick={() => handleDeleteRule(rule)}
                              className="w-full px-3.5 py-2 text-left font-semibold text-rose-500 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-35"
                            >
                              <span>🗑️</span>
                              <span>삭제</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (Image 1 동일: 커스텀 승인 라벨 ← / → 근무 정책 · 승인) */}
        <div className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("approval-labels")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                커스텀 승인 라벨
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("work-policy")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                근무 정책 · 승인
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2단 근무 유형 상세 모달 (Images 2 ~ 11)                            */}
      {/* ================================================================= */}
      {draft && (() => {
        const weeklyHours = calcWeeklyWorkHours(draft);
        const previewTimes = calcStandardCheckInOutPreview(draft);
        const activeAssigned = draft.assigned_members.filter(
          (m) => m.status === "ACTIVE"
        );
        const scheduledAssigned = draft.assigned_members.filter(
          (m) => m.status === "SCHEDULED"
        );
        const pastAssigned = draft.assigned_members.filter(
          (m) => m.status === "PAST"
        );
        const pastDisplayCount =
          pastAssigned.length > 0
            ? pastAssigned.length
            : draft.past_assigned_count || 0;

        const leftNavClass = (key: ModalSubPage) =>
          `w-full px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
            subPage === key
              ? "bg-[#eceef1] text-slate-900 font-extrabold"
              : "text-slate-600 hover:bg-slate-200/50 font-semibold"
          }`;

        const toggleWorkDay = (day: string) => {
          if (!canEdit) return;
          const exists = draft.work_days.includes(day);
          const nextDays = exists
            ? draft.work_days.filter((d) => d !== day)
            : ALL_WEEKDAYS.filter(
                (d) => draft.work_days.includes(d) || d === day
              );
          setDraft({ ...draft, work_days: nextDays });
        };

        const togglePaidRestDay = (day: string) => {
          if (!canEdit) return;
          const exists = draft.paid_rest_days.includes(day);
          if (exists && draft.paid_rest_days.length <= 1) return;
          const nextDays = exists
            ? draft.paid_rest_days.filter((d) => d !== day)
            : ALL_WEEKDAYS.filter(
                (d) => draft.paid_rest_days.includes(d) || d === day
              );
          setDraft({ ...draft, paid_rest_days: nextDays });
        };

        return (
          <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white w-full max-w-[920px] h-[86vh] max-h-[820px] rounded-2xl shadow-2xl border border-slate-200 flex overflow-hidden relative">
              {/* 좌측 서브 네비게이션 사이드바 */}
              <aside className="w-[210px] bg-[#f8f9fa] border-r border-slate-200/80 p-3.5 flex flex-col shrink-0 select-none relative">
                {/* 상단 현재 근무 유형 이름 칩 */}
                <div className="px-3 py-2 mb-3 rounded-lg bg-[#eceef1]/80 flex items-center gap-1.5">
                  <span className="text-xs font-extrabold text-slate-900 truncate">
                    {draft.name || "새 근무 유형"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-[10px] font-bold shrink-0">
                    {patternShortBadge(draft.pattern_type)}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setSubPage("basic")}
                    className={leftNavClass("basic")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">🎛️</span>
                      <span>기본 설정</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubPage("members")}
                    className={leftNavClass("members")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">👤</span>
                      <span>적용 구성원</span>
                    </span>
                    <span className="text-[11px] text-slate-400 font-semibold">
                      {activeAssigned.length > 0
                        ? activeAssigned.length
                        : "없음"}
                    </span>
                  </button>
                </div>

                <div className="mt-5 px-3 mb-1.5 text-[11px] font-bold text-slate-400">
                  근무 기록
                </div>

                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setSubPage("overtime")}
                    className={leftNavClass("overtime")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">🔥</span>
                      <span>초과 근무</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubPage("realtime")}
                    className={leftNavClass("realtime")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">⏱️</span>
                      <span>실시간 근무 기록</span>
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        draft.realtime_enabled
                          ? "bg-[#00c458] text-white"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {draft.realtime_enabled ? "ON" : "OFF"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubPage("auto_record")}
                    className={leftNavClass("auto_record")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">⚡</span>
                      <span>자동 근무 기록</span>
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        draft.auto_record_enabled
                          ? "bg-[#00c458] text-white"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {draft.auto_record_enabled ? "ON" : "OFF"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubPage("advanced")}
                    className={leftNavClass("advanced")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">⋯</span>
                      <span>고급 설정</span>
                    </span>
                  </button>
                </div>

                {/* 좌측 근무 기록 옵션 온보딩 툴팁 (Images 2~6 동일) */}
                {modalGuideTipOpen && (
                  <div className="mt-4 rounded-xl bg-[#1e2329] text-white p-3.5 shadow-xl text-[11px]">
                    <div className="font-extrabold mb-1">근무 기록 옵션</div>
                    <p className="text-slate-300 leading-relaxed">
                      좌측 근무 기록 메뉴를 통해 근무 기록에 관련된 추가 기능들을 설정할 수 있어요.
                    </p>
                    <div className="mt-2.5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setModalGuideTipOpen(false)}
                        className="font-bold text-white hover:underline"
                      >
                        확인
                      </button>
                    </div>
                  </div>
                )}
              </aside>

              {/* 우측 상세 콘텐츠 + 상단 ⋯ / ✕ + 하단 저장 */}
              <div className="flex-1 flex flex-col min-w-0 bg-white relative">
                {/* 우상단 ⋯ 메뉴 & 닫기 (Image 11 동일) */}
                <div className="absolute top-4 right-5 z-20 flex items-center gap-2">
                  {!isNewRule && canEdit && (
                    <button
                      type="button"
                      onClick={() => setModalTopMenuOpen((p) => !p)}
                      className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
                    >
                      ⋯
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                  >
                    ✕
                  </button>

                  {modalTopMenuOpen && (
                    <div className="absolute right-0 top-8 w-44 rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-30 text-xs">
                      <button
                        type="button"
                        disabled={Boolean(draft.is_default)}
                        onClick={() => handleSetDefaultRule(draft.id)}
                        className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
                      >
                        <span>✓</span>
                        <span>기본 근무 유형으로 지정</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleHideRule(draft, true)}
                        className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <span>🙈</span>
                        <span>목록에서 숨기기</span>
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        disabled={
                          activeAssigned.length > 0 || Boolean(draft.is_default)
                        }
                        onClick={() => handleDeleteRule(draft)}
                        className="w-full px-3.5 py-2 text-left font-semibold text-rose-400 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-40"
                      >
                        <span>🗑️</span>
                        <span>삭제</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 서브페이지 스크롤 영역 */}
                <div className="flex-1 overflow-y-auto px-8 py-8 custom-scroll text-xs">
                  {/* ===================================================== */}
                  {/* SUB-PAGE 1: 기본 설정 (Images 2, 3, 9, 11)             */}
                  {/* ===================================================== */}
                  {subPage === "basic" && (
                    <div className="space-y-7 max-w-[600px]">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          기본 설정
                        </h3>
                        <p className="text-slate-400 mt-1">
                          근무 유형 속성 및 일하는 방식에 대해 설정할 수 있어요.
                        </p>
                      </div>

                      {/* 근무 유형 이름 */}
                      <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5 font-bold text-slate-800">
                          <span className="text-slate-400">🏷️</span>
                          <span>근무 유형 이름</span>
                        </div>
                        <input
                          disabled={!canEdit}
                          value={draft.name}
                          onChange={(e) =>
                            setDraft({ ...draft, name: e.target.value })
                          }
                          className="w-60 px-3.5 py-2 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-none focus:border-slate-400"
                        />
                      </div>

                      {/* 근무 유형 속성 */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          근무 유형 속성
                        </h4>
                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <span className="text-slate-400 text-sm">💼</span>
                              <div>
                                <div className="font-bold text-slate-800">
                                  근무 유형 종류
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  어떤 패턴으로 근무할지 선택해주세요.
                                </div>
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.pattern_type}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  pattern_type:
                                    e.target.value as HqWorkRuleItem["pattern_type"],
                                })
                              }
                              className="px-3 py-1.5 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="고정 근무 유형">고정 근무 유형</option>
                              <option value="시차 출퇴근 유형">시차 출퇴근 유형</option>
                              <option value="선택적 근로시간 유형">
                                선택적 근로시간 유형
                              </option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <span className="text-slate-400 text-sm">👤</span>
                              <div>
                                <div className="font-bold text-slate-800">
                                  근로자 유형
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  통상, 단시간 등 어떤 근로자에게 적용할지 선택해주세요.
                                </div>
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.worker_type}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  worker_type:
                                    e.target.value as HqWorkRuleItem["worker_type"],
                                })
                              }
                              className="px-3 py-1.5 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="통상 근로자">통상 근로자</option>
                              <option value="단시간 근로자">단시간 근로자</option>
                            </select>
                          </div>
                        </div>
                      </section>

                      {/* 일하는 방식 */}
                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h4 className="text-[13px] font-extrabold text-slate-800">
                              일하는 방식
                            </h4>
                            <span className="text-[11px] font-extrabold text-[#00a84d] flex items-center gap-1">
                              <span>●</span>
                              <span>1주 소정근로시간 {weeklyHours}시간</span>
                            </span>
                          </div>
                          {draft.worker_type === "통상 근로자" && (
                            <span className="text-[11px] font-semibold text-slate-400">
                              + 요일별 근무 설정
                            </span>
                          )}
                        </div>

                        {/* 주기 / 근무 요일 / 주휴일 카드 */}
                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                근무 주기 시작 요일
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                근무 주기가 시작되는 요일을 선택해주세요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.cycle_start_day}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  cycle_start_day:
                                    e.target.value as HqWorkRuleItem["cycle_start_day"],
                                })
                              }
                              className="px-2 py-1 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="월요일">월요일</option>
                              <option value="일요일">일요일</option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-800">
                                근무 요일
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                근무해야하는 요일을 모두 선택해주세요.
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {ALL_WEEKDAYS.map((day) => {
                                const sel = draft.work_days.includes(day);
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => toggleWorkDay(day)}
                                    className={`w-7 h-7 rounded-md text-[11px] font-bold transition-colors ${
                                      sel
                                        ? "bg-slate-600 text-white"
                                        : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-800">
                                주휴일
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                유급 휴일로 지정할 요일을 모두 선택해주세요. (최소 1일)
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {ALL_WEEKDAYS.map((day) => {
                                const sel = draft.paid_rest_days.includes(day);
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => togglePaidRestDay(day)}
                                    className={`w-7 h-7 rounded-md text-[11px] font-bold transition-colors ${
                                      sel
                                        ? "bg-slate-600 text-white"
                                        : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* 출근 시각 / 하루 근무 시간 / 추천 휴게 시간 카드 */}
                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                출근 시각
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                근무을 시작하는 시각을 선택해주세요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.start_time}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  start_time: e.target.value,
                                })
                              }
                              className="px-2 py-1 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              {TIME_OPTIONS_30M.map((hm) => (
                                <option key={hm} value={hm}>
                                  {formatHmToKoreanAmPm(hm)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                근무 시간
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                하루에 근무해야하는 시간을 입력해주세요.
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  disabled={!canEdit}
                                  value={draft.daily_work_hours}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      daily_work_hours: Math.max(
                                        0,
                                        Number(e.target.value)
                                      ),
                                    })
                                  }
                                  className="w-10 font-bold text-slate-800 focus:outline-none"
                                />
                                <span className="text-slate-400 text-[11px]">
                                  시간
                                </span>
                              </div>
                              <div className="flex items-center border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
                                <input
                                  type="number"
                                  min={0}
                                  max={50}
                                  step={10}
                                  disabled={!canEdit}
                                  value={draft.daily_work_minutes}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      daily_work_minutes: Math.max(
                                        0,
                                        Number(e.target.value)
                                      ),
                                    })
                                  }
                                  className="w-10 font-bold text-slate-800 focus:outline-none"
                                />
                                <span className="text-slate-400 text-[11px]">
                                  분
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                추천 휴게 시간{" "}
                                <span className="text-slate-400 font-medium">
                                  (선택)
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                구성원들의 권장 휴게 시간을 입력해주세요.
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5">
                                <select
                                  disabled={!canEdit}
                                  value={draft.break_start_1 || ""}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      break_start_1: e.target.value,
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700"
                                >
                                  <option value="">시작 시각</option>
                                  {TIME_OPTIONS_30M.map((hm) => (
                                    <option key={hm} value={hm}>
                                      {formatHmToKoreanAmPm(hm)}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-slate-300">→</span>
                                <select
                                  disabled={!canEdit}
                                  value={draft.break_end_1 || ""}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      break_end_1: e.target.value,
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700"
                                >
                                  <option value="">종료 시각</option>
                                  {TIME_OPTIONS_30M.map((hm) => (
                                    <option key={hm} value={hm}>
                                      {formatHmToKoreanAmPm(hm)}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <select
                                  disabled={!canEdit}
                                  value={draft.break_start_2 || ""}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      break_start_2: e.target.value,
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-400"
                                >
                                  <option value="">시작 시각</option>
                                  {TIME_OPTIONS_30M.map((hm) => (
                                    <option key={hm} value={hm}>
                                      {formatHmToKoreanAmPm(hm)}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-slate-300">→</span>
                                <select
                                  disabled={!canEdit}
                                  value={draft.break_end_2 || ""}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      break_end_2: e.target.value,
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-400"
                                >
                                  <option value="">종료 시각</option>
                                  {TIME_OPTIONS_30M.map((hm) => (
                                    <option key={hm} value={hm}>
                                      {formatHmToKoreanAmPm(hm)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 주휴 시간 · 휴가 휴게 시간 카드 (Image 3 하단 동일) */}
                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                주휴 시간 · 휴가 1일 기준 시간 별도 설정{" "}
                                <span className="text-slate-300">ⓘ</span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                주휴 시간과 휴가 1일의 기준 시간을 일하는 시간과 다르게 설정할 수 있어요.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  custom_leave_day_hours:
                                    !draft.custom_leave_day_hours,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.custom_leave_day_hours
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.custom_leave_day_hours
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                휴가 사용 시 휴게 시간 포함 여부
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                반차 또는 시간차 사용 시, 휴게를 포함할지 선택할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.leave_include_break_mode}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  leave_include_break_mode:
                                    e.target.value as HqWorkRuleItem["leave_include_break_mode"],
                                })
                              }
                              className="px-2 py-1 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="구성원이 사용 시 선택">
                                구성원이 사용 시 선택
                              </option>
                              <option value="휴게 시간 제외">휴게 시간 제외</option>
                              <option value="휴게 시간 포함">휴게 시간 포함</option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                휴가에 포함할 휴게 시간
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                반차 또는 시간차에 포함할 휴게 시간을 입력해주세요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.leave_break_duration}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  leave_break_duration:
                                    e.target.value as HqWorkRuleItem["leave_break_duration"],
                                })
                              }
                              className="px-2 py-1 rounded-lg font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="30분">30분</option>
                              <option value="1시간">1시간</option>
                              <option value="1시간 30분">1시간 30분</option>
                              <option value="2시간">2시간</option>
                            </select>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* SUB-PAGE 2: 적용 구성원 (Image 10 동일)                */}
                  {/* ===================================================== */}
                  {subPage === "members" && (
                    <div className="space-y-6 max-w-[600px]">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          적용 구성원
                        </h3>
                        <p className="text-slate-400 mt-1">
                          이 근무 유형이 적용된 구성원 현황이에요.
                        </p>
                      </div>

                      <div className="border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-5">
                          {(
                            [
                              {
                                key: "ACTIVE",
                                label: "적용 중",
                                cnt: activeAssigned.length,
                              },
                              {
                                key: "SCHEDULED",
                                label: "적용 예정",
                                cnt: scheduledAssigned.length,
                              },
                              {
                                key: "PAST",
                                label: "과거 적용",
                                cnt: pastDisplayCount,
                              },
                            ] as const
                          ).map((tab) => {
                            const active = memberSubTab === tab.key;
                            return (
                              <button
                                key={tab.key}
                                type="button"
                                onClick={() => setMemberSubTab(tab.key)}
                                className={`pb-3 border-b-2 flex items-center gap-1.5 font-bold transition-colors ${
                                  active
                                    ? "border-slate-900 text-slate-900"
                                    : "border-transparent text-slate-400 hover:text-slate-600"
                                }`}
                              >
                                <span>{tab.label}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                                    active
                                      ? "bg-slate-800 text-white"
                                      : "bg-slate-200/80 text-slate-500"
                                  }`}
                                >
                                  {tab.cnt}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAddName(
                                candidatePool[0]?.name || ""
                              );
                              setSelectedAddStatus("ACTIVE");
                              setSelectedAddFromLabel("입사일 부터 적용 중");
                              setAddMemberOpen(true);
                            }}
                            className="mb-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 shadow-2xs"
                          >
                            + 적용 대상 추가
                          </button>
                        )}
                      </div>

                      <div className="divide-y divide-slate-100">
                        {(() => {
                          const list =
                            memberSubTab === "ACTIVE"
                              ? activeAssigned
                              : memberSubTab === "SCHEDULED"
                                ? scheduledAssigned
                                : pastAssigned;

                          if (list.length === 0) {
                            return (
                              <div className="py-16 text-center text-slate-400">
                                {memberSubTab === "PAST" &&
                                pastDisplayCount > 0
                                  ? `이전 기간에 이 근무 유형이 적용되었던 이력이 ${pastDisplayCount}건 있습니다.`
                                  : "해당 상태의 적용 구성원이 없어요."}
                              </div>
                            );
                          }

                          return list.map((m) => (
                            <div
                              key={m.id}
                              className="group py-3.5 flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-[160px]">
                                <span
                                  style={{
                                    backgroundColor: m.avatar_bg || "#9ba8cf",
                                  }}
                                  className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center shrink-0"
                                >
                                  {shortAvatarText(m.name)}
                                </span>
                                <div>
                                  <div className="font-bold text-slate-900">
                                    {m.name}
                                  </div>
                                  {m.job_label && (
                                    <div className="text-[11px] text-slate-400">
                                      {m.job_label}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex-1 text-slate-500 font-medium">
                                {m.applied_from_label}
                              </div>

                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      assigned_members:
                                        draft.assigned_members.filter(
                                          (x) => x.id !== m.id
                                        ),
                                    })
                                  }
                                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 font-semibold"
                                >
                                  제외
                                </button>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* SUB-PAGE 3: 초과 근무 (Image 4 동일)                   */}
                  {/* ===================================================== */}
                  {subPage === "overtime" && (
                    <div className="space-y-7 max-w-[600px]">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          초과 근무
                        </h3>
                        <p className="text-slate-400 mt-1">
                          구성원의 초과 근무 입력 정책을 항목별로 설정할 수 있어요.
                        </p>
                      </div>

                      {/* 초과 근무 한도 주기 */}
                      <section className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[13px] font-extrabold text-slate-800">
                            초과 근무 한도 주기
                          </h4>
                          <span className="text-[11px] font-extrabold text-[#00a84d]">
                            ● 연장·야간·휴일 공통
                          </span>
                        </div>

                        <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                          <select
                            disabled={!canEdit}
                            value={draft.overtime_cycle_unit}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                overtime_cycle_unit:
                                  e.target.value as HqWorkRuleItem["overtime_cycle_unit"],
                              })
                            }
                            className="font-semibold text-slate-700 bg-transparent focus:outline-none"
                          >
                            <option value="월 단위">월 단위</option>
                            <option value="주 단위">주 단위</option>
                          </select>

                          <select
                            disabled={!canEdit}
                            value={draft.overtime_cycle_day}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                overtime_cycle_day: e.target.value,
                              })
                            }
                            className="font-bold text-slate-700 bg-transparent focus:outline-none"
                          >
                            <option value="매월 1일">매월 1일</option>
                            <option value="매월 15일">매월 15일</option>
                            <option value="매월 25일">매월 25일</option>
                          </select>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          ⓘ 초과 근무 한도가 있을 때 판단하는 기준이에요. 주 단위는 기본 설정의 근무 주기({draft.cycle_start_day})를 따라요.
                        </p>
                      </section>

                      {/* 연장 근무 */}
                      <section className="space-y-3">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          연장 근무
                        </h4>

                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                연장 근무 허용
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                소정근로시간을 초과한 근무가 연장 근무로 집계돼요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.overtime_allow_mode}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  overtime_allow_mode:
                                    e.target.value as HqWorkRuleItem["overtime_allow_mode"],
                                })
                              }
                              className="font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="한도 없이 허용">한도 없이 허용</option>
                              <option value="주 12시간 한도 내 허용">
                                주 12시간 한도 내 허용
                              </option>
                              <option value="허용 안 함">허용 안 함</option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                법정근로시간 내 연장과 일반 연장을 구분해서 사용{" "}
                                <span className="text-slate-300">ⓘ</span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                소정근로시간 초과 근무 시, 법정근로시간 초과 여부에 따라 항목을 분리해서 산정해요.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  split_within_statutory_overtime:
                                    !draft.split_within_statutory_overtime,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.split_within_statutory_overtime
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.split_within_statutory_overtime
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                입력 단위 제한
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                연장 근무 입력 시 입력 시간 단위를 제한할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.overtime_input_unit}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  overtime_input_unit:
                                    e.target.value as HqWorkRuleItem["overtime_input_unit"],
                                })
                              }
                              className="font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="제한 안 함">제한 안 함</option>
                              <option value="10분 단위">10분 단위</option>
                              <option value="30분 단위">30분 단위</option>
                              <option value="1시간 단위">1시간 단위</option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                최소 시간 제한
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                연장 근무 입력 시 최소 시간을 제한할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.overtime_min_duration}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  overtime_min_duration:
                                    e.target.value as HqWorkRuleItem["overtime_min_duration"],
                                })
                              }
                              className="font-bold text-slate-700 bg-transparent focus:outline-none"
                            >
                              <option value="제한 안 함">제한 안 함</option>
                              <option value="30분 이상">30분 이상</option>
                              <option value="1시간 이상">1시간 이상</option>
                            </select>
                          </div>
                        </div>
                      </section>

                      {/* 야간 근무 */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          야간 근무
                        </h4>
                        <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              야간 근무 허용
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              22시부터 다음 날 6시 사이의 근무가 야간 근무로 집계돼요.
                            </div>
                          </div>
                          <select
                            disabled={!canEdit}
                            value={draft.night_work_allow_mode}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                night_work_allow_mode:
                                  e.target.value as HqWorkRuleItem["night_work_allow_mode"],
                              })
                            }
                            className="font-bold text-slate-700 bg-transparent focus:outline-none"
                          >
                            <option value="한도 없이 허용">한도 없이 허용</option>
                            <option value="허용 안 함">허용 안 함</option>
                          </select>
                        </div>
                      </section>

                      {/* 휴일 근무 */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          휴일 근무
                        </h4>
                        <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              휴일 근무 허용
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              주휴일 및 회사 지정 쉬는 날의 근무가 휴일 근무로 집계돼요.
                            </div>
                          </div>
                          <select
                            disabled={!canEdit}
                            value={draft.holiday_work_allow_mode}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                holiday_work_allow_mode:
                                  e.target.value as HqWorkRuleItem["holiday_work_allow_mode"],
                              })
                            }
                            className="font-bold text-slate-700 bg-transparent focus:outline-none"
                          >
                            <option value="한도 없이 허용">한도 없이 허용</option>
                            <option value="허용 안 함">허용 안 함</option>
                          </select>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* SUB-PAGE 4: 실시간 근무 기록 (Images 5 & 6 동일)        */}
                  {/* ===================================================== */}
                  {subPage === "realtime" && (
                    <div className="space-y-7 max-w-[600px]">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          실시간 근무 기록
                        </h3>
                        <p className="text-slate-400 mt-1">
                          구성원의 실시간 근무 기록 기능을 제어하거나 세부 설정을 조작할 수 있어요.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              실시간 근무 기록 사용
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              구성원이 웹, 모바일 앱, 외부 연동 등을 통해 실시간으로 재직 시간을 기록할 수 있어요.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                realtime_enabled: !draft.realtime_enabled,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.realtime_enabled
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.realtime_enabled
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          ⓘ 실시간 근무 기록을 해당 날짜의 근무 시간으로 반영할 수 있어요. (현재 설정 :{" "}
                          {draft.reflect_realtime_to_work_hours
                            ? "반영 함"
                            : "반영 안 함"}
                          ){" "}
                          <button
                            type="button"
                            onClick={() => setSubPage("advanced")}
                            className="text-blue-600 font-bold hover:underline"
                          >
                            설정 변경
                          </button>
                        </p>
                      </div>

                      {/* 정시 출·퇴근 설정 */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          정시 출 · 퇴근 설정
                        </h4>

                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                          {/* 미리보기 박스 (Image 5 동일) */}
                          <div className="p-4 bg-[#f8f9fa]">
                            <div className="rounded-xl bg-white border border-slate-200/80 p-4 space-y-3">
                              <div className="grid grid-cols-3 text-[11px] text-slate-400 font-bold">
                                <div>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-600 text-white text-[10px]">
                                    미리보기
                                  </span>
                                </div>
                                <div>정시 출근</div>
                                <div>정시 퇴근</div>
                              </div>

                              <div className="grid grid-cols-3 items-center pt-1">
                                <div className="text-slate-500 font-semibold">
                                  기본 <span className="text-slate-300">ⓘ</span>
                                </div>
                                <div>
                                  <div className="font-extrabold text-slate-800">
                                    {previewTimes.checkInLabel}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {previewTimes.checkInGraceLabel}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-extrabold text-slate-800">
                                    {previewTimes.checkOutLabel}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {previewTimes.checkOutGraceLabel}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 items-center pt-2 border-t border-slate-100">
                                <div className="text-slate-500 font-semibold">
                                  계획 입력 시{" "}
                                  <span className="text-slate-300">ⓘ</span>
                                </div>
                                <div>
                                  <div className="font-extrabold text-slate-800">
                                    입력한 계획 시작 시각
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {draft.grace_minutes}분 후까지 정시 출근 가능
                                  </div>
                                </div>
                                <div>
                                  <div className="font-extrabold text-slate-800">
                                    입력한 계획 종료 시각
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {draft.grace_minutes}분 전부터 정시 퇴근 가능
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                정시 출 · 퇴근 인정 범위
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                설정한 시간 범위 내라면, 기록 시작 · 종료 시각을 정시 출 · 퇴근 시각으로 기록할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.grace_minutes}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  grace_minutes: Number(e.target.value),
                                })
                              }
                              className="font-bold text-slate-800 bg-transparent focus:outline-none"
                            >
                              <option value={0}>0분</option>
                              <option value={5}>5분</option>
                              <option value={10}>10분</option>
                              <option value={15}>15분</option>
                              <option value={30}>30분</option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                출근 기록 시각을 반영한 정시 퇴근
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                정시 퇴근 시각 판단 시, 출근 기록 시각 반영 여부를 정할 수 있어요.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  reflect_checkin_on_checkout:
                                    !draft.reflect_checkin_on_checkout,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.reflect_checkin_on_checkout
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.reflect_checkin_on_checkout
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </section>

                      {/* 기록 설정 (Image 6 동일) */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          기록 설정
                        </h4>

                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                          <div className="p-4 bg-[#f8f9fa]">
                            <div className="rounded-xl bg-white border border-slate-200/80 p-4 text-center relative">
                              <span className="absolute left-3 top-3 px-1.5 py-0.5 rounded bg-slate-600 text-white text-[10px] font-bold">
                                미리보기
                              </span>
                              <div className="text-[11px] text-slate-400 font-semibold">
                                출근 기록 가능 ⓘ
                              </div>
                              <div className="font-extrabold text-slate-800 mt-1">
                                {previewTimes.checkInLabel} 혹은 계획 시작 시각 부터
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                둘 중 더 빠른 시각부터 출근 기록 가능
                              </div>
                            </div>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                정시 출근 시각보다 이른 출근 기록 허용
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                허용 시, 정시 출근 시각 이전에도 근무를 기록할 수 있어요.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  allow_early_checkin:
                                    !draft.allow_early_checkin,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.allow_early_checkin
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.allow_early_checkin
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                휴게 시간을 기록할 수 있도록 허용
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                허용 시, 구성원이 직접 휴게 시간을 기록할 수 있어요.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  allow_manual_break_log:
                                    !draft.allow_manual_break_log,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.allow_manual_break_log
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.allow_manual_break_log
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                퇴근 기록 누락 시 처리 방식
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                구성원이 실시간 기록을 직접 종료하지 않은 경우, 어떻게 처리할지 정할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.missing_checkout_policy}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  missing_checkout_policy:
                                    e.target.value as HqWorkRuleItem["missing_checkout_policy"],
                                })
                              }
                              className="font-bold text-slate-800 bg-transparent focus:outline-none"
                            >
                              <option value="출근 기록만 남김">
                                출근 기록만 남김
                              </option>
                              <option value="정시 퇴근 시각으로 자동 기록">
                                정시 퇴근 시각으로 자동 기록
                              </option>
                              <option value="기록 삭제">기록 삭제</option>
                            </select>
                          </div>
                        </div>
                      </section>

                      {/* 기록 종료 및 퇴근 시 설정 (Image 6 하단 동일) */}
                      <section className="space-y-2.5">
                        <h4 className="text-[13px] font-extrabold text-slate-800">
                          기록 종료 및 퇴근 시 설정{" "}
                          <span className="text-slate-300">ⓘ</span>
                        </h4>

                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                          <div className="p-5 bg-[#f8f9fa] flex items-center justify-center relative">
                            <span className="absolute left-4 top-4 px-1.5 py-0.5 rounded bg-slate-600 text-white text-[10px] font-bold">
                              미리보기
                            </span>
                            <div className="w-44 p-3 rounded-xl bg-white border border-slate-200 shadow-sm space-y-2">
                              <div className="h-6 rounded bg-slate-100" />
                              <div className="py-2 rounded-lg bg-[#00c458] text-white font-extrabold text-center flex items-center justify-between px-3">
                                <span className="flex-1 text-center">
                                  지금 퇴근
                                </span>
                                <span className="text-white/80 pl-2 border-l border-white/30">
                                  ⋮
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                기본 퇴근 방식
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                퇴근 기록 시 기본 동작을 정할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.default_checkout_mode}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  default_checkout_mode:
                                    e.target.value as HqWorkRuleItem["default_checkout_mode"],
                                })
                              }
                              className="font-bold text-slate-800 bg-transparent focus:outline-none"
                            >
                              <option value="현재 시각으로 퇴근을 우선">
                                현재 시각으로 퇴근을 우선
                              </option>
                              <option value="정시 퇴근 시각을 우선">
                                정시 퇴근 시각을 우선
                              </option>
                            </select>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                퇴근 시 오늘의 근무 기록 확인
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                기록 종료 및 퇴근 시 근무 기록 확인과 수정 요청을 정할 수 있어요.
                              </div>
                            </div>
                            <select
                              disabled={!canEdit}
                              value={draft.checkout_confirm_mode}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  checkout_confirm_mode:
                                    e.target.value as HqWorkRuleItem["checkout_confirm_mode"],
                                })
                              }
                              className="font-bold text-slate-800 bg-transparent focus:outline-none"
                            >
                              <option value="항상 확인 후 퇴근하도록 제한">
                                항상 확인 후 퇴근하도록 제한
                              </option>
                              <option value="확인 없이 즉시 퇴근">
                                확인 없이 즉시 퇴근
                              </option>
                            </select>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* SUB-PAGE 5: 자동 근무 기록 (Image 7 동일)              */}
                  {/* ===================================================== */}
                  {subPage === "auto_record" && (
                    <div className="space-y-6 max-w-[600px]">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          자동 근무 기록
                        </h3>
                        <p className="text-slate-400 mt-1">
                          구성원의 자동 근무 기록 기능을 제어하거나 세부 설정을 조작할 수 있어요.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-slate-200 overflow-hidden">
                        {/* 스케줄 자동 채움 일러스트 (Image 7 동일) */}
                        <div className="p-6 bg-[#f8f9fa] flex justify-center relative overflow-hidden">
                          <div className="w-64 space-y-2.5 relative">
                            <div className="absolute top-0 bottom-0 left-[62%] w-[1.5px] bg-amber-700/40 z-10" />
                            {[
                              { fill: "full", done: true, opacity: "opacity-55" },
                              { fill: "full", done: true, opacity: "opacity-100" },
                              { fill: "half", done: false, opacity: "opacity-100" },
                              { fill: "none", done: false, opacity: "opacity-80" },
                              { fill: "none", done: false, opacity: "opacity-45" },
                            ].map((bar, i) => (
                              <div key={i} className={bar.opacity}>
                                <div className="h-6 rounded-md border border-dashed border-teal-300 bg-white overflow-hidden flex items-center relative">
                                  {bar.fill === "full" && (
                                    <div className="w-full h-full bg-teal-100/90 border border-teal-300 rounded-md" />
                                  )}
                                  {bar.fill === "half" && (
                                    <div className="w-[62%] h-full bg-teal-100/90 border-r border-teal-300" />
                                  )}
                                  <span className="absolute left-2 text-[10px]">
                                    💼
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[9px] text-slate-400 mt-0.5 px-0.5">
                                  <span>AM 9</span>
                                  <span>
                                    PM 6{" "}
                                    {bar.done && (
                                      <span className="text-emerald-500 font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="px-5 py-4 bg-white border-t border-slate-100 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              자동 근무 기록 사용
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              구성원의 근무 기록이 매일 자동으로 채워지도록 설정할 수 있어요.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                auto_record_enabled: !draft.auto_record_enabled,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.auto_record_enabled
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.auto_record_enabled
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400">
                        ⓘ 자동 근무 기록은 출근 시각 (
                        {formatHmToKoreanAmPm(draft.start_time)})부터 시작됩니다.
                      </p>
                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* SUB-PAGE 6: 고급 설정 (Image 8 동일)                   */}
                  {/* ===================================================== */}
                  {subPage === "advanced" && (
                    <div className="space-y-6 max-w-[600px]">
                      <h3 className="text-lg font-extrabold text-slate-900">
                        고급 설정
                      </h3>

                      <div className="space-y-2">
                        <div className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              실시간 근무 기록을 근무 시간으로 반영
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              반영 시, 실시간 근무 기록을 그대로 해당 날짜의 근무 시간에 등록해요.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                reflect_realtime_to_work_hours:
                                  !draft.reflect_realtime_to_work_hours,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.reflect_realtime_to_work_hours
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.reflect_realtime_to_work_hours
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          ⓘ 반영을 꺼도 근무 편집 권한이 있으면 근무 시간을 직접 입력·수정할 수 있어요.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                법정 최대근로시간(주 52시간)을 초과한 근무 등록 허용{" "}
                                <span className="text-slate-300">ⓘ</span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                구성원이 1주 최대근로시간을 초과한 근무를 등록할 수 있도록 허용합니다.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  allow_exceed_max_52h:
                                    !draft.allow_exceed_max_52h,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.allow_exceed_max_52h
                                  ? "bg-amber-400"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.allow_exceed_max_52h
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-bold text-slate-800">
                                법정 최소 휴게 시간을 미달한 근무 등록 허용
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                4시간마다 30분의 휴게 시간이 포함되지 않아도 근무를 등록할 수 있도록 허용합니다.
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  allow_insufficient_break:
                                    !draft.allow_insufficient_break,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.allow_insufficient_break
                                  ? "bg-amber-400"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.allow_insufficient_break
                                    ? "translate-x-5"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          ⓘ 법정 기준 제한을 허용하는 경우, 법적인 위험이 있을 수 있으므로 안내 사항을 확인해주세요.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 우하단 고정 저장 버튼 */}
                {canEdit && (
                  <div className="px-6 py-3.5 border-t border-slate-100 bg-white flex justify-end shrink-0">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveDraft}
                      className="px-5 py-2 rounded-lg bg-[#00c458] hover:bg-[#00ad4d] text-white text-xs font-extrabold shadow-xs transition-colors"
                    >
                      {saving ? "저장 중..." : "저장"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 적용 대상 추가 서브 다이얼로그 */}
            {addMemberOpen && (
              <div className="fixed inset-0 bg-slate-900/40 z-[85] flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-slate-900">
                      적용 대상 구성원 추가
                    </h4>
                    <button
                      type="button"
                      onClick={() => setAddMemberOpen(false)}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-5 space-y-3.5">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        구성원 선택
                      </label>
                      <select
                        value={selectedAddName}
                        onChange={(e) => setSelectedAddName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      >
                        {candidatePool.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                            {c.job_label ? ` (${c.job_label})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        적용 구분
                      </label>
                      <select
                        value={selectedAddStatus}
                        onChange={(e) =>
                          setSelectedAddStatus(
                            e.target.value as "ACTIVE" | "SCHEDULED"
                          )
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                      >
                        <option value="ACTIVE">현재 적용 중</option>
                        <option value="SCHEDULED">적용 예정</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        적용 시점 문구
                      </label>
                      <input
                        value={selectedAddFromLabel}
                        onChange={(e) =>
                          setSelectedAddFromLabel(e.target.value)
                        }
                        placeholder="예: 입사일 부터 적용 중 / 2026년 12월 1일 부터 적용 예정"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300"
                      />
                    </div>
                  </div>
                  <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddMemberOpen(false)}
                      className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-600"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedAddName) return;
                        if (
                          draft.assigned_members.some(
                            (x) =>
                              x.name === selectedAddName &&
                              x.status === selectedAddStatus
                          )
                        ) {
                          alert("이미 목록에 포함된 구성원입니다.");
                          return;
                        }
                        const found = candidatePool.find(
                          (c) => c.name === selectedAddName
                        );
                        const added: HqWorkRuleAssignedMember = {
                          id: `wm-${uid()}`,
                          name: selectedAddName,
                          job_label: found?.job_label || "",
                          avatar_bg: found?.avatar_bg || "#9ba8cf",
                          applied_from_label:
                            selectedAddFromLabel.trim() ||
                            "입사일 부터 적용 중",
                          status: selectedAddStatus,
                        };
                        setDraft({
                          ...draft,
                          assigned_members: [...draft.assigned_members, added],
                        });
                        setMemberSubTab(selectedAddStatus);
                        setAddMemberOpen(false);
                      }}
                      className="px-5 py-2 rounded-xl bg-[#00c458] text-white font-extrabold"
                    >
                      추가하기
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
