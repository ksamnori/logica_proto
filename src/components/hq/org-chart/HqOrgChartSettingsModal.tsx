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

function makeNodeId(): string {
  return `org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

  // 하위 조직(또는 최상위 조직) 인라인 추가 상태 (Screenshot 11)
  const [addingUnderParentId, setAddingUnderParentId] = useState<
    string | "ROOT" | null
  >(null);
  const [newOrgName, setNewOrgName] = useState("");

  // 행별 [⋯] 팝오버 상태 (Screenshot 10: 이름 수정 / 옮기기 / 숨기기 / 삭제하기)
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
    setAddingUnderParentId(null);
    setNewOrgName("");
    setMenuNodeId(null);
    setMoveModeNodeId(null);
    setRenameMap({});
  }, [isOpen, initialNodes, initialEffectiveDate, initialMemo, todayIso]);

  const childrenMap = useMemo(() => {
    const validIds = new Set(nodes.map((n) => n.id));
    const map = new Map<string | null, HqOrgChartNode[]>();
    [...nodes]
      .sort((a, b) => a.order - b.order)
      .forEach((n) => {
        const pid =
          n.parent_id && validIds.has(n.parent_id) ? n.parent_id : null;
        map.set(pid, [...(map.get(pid) || []), n]);
      });
    return map;
  }, [nodes]);

  const parentNodeIds = useMemo(
    () =>
      nodes
        .filter((n) => (childrenMap.get(n.id) || []).length > 0)
        .map((n) => n.id),
    [nodes, childrenMap]
  );

  if (!isOpen) return null;

  const isSystemProtected = (node: HqOrgChartNode) =>
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
      // 기존 체인 매핑 유지 (A -> B 후 B -> C 면 A -> C)
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

  const handleMoveOrder = (targetNode: HqOrgChartNode, dir: -1 | 1) => {
    const siblings = (childrenMap.get(targetNode.parent_id) || []).sort(
      (a, b) => a.order - b.order
    );
    const idx = siblings.findIndex((s) => s.id === targetNode.id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;

    const a = siblings[idx];
    const b = siblings[swapIdx];
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === a.id) return { ...n, order: b.order };
        if (n.id === b.id) return { ...n, order: a.order };
        return n;
      })
    );
  };

  const handleToggleHidden = (node: HqOrgChartNode) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, is_hidden: !n.is_hidden } : n
      )
    );
  };

  const handleDeleteNode = (node: HqOrgChartNode) => {
    if (isSystemProtected(node)) {
      alert("기본 퇴직 분류 노드는 삭제할 수 없습니다.");
      return;
    }
    const toRemoveIds = collectDescendantIds(node.id);
    const removedNodes = nodes.filter((n) => toRemoveIds.has(n.id));
    const affectedCount = removedNodes.reduce(
      (sum, rn) => sum + countMembersInOrg(rn.name, members),
      0
    );

    const parentNode = nodes.find((n) => n.id === node.parent_id);
    const fallbackDept =
      parentNode && !parentNode.is_hidden
        ? parentNode.name
        : nodes.find((n) => !toRemoveIds.has(n.id) && !n.is_hidden)?.name ||
          "대표";

    const msg =
      affectedCount > 0
        ? `[${node.name}]${
            removedNodes.length > 1
              ? ` 및 하위 조직 ${removedNodes.length - 1}개`
              : ""
          }에 현재 ${affectedCount}명의 구성원이 소속되어 있습니다.\n삭제 시 소속 구성원은 상위 조직(${fallbackDept})으로 안전하게 이동됩니다. 삭제하시겠습니까?`
        : `[${node.name}]${
            removedNodes.length > 1
              ? ` 및 하위 조직 ${removedNodes.length - 1}개`
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
    setMenuNodeId(null);
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

  const renderTreeRows = (parentId: string | null, depth: number): React.ReactNode => {
    const list = childrenMap.get(parentId) || [];
    if (list.length === 0) return null;

    const kw = searchQuery.trim().toLowerCase();

    return list.map((node, idx) => {
      const subChildren = childrenMap.get(node.id) || [];
      const hasSub = subChildren.length > 0;
      const isCollapsed = collapsedIds.includes(node.id);
      const memCnt = countMembersInOrg(node.name, members);
      const isMenuOpen = menuNodeId === node.id;
      const isAddingChildHere = addingUnderParentId === node.id;

      // 검색어 필터 시 본인 또는 하위 자손에 매칭되는 경우만 표시
      if (kw) {
        const descIds = collectDescendantIds(node.id);
        const anyMatch = nodes.some(
          (n) => descIds.has(n.id) && n.name.toLowerCase().includes(kw)
        );
        if (!anyMatch) return null;
      }

      const descendants = collectDescendantIds(node.id);
      const validMoveTargets = nodes.filter(
        (n) => !descendants.has(n.id) && n.name !== "퇴직"
      );

      return (
        <React.Fragment key={node.id}>
          <div
            style={{ paddingLeft: `${depth * 22 + 8}px` }}
            className={`pr-2 py-2.5 rounded-xl flex items-center justify-between gap-2 group transition-colors relative ${
              isMenuOpen || isAddingChildHere
                ? "bg-slate-100/90"
                : "hover:bg-slate-50"
            }`}
          >
            {/* 좌측: 드래그 핸들 아이콘 + 접기 화살표/불릿 + 조직명 + 인원수 + 숨김표시 */}
            <div className="flex items-center gap-2 min-w-0">
              {!isSystemProtected(node) && (
                <span
                  className="opacity-0 group-hover:opacity-100 text-slate-300 text-[11px] select-none cursor-grab"
                  title="순서 및 계층 이동 가능"
                >
                  ⋮⋮
                </span>
              )}

              {hasSub ? (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedIds((prev) =>
                      isCollapsed
                        ? prev.filter((id) => id !== node.id)
                        : [...prev, node.id]
                    )
                  }
                  className="w-4 h-4 flex items-center justify-center text-slate-500 text-[10px] font-extrabold"
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className="w-4 text-center text-slate-300 text-[10px]">
                  •
                </span>
              )}

              <span
                className={`text-[13px] font-bold truncate ${
                  node.is_hidden ? "text-slate-500" : "text-slate-800"
                }`}
              >
                {node.name}
              </span>

              {node.is_hidden && (
                <span
                  className="text-amber-500 text-xs"
                  title="조직도 화면에서 숨김 처리된 조직"
                >
                  👁‍🗨
                </span>
              )}

              {memCnt > 0 && !node.is_hidden && (
                <span className="text-xs font-bold text-slate-300">
                  {memCnt}
                </span>
              )}
            </div>

            {/* 우측: 호버 액션 버튼 (위/아래 순서, + 하위 조직 추가, ⋯ 더보기 메뉴) */}
            {!isSystemProtected(node) && (
              <div className="flex items-center gap-1 shrink-0 relative">
                {list.length > 1 && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center mr-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveOrder(node, -1)}
                      className="w-5 h-5 rounded hover:bg-slate-200/70 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-20"
                      title="위로 이동"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={idx === list.length - 1}
                      onClick={() => handleMoveOrder(node, 1)}
                      className="w-5 h-5 rounded hover:bg-slate-200/70 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-20"
                      title="아래로 이동"
                    >
                      ↓
                    </button>
                  </div>
                )}

                {/* + 하위 조직 추가 버튼 (Screenshot 9 & 11) */}
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

                {/* ⋯ 메뉴 버튼 (Screenshot 10) */}
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

                {/* 플렉스 스타일 ⋯ 팝오버 (이름 변경 / 옮기기 / 숨기기 / 삭제하기) */}
                {isMenuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-8 z-40 w-56 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-1.5 text-xs"
                  >
                    {/* 1) 조직 이름 인라인 수정 */}
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitNodeRename(node, renameDraft);
                          setMenuNodeId(null);
                        }
                      }}
                      onBlur={() => commitNodeRename(node, renameDraft)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#00c458] font-bold text-slate-900 focus:outline-none"
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
                          이동할 상위 조직 선택
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
                        <span>숨기기</span>
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
                    <button
                      type="button"
                      onClick={() => handleDeleteNode(node)}
                      className="w-full px-2 py-1.5 rounded-lg hover:bg-rose-50 text-left font-bold text-rose-600"
                    >
                      삭제하기
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 하위 조직 인라인 추가 입력창 (Screenshot 11) */}
          {isAddingChildHere && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 22 + 16}px` }}
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
        </React.Fragment>
      );
    });
  };

  const handleSaveClick = async () => {
    // 번호 정규화
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
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          setMenuNodeId(null);
          setMoveModeNodeId(null);
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
          <div className="mt-3 flex items-center gap-2">
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
          <div className="flex items-center gap-2.5 text-slate-500">
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
            <div className="px-2 py-1.5 flex items-center gap-2">
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

        {/* 하단 저장하기 버튼 (Screenshots 9, 10, 11) */}
        <div className="pt-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveClick}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:brightness-95 text-white text-xs font-extrabold shadow-md disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
