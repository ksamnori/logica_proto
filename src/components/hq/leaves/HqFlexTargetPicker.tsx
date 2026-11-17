// src/components/hq/leaves/HqFlexTargetPicker.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildFlatOrgTreeOptions, normalizeOrgNodes } from "@/lib/hq/orgTreeHelper";
import type { HqMember, HqOrgChartNode } from "@/lib/hq/types";

interface Props {
  label?: string;
  members: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  placeholder?: string;
  eligibilityHint?: string;
}

const ORG_BADGE_COLORS = [
  "#9ba8cf",
  "#2dd4bf",
  "#eb7d66",
  "#f59e0b",
  "#ec4899",
  "#6366f1",
  "#10b981",
];

function memberAvatarBg(name: string): string {
  if (name === "김근식" || name === "백시연" || name === "심혜영") return "#2dd4bf";
  if (name === "김동현") return "#4ade80";
  if (
    name === "김문수" ||
    name === "원종준" ||
    name === "조원형" ||
    name === "최수연"
  ) {
    return "#eb7d66";
  }
  if (name === "민세리") return "#e57373";
  if (name === "천종현") return "#9ba8cf";
  if (name === "한민서") return "#b57edc";
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = ["#38bdf8", "#fb7185", "#a78bfa", "#34d399", "#fbbf24"];
  return palette[Math.abs(hash) % palette.length];
}

