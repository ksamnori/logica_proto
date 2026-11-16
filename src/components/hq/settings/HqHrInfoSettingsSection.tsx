// src/components/hq/settings/HqHrInfoSettingsSection.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HQ_EMPLOYMENT_TYPES } from "@/lib/hq/constants";
import {
  DEFAULT_ORG_CHART_NODES,
  formatEmpNoPreview,
} from "@/lib/hq/defaultCompanySettings";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqEmpNoPolicy,
  HqJobGradeItem,
  HqJobGroupItem,
  HqMember,
  HqOrgChartNode,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

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
  onCloseSettings: () => void;
}

type HrSubModal =
  | null
  | "position" // 직위
  | "title" // 직책
  | "job" // 직무
  | "job_group" // 직군
  | "grade" // 직급
  | "org_chart" // 조직도 설정
  | "emp_policy"; // 사번 자동 부여 정책

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function HqHrInfoSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
  onCloseSettings,
}: Props) {
  const router = useRouter();
  const ex = settings.extra_settings || {};

  const positions = ex.hr_positions || ["대표", "사원", "실장", "팀장"];
  const titles = ex.hr_titles || ["사원", "실장", "총괄", "팀장"];
  const jobs = ex.hr_jobs || [
    "경영",
    "교재 집필",
    "교정",
    "디자인",
    "마케팅",
    "영업",
    "인사",
    "주문",
    "편집",
    "회계",
  ];
  const jobGroups = ex.hr_job_groups || [];
  const grades = ex.hr_grades || [];
  const orgNodes =
    ex.org_chart_nodes && ex.org_chart_nodes.length > 0
      ? ex.org_chart_nodes
      : DEFAULT_ORG_CHART_NODES;
  const empNoLocked = Boolean(ex.emp_no_locked);
  const empPolicies = ex.emp_no_policies || [];

  const [subModal, setSubModal] = useState<HrSubModal>(null);
  const [orgCardMenuOpen, setOrgCardMenuOpen] = useState(false);

  // =========================================================================
  // 1) 단순 문자열 리스트 모달 (직위 / 직책 / 직무) 상태
  // =========================================================================
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [newItemInput, setNewItemInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  // =========================================================================
  // 2) 직군 / 직급 모달 상태
  // =========================================================================
  const [groupDrafts, setGroupDrafts] = useState<HqJobGroupItem[]>([]);
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupJobs, setNewGroupJobs] = useState<string[]>([]);

  const [gradeDrafts, setGradeDrafts] = useState<HqJobGradeItem[]>([]);
  const [gradeCreatorOpen, setGradeCreatorOpen] = useState(false);
  const [newGradeName, setNewGradeName] = useState("");
  const [newGradeDesc, setNewGradeDesc] = useState("");

  // =========================================================================
  // 3) 조직도 설정 모달 상태 (Images 8 & 9)
  // =========================================================================
  const [orgDraft, setOrgDraft] = useState<HqOrgChartNode[]>([]);
  const [orgEffectiveDate, setOrgEffectiveDate] = useState("");
  const [orgMemo, setOrgMemo] = useState("");
  const [orgDateOpen, setOrgDateOpen] = useState(false);
  const [orgMemoOpen, setOrgMemoOpen] = useState(false);
  const [orgGuideStep, setOrgGuideStep] = useState<0 | 1 | 2>(0);
  const [orgSearchOpen, setOrgSearchOpen] = useState(false);
  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([]);
  const [orgTopMenuOpen, setOrgTopMenuOpen] = useState(false);
  const [addingNodeParentId, setAddingNodeParentId] = useState<
    string | null | "CLOSED"
  >("CLOSED");
  const [newNodeName, setNewNodeName] = useState("");
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renamingNodeText, setRenamingNodeText] = useState("");

  // =========================================================================
  // 4) 사번 자동 부여 정책 모달 상태
  // =========================================================================
  const [editingPolicy, setEditingPolicy] = useState<HqEmpNoPolicy | null>(
    null
  );
  const [policyForm, setPolicyForm] = useState<HqEmpNoPolicy>({
    id: "",
    name: "정규직 입사연월 사번",
    target_employment: "전체",
    prefix: "",
    date_part: "YYYYMM",
    seq_digits: 2,
    start_seq: 1,
  });

  // 조직도 요약 텍스트 (Image 1과 동일하게 대표 상위 + 하위팀 나열)
  const orgSummaryText = useMemo(() => {
    const sorted = [...orgNodes].sort((a, b) => a.order - b.order);
    return sorted.map((n) => n.name).join(", ");
  }, [orgNodes]);

  // 단순 리스트 모달 열기
  const openSimpleListModal = (kind: "position" | "title" | "job") => {
    const base =
      kind === "position" ? positions : kind === "title" ? titles : jobs;
    setListDraft([...base]);
    setCheckedItems([]);
    setNewItemInput("");
    setSearchOpen(false);
    setSearchQuery("");
    setEditingIdx(null);
    setSubModal(kind);
  };

  const handleAppendListItem = () => {
    const trimmed = newItemInput.trim();
    if (!trimmed) {
      addInputRef.current?.focus();
      return;
    }
    if (listDraft.includes(trimmed)) {
      alert("이미 등록된 항목입니다.");
      return;
    }
    setListDraft((prev) => [...prev, trimmed]);
    setNewItemInput("");
  };

  const handleSaveSimpleList = async () => {
    const finalItems = [...listDraft];
    if (newItemInput.trim() && !finalItems.includes(newItemInput.trim())) {
      finalItems.push(newItemInput.trim());
    }

    if (subModal === "position") {
      await onSaveExtra(
        { hr_positions: finalItems },
        "직위 설정이 저장되었습니다."
      );
    } else if (subModal === "title") {
      await onSaveExtra(
        { hr_titles: finalItems },
        "직책 설정이 저장되었습니다."
      );
    } else if (subModal === "job") {
      await onSaveExtra({ hr_jobs: finalItems }, "직무 설정이 저장되었습니다.");
    }
    setSubModal(null);
  };

  // 직군 모달 열기
  const openJobGroupModal = () => {
    setGroupDrafts([...jobGroups]);
    setGroupCreatorOpen(false);
    setNewGroupName("");
    setNewGroupJobs([]);
    setSubModal("job_group");
  };

  // 직급 모달 열기
  const openGradeModal = () => {
    setGradeDrafts([...grades]);
    setGradeCreatorOpen(false);
    setNewGradeName("");
    setNewGradeDesc("");
    setSubModal("grade");
  };

  // 조직도 설정 모달 열기
  const openOrgChartModal = () => {
    setOrgCardMenuOpen(false);
    const cloned = orgNodes.map((n) => ({ ...n }));
    setOrgDraft(cloned);
    setOrgEffectiveDate(
      ex.org_chart_effective_date || new Date().toISOString().slice(0, 10)
    );
    setOrgMemo(ex.org_chart_memo || "");
    setOrgDateOpen(false);
    setOrgMemoOpen(false);
    setOrgSearchOpen(false);
    setOrgSearchQuery("");
    setExpandedNodeIds([]); // Image 8, 9 기본 상태처럼 상위 노드 중심으로 깔끔하게 시작 (클릭 시 하위 부서 펼침)
    setAddingNodeParentId("CLOSED");
    setRenamingNodeId(null);
    setOrgGuideStep(ex.org_chart_effective_date ? 0 : 1);
    setSubModal("org_chart");
  };

  const toggleAllOrgExpand = () => {
    const parentIds = Array.from(
      new Set(orgDraft.map((n) => n.parent_id).filter(Boolean) as string[])
    );
    if (expandedNodeIds.length > 0) {
      setExpandedNodeIds([]);
    } else {
      setExpandedNodeIds(parentIds);
    }
  };

  const handleSyncFromActualDepartments = () => {
    setOrgTopMenuOpen(false);
    const existingNames = new Set(orgDraft.map((n) => n.name));
    const ceoNode =
      orgDraft.find((n) => n.name === "대표") ||
      orgDraft.find((n) => n.parent_id === null && !n.is_hidden);
    const parentId = ceoNode ? ceoNode.id : null;

    let maxOrder = orgDraft.reduce((m, x) => Math.max(m, x.order), 0);
    const added: HqOrgChartNode[] = [];
    members.forEach((m) => {
      const d = (m.department || "").trim();
      if (d && d !== "미지정" && !existingNames.has(d)) {
        existingNames.add(d);
        added.push({
          id: `org-${uid()}`,
          name: d,
          parent_id: parentId,
          is_hidden: false,
          order: ++maxOrder,
        });
      }
    });

    if (added.length === 0) {
      alert("이미 모든 재직 구성원의 소속 부서가 조직도에 포함되어 있습니다.");
      return;
    }
    setOrgDraft((prev) => [...prev, ...added]);
    if (parentId && !expandedNodeIds.includes(parentId)) {
      setExpandedNodeIds((prev) => [...prev, parentId]);
    }
  };

  const handleAddOrgNode = () => {
    if (!newNodeName.trim() || addingNodeParentId === "CLOSED") return;
    const maxOrder = orgDraft.reduce((m, x) => Math.max(m, x.order), 0);
    const nextNode: HqOrgChartNode = {
      id: `org-${uid()}`,
      name: newNodeName.trim(),
      parent_id: addingNodeParentId,
      is_hidden: false,
      order: maxOrder + 1,
    };
    setOrgDraft((prev) => [...prev, nextNode]);
    if (addingNodeParentId && !expandedNodeIds.includes(addingNodeParentId)) {
      setExpandedNodeIds((prev) => [...prev, addingNodeParentId]);
    }
    setNewNodeName("");
    setAddingNodeParentId("CLOSED");
  };

  const handleDeleteOrgNode = (targetId: string) => {
    const toRemove = new Set<string>([targetId]);
    let changed = true;
    while (changed) {
      changed = false;
      orgDraft.forEach((n) => {
        if (n.parent_id && toRemove.has(n.parent_id) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          changed = true;
        }
      });
    }
    setOrgDraft((prev) => prev.filter((n) => !toRemove.has(n.id)));
  };

  const handleSaveOrgChart = async () => {
    await onSaveExtra(
      {
        org_chart_nodes: orgDraft,
        org_chart_effective_date: orgEffectiveDate,
        org_chart_memo: orgMemo.trim(),
      },
      "조직도 설정이 저장되었습니다."
    );
    setSubModal(null);
  };

  // 사번 정책 추가/수정 열기
  const openAddPolicyModal = (existing?: HqEmpNoPolicy) => {
    if (existing) {
      setEditingPolicy(existing);
      setPolicyForm({ ...existing });
    } else {
      setEditingPolicy(null);
      setPolicyForm({
        id: "",
        name: "기본 입사연월 사번 정책",
        target_employment: "전체",
        prefix: "",
        date_part: "YYYYMM",
        seq_digits: 2,
        start_seq: 1,
      });
    }
    setSubModal("emp_policy");
  };

  const handleSaveEmpPolicy = async () => {
    if (!policyForm.name.trim()) {
      alert("사번 정책 이름을 입력해주세요.");
      return;
    }
    const item: HqEmpNoPolicy = {
      ...policyForm,
      id: editingPolicy ? editingPolicy.id : uid(),
      name: policyForm.name.trim(),
      prefix: policyForm.prefix.trim().toUpperCase(),
    };
    const nextList = editingPolicy
      ? empPolicies.map((p) => (p.id === editingPolicy.id ? item : p))
      : [...empPolicies, item];

    await onSaveExtra(
      { emp_no_policies: nextList },
      editingPolicy
        ? "사번 자동 부여 정책이 수정되었습니다."
        : "새 사번 자동 부여 정책이 추가되었습니다."
    );
    setSubModal(null);
  };

  const movePolicyOrder = async (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= empPolicies.length) return;
    const copy = [...empPolicies];
    const [picked] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, picked);
    await onSaveExtra(
      { emp_no_policies: copy },
      "사번 정책 우선순위가 변경되었습니다."
    );
  };

  // 단순 리스트 모달 메타데이터
  const simpleModalMeta =
    subModal === "position"
      ? {
          title: "직위 설정",
          badgeBg: "bg-[#9db85c]",
          icon: "🏅",
          placeholder: "직위 입력 (대리, 과장 등)",
          tooltip: "회사 내 서열·경력 단계에 따른 직위 목록입니다.",
        }
      : subModal === "title"
        ? {
            title: "직책 설정",
            badgeBg: "bg-[#9b6bd6]",
            icon: "💼",
            placeholder: "직책 입력 (실장, 팀장 등)",
            tooltip: "조직에서 맡은 역할·책임 단위 호칭 목록입니다.",
          }
        : {
            title: "직무 설정",
            badgeBg: "bg-[#6c989b]",
            icon: "🛠️",
            placeholder: "직무 입력 (디자이너, 마케터 등)",
            tooltip: "구성원이 수행하는 전문 업무 분야 목록입니다.",
          };

  const filteredListDraft = listDraft
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) =>
      searchQuery.trim()
        ? item.toLowerCase().includes(searchQuery.trim().toLowerCase())
        : true
    );

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveLabel =
    !orgEffectiveDate || orgEffectiveDate === todayIso
      ? "오늘"
      : orgEffectiveDate;

  // 재귀 트리 렌더러 (조직도 설정 모달용)
  const renderOrgTreeNodes = (parentId: string | null, depth = 0) => {
    const children = orgDraft
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => a.order - b.order);

    if (children.length === 0) return null;

    return children.map((node) => {
      const subChildren = orgDraft.filter((c) => c.parent_id === node.id);
      const hasSub = subChildren.length > 0;
      const isExpanded =
        expandedNodeIds.includes(node.id) || orgSearchQuery.trim().length > 0;

      if (
        orgSearchQuery.trim() &&
        !node.name.toLowerCase().includes(orgSearchQuery.trim().toLowerCase()) &&
        !subChildren.some((sc) =>
          sc.name.toLowerCase().includes(orgSearchQuery.trim().toLowerCase())
        )
      ) {
        return null;
      }

      const memberCnt = members.filter(
        (m) => m.work_status === "재직" && m.department === node.name
      ).length;

      return (
        <div key={node.id}>
          <div
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
            className="group py-3 pr-2 border-b border-slate-100 hover:bg-slate-50/80 flex items-center justify-between gap-2 text-[13px]"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {hasSub ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedNodeIds((prev) =>
                      prev.includes(node.id)
                        ? prev.filter((x) => x !== node.id)
                        : [...prev, node.id]
                    )
                  }
                  className="w-4 h-4 text-slate-500 hover:text-slate-900 flex items-center justify-center text-[10px] shrink-0"
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-4 text-center text-slate-300 text-xs shrink-0">
                  •
                </span>
              )}

              {renamingNodeId === node.id ? (
                <input
                  autoFocus
                  value={renamingNodeText}
                  onChange={(e) => setRenamingNodeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renamingNodeText.trim()) {
                      setOrgDraft((prev) =>
                        prev.map((x) =>
                          x.id === node.id
                            ? { ...x, name: renamingNodeText.trim() }
                            : x
                        )
                      );
                      setRenamingNodeId(null);
                    }
                    if (e.key === "Escape") setRenamingNodeId(null);
                  }}
                  onBlur={() => {
                    if (renamingNodeText.trim()) {
                      setOrgDraft((prev) =>
                        prev.map((x) =>
                          x.id === node.id
                            ? { ...x, name: renamingNodeText.trim() }
                            : x
                        )
                      );
                    }
                    setRenamingNodeId(null);
                  }}
                  className="px-2 py-0.5 rounded border border-brand text-xs font-bold text-slate-900 focus:outline-none"
                />
              ) : (
                <span className="font-semibold text-slate-800 truncate">
                  {node.name}
                </span>
              )}

              {/* Image 9의 주황색 숨김 눈 아이콘 */}
              {node.is_hidden && (
                <span
                  className="text-amber-500 text-xs shrink-0"
                  title="조직도 비노출(숨김) 조직"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18"
                    />
                  </svg>
                </span>
              )}

              {/* 하위 팀 또는 소속 인원 카운트 표시 */}
              {(hasSub || memberCnt > 0) && !node.is_hidden && (
                <span className="text-xs text-slate-400 font-medium">
                  {memberCnt > 0 ? memberCnt : subChildren.length}
                </span>
              )}
            </div>

            {canEdit && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setAddingNodeParentId(node.id);
                    setNewNodeName("");
                  }}
                  className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold"
                  title="하위 조직 추가"
                >
                  +하위
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenamingNodeId(node.id);
                    setRenamingNodeText(node.name);
                  }}
                  className="px-1.5 py-0.5 rounded hover:bg-slate-100 text-slate-500"
                  title="조직명 변경"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOrgDraft((prev) =>
                      prev.map((x) =>
                        x.id === node.id
                          ? { ...x, is_hidden: !x.is_hidden }
                          : x
                      )
                    )
                  }
                  className="px-1.5 py-0.5 rounded hover:bg-amber-50 text-amber-600"
                  title="조직도 표시/숨김 전환"
                >
                  {node.is_hidden ? "표시" : "숨김"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteOrgNode(node.id)}
                  className="px-1.5 py-0.5 rounded hover:bg-rose-50 text-rose-500"
                  title="삭제"
                >
                  삭제
                </button>
              </div>
            )}
          </div>

          {addingNodeParentId === node.id && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 20 + 12}px` }}
              className="py-2.5 pr-2 bg-emerald-50/40 border-b border-emerald-100 flex items-center gap-2"
            >
              <input
                autoFocus
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddOrgNode();
                  if (e.key === "Escape") setAddingNodeParentId("CLOSED");
                }}
                placeholder={`${node.name} 하위 부서명 입력`}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs font-bold focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddOrgNode}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
              >
                추가
              </button>
              <button
                type="button"
                onClick={() => setAddingNodeParentId("CLOSED")}
                className="px-2 py-1.5 text-xs text-slate-400 font-semibold"
              >
                취소
              </button>
            </div>
          )}

          {hasSub && isExpanded && renderOrgTreeNodes(node.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <>
      <div className="space-y-9">
        <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
          인사 · 구성원 정보
        </h2>

        {/* =============================================================== */}
        {/* 1. 인사 정보 설정 (직위 / 직책 / 직무 / 직군 / 직급)             */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              인사 정보 설정
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              회사의 등급, 직무 및 체계를 통합 관리해 보세요.
            </p>
          </div>

          <div className="space-y-2.5">
            {/* 직위 */}
            <button
              type="button"
              onClick={() => openSimpleListModal("position")}
              className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center gap-4 shadow-2xs"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🏅
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">직위</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {positions.length > 0
                    ? positions.join(", ")
                    : "회사 내 직위 체계를 등록해 보세요."}
                </div>
              </div>
            </button>

            {/* 직책 */}
            <button
              type="button"
              onClick={() => openSimpleListModal("title")}
              className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center gap-4 shadow-2xs"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                💼
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">직책</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {titles.length > 0
                    ? titles.join(", ")
                    : "조직 리더 및 역할별 직책을 설정해 보세요."}
                </div>
              </div>
            </button>

            {/* 직무 */}
            <button
              type="button"
              onClick={() => openSimpleListModal("job")}
              className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center gap-4 shadow-2xs"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🛠️
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">직무</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {jobs.length > 0
                    ? jobs.join(", ")
                    : "구성원이 수행하는 직무 목록을 추가해 보세요."}
                </div>
              </div>
            </button>

            {/* 직군 */}
            <button
              type="button"
              onClick={openJobGroupModal}
              className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center gap-4 shadow-2xs"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🗂️
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">직군</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {jobGroups.length > 0
                    ? jobGroups.map((g) => g.name).join(", ")
                    : "비슷한 성격의 직무들을 묶은 분류 단위에요."}
                </div>
              </div>
            </button>

            {/* 직급 */}
            <button
              type="button"
              onClick={openGradeModal}
              className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center gap-4 shadow-2xs"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                ⚙️
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">직급</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {grades.length > 0
                    ? grades.map((g) => g.name).join(", ")
                    : "조직 내에서의 직무 수행 수준과 숙련도를 단계로 구분한 정보에요. 인사 권한자와 본인만 볼 수 있어요."}
                </div>
              </div>
            </button>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 2. 조직 설정 (조직도)                                            */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            조직 설정
          </h3>

          <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex items-center justify-between gap-3 shadow-2xs relative">
            <button
              type="button"
              onClick={openOrgChartModal}
              className="flex items-center gap-4 min-w-0 flex-1 text-left"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🏛️
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-900">조직도</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {orgSummaryText}
                </div>
              </div>
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setOrgCardMenuOpen((p) => !p)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold"
              >
                ⋯
              </button>
              {orgCardMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={openOrgChartModal}
                    className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    조직도 설정 열기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrgCardMenuOpen(false);
                      onCloseSettings();
                      router.push("/hq/members");
                    }}
                    className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    구성원 조직도 화면 이동 ↗
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 3. 구성원 정보 관리 (설정하기 -> 승인 정책 관리 페이지로 이동)      */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              구성원 정보 관리
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              구성원 정보 관리에 도움을 주는 설정을 확인해 보세요.
            </p>
          </div>

          <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🔑
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-900">
                  정보 변경 승인 설정
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  구성원이 변경 가능한 정보는 관리자의 승인을 통해 반영할 수 있어요.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab("approval-policy")}
              className="text-xs font-bold text-slate-700 hover:text-slate-900 flex items-center gap-1 shrink-0"
            >
              <span>설정하기</span>
              <span className="text-slate-400">›</span>
            </button>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 4. 사번 관리 (사번 수정 잠금 토글)                                */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            사번 관리
          </h3>

          <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                🔒
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-900">
                  사번 수정 잠금
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  생성된 사번을 어디서든 수정할 수 없도록 설정해요.
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={empNoLocked}
              disabled={!canEdit || saving}
              onClick={() =>
                onSaveExtra(
                  { emp_no_locked: !empNoLocked },
                  !empNoLocked
                    ? "사번 수정 잠금이 활성화되었습니다."
                    : "사번 수정 잠금이 해제되었습니다."
                )
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out disabled:opacity-50 ${
                empNoLocked ? "bg-emerald-500" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  empNoLocked ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 5. 사번 자동 부여 정책                                           */}
        {/* =============================================================== */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                사번 자동 부여 정책
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                사번 정책을 자동으로 관리해 보세요. 구성원이 여러 정책에 해당하면 상단 정책이 적용돼요.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => openAddPolicyModal()}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5 shrink-0"
              >
                <span className="text-emerald-500 text-sm leading-none font-extrabold">
                  +
                </span>
                <span>정책 추가</span>
              </button>
            )}
          </div>

          {empPolicies.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-center text-slate-300 text-lg mb-3">
                📄
              </div>
              <div className="text-xs font-bold text-slate-700">
                아직 사번 정책이 없어요.
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                사번 정책을 설정해 구성원 등록 시 사번을 자동으로 부여해 보세요.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {empPolicies.map((pol, idx) => (
                <div
                  key={pol.id}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex flex-wrap items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-900">
                          {pol.name}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                          대상: {pol.target_employment}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        규칙: {pol.prefix ? `접두어(${pol.prefix}) + ` : ""}
                        {pol.date_part === "NONE"
                          ? "날짜없음"
                          : `입사일(${pol.date_part})`}{" "}
                        + 일련번호 {pol.seq_digits}자리 · 예시:{" "}
                        <strong className="font-mono text-emerald-600">
                          {formatEmpNoPreview(pol)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1.5 text-xs shrink-0">
                      {empPolicies.length > 1 && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => movePolicyOrder(idx, -1)}
                            className="px-2 py-1 rounded border border-slate-200 text-slate-500 disabled:opacity-30"
                            title="우선순위 위로"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === empPolicies.length - 1}
                            onClick={() => movePolicyOrder(idx, 1)}
                            className="px-2 py-1 rounded border border-slate-200 text-slate-500 disabled:opacity-30"
                            title="우선순위 아래로"
                          >
                            ↓
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openAddPolicyModal(pol)}
                        className="px-2.5 py-1 rounded-lg hover:bg-slate-100 font-semibold text-slate-600"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirm("이 사번 정책을 삭제하시겠습니까?")) return;
                          onSaveExtra(
                            {
                              emp_no_policies: empPolicies.filter(
                                (p) => p.id !== pol.id
                              ),
                            },
                            "사번 정책이 삭제되었습니다."
                          );
                        }}
                        className="px-2.5 py-1 rounded-lg hover:bg-rose-50 font-semibold text-rose-500"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 하단 이전/다음 카드 (Image 2 동일) */}
        <div className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("seal")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                회사 직인
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("doc-box")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                문서함 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 A: 직위 설정 / 직책 설정 / 직무 설정 (Images 3, 4, 5)          */}
      {/* ================================================================= */}
      {(subModal === "position" ||
        subModal === "title" ||
        subModal === "job") && (
        <div className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[500px] h-[640px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-7 h-7 rounded-lg ${simpleModalMeta.badgeBg} text-white flex items-center justify-center text-sm`}
                >
                  {simpleModalMeta.icon}
                </span>
                <span className="text-[15px] font-extrabold text-slate-900">
                  {simpleModalMeta.title}
                </span>
                <span
                  className="text-slate-300 text-xs cursor-help"
                  title={simpleModalMeta.tooltip}
                >
                  ⓘ
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSearchOpen((p) => !p)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-xs"
                  title="검색"
                >
                  🔍
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => addInputRef.current?.focus()}
                    className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-600 font-bold text-base leading-none flex items-center justify-center"
                    title="항목 추가"
                  >
                    +
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSubModal(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {searchOpen && (
              <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="항목명 검색..."
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none"
                />
              </div>
            )}

            {/* 체크박스 목록 */}
            <div className="flex-1 overflow-y-auto custom-scroll text-xs">
              <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={
                      listDraft.length > 0 &&
                      checkedItems.length === listDraft.length
                    }
                    onChange={(e) =>
                      setCheckedItems(e.target.checked ? [...listDraft] : [])
                    }
                    className="w-4 h-4 rounded border-slate-300 accent-emerald-500"
                  />
                  <span className="font-semibold text-slate-600">
                    총 {listDraft.length}개
                  </span>
                </label>

                {canEdit && checkedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setListDraft((prev) =>
                        prev.filter((x) => !checkedItems.includes(x))
                      );
                      setCheckedItems([]);
                    }}
                    className="text-xs font-bold text-rose-500 hover:underline"
                  >
                    선택 삭제 ({checkedItems.length})
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-100">
                {filteredListDraft.map(({ item, idx }) => {
                  const checked = checkedItems.includes(item);
                  return (
                    <div
                      key={`${item}-${idx}`}
                      className="group px-6 py-3.5 flex items-center justify-between hover:bg-slate-50/70"
                    >
                      <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCheckedItems((prev) =>
                              e.target.checked
                                ? [...prev, item]
                                : prev.filter((x) => x !== item)
                            )
                          }
                          className="w-4 h-4 rounded border-slate-300 accent-emerald-500 shrink-0"
                        />
                        {editingIdx === idx ? (
                          <input
                            autoFocus
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editingText.trim()) {
                                setListDraft((prev) =>
                                  prev.map((v, i) =>
                                    i === idx ? editingText.trim() : v
                                  )
                                );
                                setEditingIdx(null);
                              }
                              if (e.key === "Escape") setEditingIdx(null);
                            }}
                            onBlur={() => {
                              if (editingText.trim()) {
                                setListDraft((prev) =>
                                  prev.map((v, i) =>
                                    i === idx ? editingText.trim() : v
                                  )
                                );
                              }
                              setEditingIdx(null);
                            }}
                            className="px-2 py-1 rounded border border-emerald-400 font-bold text-slate-900 focus:outline-none"
                          />
                        ) : (
                          <span className="font-semibold text-slate-800 truncate">
                            {item}
                          </span>
                        )}
                      </label>

                      {canEdit && editingIdx !== idx && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 text-slate-400">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingIdx(idx);
                              setEditingText(item);
                            }}
                            className="hover:text-slate-700"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setListDraft((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="hover:text-rose-500"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 하단 인라인 입력 행 (Images 3, 4, 5 동일) */}
              {canEdit && (
                <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
                  <input
                    ref={addInputRef}
                    value={newItemInput}
                    onChange={(e) => setNewItemInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAppendListItem();
                      }
                    }}
                    placeholder={simpleModalMeta.placeholder}
                    className="flex-1 pl-7 text-xs font-medium text-slate-800 placeholder:text-slate-300 focus:outline-none"
                  />
                  {newItemInput.trim() && (
                    <button
                      type="button"
                      onClick={handleAppendListItem}
                      className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]"
                    >
                      추가
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 하단 설정 저장 푸터 */}
            <div className="px-6 py-3.5 border-t border-slate-100 flex justify-end shrink-0 bg-white">
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveSimpleList}
                  className="px-5 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white text-xs font-extrabold shadow-xs transition-colors"
                >
                  설정 저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 B: 직군 설정 (Image 6)                                        */}
      {/* ================================================================= */}
      {subModal === "job_group" && (
        <div className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[500px] h-[620px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-[#7f95ab] text-white flex items-center justify-center text-sm">
                  🗂️
                </span>
                <span className="text-[15px] font-extrabold text-slate-900">
                  직군 설정
                </span>
                <span
                  className="text-slate-300 text-xs cursor-help"
                  title="유사한 성격의 직무들을 묶은 상위 분류 단위입니다."
                >
                  ⓘ
                </span>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setGroupCreatorOpen(true)}
                    className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-600 font-bold text-base leading-none flex items-center justify-center"
                  >
                    +
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSubModal(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-6 flex flex-col">
              {groupDrafts.length === 0 && !groupCreatorOpen ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="w-8 h-8 rounded-lg border border-slate-200 text-slate-300 flex items-center justify-center text-xs font-bold mb-3">
                    !
                  </div>
                  <div className="text-xs font-extrabold text-slate-800">
                    아직 추가한 직군이 없어요.
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    직군을 추가하면 여기에 보여져요.
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setGroupCreatorOpen(true)}
                      className="mt-4 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs"
                    >
                      + 직군 만들기
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  {groupCreatorOpen && canEdit && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div>
                        <label className="block font-bold text-slate-600 mb-1">
                          새 직군 이름
                        </label>
                        <input
                          autoFocus
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          placeholder="예: 연구·집필직군, 출판제작직군, 경영관리직군"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-600 mb-1.5">
                          포함할 직무 선택 (선택)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {jobs.map((jb) => {
                            const sel = newGroupJobs.includes(jb);
                            return (
                              <button
                                key={jb}
                                type="button"
                                onClick={() =>
                                  setNewGroupJobs((prev) =>
                                    sel
                                      ? prev.filter((x) => x !== jb)
                                      : [...prev, jb]
                                  )
                                }
                                className={`px-2.5 py-1 rounded-lg border font-semibold ${
                                  sel
                                    ? "bg-emerald-50 border-emerald-400 text-emerald-800"
                                    : "bg-white border-slate-200 text-slate-600"
                                }`}
                              >
                                {jb}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setGroupCreatorOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 font-bold"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!newGroupName.trim()) return;
                            setGroupDrafts((prev) => [
                              ...prev,
                              {
                                id: uid(),
                                name: newGroupName.trim(),
                                jobs: newGroupJobs,
                              },
                            ]);
                            setNewGroupName("");
                            setNewGroupJobs([]);
                            setGroupCreatorOpen(false);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                        >
                          목록에 추가
                        </button>
                      </div>
                    </div>
                  )}

                  {groupDrafts.map((grp) => (
                    <div
                      key={grp.id}
                      className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-[13px]">
                          {grp.name}
                        </div>
                        <div className="text-slate-400 mt-0.5">
                          {grp.jobs && grp.jobs.length > 0
                            ? `연결 직무: ${grp.jobs.join(", ")}`
                            : "연결된 세부 직무 없음"}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            setGroupDrafts((prev) =>
                              prev.filter((x) => x.id !== grp.id)
                            )
                          }
                          className="text-slate-400 hover:text-rose-500 font-semibold"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-100 flex justify-end shrink-0">
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await onSaveExtra(
                      { hr_job_groups: groupDrafts },
                      "직군 설정이 저장되었습니다."
                    );
                    setSubModal(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white text-xs font-extrabold"
                >
                  설정 저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 C: 직급 설정 (Image 7)                                        */}
      {/* ================================================================= */}
      {subModal === "grade" && (
        <div className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[500px] h-[620px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-[#897ce3] text-white flex items-center justify-center text-sm">
                  ⚙️
                </span>
                <span className="text-[15px] font-extrabold text-slate-900">
                  직급 설정
                </span>
                <span
                  className="text-slate-300 text-xs cursor-help"
                  title="직무 수행 수준과 숙련도 단계(예: L1~L5, 호봉)입니다."
                >
                  ⓘ
                </span>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setGradeCreatorOpen(true)}
                    className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-600 font-bold text-base leading-none flex items-center justify-center"
                  >
                    +
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSubModal(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-6 flex flex-col">
              {gradeDrafts.length === 0 && !gradeCreatorOpen ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="w-8 h-8 rounded-lg border border-slate-200 text-slate-300 flex items-center justify-center text-xs font-bold mb-3">
                    !
                  </div>
                  <div className="text-xs font-extrabold text-slate-800">
                    아직 추가한 직급이 없어요.
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    직급을 추가하면 여기에 보여져요.
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setGradeCreatorOpen(true)}
                      className="mt-4 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs"
                    >
                      + 직급 만들기
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  {gradeCreatorOpen && canEdit && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div>
                        <label className="block font-bold text-slate-600 mb-1">
                          새 직급 명칭
                        </label>
                        <input
                          autoFocus
                          value={newGradeName}
                          onChange={(e) => setNewGradeName(e.target.value)}
                          placeholder="예: L1 (주니어), L2 (시니어), L3 (리드)"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-600 mb-1">
                          설명 (선택)
                        </label>
                        <input
                          value={newGradeDesc}
                          onChange={(e) => setNewGradeDesc(e.target.value)}
                          placeholder="숙련도 기준 설명"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setGradeCreatorOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 font-bold"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!newGradeName.trim()) return;
                            setGradeDrafts((prev) => [
                              ...prev,
                              {
                                id: uid(),
                                name: newGradeName.trim(),
                                description: newGradeDesc.trim(),
                              },
                            ]);
                            setNewGradeName("");
                            setNewGradeDesc("");
                            setGradeCreatorOpen(false);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                        >
                          목록에 추가
                        </button>
                      </div>
                    </div>
                  )}

                  {gradeDrafts.map((gr) => (
                    <div
                      key={gr.id}
                      className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-[13px]">
                          {gr.name}
                        </div>
                        {gr.description && (
                          <div className="text-slate-400 mt-0.5">
                            {gr.description}
                          </div>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            setGradeDrafts((prev) =>
                              prev.filter((x) => x.id !== gr.id)
                            )
                          }
                          className="text-slate-400 hover:text-rose-500 font-semibold"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-100 flex justify-end shrink-0">
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await onSaveExtra(
                      { hr_grades: gradeDrafts },
                      "직급 설정이 저장되었습니다."
                    );
                    setSubModal(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white text-xs font-extrabold"
                >
                  설정 저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 D: 조직도 설정 (Images 8 & 9)                                 */}
      {/* ================================================================= */}
      {subModal === "org_chart" && (
        <div className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] h-[680px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7">
            {/* 상단 우측 메뉴 & 닫기 */}
            <div className="flex items-center justify-end gap-2 relative shrink-0">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setOrgTopMenuOpen((p) => !p)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
                >
                  ⋯
                </button>
              )}
              <button
                type="button"
                onClick={() => setSubModal(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>

              {orgTopMenuOpen && (
                <div className="absolute right-8 top-7 w-52 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={handleSyncFromActualDepartments}
                    className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    🔄 재직 구성원 부서 자동 동기화
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrgTopMenuOpen(false);
                      setOrgDraft(DEFAULT_ORG_CHART_NODES.map((n) => ({ ...n })));
                    }}
                    className="w-full px-3.5 py-2 text-left font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    기본 조직도로 초기화
                  </button>
                </div>
              )}
            </div>

            {/* 타이틀 + 적용일/메모 칩 */}
            <div className="mt-1 shrink-0 relative">
              <h3 className="text-xl font-extrabold text-slate-900">
                조직도 설정
              </h3>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOrgDateOpen((p) => !p);
                    setOrgGuideStep(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg bg-orange-50 text-orange-600 text-xs font-bold ${
                    orgGuideStep === 1
                      ? "ring-2 ring-blue-400 border border-blue-300"
                      : "border border-orange-200/80"
                  }`}
                >
                  적용일 {effectiveLabel}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOrgMemoOpen((p) => !p);
                    setOrgGuideStep(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                    orgGuideStep === 2
                      ? "ring-2 ring-blue-400 border-blue-300 bg-white text-slate-800"
                      : orgMemo
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-slate-100 border-slate-200/70 text-slate-500"
                  }`}
                >
                  메모{orgMemo ? " ✓" : ""}
                </button>
              </div>

              {/* Image 8 스타일 2단계 온보딩 툴팁 */}
              {orgGuideStep > 0 && (
                <div className="absolute left-0 top-20 z-30 w-64 rounded-xl bg-[#1e2329] text-white p-4 shadow-xl text-xs">
                  {orgGuideStep === 1 ? (
                    <>
                      <div className="font-bold mb-1">
                        조직도의 적용 시점을 설정해보세요.
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        조직별로 설정하던 조직의 시작, 종료일을 &apos;적용일&apos;로 한번에 설정할 수 있어요.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="font-bold mb-1">
                        조직 개편 메모를 함께 남겨보세요.
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        조직 개편 사유나 변경 내역을 메모로 기록해 두면 언제든 확인할 수 있어요.
                      </p>
                    </>
                  )}
                  <div className="mt-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          orgGuideStep === 1 ? "bg-white" : "bg-slate-600"
                        }`}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          orgGuideStep === 2 ? "bg-white" : "bg-slate-600"
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setOrgGuideStep(0)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-white"
                      >
                        닫기
                      </button>
                      {orgGuideStep === 1 ? (
                        <button
                          type="button"
                          onClick={() => setOrgGuideStep(2)}
                          className="text-[11px] font-bold text-white hover:underline"
                        >
                          다음
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOrgGuideStep(0)}
                          className="text-[11px] font-bold text-emerald-400 hover:underline"
                        >
                          확인
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {orgDateOpen && (
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    type="date"
                    value={orgEffectiveDate}
                    onChange={(e) => setOrgEffectiveDate(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setOrgEffectiveDate(todayIso)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600"
                  >
                    오늘
                  </button>
                </div>
              )}

              {orgMemoOpen && (
                <div className="mt-2.5">
                  <input
                    value={orgMemo}
                    onChange={(e) => setOrgMemo(e.target.value)}
                    placeholder="조직 개편 사유나 메모를 남겨보세요."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                  />
                </div>
              )}
            </div>

            {/* 전체(N) + 검색 / 추가 / 모두 접기 툴바 */}
            <div className="mt-6 pb-2.5 border-b border-slate-100 flex items-center justify-between text-xs shrink-0">
              <span className="font-bold text-slate-800">
                전체 ({orgDraft.length})
              </span>

              <div className="flex items-center gap-2.5 text-slate-500">
                <button
                  type="button"
                  onClick={() => setOrgSearchOpen((p) => !p)}
                  className="hover:text-slate-900"
                  title="조직 검색"
                >
                  🔍
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const ceoNode = orgDraft.find((n) => n.name === "대표");
                      setAddingNodeParentId(ceoNode ? ceoNode.id : null);
                      if (ceoNode && !expandedNodeIds.includes(ceoNode.id)) {
                        setExpandedNodeIds((prev) => [...prev, ceoNode.id]);
                      }
                      setNewNodeName("");
                    }}
                    className="font-bold text-base leading-none hover:text-slate-900"
                    title="부서 추가"
                  >
                    +
                  </button>
                )}
                <span className="text-slate-200">|</span>
                <button
                  type="button"
                  onClick={toggleAllOrgExpand}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
                >
                  {expandedNodeIds.length > 0 ? "⤡ 모두 접기" : "⤢ 모두 펼치기"}
                </button>
              </div>
            </div>

            {orgSearchOpen && (
              <div className="py-2 border-b border-slate-100 shrink-0">
                <input
                  autoFocus
                  value={orgSearchQuery}
                  onChange={(e) => setOrgSearchQuery(e.target.value)}
                  placeholder="부서·조직명 검색..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none"
                />
              </div>
            )}

            {/* 트리 본문 */}
            <div className="flex-1 overflow-y-auto custom-scroll py-1">
              {addingNodeParentId === null && (
                <div className="py-2.5 px-2 bg-emerald-50/40 border-b border-emerald-100 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newNodeName}
                    onChange={(e) => setNewNodeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddOrgNode();
                      if (e.key === "Escape") setAddingNodeParentId("CLOSED");
                    }}
                    placeholder="최상위 조직명 입력"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs font-bold"
                  />
                  <button
                    type="button"
                    onClick={handleAddOrgNode}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                  >
                    추가
                  </button>
                </div>
              )}

              {renderOrgTreeNodes(null, 0)}
            </div>

            {/* 하단 풀사이즈 그라데이션 저장하기 버튼 (Images 8 & 9 동일) */}
            {canEdit && (
              <div className="pt-4 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveOrgChart}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving ? "저장 중..." : "저장하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 E: 사번 자동 부여 정책 추가/수정                              */}
      {/* ================================================================= */}
      {subModal === "emp_policy" && (
        <div className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h4 className="text-sm font-bold">
                {editingPolicy
                  ? "사번 자동 부여 정책 수정"
                  : "+ 사번 자동 부여 정책 추가"}
              </h4>
              <button
                type="button"
                onClick={() => setSubModal(null)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  정책 이름
                </label>
                <input
                  value={policyForm.name}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, name: e.target.value })
                  }
                  placeholder="예: 정규직 입사연월 사번 정책"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    적용 고용형태
                  </label>
                  <select
                    value={policyForm.target_employment}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        target_employment: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value="전체">전체 구성원</option>
                    {HQ_EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    접두어 (선택)
                  </label>
                  <input
                    value={policyForm.prefix}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, prefix: e.target.value })
                    }
                    placeholder="비움 또는 HQ-"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">
                    입사일 연·월 규칙
                  </label>
                  <select
                    value={policyForm.date_part}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        date_part: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value="YYYYMM">입사 연월 6자리 (202605)</option>
                    <option value="YYYY">입사 연도 4자리 (2026)</option>
                    <option value="YY">입사 연도 2자리 (26)</option>
                    <option value="NONE">날짜 사용 안함</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    일련번호 자릿수
                  </label>
                  <select
                    value={policyForm.seq_digits}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        seq_digits: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value={2}>2자리 (01)</option>
                    <option value={3}>3자리 (001)</option>
                    <option value={4}>4자리 (0001)</option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
                <span className="font-bold text-emerald-900">
                  자동 생성 사번 미리보기
                </span>
                <span className="font-mono text-sm font-extrabold text-emerald-700">
                  {formatEmpNoPreview(policyForm)}
                </span>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubModal(null)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveEmpPolicy}
                className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white font-extrabold"
              >
                정책 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
