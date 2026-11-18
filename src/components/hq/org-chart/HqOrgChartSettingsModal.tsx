// src/components/hq/org-chart/HqOrgChartSettingsModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import { countMembersInOrg, normalizeOrgNodes } from "@/lib/hq/orgTreeHelper";
import type { HqMember, HqOrgChartNode } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  initialNodes?: HqOrgChartNode[] | null;
  initialEffectiveDate?: string;
  initialMemo?: string;
  members: HqMember[];
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: {
    nodes: HqOrgChartNode[];
    effectiveDate: string;
    memo: string;
    renameMap: Record<string, string>;
  }) => Promise<void>;
}

type DropPosition = "BEFORE" | "AFTER" | "INSIDE";

function makeNodeId(): string {
  return `org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 플렉스 스타일 주황색 숨김(eye-off) 아이콘 */
function EyeOffAmberIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

/** 6점 드래그 그립 아이콘 */
function DragGripIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="5.5" cy="3.5" r="1.2" />
      <circle cx="10.5" cy="3.5" r="1.2" />
      <circle cx="5.5" cy="8" r="1.2" />
      <circle cx="10.5" cy="8" r="1.2" />
      <circle cx="5.5" cy="12.5" r="1.2" />
      <circle cx="10.5" cy="12.5" r="1.2" />
    </svg>
  );
}

export default function HqOrgChartSettingsModal({
  isOpen,
  initialNodes,
  initialEffectiveDate,
  initialMemo,
  members,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [nodes, setNodes] = useState<HqOrgChartNode[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(todayIso);
  const [memo, setMemo] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [topMenuOpen, setTopMenuOpen] = useState(false);

  // 다중/단일 행 선택 상태 (하단 숨기기 · 숨김 해제하기 · 조직 삭제 바 연동)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // 드래그 앤 드롭 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<{
    targetId: string;
    position: DropPosition;
  } | null>(null);

  // 하위 조직(또는 최상위 조직) 인라인 추가 상태
  const [addingUnderParentId, setAddingUnderParentId] = useState<
    string | "ROOT" | null
  >(null);
  const [newOrgName, setNewOrgName] = useState("");

  // 행별 [⋯] 팝오버 상태 (이름 수정 / 옮기기 / 숨기기 / 삭제하기)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveModeNodeId, setMoveModeNodeId] = useState<string | null>(null);

  // 조직 이름 변경 및 삭제 시 소속 구성원 자동 마이그레이션 맵
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    const norm = normalizeOrgNodes(initialNodes).map((n, idx) => ({
      ...n,
      order: idx + 1,
    }));
    setNodes(norm);
    setEffectiveDate(initialEffectiveDate || todayIso);
    setMemo(initialMemo || "");
    setDateOpen(false);
    setMemoOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setCollapsedIds([]);
    setTopMenuOpen(false);
    setSelectedIds([]);
    setBulkMoveOpen(false);
    setDraggingId(null);
    setDragOverInfo(null);
    setAddingUnderParentId(null);
    setNewOrgName("");
    setMenuNodeId(null);
    setMoveModeNodeId(null);
    setRenameMap({});
  }, [isOpen, initialNodes, initialEffectiveDate, initialMemo, todayIso]);

  const validIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const resolveParentId = (n: HqOrgChartNode): string | null =>
    n.parent_id && validIdSet.has(n.parent_id) ? n.parent_id : null;

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, HqOrgChartNode[]>();
    [...nodes]
      .sort((a, b) => a.order - b.order)
      .forEach((n) => {
        const pid =
          n.parent_id && validIdSet.has(n.parent_id) ? n.parent_id : null;
        map.set(pid, [...(map.get(pid) || []), n]);
      });
    return map;
  }, [nodes, validIdSet]);

  const parentNodeIds = useMemo(
    () =>
      nodes
        .filter((n) => (childrenMap.get(n.id) || []).length > 0)
        .map((n) => n.id),
    [nodes, childrenMap]
  );

  if (!isOpen) return null;

  const isRetiredSystemNode = (node: HqOrgChartNode) =>
    node.id === "org-retired" || node.name === "퇴직";

  // 특정 노드의 모든 하위 자손 ID 집합 (순환 이동 방지 및 하위 일괄 삭제용)
  const collectDescendantIds = (rootId: string): Set<string> => {
    const set = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach((n) => {
        if (n.parent_id && set.has(n.parent_id) && !set.has(n.id)) {
          set.add(n.id);
          changed = true;
        }
      });
    }
    return set;
  };

  const draggingNode = draggingId
    ? nodes.find((n) => n.id === draggingId) || null
    : null;

  const commitInlineAdd = () => {
    const trimmed = newOrgName.trim();
    if (!trimmed || addingUnderParentId === null) {
      setAddingUnderParentId(null);
      setNewOrgName("");
      return;
    }
    if (nodes.some((n) => n.name === trimmed)) {
      alert(`이미 [${trimmed}] 조직이 존재합니다.`);
      return;
    }
    const parentId =
      addingUnderParentId === "ROOT" ? null : addingUnderParentId;
    const maxOrder = nodes.reduce((m, n) => Math.max(m, n.order), 0);

    setNodes((prev) => [
      ...prev,
      {
        id: makeNodeId(),
        name: trimmed,
        parent_id: parentId,
        is_hidden: false,
        order: maxOrder + 1,
      },
    ]);
    if (parentId) {
      setCollapsedIds((prev) => prev.filter((id) => id !== parentId));
    }
    setNewOrgName("");
    setAddingUnderParentId(null);
  };

  const commitNodeRename = (node: HqOrgChartNode, nextRaw: string) => {
    const nextName = nextRaw.trim();
    if (!nextName || nextName === node.name) return;
    if (nodes.some((n) => n.id !== node.id && n.name === nextName)) {
      alert(`이미 [${nextName}] 조직이 존재합니다.`);
      return;
    }
    setRenameMap((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((origKey) => {
        if (updated[origKey] === node.name) {
          updated[origKey] = nextName;
        }
      });
      updated[node.name] = nextName;
      return updated;
    });
    setNodes((prev) =>
      prev.map((n) => (n.id === node.id ? { ...n, name: nextName } : n))
    );
  };

  const handleMoveParent = (
    targetNode: HqOrgChartNode,
    newParentId: string | null
  ) => {
    const descendants = collectDescendantIds(targetNode.id);
    if (newParentId && descendants.has(newParentId)) {
      alert("자기 자신이나 하위 조직 아래로는 이동할 수 없습니다.");
      return;
    }
    const maxOrder = nodes.reduce((m, n) => Math.max(m, n.order), 0);
    setNodes((prev) =>
      prev.map((n) =>
        n.id === targetNode.id
          ? { ...n, parent_id: newParentId, order: maxOrder + 1 }
          : n
      )
    );
    if (newParentId) {
      setCollapsedIds((prev) => prev.filter((id) => id !== newParentId));
    }
    setMoveModeNodeId(null);
    setMenuNodeId(null);
  };

  // 드래그 앤 드롭 실행 (BEFORE / AFTER 순서 및 계층 이동, INSIDE 하위 조직 편입)
  const executeDropMove = (
    sourceId: string,
    targetId: string,
    position: DropPosition
  ) => {
    if (!sourceId || sourceId === targetId) return;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    const targetNode = nodes.find((n) => n.id === targetId);
    if (!sourceNode || !targetNode) return;

    const sourceDescendants = collectDescendantIds(sourceId);
    if (sourceDescendants.has(targetId)) {
      return;
    }

    if (position === "INSIDE") {
      const maxOrder = nodes.reduce((m, n) => Math.max(m, n.order), 0);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === sourceId
            ? { ...n, parent_id: targetNode.id, order: maxOrder + 1 }
            : n
        )
      );
      setCollapsedIds((prev) => prev.filter((id) => id !== targetNode.id));
      return;
    }

    const newParentId = resolveParentId(targetNode);
    const siblingsWithoutSource = [...nodes]
      .filter((n) => resolveParentId(n) === newParentId && n.id !== sourceId)
      .sort((a, b) => a.order - b.order);

    const targetIdx = siblingsWithoutSource.findIndex((s) => s.id === targetId);
    const insertIdx =
      targetIdx < 0
        ? siblingsWithoutSource.length
        : position === "BEFORE"
          ? targetIdx
          : targetIdx + 1;

    const updatedSource: HqOrgChartNode = {
      ...sourceNode,
      parent_id: newParentId,
    };
    const nextSiblings = [...siblingsWithoutSource];
    nextSiblings.splice(insertIdx, 0, updatedSource);

    // 형제 그룹에 새 순번 부여 후 전체 노드 order 재정렬
    const siblingRank = new Map<string, number>();
    nextSiblings.forEach((s, i) => siblingRank.set(s.id, i + 1));

    setNodes((prev) => {
      const otherNodes = prev
        .filter((n) => !siblingRank.has(n.id))
        .sort((a, b) => a.order - b.order);

      // 새 트리 순서를 깔끔하게 유지하도록 그룹별 재번호 부여
      const merged: HqOrgChartNode[] = [];
      let cursor = 1;

      const byParent = new Map<string | null, HqOrgChartNode[]>();
      const allUpdated = [
        ...nextSiblings,
        ...otherNodes,
      ];
      const allIds = new Set(allUpdated.map((x) => x.id));
      allUpdated.forEach((n) => {
        const pid = n.parent_id && allIds.has(n.parent_id) ? n.parent_id : null;
        const arr = byParent.get(pid) || [];
        arr.push(n);
        byParent.set(pid, arr);
      });

      byParent.forEach((arr, pid) => {
        if (pid === newParentId) {
          arr.sort(
            (a, b) => (siblingRank.get(a.id) ?? 999) - (siblingRank.get(b.id) ?? 999)
          );
        } else {
          arr.sort((a, b) => a.order - b.order);
        }
      });

      const visited = new Set<string>();
      const walk = (pid: string | null) => {
        for (const item of byParent.get(pid) || []) {
          if (visited.has(item.id)) continue;
          visited.add(item.id);
          merged.push({ ...item, order: cursor++ });
          walk(item.id);
        }
      };
      walk(null);
      allUpdated.forEach((item) => {
        if (!visited.has(item.id)) {
          merged.push({ ...item, order: cursor++ });
        }
      });
      return merged;
    });
  };

  const handleToggleHidden = (node: HqOrgChartNode) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, is_hidden: !n.is_hidden } : n
      )
    );
  };

  const handleBulkToggleHidden = (nextHidden: boolean) => {
    if (selectedIds.length === 0) return;
    const selSet = new Set(selectedIds);
    setNodes((prev) =>
      prev.map((n) => (selSet.has(n.id) ? { ...n, is_hidden: nextHidden } : n))
    );
    setSelectedIds([]);
    setBulkMoveOpen(false);
  };

  const handleBulkMoveParent = (newParentId: string | null) => {
    if (selectedIds.length === 0) return;
    const forbidden = new Set<string>();
    selectedIds.forEach((sid) => {
      collectDescendantIds(sid).forEach((d) => forbidden.add(d));
    });
    if (newParentId && forbidden.has(newParentId)) {
      alert("선택된 조직 자신이나 하위 조직 아래로는 이동할 수 없습니다.");
      return;
    }
    let maxOrder = nodes.reduce((m, n) => Math.max(m, n.order), 0);
    const selSet = new Set(selectedIds);
    setNodes((prev) =>
      prev.map((n) =>
        selSet.has(n.id)
          ? { ...n, parent_id: newParentId, order: ++maxOrder }
          : n
      )
    );
    if (newParentId) {
      setCollapsedIds((prev) => prev.filter((id) => id !== newParentId));
    }
    setSelectedIds([]);
    setBulkMoveOpen(false);
  };

  const handleDeleteNodes = (targetNodes: HqOrgChartNode[]) => {
    if (targetNodes.length === 0) return;
    if (targetNodes.some((n) => isRetiredSystemNode(n))) {
      alert(
        "기본 [퇴직] 분류 노드는 삭제할 수 없습니다. 조직도에서 보이지 않게 하려면 [숨기기]를 사용해 주세요."
      );
      return;
    }

    const toRemoveIds = new Set<string>();
    targetNodes.forEach((tn) => {
      collectDescendantIds(tn.id).forEach((id) => toRemoveIds.add(id));
    });

    const removedNodes = nodes.filter((n) => toRemoveIds.has(n.id));
    const affectedCount = removedNodes.reduce(
      (sum, rn) => sum + countMembersInOrg(rn.name, members),
      0
    );

    const firstTarget = targetNodes[0];
    const parentNode = nodes.find((n) => n.id === firstTarget.parent_id);
    const fallbackDept =
      parentNode && !parentNode.is_hidden && !toRemoveIds.has(parentNode.id)
        ? parentNode.name
        : nodes.find((n) => !toRemoveIds.has(n.id) && !n.is_hidden)?.name ||
          "대표";

    const titleLabel =
      targetNodes.length === 1
        ? `[${firstTarget.name}]`
        : `[${firstTarget.name}] 외 ${targetNodes.length - 1}개 조직`;

    const msg =
      affectedCount > 0
        ? `${titleLabel}${
            removedNodes.length > targetNodes.length
              ? ` (하위 조직 포함 총 ${removedNodes.length}개)`
              : ""
          }에 현재 ${affectedCount}명의 구성원이 소속되어 있습니다.\n삭제 시 소속 구성원은 상위 조직(${fallbackDept})으로 안전하게 이동됩니다. 삭제하시겠습니까?`
        : `${titleLabel}${
            removedNodes.length > targetNodes.length
              ? ` 및 하위 조직`
              : ""
          }을(를) 삭제하시겠습니까?`;

    if (!confirm(msg)) return;

    if (affectedCount > 0) {
      setRenameMap((prev) => {
        const updated = { ...prev };
        removedNodes.forEach((rn) => {
          updated[rn.name] = fallbackDept;
        });
        return updated;
      });
    }

    setNodes((prev) => prev.filter((n) => !toRemoveIds.has(n.id)));
    setSelectedIds((prev) => prev.filter((id) => !toRemoveIds.has(id)));
    setMenuNodeId(null);
    setBulkMoveOpen(false);
  };

  const handleSyncOrphanDepartments = () => {
    setTopMenuOpen(false);
    const existingNames = new Set(nodes.map((n) => n.name));
    const ceoNode =
      nodes.find((n) => n.name === "대표") ||
      nodes.find((n) => n.parent_id === null && !n.is_hidden);
    const parentId = ceoNode ? ceoNode.id : null;
    let maxOrder = nodes.reduce((m, n) => Math.max(m, n.order), 0);

    const added: HqOrgChartNode[] = [];
    members.forEach((m) => {
      if (m.work_status === "퇴직") return;
      const dept = (m.department || "").trim();
      if (dept && dept !== "미지정" && !existingNames.has(dept)) {
        existingNames.add(dept);
        added.push({
          id: makeNodeId(),
          name: dept,
          parent_id: parentId,
          is_hidden: false,
          order: ++maxOrder,
        });
      }
    });

    if (added.length === 0) {
      alert("이미 모든 재직 구성원의 소속 조직이 조직도에 등록되어 있습니다.");
      return;
    }
    setNodes((prev) => [...prev, ...added]);
  };

  const toggleRowSelect = (nodeId: string) => {
    setSelectedIds((prev) =>
      prev.includes(nodeId)
        ? prev.filter((id) => id !== nodeId)
        : [...prev, nodeId]
    );
    setBulkMoveOpen(false);
  };

  const selectedNodeObjs = nodes.filter((n) => selectedIds.includes(n.id));
  const allSelectedHidden =
    selectedNodeObjs.length > 0 &&
    selectedNodeObjs.every((n) => Boolean(n.is_hidden));

  const renderDropIndicatorLine = (depth: number) => {
    if (!draggingNode) return null;
    return (
      <div
        style={{ paddingLeft: `${depth * 22 + 22}px` }}
        className="relative h-0 z-30 pointer-events-none select-none flex items-center"
      >
        <div className="w-full flex items-center relative">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[#00c458] bg-white shrink-0" />
          <div className="flex-1 h-[2px] bg-[#00c458]" />
          <span className="absolute left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#00c458] text-white text-[11px] font-extrabold shadow-md whitespace-nowrap">
            {draggingNode.name}
          </span>
        </div>
      </div>
    );
  };

  const renderTreeRows = (
    parentId: string | null,
    depth: number
  ): React.ReactNode => {
    const list = childrenMap.get(parentId) || [];
    if (list.length === 0) return null;

    const kw = searchQuery.trim().toLowerCase();

    return list.map((node) => {
      const subChildren = childrenMap.get(node.id) || [];
      const hasSub = subChildren.length > 0;
      const isCollapsed = collapsedIds.includes(node.id);
      const memCnt = countMembersInOrg(node.name, members);
      const isMenuOpen = menuNodeId === node.id;
      const isAddingChildHere = addingUnderParentId === node.id;
      const isSelected = selectedIds.includes(node.id);
      const isBeingDragged = draggingId === node.id;
      const dropHere =
        dragOverInfo?.targetId === node.id ? dragOverInfo.position : null;

      if (kw) {
        const descIds = collectDescendantIds(node.id);
        const anyMatch = nodes.some(
          (n) => descIds.has(n.id) && n.name.toLowerCase().includes(kw)
        );
        if (!anyMatch) return null;
      }

      const descendants = collectDescendantIds(node.id);
      const validMoveTargets = nodes.filter((n) => !descendants.has(n.id));
      const canDrag = menuNodeId === null && addingUnderParentId === null;

      return (
        <React.Fragment key={node.id}>
          {dropHere === "BEFORE" && renderDropIndicatorLine(depth)}

          <div
            draggable={canDrag}
            onDragStart={(e) => {
              if (!canDrag) {
                e.preventDefault();
                return;
              }
              setDraggingId(node.id);
              setMenuNodeId(null);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", node.id);
            }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === node.id) return;
              if (collectDescendantIds(draggingId).has(node.id)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio =
                rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
              const pos: DropPosition =
                ratio < 0.28 ? "BEFORE" : ratio > 0.72 ? "AFTER" : "INSIDE";
              if (
                dragOverInfo?.targetId !== node.id ||
                dragOverInfo?.position !== pos
              ) {
                setDragOverInfo({ targetId: node.id, position: pos });
              }
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverInfo(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const srcId =
                draggingId || e.dataTransfer.getData("text/plain") || "";
              const pos =
                dragOverInfo?.targetId === node.id
                  ? dragOverInfo.position
                  : "AFTER";
              setDraggingId(null);
              setDragOverInfo(null);
              if (srcId) {
                executeDropMove(srcId, node.id, pos);
              }
            }}
            onClick={() => toggleRowSelect(node.id)}
            style={{ paddingLeft: `${depth * 22 + 4}px` }}
            className={`pr-2.5 py-2.5 rounded-xl flex items-center justify-between gap-2 group transition-colors relative cursor-pointer select-none ${
              isBeingDragged
                ? "opacity-45 bg-slate-100"
                : dropHere === "INSIDE"
                  ? "bg-emerald-50/80 ring-2 ring-[#00c458]"
                  : isSelected
                    ? "bg-[#eff6ff]"
                    : isMenuOpen || isAddingChildHere
                      ? "bg-slate-100/90"
                      : "hover:bg-slate-50"
            }`}
          >
            {/* 좌측: 모든 노드에 동일한 폭의 드래그 핸들 슬롯을 배치하여 완벽 정렬 */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-4 h-4 shrink-0 flex items-center justify-center text-slate-300 cursor-grab active:cursor-grabbing transition-opacity ${
                  isBeingDragged
                    ? "opacity-100 text-slate-500"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                title="드래그하여 순서 또는 상위·하위 조직 이동"
              >
                <DragGripIcon />
              </span>

              {hasSub ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsedIds((prev) =>
                      isCollapsed
                        ? prev.filter((id) => id !== node.id)
                        : [...prev, node.id]
                    );
                  }}
                  className="w-4 h-4 shrink-0 flex items-center justify-center text-slate-500 text-[10px] font-extrabold hover:text-slate-800"
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className="w-4 h-4 shrink-0 flex items-center justify-center text-slate-300 text-[10px]">
                  •
                </span>
              )}

              <span
                className={`text-[13px] font-bold truncate ${
                  node.is_hidden ? "text-slate-600" : "text-slate-800"
                }`}
              >
                {node.name}
              </span>

              {node.is_hidden && (
                <span
                  className="text-amber-500 shrink-0 inline-flex items-center ml-0.5"
                  title="조직도 화면에서 숨김 처리된 조직"
                >
                  <EyeOffAmberIcon />
                </span>
              )}

              {memCnt > 0 && !node.is_hidden && (
                <span className="text-xs font-bold text-slate-300 ml-0.5">
                  {memCnt}
                </span>
              )}
            </div>

            {/* 우측: 드래그 하위이동 안내 / 선택 체크 표시 / 호버 시 [+] [⋯] */}
            <div className="flex items-center gap-1 shrink-0 relative">
              {dropHere === "INSIDE" && draggingNode ? (
                <span className="px-2 py-0.5 rounded-md bg-[#00c458] text-white text-[10px] font-extrabold">
                  ↳ [{node.name}] 하위로 이동
                </span>
              ) : isSelected ? (
                <span className="w-6 h-6 flex items-center justify-center text-blue-600 text-sm font-extrabold">
                  ✓
                </span>
              ) : (
                <>
                  {/* + 하위 조직 추가 버튼 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuNodeId(null);
                      setAddingUnderParentId(node.id);
                      setNewOrgName("");
                      setCollapsedIds((prev) =>
                        prev.filter((id) => id !== node.id)
                      );
                    }}
                    title="하위 조직 추가"
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-sm font-bold transition-opacity ${
                      isMenuOpen
                        ? "opacity-100 bg-white text-slate-700 shadow-2xs"
                        : "opacity-0 group-hover:opacity-100 hover:bg-white text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    +
                  </button>

                  {/* ⋯ 메뉴 버튼 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMenuOpen) {
                        setMenuNodeId(null);
                        setMoveModeNodeId(null);
                      } else {
                        setMenuNodeId(node.id);
                        setRenameDraft(node.name);
                        setMoveModeNodeId(null);
                      }
                    }}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-extrabold transition-opacity ${
                      isMenuOpen
                        ? "opacity-100 bg-white text-slate-800 shadow-2xs"
                        : "opacity-0 group-hover:opacity-100 hover:bg-white text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    ⋯
                  </button>
                </>
              )}

              {/* 플렉스 스타일 ⋯ 팝오버 (이름 변경 / 옮기기 / 숨기기 / 삭제하기) */}
              {isMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-8 z-40 w-56 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-1.5 text-xs"
                >
                  {/* 1) 조직 이름 인라인 수정 */}
                  <input
                    autoFocus
                    disabled={isRetiredSystemNode(node)}
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commitNodeRename(node, renameDraft);
                        setMenuNodeId(null);
                      }
                    }}
                    onBlur={() => commitNodeRename(node, renameDraft)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#00c458] font-bold text-slate-900 focus:outline-none disabled:bg-slate-50 disabled:border-slate-200 disabled:text-slate-500"
                  />

                  {/* 2) 옮기기 (상위 조직 이동) */}
                  <button
                    type="button"
                    onClick={() =>
                      setMoveModeNodeId(
                        moveModeNodeId === node.id ? null : node.id
                      )
                    }
                    className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-700"
                  >
                    <span>옮기기</span>
                    <span className="text-[10px] text-slate-400">▸</span>
                  </button>

                  {moveModeNodeId === node.id && (
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 space-y-1 max-h-40 overflow-y-auto custom-scroll">
                      <div className="text-[10px] font-bold text-slate-400 px-1">
                        이동할 위치 선택
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMoveParent(node, null)}
                        className={`w-full px-2 py-1 rounded text-left text-[11px] font-bold hover:bg-white ${
                          node.parent_id === null
                            ? "text-[#00a84b]"
                            : "text-slate-700"
                        }`}
                      >
                        최상위 조직으로 이동
                      </button>
                      {validMoveTargets.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => handleMoveParent(node, target.id)}
                          className={`w-full px-2 py-1 rounded text-left text-[11px] font-bold hover:bg-white truncate ${
                            node.parent_id === target.id
                              ? "text-[#00a84b]"
                              : "text-slate-700"
                          }`}
                        >
                          ↳ [{target.name}] 하위 조직으로
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 3) 숨기기 토글 */}
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <span>{node.is_hidden ? "숨김 해제하기" : "숨기기"}</span>
                      <span
                        className="text-slate-300 text-[11px]"
                        title="숨긴 조직은 조직도 화면에서 보이지 않습니다."
                      >
                        ⓘ
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleHidden(node)}
                      className={`w-9 h-5 rounded-full transition-colors relative ${
                        node.is_hidden ? "bg-[#00c458]" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                          node.is_hidden ? "left-4.5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  {/* 4) 삭제하기 */}
                  {!isRetiredSystemNode(node) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteNodes([node])}
                      className="w-full px-2 py-1.5 rounded-lg hover:bg-rose-50 text-left font-bold text-rose-600"
                    >
                      삭제하기
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 하위 조직 인라인 추가 입력창 */}
          {isAddingChildHere && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 22 + 26}px` }}
              className="pr-2 py-1.5 flex items-center gap-2"
            >
              <span className="text-slate-300 text-[10px]">•</span>
              <div className="flex-1 flex items-center justify-between px-3 py-2 rounded-xl border border-[#00c458] bg-white shadow-2xs">
                <input
                  autoFocus
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitInlineAdd();
                    }
                    if (e.key === "Escape") {
                      setAddingUnderParentId(null);
                      setNewOrgName("");
                    }
                  }}
                  placeholder="조직 이름 입력 (마케팅팀, 개발1팀 등)"
                  className="flex-1 text-xs font-bold text-slate-800 placeholder:text-slate-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={commitInlineAdd}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-700 flex items-center gap-1 shrink-0"
                >
                  <span>입력 후</span>
                  <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-mono text-slate-600">
                    Enter
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* 재귀 하위 조직 렌더링 */}
          {!isCollapsed && renderTreeRows(node.id, depth + 1)}

          {dropHere === "AFTER" && renderDropIndicatorLine(depth)}
        </React.Fragment>
      );
    });
  };

  const handleSaveClick = async () => {
    const normalized = nodes.map((n, idx) => ({ ...n, order: idx + 1 }));
    await onSave({
      nodes: normalized,
      effectiveDate,
      memo: memo.trim(),
      renameMap,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4"
      onClick={() => {
        setMenuNodeId(null);
        setMoveModeNodeId(null);
        setTopMenuOpen(false);
        setBulkMoveOpen(false);
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          setMenuNodeId(null);
          setMoveModeNodeId(null);
          setBulkMoveOpen(false);
        }}
        className="bg-white w-full max-w-[520px] h-[680px] max-h-[88vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs"
      >
        {/* 우상단 ⋯ 메뉴 및 ✕ 닫기 */}
        <div className="flex items-center justify-end gap-2 relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTopMenuOpen((p) => !p);
            }}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
          >
            ⋯
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center font-bold"
          >
            ✕
          </button>

          {topMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-8 top-7 w-56 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40"
            >
              <button
                type="button"
                onClick={handleSyncOrphanDepartments}
                className="w-full px-3.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50"
              >
                🔄 구성원 미등록 소속 자동 불러오기
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopMenuOpen(false);
                  if (confirm("기본 조직도 구조로 초기화하시겠습니까?")) {
                    setNodes(DEFAULT_ORG_CHART_NODES.map((n) => ({ ...n })));
                    setSelectedIds([]);
                  }
                }}
                className="w-full px-3.5 py-2 text-left font-semibold text-slate-500 hover:bg-slate-50"
              >
                기본 조직도로 초기화
              </button>
            </div>
          )}
        </div>

        {/* 타이틀 & 적용일 / 메모 */}
        <div className="mt-1 shrink-0">
          <h3 className="text-xl font-extrabold text-slate-900">조직도 설정</h3>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDateOpen((p) => !p)}
                className="px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200/80 text-orange-600 text-[11px] font-extrabold"
              >
                적용일 {effectiveDate === todayIso ? "오늘" : effectiveDate}
              </button>
              <button
                type="button"
                onClick={() => setMemoOpen((p) => !p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  memo
                    ? "bg-blue-50 border border-blue-200 text-blue-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                메모{memo ? " ✓" : ""}
              </button>
            </div>
            <span className="text-[11px] text-slate-400">
              드래그하여 순서·하위조직 이동
            </span>
          </div>

          {dateOpen && (
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value || todayIso)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 font-bold"
              />
              <button
                type="button"
                onClick={() => setEffectiveDate(todayIso)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 font-bold text-slate-600"
              >
                오늘
              </button>
            </div>
          )}

          {memoOpen && (
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="조직 개편 사유·메모를 입력해 주세요."
              className="w-full mt-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none"
            />
          )}
        </div>

        {/* 전체 (N) + 검색 / + 추가 / 모두 접기 툴바 */}
        <div className="mt-5 pb-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <span className="font-extrabold text-slate-800">
            전체 ({nodes.length})
          </span>
          <div className="flex items-center gap-3 text-slate-500">
            <button
              type="button"
              onClick={() => {
                setSearchOpen((p) => !p);
                if (searchOpen) setSearchQuery("");
              }}
              className="hover:text-slate-900"
              title="조직 검색"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={() => {
                const ceoNode = nodes.find((n) => n.name === "대표");
                if (ceoNode) {
                  setAddingUnderParentId(ceoNode.id);
                  setCollapsedIds((prev) =>
                    prev.filter((id) => id !== ceoNode.id)
                  );
                } else {
                  setAddingUnderParentId("ROOT");
                }
                setNewOrgName("");
              }}
              className="font-extrabold text-base leading-none hover:text-slate-900"
              title="새 조직 추가"
            >
              +
            </button>
            <span className="h-3 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() =>
                setCollapsedIds((prev) =>
                  prev.length > 0 ? [] : [...parentNodeIds]
                )
              }
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
            >
              {collapsedIds.length > 0 ? "⤢ 모두 펼치기" : "⤡ 모두 접기"}
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="py-2 border-b border-slate-100 shrink-0">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="조직명 검색..."
              className="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 focus:outline-none"
            />
          </div>
        )}

        {/* 재귀 트리 목록 */}
        <div className="flex-1 overflow-y-auto custom-scroll py-2 space-y-0.5">
          {addingUnderParentId === "ROOT" && (
            <div className="pl-6 pr-2 py-1.5 flex items-center gap-2">
              <span className="text-slate-300 text-[10px]">•</span>
              <div className="flex-1 flex items-center justify-between px-3 py-2 rounded-xl border border-[#00c458] bg-white">
                <input
                  autoFocus
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitInlineAdd();
                    }
                    if (e.key === "Escape") {
                      setAddingUnderParentId(null);
                      setNewOrgName("");
                    }
                  }}
                  placeholder="최상위 조직 이름 입력"
                  className="flex-1 text-xs font-bold text-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={commitInlineAdd}
                  className="text-[11px] font-bold text-[#00a84b]"
                >
                  Enter
                </button>
              </div>
            </div>
          )}

          {renderTreeRows(null, 0)}
        </div>

        {/* 하단 영역: 행 선택 시 [조직 삭제 / 숨기기·숨김 해제하기 / ⋯ / ✕] 액션 바 + 저장하기 */}
        <div className="pt-3 border-t border-slate-100 shrink-0 space-y-2.5">
          {selectedIds.length > 0 ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-between gap-2 relative"
            >
              <span className="text-xs font-bold text-slate-600 shrink-0">
                {selectedIds.length}개 선택됨
              </span>

              <div className="flex items-center gap-2 flex-1 justify-end">
                <button
                  type="button"
                  onClick={() => handleDeleteNodes(selectedNodeObjs)}
                  className="flex-1 max-w-[132px] py-2.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-rose-50/50 text-[#f05638] font-extrabold transition-colors"
                >
                  조직 삭제
                </button>

                <button
                  type="button"
                  onClick={() => handleBulkToggleHidden(!allSelectedHidden)}
                  className="flex-1 max-w-[132px] py-2.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-extrabold transition-colors"
                >
                  {allSelectedHidden ? "숨김 해제하기" : "숨기기"}
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBulkMoveOpen((v) => !v)}
                    title="선택한 조직 일괄 이동"
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-extrabold flex items-center justify-center"
                  >
                    ⋯
                  </button>

                  {bulkMoveOpen && (
                    <div className="absolute right-0 bottom-11 z-40 w-52 rounded-2xl bg-white border border-slate-200 shadow-2xl p-2 space-y-1 max-h-52 overflow-y-auto custom-scroll">
                      <div className="px-2 py-1 text-[10px] font-bold text-slate-400">
                        선택 조직 상위 위치 이동
                      </div>
                      <button
                        type="button"
                        onClick={() => handleBulkMoveParent(null)}
                        className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-left font-bold text-slate-700"
                      >
                        최상위 조직으로 이동
                      </button>
                      {nodes
                        .filter((n) => !selectedIds.includes(n.id))
                        .map((target) => (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() => handleBulkMoveParent(target.id)}
                            className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-left font-bold text-slate-700 truncate"
                          >
                            ↳ [{target.name}] 하위 조직으로
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds([]);
                    setBulkMoveOpen(false);
                  }}
                  title="선택 해제"
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveClick}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:brightness-95 text-white text-xs font-extrabold shadow-md disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