export default function HqFlexTargetPicker({
  label = "부여 대상",
  members,
  orgNodes,
  selectedIds,
  onChange,
  placeholder = "부여 대상 선택",
  eligibilityHint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [treeMode, setTreeMode] = useState(false);
  const [includeSubOrgs, setIncludeSubOrgs] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const allMemberIds = useMemo(
    () => members.map((m) => m.instructor_id),
    [members]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const isAllSelected =
    members.length > 0 && allMemberIds.every((id) => selectedSet.has(id));

  // 조직 트리 평탄화 + 미등록 부서 보완
  const normalizedNodes = useMemo(() => normalizeOrgNodes(orgNodes), [orgNodes]);

  const orgList = useMemo(() => {
    const flat = buildFlatOrgTreeOptions(normalizedNodes, members, {
      includeHiddenSystemNodes: false,
      excludeRetired: true,
    });
    const knownNames = new Set(flat.map((o) => o.name));
    const extraOrgs: typeof flat = [];
    members.forEach((m) => {
      const dept = (m.department || "").trim();
      if (dept && !knownNames.has(dept)) {
        knownNames.add(dept);
        extraOrgs.push({
          id: `extra-${dept}`,
          name: dept,
          parent_id: null,
          depth: 1,
          is_hidden: false,
          hasChildren: false,
          memberCount: members.filter((x) => x.department === dept).length,
          indentedLabel: dept,
        });
      }
    });
    return [...flat, ...extraOrgs];
  }, [normalizedNodes, members]);

  // 특정 조직(및 하위 조직 포함 옵션 시 하위 조직들) 소속 구성원 ID 배열 구하기
  const getMemberIdsForOrg = (orgId: string, orgName: string): string[] => {
    const targetOrgNames = new Set<string>([orgName]);

    if (includeSubOrgs && !orgId.startsWith("extra-")) {
      const childrenMap = new Map<string, HqOrgChartNode[]>();
      normalizedNodes.forEach((n) => {
        if (n.parent_id && !n.is_hidden && n.name !== "퇴직") {
          const arr = childrenMap.get(n.parent_id) || [];
          arr.push(n);
          childrenMap.set(n.parent_id, arr);
        }
      });
      const walk = (pid: string) => {
        const kids = childrenMap.get(pid) || [];
        kids.forEach((k) => {
          targetOrgNames.add(k.name);
          walk(k.id);
        });
      };
      walk(orgId);
    }

    return members
      .filter((m) => {
        if (targetOrgNames.has("대표") && m.rank_code === "CEO") return true;
        if (targetOrgNames.has((m.department || "").trim())) return true;
        const subAssigns = m.profile_extra?.org_assignments || [];
        return subAssigns.some((a) => targetOrgNames.has(a.org_name));
      })
      .map((m) => m.instructor_id);
  };

  const toggleAllMembers = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange([...allMemberIds]);
    }
  };

  const toggleOrg = (orgId: string, orgName: string) => {
    const ids = getMemberIdsForOrg(orgId, orgName);
    if (ids.length === 0) return;
    const allInOrgSelected = ids.every((id) => selectedSet.has(id));
    if (allInOrgSelected) {
      onChange(selectedIds.filter((id) => !ids.includes(id)));
    } else {
      const merged = new Set([...selectedIds, ...ids]);
      onChange(Array.from(merged));
    }
  };

  const toggleMember = (memberId: string) => {
    if (selectedSet.has(memberId)) {
      onChange(selectedIds.filter((id) => id !== memberId));
    } else {
      onChange([...selectedIds, memberId]);
    }
  };

  const qLower = query.trim().toLowerCase();

  const filteredOrgs = useMemo(() => {
    if (!qLower) return orgList;
    return orgList.filter((o) => o.name.toLowerCase().includes(qLower));
  }, [orgList, qLower]);

  const filteredMembers = useMemo(() => {
    if (!qLower) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(qLower) ||
        (m.department || "").toLowerCase().includes(qLower) ||
        (m.employee_no || "").toLowerCase().includes(qLower)
    );
  }, [members, qLower]);

  const selectedMemberObjs = useMemo(() => {
    const map = new Map(members.map((m) => [m.instructor_id, m]));
    return selectedIds
      .map((id) => map.get(id))
      .filter((m): m is HqMember => Boolean(m));
  }, [members, selectedIds]);

  const summaryText = useMemo(() => {
    if (selectedMemberObjs.length === 0) return "";
    if (isAllSelected && members.length > 0) {
      return `전체 구성원 (${members.length}명)`;
    }
    if (selectedMemberObjs.length <= 3) {
      return selectedMemberObjs.map((m) => m.name).join(", ");
    }
    return `${selectedMemberObjs
      .slice(0, 2)
      .map((m) => m.name)
      .join(", ")} 외 ${selectedMemberObjs.length - 2}명`;
  }, [selectedMemberObjs, isAllSelected, members.length]);

  return (
    <div ref={rootRef} className="relative">
      {/* 상단 빠른 전원선택 액션 바 */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
          <span>{label}</span>
          <span className="text-rose-500">*</span>
          {selectedMemberObjs.length > 0 && (
            <span className="ml-1 text-[#00a84b] font-extrabold">
              ({selectedMemberObjs.length}명 선택됨)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={toggleAllMembers}
            className={`font-extrabold px-2 py-0.5 rounded-md border transition-colors ${
              isAllSelected
                ? "bg-emerald-50 border-[#00c458] text-[#00a84b]"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
            }`}
          >
            {isAllSelected ? "✓ 전원 선택됨" : "전원 선택"}
          </button>
          {selectedMemberObjs.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-slate-400 hover:text-rose-500 font-semibold"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 셀렉트 트리거 박스 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full px-3.5 py-2.5 rounded-xl border text-left text-xs flex items-center justify-between transition-colors bg-white ${
          open
            ? "border-[#00c458] ring-2 ring-[#00c458]/15"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <span
          className={
            summaryText
              ? "font-bold text-slate-900 truncate"
              : "font-semibold text-slate-400"
          }
        >
          {summaryText || placeholder}
        </span>
        <span className="text-[10px] text-slate-400 ml-2 shrink-0">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {eligibilityHint && (
        <p className="mt-1 text-[11px] text-slate-400 font-medium">
          {eligibilityHint}
        </p>
      )}

      {/* 플렉스 2단 팝오버 (좌: 전체구성원/조직/구성원목록 · 우: 선택된 대상 + 하위 조직 함께 선택) */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-[min(540px,calc(100vw-3rem))] rounded-2xl bg-white border border-slate-200 shadow-2xl z-50 overflow-hidden grid grid-cols-1 sm:grid-cols-2">
          {/* 왼쪽 패널: 검색 + 조직도 보기 + 전체 구성원 + 조직 + 구성원 목록 */}
          <div className="border-b sm:border-b-0 sm:border-r border-slate-100 flex flex-col h-[330px]">
            <div className="p-2.5 flex items-center gap-1.5 border-b border-slate-100">
              <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#00c458] bg-white">
                <span className="text-[11px] text-slate-400">🔍</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="검색"
                  className="w-full text-xs font-semibold text-slate-800 outline-none bg-transparent"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-[10px] text-slate-400"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTreeMode((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold shrink-0 transition-colors ${
                  treeMode
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                조직도 보기
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-1 text-xs">
              {/* 1) 전체 구성원 (전원 선택) */}
              {!qLower && (
                <button
                  type="button"
                  onClick={toggleAllMembers}
                  className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between transition-colors ${
                    isAllSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-[11px] inline-flex items-center justify-center shrink-0">
                      🏢
                    </span>
                    <span className="font-extrabold text-slate-900">
                      전체 구성원
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {members.length}명
                    </span>
                  </div>
                  {isAllSelected && (
                    <span className="text-[#00a84b] font-extrabold">✓</span>
                  )}
                </button>
              )}

              {/* 2) 조직 섹션 */}
              {filteredOrgs.length > 0 && (
                <div className="pt-1">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400">
                    조직
                  </div>
                  {filteredOrgs.map((org, idx) => {
                    const orgMemberIds = getMemberIdsForOrg(org.id, org.name);
                    const allOrgChecked =
                      orgMemberIds.length > 0 &&
                      orgMemberIds.every((id) => selectedSet.has(id));
                    const someOrgChecked =
                      !allOrgChecked &&
                      orgMemberIds.some((id) => selectedSet.has(id));

                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => toggleOrg(org.id, org.name)}
                        style={{
                          paddingLeft: treeMode
                            ? `${10 + Math.max(0, org.depth - 1) * 14}px`
                            : undefined,
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between transition-colors ${
                          allOrgChecked ? "bg-emerald-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            style={{
                              backgroundColor:
                                ORG_BADGE_COLORS[idx % ORG_BADGE_COLORS.length],
                            }}
                            className="w-6 h-6 rounded-full text-white text-[10px] font-extrabold inline-flex items-center justify-center shrink-0"
                          >
                            品
                          </span>
                          <span className="font-bold text-slate-800 truncate">
                            {org.name}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {orgMemberIds.length}
                          </span>
                        </div>
                        {allOrgChecked ? (
                          <span className="text-[#00a84b] font-extrabold">✓</span>
                        ) : someOrgChecked ? (
                          <span className="text-emerald-500 font-extrabold text-[10px]">
                            •
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 3) 구성원 목록 섹션 */}
              {!treeMode && (
                <div className="pt-1">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400">
                    구성원 목록
                  </div>
                  {filteredMembers.length === 0 ? (
                    <div className="px-2.5 py-6 text-center text-[11px] text-slate-400">
                      해당하는 구성원이 없습니다.
                    </div>
                  ) : (
                    filteredMembers.map((m) => {
                      const checked = selectedSet.has(m.instructor_id);
                      return (
                        <button
                          key={m.instructor_id}
                          type="button"
                          onClick={() => toggleMember(m.instructor_id)}
                          className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between transition-colors ${
                            checked ? "bg-emerald-50/60" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              style={{
                                backgroundColor: memberAvatarBg(m.name),
                              }}
                              className="w-6 h-6 rounded-full text-white text-[10px] font-extrabold inline-flex items-center justify-center shrink-0"
                            >
                              {m.name.slice(-2)}
                            </span>
                            <span className="font-bold text-slate-900 truncate">
                              {m.name}
                            </span>
                            {m.department && (
                              <span className="text-[11px] text-slate-400 truncate">
                                {m.department}
                              </span>
                            )}
                          </div>
                          {checked && (
                            <span className="text-[#00a84b] font-extrabold shrink-0">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽 패널: 선택된 구성원 리스트 + 하위 조직 함께 선택 */}
          <div className="flex flex-col justify-between h-[330px] bg-slate-50/30">
            <div className="flex-1 overflow-y-auto p-3">
              {selectedMemberObjs.length === 0 ? (
                <div className="text-xs font-semibold text-slate-400">
                  선택없음
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <span className="text-[11px] font-extrabold text-slate-600">
                      선택됨 {selectedMemberObjs.length}명
                    </span>
                    <button
                      type="button"
                      onClick={() => onChange([])}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      전체 해제
                    </button>
                  </div>
                  {selectedMemberObjs.map((m) => (
                    <div
                      key={m.instructor_id}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-100 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          style={{ backgroundColor: memberAvatarBg(m.name) }}
                          className="w-5 h-5 rounded-full text-white text-[9px] font-extrabold inline-flex items-center justify-center shrink-0"
                        >
                          {m.name.slice(-2)}
                        </span>
                        <span className="font-bold text-slate-800 truncate">
                          {m.name}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          {m.department}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleMember(m.instructor_id)}
                        className="text-slate-300 hover:text-rose-500 font-bold text-[11px]"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-3 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSubOrgs}
                  onChange={(e) => setIncludeSubOrgs(e.target.checked)}
                  className="rounded border-slate-300 text-[#00c458] focus:ring-[#00c458]"
                />
                <span>하위 조직 함께 선택</span>
              </label>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"
              >
                선택 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
