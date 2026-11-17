// src/app/hq/approvals/page.tsx
"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import ApprovalCreateModal from "@/components/hq/approvals/ApprovalCreateModal";
import ApprovalDetailModal from "@/components/hq/approvals/ApprovalDetailModal";
import WorkflowFormBuilderModal from "@/components/hq/approvals/WorkflowFormBuilderModal";
import WorkflowFormManagerDrawer from "@/components/hq/approvals/WorkflowFormManagerDrawer";
import WorkflowFormPickerModal from "@/components/hq/approvals/WorkflowFormPickerModal";
import { APPROVAL_DOC_META } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_APPROVAL_TEMPLATES,
} from "@/lib/hq/defaultApprovalPolicies";
import {
  DEFAULT_WORKFLOW_CATEGORIES,
  DEFAULT_WORKFLOW_FORMS,
  mergeFormsWithPolicies,
} from "@/lib/hq/defaultWorkflowForms";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqApprovalStatus,
  HqApprovalTemplate,
  HqWorkflowFormDef,
  HqWorkflowSavedView,
} from "@/lib/hq/types";

type ArchiveScope = "MY" | "COMPANY";
type SubTabKey = "IN_PROGRESS" | "COMPLETED" | "IMPORTANT" | "ALL";
type MyRoleFilter = "ALL" | "MINE" | "MY_TURN";
type SortMode = "UPDATED_DESC" | "CREATED_DESC" | "AMOUNT_DESC";
type GroupMode = "STATUS" | "FORM" | "NONE";
type DatePreset = "ALL" | "TODAY" | "7D" | "30D" | "90D" | "YEAR";

const AVATAR_PALETTE = [
  "#9ba8cf",
  "#34d399",
  "#f87171",
  "#60a5fa",
  "#fb923c",
  "#a78bfa",
  "#2dd4bf",
  "#f472b6",
];

function getAvatarBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function formatKoreanMonthDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function HqApprovalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    me,
    members,
    companySettings,
    isHqAdmin,
    refreshApprovalBadge,
    refreshMembers,
    refreshCompanySettings,
  } = useHqShell();

  const [docs, setDocs] = useState<HqApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [canViewCompanyArchive, setCanViewCompanyArchive] = useState(false);
  const [canDeleteCompanyDoc, setCanDeleteCompanyDoc] = useState(false);

  // 양식 및 개인 설정 (즐겨찾기 / 보기 저장)
  const [categories, setCategories] = useState<string[]>(
    DEFAULT_WORKFLOW_CATEGORIES
  );
  const [forms, setForms] = useState<HqWorkflowFormDef[]>(
    DEFAULT_WORKFLOW_FORMS
  );
  const [approvalTemplates, setApprovalTemplates] = useState<
    HqApprovalTemplate[]
  >(DEFAULT_APPROVAL_TEMPLATES);
  const [canManageForms, setCanManageForms] = useState(false);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<HqWorkflowSavedView[]>([]);

  // 상단 탭 & 서브 탭 & 보기 옵션
  const [scope, setScope] = useState<ArchiveScope>("MY");
  const [subTab, setSubTab] = useState<SubTabKey>("IN_PROGRESS");
  const [myRoleFilter, setMyRoleFilter] = useState<MyRoleFilter>("ALL");

  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("UPDATED_DESC");
  const [groupMode, setGroupMode] = useState<GroupMode>("STATUS");

  // 필터 상태
  const [drafterIds, setDrafterIds] = useState<string[]>([]);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [ccNames, setCcNames] = useState<string[]>([]);
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<HqApprovalStatus[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");

  // 열린 필터 팝오버
  const [openPopover, setOpenPopover] = useState<
    | null
    | "DRAFTER"
    | "FORM"
    | "DATE"
    | "MORE"
    | "SORT"
    | "GROUP"
    | "VIEWS"
    | "APPROVER"
    | "CC"
    | "STATUS"
  >(null);
  const [memberFilterSearch, setMemberFilterSearch] = useState("");
  const [formFilterSearch, setFormFilterSearch] = useState("");

  // 그룹 접기 토글
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {}
  );

  // 모달 & 드로어 상태
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<HqWorkflowFormDef | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [defaultDocType, setDefaultDocType] =
    useState<HqApprovalDocType>("GENERAL");
  const [defaultPolicyId, setDefaultPolicyId] = useState<string | null>(null);
  const [presetRefDoc, setPresetRefDoc] = useState<HqApprovalDoc | null>(null);
  const [cloneSourceDoc, setCloneSourceDoc] = useState<HqApprovalDoc | null>(
    null
  );

  const [selectedDoc, setSelectedDoc] = useState<HqApprovalDoc | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [appRes, wfRes] = await Promise.all([
        hqFetch<{
          success: boolean;
          data: {
            docs: HqApprovalDoc[];
            myPendingCount: number;
            canViewCompanyArchive?: boolean;
            canDeleteCompanyDoc?: boolean;
          };
        }>("/api/hq/approvals"),
        hqFetch<{
          success: boolean;
          data: {
            categories: string[];
            forms: HqWorkflowFormDef[];
            starredDocIds: string[];
            savedViews: HqWorkflowSavedView[];
            approvalTemplates: HqApprovalTemplate[];
            canManageForms: boolean;
          };
        }>("/api/hq/workflows").catch(() => null),
      ]);

      const docList = appRes.data?.docs || [];
      setDocs(docList);
      setCanViewCompanyArchive(Boolean(appRes.data?.canViewCompanyArchive));
      setCanDeleteCompanyDoc(Boolean(appRes.data?.canDeleteCompanyDoc));

      if (wfRes?.data) {
        setCategories(wfRes.data.categories || DEFAULT_WORKFLOW_CATEGORIES);
        setForms(wfRes.data.forms || DEFAULT_WORKFLOW_FORMS);
        setStarredIds(wfRes.data.starredDocIds || []);
        setSavedViews(wfRes.data.savedViews || []);
        setApprovalTemplates(
          wfRes.data.approvalTemplates || DEFAULT_APPROVAL_TEMPLATES
        );
        setCanManageForms(Boolean(wfRes.data.canManageForms));
      } else {
        const wfPols = (
          companySettings?.extra_settings?.approval_policies ||
          DEFAULT_APPROVAL_POLICIES
        ).filter((p) => p.category === "workflow");
        setForms(mergeFormsWithPolicies(DEFAULT_WORKFLOW_FORMS, wfPols));
      }
      return docList;
    } catch {
      setDocs([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [companySettings?.extra_settings?.approval_policies]);

  useEffect(() => {
    loadAll().then((list) => {
      if (!me) return;
      const myDocs = list.filter(
        (d) =>
          d.drafter_id === me.instructor_id ||
          d.steps.some((s) => s.approver_id === me.instructor_id) ||
          d.workflow_meta?.cc_member_ids?.includes(me.instructor_id) ||
          d.workflow_meta?.cc_member_names?.includes(me.name)
      );
      const hasInProgress = myDocs.some(
        (d) => d.status === "PENDING" || d.status === "IN_PROGRESS"
      );
      // 진행중 문서가 없고 완료 문서만 있으면 자동으로 [전체] 탭을 보여줌
      if (!hasInProgress && myDocs.length > 0) {
        setSubTab("ALL");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.instructor_id]);

  // URL 쿼리 (?new=1&type=...&policy=...) 진입 지원
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      const reqType = searchParams.get("type") as HqApprovalDocType | null;
      const reqPolicy = searchParams.get("policy");
      setDefaultDocType(
        reqType && ["GENERAL", "LEAVE", "PURCHASE", "EXPENSE"].includes(reqType)
          ? reqType
          : "GENERAL"
      );
      setDefaultPolicyId(reqPolicy || null);
      setPresetRefDoc(null);
      setCloneSourceDoc(null);
      setCreateOpen(true);
      router.replace("/hq/approvals");
    }
  }, [searchParams, router]);

  const isMyDoc = useCallback(
    (doc: HqApprovalDoc) => {
      if (!me) return false;
      if (doc.drafter_id === me.instructor_id) return true;
      if (doc.steps.some((s) => s.approver_id === me.instructor_id)) return true;
      const ccIds = doc.workflow_meta?.cc_member_ids || [];
      const ccList = doc.workflow_meta?.cc_member_names || [];
      return ccIds.includes(me.instructor_id) || ccList.includes(me.name);
    },
    [me]
  );

  const isMyCurrentTurn = useCallback(
    (doc: HqApprovalDoc) => {
      if (!me) return false;
      if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") return false;
      const cur = doc.steps.find(
        (s) => Number(s.step_order) === Number(doc.current_step_order)
      );
      return Boolean(
        cur && cur.approver_id === me.instructor_id && cur.status === "CURRENT"
      );
    },
    [me]
  );

  const myTurnCount = useMemo(
    () => docs.filter((d) => isMyCurrentTurn(d)).length,
    [docs, isMyCurrentTurn]
  );

  const resolveDocFormTitle = useCallback((doc: HqApprovalDoc) => {
    if (doc.workflow_meta?.form_title) return doc.workflow_meta.form_title;
    const meta = APPROVAL_DOC_META[doc.doc_type] || APPROVAL_DOC_META.GENERAL;
    return meta.label;
  }, []);

  const resolveDocFormId = useCallback((doc: HqApprovalDoc) => {
    return doc.workflow_meta?.form_id || `legacy-${doc.doc_type}`;
  }, []);

  // 문서함 범위(내 문서함 vs 회사 문서함) + 서브탭 + 상세 필터 적용
  const filteredDocs = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const nowMs = Date.now();

    const list = docs.filter((doc) => {
      // 1) 내 문서함 vs 회사 문서함 구분
      if (scope === "MY" && !isMyDoc(doc)) return false;

      // 2) 서브 탭 필터
      const isProg = doc.status === "PENDING" || doc.status === "IN_PROGRESS";
      if (subTab === "IN_PROGRESS" && !isProg) return false;
      if (subTab === "COMPLETED" && isProg) return false;
      if (subTab === "IMPORTANT" && !starredIds.includes(doc.approval_id)) {
        return false;
      }

      // 3) 내 문서함 내 [전체 | 내가 작성한 | 내 결재 차례] 세그먼트
      if (scope === "MY") {
        if (myRoleFilter === "MINE" && doc.drafter_id !== me?.instructor_id) {
          return false;
        }
        if (myRoleFilter === "MY_TURN" && !isMyCurrentTurn(doc)) {
          return false;
        }
      }

      // 4) 작성자 필터
      if (drafterIds.length > 0 && !drafterIds.includes(doc.drafter_id)) {
        return false;
      }

      // 5) 승인자 필터
      if (
        approverIds.length > 0 &&
        !doc.steps.some((s) => approverIds.includes(s.approver_id))
      ) {
        return false;
      }

      // 6) 참조자 필터
      if (ccNames.length > 0) {
        const docCc = doc.workflow_meta?.cc_member_names || [];
        if (!ccNames.some((n) => docCc.includes(n))) return false;
      }

      // 7) 양식 필터
      if (selectedFormIds.length > 0) {
        const fId = resolveDocFormId(doc);
        const fTitle = resolveDocFormTitle(doc);
        const matched = selectedFormIds.some((selId) => {
          const formObj = forms.find((f) => f.id === selId);
          return selId === fId || (formObj && formObj.title === fTitle);
        });
        if (!matched) return false;
      }

      // 8) 상세 문서 상태 필터
      if (statusFilters.length > 0 && !statusFilters.includes(doc.status)) {
        return false;
      }

      // 9) 업데이트일 프리셋 필터
      if (datePreset !== "ALL") {
        const ts = new Date(doc.updated_at || doc.submitted_at).getTime();
        if (!Number.isNaN(ts)) {
          const diffDays = (nowMs - ts) / (1000 * 60 * 60 * 24);
          if (datePreset === "TODAY" && diffDays > 1) return false;
          if (datePreset === "7D" && diffDays > 7) return false;
          if (datePreset === "30D" && diffDays > 30) return false;
          if (datePreset === "90D" && diffDays > 90) return false;
          if (datePreset === "YEAR") {
            const yr = new Date(ts).getFullYear();
            if (yr !== new Date().getFullYear()) return false;
          }
        }
      }

      // 10) 키워드 검색
      if (q) {
        const hay = [
          doc.title,
          doc.doc_no,
          doc.content,
          doc.drafter_name,
          doc.drafter_dept,
          resolveDocFormTitle(doc),
          doc.merchant_name || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    // 정렬
    return [...list].sort((a, b) => {
      if (sortMode === "AMOUNT_DESC") return (b.amount || 0) - (a.amount || 0);
      if (sortMode === "CREATED_DESC") {
        return (
          new Date(b.submitted_at).getTime() -
          new Date(a.submitted_at).getTime()
        );
      }
      return (
        new Date(b.updated_at || b.submitted_at).getTime() -
        new Date(a.updated_at || a.submitted_at).getTime()
      );
    });
  }, [
    docs,
    scope,
    subTab,
    myRoleFilter,
    starredIds,
    drafterIds,
    approverIds,
    ccNames,
    selectedFormIds,
    statusFilters,
    datePreset,
    keyword,
    sortMode,
    me,
    forms,
    isMyDoc,
    isMyCurrentTurn,
    resolveDocFormId,
    resolveDocFormTitle,
  ]);

  // 그룹핑 (진행중 문서 / 완료 문서 등 — Screenshots 1 & 3)
  const groupedSections = useMemo(() => {
    if (groupMode === "NONE") {
      return [{ key: "ALL", label: `전체 문서 ${filteredDocs.length}`, items: filteredDocs }];
    }
    if (groupMode === "FORM") {
      const map = new Map<string, HqApprovalDoc[]>();
      filteredDocs.forEach((d) => {
        const ft = resolveDocFormTitle(d);
        map.set(ft, [...(map.get(ft) || []), d]);
      });
      return Array.from(map.entries()).map(([ft, items]) => ({
        key: `form-${ft}`,
        label: `${ft} ${items.length}`,
        items,
      }));
    }
    const inProg = filteredDocs.filter(
      (d) => d.status === "PENDING" || d.status === "IN_PROGRESS"
    );
    const done = filteredDocs.filter(
      (d) => d.status !== "PENDING" && d.status !== "IN_PROGRESS"
    );
    const sections: { key: string; label: string; items: HqApprovalDoc[] }[] = [];
    if (inProg.length > 0) {
      sections.push({
        key: "IN_PROGRESS",
        label: `진행중 문서 ${inProg.length}`,
        items: inProg,
      });
    }
    if (done.length > 0) {
      sections.push({
        key: "DONE",
        label: `완료 문서 ${done.length}`,
        items: done,
      });
    }
    return sections;
  }, [filteredDocs, groupMode, resolveDocFormTitle]);

  const resetFilters = () => {
    setMyRoleFilter("ALL");
    setDrafterIds([]);
    setApproverIds([]);
    setCcNames([]);
    setSelectedFormIds([]);
    setStatusFilters([]);
    setDatePreset("ALL");
    setKeyword("");
    setOpenPopover(null);
  };

  const handleToggleStar = async (approvalId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const optimistic = starredIds.includes(approvalId)
      ? starredIds.filter((id) => id !== approvalId)
      : [...starredIds, approvalId];
    setStarredIds(optimistic);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { starredDocIds: string[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: { action: "TOGGLE_STAR", approval_id: approvalId },
      });
      setStarredIds(res.data.starredDocIds || optimistic);
    } catch {
      // ignore
    }
  };

  const handleSaveCurrentView = async () => {
    const viewName = prompt(
      "현재 필터 조건을 저장할 [보기 이름]을 입력해 주세요.",
      scope === "COMPANY" ? "회사 진행중 지출문서" : "내가 확인중인 문서"
    );
    if (!viewName || !viewName.trim()) return;
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { savedViews: HqWorkflowSavedView[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: {
          action: "SAVE_VIEW",
          view: {
            id: `vw-${Date.now()}`,
            name: viewName.trim(),
            scope,
            subTab,
            myRoleFilter,
            drafterIds,
            approverIds,
            ccIds: ccNames,
            formIds: selectedFormIds,
            statusFilters,
            datePreset,
          },
        },
      });
      setSavedViews(res.data.savedViews || []);
      alert(`✅ [${viewName.trim()}] 보기가 저장되었습니다.`);
    } catch (e: any) {
      alert(e?.message || "보기 저장 실패");
    }
  };

  const applySavedView = (vw: HqWorkflowSavedView) => {
    if (vw.scope === "COMPANY" && !canViewCompanyArchive) {
      alert("회사 문서함 열람 권한이 없습니다.");
      return;
    }
    setScope(vw.scope);
    setSubTab((vw.subTab as SubTabKey) || "ALL");
    setMyRoleFilter(vw.myRoleFilter || "ALL");
    setDrafterIds(vw.drafterIds || []);
    setApproverIds(vw.approverIds || []);
    setCcNames(vw.ccIds || []);
    setSelectedFormIds(vw.formIds || []);
    setStatusFilters(vw.statusFilters || []);
    setDatePreset((vw.datePreset as DatePreset) || "ALL");
    setOpenPopover(null);
  };

  const handleDeleteSavedView = async (viewId: string) => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { savedViews: HqWorkflowSavedView[] };
      }>("/api/hq/workflows", {
        method: "POST",
        body: { action: "DELETE_VIEW", view_id: viewId },
      });
      setSavedViews(res.data.savedViews || []);
    } catch {
      // ignore
    }
  };

  const handleRefreshAll = async () => {
    await Promise.all([
      loadAll(),
      refreshApprovalBadge(),
      refreshMembers(),
    ]);
  };

  const sortedMembersForFilter = useMemo(() => {
    const q = memberFilterSearch.trim().toLowerCase();
    return [...members]
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .filter((m) => {
        if (!q) return true;
        return `${m.name} ${m.department}`.toLowerCase().includes(q);
      });
  }, [members, memberFilterSearch]);

  const datePresetLabel: Record<DatePreset, string> = {
    ALL: "업데이트일",
    TODAY: "오늘",
    "7D": "지난 1주일",
    "30D": "지난 1개월",
    "90D": "지난 3개월",
    YEAR: `${new Date().getFullYear()}년 전체`,
  };

  return (
    <>
      <div
        className="min-h-[calc(100vh-64px)] bg-white print:hidden"
        onClick={() => setOpenPopover(null)}
      >
        <div className="max-w-[1440px] mx-auto px-6 sm:px-8 pt-7 pb-12 space-y-4">
          {/* ================= 1. 상단 헤더: 내 문서함 / 회사 문서함 + 우측 액션 버튼 ================= */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => {
                  setScope("MY");
                  setSubTab("IN_PROGRESS");
                }}
                className={`text-2xl font-extrabold tracking-tight transition-colors ${
                  scope === "MY"
                    ? "text-slate-900"
                    : "text-slate-300 hover:text-slate-500"
                }`}
              >
                내 문서함
              </button>

              {canViewCompanyArchive && (
                <button
                  type="button"
                  onClick={() => {
                    setScope("COMPANY");
                    if (subTab === "IMPORTANT") setSubTab("IN_PROGRESS");
                  }}
                  className={`text-2xl font-extrabold tracking-tight transition-colors ${
                    scope === "COMPANY"
                      ? "text-slate-900"
                      : "text-slate-300 hover:text-slate-500"
                  }`}
                >
                  회사 문서함
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-extrabold text-slate-800 flex items-center gap-2 shadow-2xs transition-colors"
              >
                <span>🗂️</span>
                <span>문서 양식 관리</span>
              </button>

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <span>✎</span>
                <span>문서 작성하기</span>
              </button>
            </div>
          </div>

          {/* ================= 2. 서브 탭 & 우측 검색·정렬·그룹·보기 툴바 ================= */}
          <div className="border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-6">
              {(
                [
                  { key: "IN_PROGRESS", label: "진행중" },
                  { key: "COMPLETED", label: "완료" },
                  ...(scope === "MY"
                    ? [{ key: "IMPORTANT", label: "중요" }]
                    : []),
                  { key: "ALL", label: "전체" },
                ] as { key: SubTabKey; label: string }[]
              ).map((t) => {
                const active = subTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSubTab(t.key)}
                    className={`pb-3 text-[14px] font-extrabold border-b-2 transition-colors flex items-center gap-1.5 ${
                      active
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    <span>{t.label}</span>
                    {t.key === "IN_PROGRESS" &&
                      scope === "MY" &&
                      myTurnCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold leading-none">
                          {myTurnCount}
                        </span>
                      )}
                  </button>
                );
              })}
            </div>

            {/* 우측 아이콘 툴바 */}
            <div
              className="flex items-center gap-2 pb-2 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {searchOpen ? (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 border border-slate-200">
                  <span className="text-xs text-slate-400">🔍</span>
                  <input
                    autoFocus
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="제목, 문서번호, 작성자 검색"
                    className="w-44 bg-transparent text-xs font-semibold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setKeyword("");
                      setSearchOpen(false);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-700 font-bold"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="px-2 py-1 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-500"
                  title="검색"
                >
                  🔍
                </button>
              )}

              {/* 정렬 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "SORT" ? null : "SORT")
                  }
                  className="px-2.5 py-1 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-500 flex items-center gap-1"
                >
                  <span>⇅</span>
                  <span>정렬</span>
                </button>
                {openPopover === "SORT" && (
                  <div className="absolute right-0 top-8 z-30 w-44 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 text-xs font-bold text-slate-700">
                    {(
                      [
                        { id: "UPDATED_DESC", label: "최근 업데이트순" },
                        { id: "CREATED_DESC", label: "작성일 최신순" },
                        { id: "AMOUNT_DESC", label: "문서 금액 높은순" },
                      ] as { id: SortMode; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setSortMode(opt.id);
                          setOpenPopover(null);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
                      >
                        <span>{opt.label}</span>
                        {sortMode === opt.id && (
                          <span className="text-[#00a84b]">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 그룹 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "GROUP" ? null : "GROUP")
                  }
                  className="px-2.5 py-1 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-500 flex items-center gap-1"
                >
                  <span>▤</span>
                  <span>그룹</span>
                </button>
                {openPopover === "GROUP" && (
                  <div className="absolute right-0 top-8 z-30 w-40 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 text-xs font-bold text-slate-700">
                    {(
                      [
                        { id: "STATUS", label: "진행 상태별 그룹" },
                        { id: "FORM", label: "문서 양식별 그룹" },
                        { id: "NONE", label: "그룹 없음" },
                      ] as { id: GroupMode; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setGroupMode(opt.id);
                          setOpenPopover(null);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
                      >
                        <span>{opt.label}</span>
                        {groupMode === opt.id && (
                          <span className="text-[#00a84b]">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 저장된 보기 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "VIEWS" ? null : "VIEWS")
                  }
                  className="px-2.5 py-1 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-500 flex items-center gap-1"
                >
                  <span>👁</span>
                  <span>보기 ▾</span>
                </button>
                {openPopover === "VIEWS" && (
                  <div className="absolute right-0 top-8 z-30 w-56 rounded-xl bg-white shadow-xl border border-slate-200 p-2 text-xs font-bold text-slate-700">
                    <div className="px-2 py-1 text-[10px] text-slate-400">
                      저장된 맞춤 보기 ({savedViews.length})
                    </div>
                    {savedViews.length === 0 ? (
                      <div className="px-2 py-3 text-slate-400 font-medium">
                        저장된 보기가 없습니다. 우측 [보기 저장]을 눌러 자주 쓰는 필터를 저장해 보세요.
                      </div>
                    ) : (
                      savedViews.map((vw) => (
                        <div
                          key={vw.id}
                          className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50"
                        >
                          <button
                            type="button"
                            onClick={() => applySavedView(vw)}
                            className="flex-1 text-left truncate text-slate-800"
                          >
                            {vw.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedView(vw.id)}
                            className="text-slate-400 hover:text-rose-500 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ================= 3. 필터 바 (작성자 / 양식 / 업데이트일 / + 필터 추가 / 건수·초기화·보기 저장) ================= */}
          <div
            className="flex flex-wrap items-center justify-between gap-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-2 relative">
              {scope === "MY" && (
                <>
                  <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/70">
                    {(
                      [
                        { id: "ALL", label: "전체" },
                        { id: "MINE", label: "내가 작성한" },
                        { id: "MY_TURN", label: "내 승인 차례" },
                      ] as { id: MyRoleFilter; label: string }[]
                    ).map((seg) => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setMyRoleFilter(seg.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          myRoleFilter === seg.id
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {seg.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-slate-200">|</span>
                </>
              )}

              {/* 👤 작성자 팝오버 (Screenshot 2 & 9) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(
                      openPopover === "DRAFTER" ? null : "DRAFTER"
                    )
                  }
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    drafterIds.length > 0
                      ? "bg-emerald-50 border-[#00c458] text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span>👤</span>
                  <span>
                    작성자
                    {drafterIds.length > 0 ? ` (${drafterIds.length})` : ""}
                  </span>
                  <span className="text-[10px]">▾</span>
                </button>

                {openPopover === "DRAFTER" && (
                  <div className="absolute left-0 top-10 z-30 w-[440px] max-w-[92vw] h-[380px] rounded-2xl bg-white shadow-2xl border border-slate-200 grid grid-cols-2 overflow-hidden">
                    <div className="border-r border-slate-100 p-3 flex flex-col min-h-0">
                      <input
                        autoFocus
                        value={memberFilterSearch}
                        onChange={(e) => setMemberFilterSearch(e.target.value)}
                        placeholder="🔍 검색"
                        className="w-full px-3 py-1.5 rounded-lg border border-[#00c458] text-xs font-medium focus:outline-none mb-2"
                      />
                      <div className="text-[11px] font-bold text-slate-400 px-1 mb-1.5">
                        총 {drafterIds.length}명 선택
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-0.5 custom-scroll">
                        {me && (
                          <button
                            type="button"
                            onClick={() =>
                              setDrafterIds((prev) =>
                                prev.includes(me.instructor_id)
                                  ? prev.filter((id) => id !== me.instructor_id)
                                  : [...prev, me.instructor_id]
                              )
                            }
                            className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-extrabold text-slate-800"
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-slate-700 text-white text-[10px] flex items-center justify-center">
                                나
                              </span>
                              <span>나 ({me.name})</span>
                            </span>
                            {drafterIds.includes(me.instructor_id) && (
                              <span className="text-[#00a84b]">✓</span>
                            )}
                          </button>
                        )}
                        <div className="text-[10px] font-bold text-slate-400 px-2 pt-2 pb-1">
                          구성원 목록
                        </div>
                        {sortedMembersForFilter.map((m) => {
                          const checked = drafterIds.includes(m.instructor_id);
                          return (
                            <button
                              key={m.instructor_id}
                              type="button"
                              onClick={() =>
                                setDrafterIds((prev) =>
                                  checked
                                    ? prev.filter(
                                        (id) => id !== m.instructor_id
                                      )
                                    : [...prev, m.instructor_id]
                                )
                              }
                              className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <span
                                  style={{
                                    backgroundColor: getAvatarBg(m.name),
                                  }}
                                  className="w-6 h-6 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                                >
                                  {m.name.slice(-2)}
                                </span>
                                <span className="truncate">{m.name}</span>
                                <span className="text-[10px] font-normal text-slate-400 truncate">
                                  {m.work_status === "퇴직"
                                    ? "퇴직"
                                    : m.department}
                                </span>
                              </span>
                              {checked && (
                                <span className="text-[#00a84b] shrink-0">
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="p-3 overflow-y-auto custom-scroll">
                      {drafterIds.length === 0 ? (
                        <div className="text-xs text-slate-400 pt-1">
                          선택없음
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {drafterIds.map((id) => {
                            const m = members.find(
                              (item) => item.instructor_id === id
                            );
                            return (
                              <div
                                key={id}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-700"
                              >
                                <span>{m?.name || id}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDrafterIds((prev) =>
                                      prev.filter((x) => x !== id)
                                    )
                                  }
                                  className="text-slate-400 hover:text-rose-500"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 📄 양식 팝오버 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "FORM" ? null : "FORM")
                  }
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    selectedFormIds.length > 0
                      ? "bg-emerald-50 border-[#00c458] text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span>📄</span>
                  <span>
                    양식
                    {selectedFormIds.length > 0
                      ? ` (${selectedFormIds.length})`
                      : ""}
                  </span>
                  <span className="text-[10px]">▾</span>
                </button>

                {openPopover === "FORM" && (
                  <div className="absolute left-0 top-10 z-30 w-64 rounded-2xl bg-white shadow-2xl border border-slate-200 p-3 space-y-2">
                    <input
                      autoFocus
                      value={formFilterSearch}
                      onChange={(e) => setFormFilterSearch(e.target.value)}
                      placeholder="🔍 양식 검색"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-medium focus:outline-none"
                    />
                    <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scroll">
                      {forms
                        .filter(
                          (f) =>
                            !formFilterSearch.trim() ||
                            f.title
                              .toLowerCase()
                              .includes(formFilterSearch.trim().toLowerCase())
                        )
                        .map((f) => {
                          const checked = selectedFormIds.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() =>
                                setSelectedFormIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== f.id)
                                    : [...prev, f.id]
                                )
                              }
                              className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <span>{f.icon}</span>
                                <span className="truncate">{f.title}</span>
                              </span>
                              {checked && (
                                <span className="text-[#00a84b]">✓</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* 📅 업데이트일 팝오버 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "DATE" ? null : "DATE")
                  }
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    datePreset !== "ALL"
                      ? "bg-emerald-50 border-[#00c458] text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span>📅</span>
                  <span>{datePresetLabel[datePreset]}</span>
                  <span className="text-[10px]">▾</span>
                </button>

                {openPopover === "DATE" && (
                  <div className="absolute left-0 top-10 z-30 w-44 rounded-2xl bg-white shadow-2xl border border-slate-200 py-1.5 text-xs font-bold text-slate-700">
                    {(
                      Object.keys(datePresetLabel) as DatePreset[]
                    ).map((dp) => (
                      <button
                        key={dp}
                        type="button"
                        onClick={() => {
                          setDatePreset(dp);
                          setOpenPopover(null);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
                      >
                        <span>
                          {dp === "ALL" ? "전체 기간" : datePresetLabel[dp]}
                        </span>
                        {datePreset === dp && (
                          <span className="text-[#00a84b]">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 선택된 추가 필터 배지 표시 */}
              {approverIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setApproverIds([])}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-[#00c458] text-xs font-bold text-emerald-900"
                >
                  승인자 ({approverIds.length}) ✕
                </button>
              )}
              {ccNames.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCcNames([])}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-[#00c458] text-xs font-bold text-emerald-900"
                >
                  참조자 ({ccNames.length}) ✕
                </button>
              )}
              {statusFilters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilters([])}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-[#00c458] text-xs font-bold text-emerald-900"
                >
                  진행상태 ({statusFilters.length}) ✕
                </button>
              )}

              {/* + 필터 추가 팝오버 (Screenshot 13) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPopover(openPopover === "MORE" ? null : "MORE")
                  }
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-extrabold text-slate-700"
                >
                  + 필터 추가
                </button>

                {openPopover === "MORE" && (
                  <div className="absolute left-0 top-10 z-30 w-48 rounded-2xl bg-white shadow-2xl border border-slate-200 py-2 text-xs font-bold text-slate-700">
                    <div className="px-3.5 py-1 text-[10px] text-slate-400">
                      대상자
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenPopover("APPROVER")}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span>👤</span>
                      <span>승인자</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenPopover("CC")}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span>👀</span>
                      <span>참조자</span>
                    </button>
                    <div className="px-3.5 pt-2 pb-1 mt-1 border-t border-slate-100 text-[10px] text-slate-400">
                      문서 상태
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenPopover("STATUS")}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span>📌</span>
                      <span>진행 상태</span>
                    </button>
                  </div>
                )}

                {openPopover === "APPROVER" && (
                  <div className="absolute left-0 top-10 z-30 w-56 max-h-64 overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200 p-2 custom-scroll">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400">
                      승인자 필터 선택
                    </div>
                    {sortedMembersForFilter.map((m) => {
                      const checked = approverIds.includes(m.instructor_id);
                      return (
                        <button
                          key={m.instructor_id}
                          type="button"
                          onClick={() =>
                            setApproverIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== m.instructor_id)
                                : [...prev, m.instructor_id]
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                        >
                          <span>
                            {m.name}{" "}
                            <span className="text-[10px] font-normal text-slate-400">
                              {m.department}
                            </span>
                          </span>
                          {checked && (
                            <span className="text-[#00a84b]">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {openPopover === "CC" && (
                  <div className="absolute left-0 top-10 z-30 w-56 max-h-64 overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200 p-2 custom-scroll">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400">
                      참조자 필터 선택
                    </div>
                    {sortedMembersForFilter.map((m) => {
                      const checked = ccNames.includes(m.name);
                      return (
                        <button
                          key={m.instructor_id}
                          type="button"
                          onClick={() =>
                            setCcNames((prev) =>
                              checked
                                ? prev.filter((n) => n !== m.name)
                                : [...prev, m.name]
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                        >
                          <span>
                            {m.name}{" "}
                            <span className="text-[10px] font-normal text-slate-400">
                              {m.department}
                            </span>
                          </span>
                          {checked && (
                            <span className="text-[#00a84b]">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {openPopover === "STATUS" && (
                  <div className="absolute left-0 top-10 z-30 w-44 rounded-2xl bg-white shadow-2xl border border-slate-200 py-1.5 text-xs font-bold text-slate-700">
                    {(
                      [
                        { id: "PENDING", label: "승인 대기" },
                        { id: "IN_PROGRESS", label: "진행중" },
                        { id: "APPROVED", label: "승인 완료" },
                        { id: "REJECTED", label: "반려" },
                        { id: "CANCELLED", label: "취소" },
                      ] as { id: HqApprovalStatus; label: string }[]
                    ).map((st) => {
                      const checked = statusFilters.includes(st.id);
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            setStatusFilters((prev) =>
                              checked
                                ? prev.filter((x) => x !== st.id)
                                : [...prev, st.id]
                            )
                          }
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
                        >
                          <span>{st.label}</span>
                          {checked && (
                            <span className="text-[#00a84b]">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 우측 건수 / 초기화 / 보기 저장 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 mr-1">
                {filteredDocs.length}건
              </span>
              <button
                type="button"
                onClick={resetFilters}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600"
              >
                초기화
              </button>
              <button
                type="button"
                onClick={handleSaveCurrentView}
                className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-xs font-extrabold text-[#00a84b]"
              >
                보기 저장
              </button>
            </div>
          </div>

          {/* ================= 4. 문서 목록 (접기 가능한 그룹 + Flex 2줄 문서 행) ================= */}
          {loading ? (
            <div className="py-20 text-center text-sm text-slate-400 font-semibold">
              워크플로우 문서를 불러오는 중입니다...
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center text-2xl mb-3">
                📄
              </div>
              <div className="text-sm font-extrabold text-slate-800">
                문서가 없어요.
              </div>
              <p className="text-xs text-slate-400 mt-1 mb-4">
                새 문서를 작성해 보세요.
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="px-4 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white text-xs font-extrabold"
              >
                문서 작성하기
              </button>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              {groupedSections.map((sec) => {
                const isCollapsed = Boolean(collapsedGroups[sec.key]);
                return (
                  <div key={sec.key} className="space-y-1">
                    {/* 그룹 헤더 바 (Screenshots 1 & 3) */}
                    <div className="px-2 py-2 border-y border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span className="font-bold">{sec.label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [sec.key]: !isCollapsed,
                          }))
                        }
                        className="text-[11px] font-bold text-slate-400 hover:text-slate-700"
                      >
                        {isCollapsed ? "펼치기 ▾" : "접기 ▴"}
                      </button>
                    </div>

                    {!isCollapsed && (
                      <div className="divide-y divide-slate-100/80">
                        {sec.items.map((doc) => {
                          const formTitle = resolveDocFormTitle(doc);
                          const isProg =
                            doc.status === "PENDING" ||
                            doc.status === "IN_PROGRESS";
                          const myTurn = isMyCurrentTurn(doc);
                          const starred = starredIds.includes(doc.approval_id);
                          const attCount =
                            doc.workflow_meta?.attachments?.length ||
                            (doc.receipt_url ? 1 : 0);

                          const isApprovedPre =
                            doc.status === "APPROVED" &&
                            (doc.workflow_meta?.form_id === "wf-expense-pre" ||
                              formTitle.includes("지출계획서") ||
                              doc.doc_type === "PURCHASE");

                          return (
                            <div
                              key={doc.approval_id}
                              onClick={() => setSelectedDoc(doc)}
                              className="px-3 py-3.5 hover:bg-slate-50/90 rounded-2xl transition-colors cursor-pointer flex items-center justify-between gap-4 group"
                            >
                              {/* 좌측: 원형 문서 아이콘 + 별표 + 2줄 요약 */}
                              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                                <div className="relative shrink-0 mt-0.5">
                                  <span className="w-10 h-10 rounded-full bg-orange-50/80 border border-orange-100 flex items-center justify-center text-base">
                                    {doc.workflow_meta?.form_icon || "📄"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) =>
                                      handleToggleStar(doc.approval_id, e)
                                    }
                                    className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] transition-opacity ${
                                      starred
                                        ? "bg-amber-400 text-white opacity-100"
                                        : "bg-white border border-slate-200 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-400"
                                    }`}
                                    title="중요 문서 표시"
                                  >
                                    ★
                                  </button>
                                </div>

                                <div className="min-w-0 flex-1 space-y-1">
                                  {/* 1줄: 작성자 + 날짜 + 상태 배지 */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[13px] font-extrabold text-slate-900">
                                      {doc.drafter_name}
                                    </span>
                                    <span className="text-xs text-slate-400 font-medium">
                                      {formatKoreanMonthDay(doc.submitted_at)}
                                    </span>

                                    {isProg ? (
                                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-extrabold">
                                        진행중 {doc.current_step_order}/
                                        {doc.total_steps}
                                      </span>
                                    ) : doc.status === "APPROVED" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                                        승인
                                      </span>
                                    ) : doc.status === "REJECTED" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[11px] font-extrabold">
                                        반려
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-bold">
                                        취소
                                      </span>
                                    )}

                                    {myTurn && (
                                      <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold">
                                        내 승인 차례
                                      </span>
                                    )}

                                    {doc.urgent && (
                                      <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                                        긴급
                                      </span>
                                    )}
                                  </div>

                                  {/* 2줄: 양식명 + 문서번호 · 제목 · 본문 요약 + 첨부파일 배지 */}
                                  <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                                    <span className="font-bold text-slate-800 shrink-0">
                                      {formTitle}
                                    </span>
                                    <span className="text-slate-400 truncate max-w-[640px]">
                                      문서번호: {doc.doc_no} · {doc.title}
                                      {doc.amount > 0
                                        ? ` (${doc.amount.toLocaleString()}원)`
                                        : ""}
                                      {doc.content
                                        ? ` · ${doc.content.replace(/\s+/g, " ").slice(0, 60)}`
                                        : ""}
                                    </span>

                                    {attCount > 0 && (
                                      <span className="px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 shrink-0">
                                        📎 첨부파일 {attCount}건
                                      </span>
                                    )}

                                    {doc.workflow_meta?.ref_doc_no && (
                                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-[11px] font-bold shrink-0">
                                        🔗 참조연결
                                      </span>
                                    )}

                                    {isApprovedPre && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPresetRefDoc(doc);
                                          setCloneSourceDoc(null);
                                          setDefaultPolicyId("wf-expense-post");
                                          setDefaultDocType("EXPENSE");
                                          setCreateOpen(true);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-md bg-emerald-50 border border-[#00c458] text-[#00a84b] text-[11px] font-extrabold shrink-0"
                                      >
                                        💳 사후품의 작성 ›
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* 우측: 승인자 원형 2글자 아바타 칩 (Screenshots 1 & 3) */}
                              <div className="flex items-center gap-1 shrink-0">
                                {doc.steps.map((st) => (
                                  <span
                                    key={st.step_order}
                                    style={{
                                      backgroundColor: getAvatarBg(
                                        st.approver_name
                                      ),
                                    }}
                                    title={`${st.step_order}단계: ${st.approver_name} (${
                                      st.status === "APPROVED"
                                        ? "승인"
                                        : st.status === "REJECTED"
                                          ? "반려"
                                          : "대기"
                                    })`}
                                    className={`w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center shadow-2xs ${
                                      st.status === "CURRENT"
                                        ? "ring-2 ring-blue-500 ring-offset-1"
                                        : ""
                                    }`}
                                  >
                                    {st.approver_name.slice(-2)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 1) [문서 작성하기] 양식 선택 모달 */}
      <WorkflowFormPickerModal
        isOpen={pickerOpen}
        forms={forms}
        categories={categories}
        onClose={() => setPickerOpen(false)}
        onSelectForm={(form) => {
          setPickerOpen(false);
          setDefaultPolicyId(form.id);
          setDefaultDocType(form.mapped_doc_type || "GENERAL");
          setPresetRefDoc(null);
          setCloneSourceDoc(null);
          setCreateOpen(true);
        }}
      />

      {/* 2) [문서 양식 관리] 우측 슬라이드 드로어 */}
      <WorkflowFormManagerDrawer
        isOpen={drawerOpen}
        forms={forms}
        categories={categories}
        canManageForms={canManageForms}
        onClose={() => setDrawerOpen(false)}
        onOpenBuilder={(form) => {
          setEditingForm(form);
          setBuilderOpen(true);
        }}
        onQuickDraft={(form) => {
          setDrawerOpen(false);
          setDefaultPolicyId(form.id);
          setDefaultDocType(form.mapped_doc_type || "GENERAL");
          setPresetRefDoc(null);
          setCloneSourceDoc(null);
          setCreateOpen(true);
        }}
        onFormsMutated={(nextCats, nextForms) => {
          setCategories(nextCats);
          setForms(nextForms);
          refreshCompanySettings().catch(() => {});
        }}
      />

      {/* 3) [양식 만들기 / 수정] 2-Pane 빌더 모달 */}
      <WorkflowFormBuilderModal
        isOpen={builderOpen}
        editingForm={editingForm}
        categories={categories}
        members={members}
        approvalTemplates={approvalTemplates}
        onClose={() => setBuilderOpen(false)}
        onSaved={(nextCats, nextForms) => {
          setCategories(nextCats);
          setForms(nextForms);
          refreshCompanySettings().catch(() => {});
        }}
      />

      {/* 4) 워크플로우 문서 작성 모달 */}
      <ApprovalCreateModal
        isOpen={createOpen}
        me={me}
        members={members}
        defaultDocType={defaultDocType}
        defaultPolicyId={defaultPolicyId}
        workflowForms={forms}
        availableRefDocs={docs}
        presetRefDoc={presetRefDoc}
        cloneSourceDoc={cloneSourceDoc}
        onClose={() => {
          setCreateOpen(false);
          setPresetRefDoc(null);
          setCloneSourceDoc(null);
        }}
        onCreated={handleRefreshAll}
      />

      {/* 5) 워크플로우 문서 상세 열람 · 승인 · 의견 모달 */}
      <ApprovalDetailModal
        doc={selectedDoc}
        me={me}
        isHqAdmin={isHqAdmin}
        canDeleteCompanyDoc={scope === "COMPANY" && canDeleteCompanyDoc}
        isStarred={
          selectedDoc ? starredIds.includes(selectedDoc.approval_id) : false
        }
        onToggleStar={(id) => handleToggleStar(id)}
        onFollowUpPostExpense={(approvedPreDoc) => {
          setPresetRefDoc(approvedPreDoc);
          setCloneSourceDoc(null);
          setDefaultPolicyId("wf-expense-post");
          setDefaultDocType("EXPENSE");
          setCreateOpen(true);
        }}
        onCloneDoc={(srcDoc) => {
          setCloneSourceDoc(srcDoc);
          setPresetRefDoc(null);
          setDefaultPolicyId(srcDoc.workflow_meta?.form_id || null);
          setDefaultDocType(srcDoc.doc_type);
          setCreateOpen(true);
        }}
        onOpenRefDoc={(refId) => {
          const found = docs.find((d) => d.approval_id === refId);
          if (found) setSelectedDoc(found);
          else alert("연결된 참조 문서를 찾을 수 없거나 열람 권한이 없습니다.");
        }}
        onClose={() => setSelectedDoc(null)}
        onUpdated={handleRefreshAll}
      />
    </>
  );
}

export default function HqApprovalsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-slate-400">
          워크플로우 데이터를 불러오는 중...
        </div>
      }
    >
      <HqApprovalsContent />
    </Suspense>
  );
}
