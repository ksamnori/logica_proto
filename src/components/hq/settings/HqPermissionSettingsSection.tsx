// src/components/hq/settings/HqPermissionSettingsSection.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_PERMISSION_SETTINGS,
  PERMISSION_CATEGORIES,
  PERMISSION_SCOPE_OPTIONS,
} from "@/lib/hq/defaultPermissionSettings";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqPermissionGroupItem,
  HqPermissionScope,
  HqPermissionSettings,
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

const AVATAR_COLOR_BY_HASH = [
  "#818cf8",
  "#2dd4bf",
  "#fbbf24",
  "#fb923c",
  "#4ade80",
  "#f87171",
  "#38bdf8",
  "#a78bfa",
];

function colorForName(name: string): string {
  if (name === "천종현") return "#8da2fb";
  if (name === "김근식") return "#2dd4bf";
  if (name === "이웅행") return "#fbbf24";
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLOR_BY_HASH[sum % AVATAR_COLOR_BY_HASH.length];
}

interface DirectoryPerson {
  name: string;
  jobOrDept: string;
  isDeptHead: boolean;
}

const FALLBACK_MEMBER_ROSTER: DirectoryPerson[] = [
  { name: "김근식", jobOrDept: "관리팀", isDeptHead: true },
  { name: "김동현", jobOrDept: "집필팀", isDeptHead: false },
  { name: "김문수", jobOrDept: "편집", isDeptHead: false },
  { name: "민세리", jobOrDept: "집필팀", isDeptHead: false },
  { name: "박주원", jobOrDept: "집필팀", isDeptHead: false },
  { name: "백시연", jobOrDept: "교재 집필", isDeptHead: false },
  { name: "심혜영", jobOrDept: "디자인", isDeptHead: false },
  { name: "원종준", jobOrDept: "교재 집필", isDeptHead: false },
  { name: "이웅행", jobOrDept: "경영", isDeptHead: false },
  { name: "조원형", jobOrDept: "마케팅", isDeptHead: true },
  { name: "천종현", jobOrDept: "대표", isDeptHead: true },
  { name: "최수연", jobOrDept: "디자인", isDeptHead: false },
  { name: "한민서", jobOrDept: "마케팅", isDeptHead: false },
];

interface Props {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onCloseSettings?: () => void;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

type MatrixEditorMode =
  | { kind: "CUSTOM"; isNew: boolean; group: HqPermissionGroupItem }
  | {
      kind: "ORG_HEAD";
      permissions: Record<string, boolean>;
      scopes: Record<string, HqPermissionScope>;
    }
  | {
      kind: "DEFAULT_MEMBER";
      permissions: Record<string, boolean>;
    };

export default function HqPermissionSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onCloseSettings,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const router = useRouter();
  const permSettings: HqPermissionSettings = useMemo(() => {
    const raw = settings.extra_settings?.permission_settings;
    if (!raw) return DEFAULT_PERMISSION_SETTINGS;
    return {
      ...DEFAULT_PERMISSION_SETTINGS,
      ...raw,
      super_admin_names:
        Array.isArray(raw.super_admin_names) && raw.super_admin_names.length > 0
          ? raw.super_admin_names
          : DEFAULT_PERMISSION_SETTINGS.super_admin_names,
      groups: Array.isArray(raw.groups)
        ? raw.groups
        : DEFAULT_PERMISSION_SETTINGS.groups,
    };
  }, [settings.extra_settings?.permission_settings]);

  // 상단 탭: 권한 그룹 | 구성원 권한 (190110 vs 190734)
  const [subTab, setSubTab] = useState<"GROUPS" | "MEMBERS">("GROUPS");

  // 구성원 권한 탭 검색
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [memberTabKeyword, setMemberTabKeyword] = useState("");

  // 카드 우측 ⋯ 메뉴
  const [openMenuGroupId, setOpenMenuGroupId] = useState<string | null>(null);

  // 1) 최고 관리자 구성원 관리 모달
  const [superAdminModalOpen, setSuperAdminModalOpen] = useState(false);
  const [superAdminDraft, setSuperAdminDraft] = useState<string[]>([]);
  const [superAdminQuery, setSuperAdminQuery] = useState("");

  // 2) 권한 매트릭스 생성/수정 모달 (190151 ~ 190704)
  const [matrixState, setMatrixState] = useState<MatrixEditorMode | null>(null);
  const [activeCatId, setActiveCatId] = useState<string>(
    PERMISSION_CATEGORIES[0].id
  );
  const [permKeyword, setPermKeyword] = useState("");
  const [showRightMemberPane, setShowRightMemberPane] = useState(true);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberPickerQuery, setMemberPickerQuery] = useState("");
  const [openScopePermKey, setOpenScopePermKey] = useState<string | null>(null);

  const catTabsScrollRef = useRef<HTMLDivElement>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 3) 구성원별 권한 그룹 배정 모달 (구성원 권한 탭 행 클릭)
  const [editingMemberRow, setEditingMemberRow] =
    useState<DirectoryPerson | null>(null);
  const [memberAssignedGroupIds, setMemberAssignedGroupIds] = useState<
    string[]
  >([]);
  const [memberIsSuperDraft, setMemberIsSuperDraft] = useState(false);

  // 재직 구성원 + 기본 로스터 병합 (가나다순 정렬 — 190734 동일)
  const directoryPeople: DirectoryPerson[] = useMemo(() => {
    const map = new Map<string, DirectoryPerson>();
    members
      .filter((m) => m.work_status !== "퇴직")
      .forEach((m) => {
        const label =
          m.department && m.department !== "미지정"
            ? m.department
            : m.job_title || "";
        map.set(m.name, {
          name: m.name,
          jobOrDept: label,
          isDeptHead: Boolean(m.is_dept_head),
        });
      });

    if (map.size < 4) {
      FALLBACK_MEMBER_ROSTER.forEach((fb) => {
        if (!map.has(fb.name)) map.set(fb.name, fb);
      });
    } else {
      // 그룹에 이미 지정된 구성원 이름이 누락되지 않도록 보강
      const referenced = new Set<string>(permSettings.super_admin_names);
      permSettings.groups.forEach((g) =>
        g.member_names.forEach((n) => referenced.add(n))
      );
      referenced.forEach((nm) => {
        if (!map.has(nm)) {
          const fb = FALLBACK_MEMBER_ROSTER.find((x) => x.name === nm);
          map.set(nm, fb || { name: nm, jobOrDept: "", isDeptHead: false });
        }
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ko")
    );
  }, [members, permSettings]);

  const patchPermSettings = async (
    partial: Partial<HqPermissionSettings>,
    toast: string
  ) => {
    await onSaveExtra(
      {
        permission_settings: {
          ...permSettings,
          ...partial,
        },
      },
      toast
    );
  };

  // 새 권한 그룹 추가 모달 열기 (190151 동일)
  const openCreateGroupModal = () => {
    setPermKeyword("");
    setActiveCatId(PERMISSION_CATEGORIES[0].id);
    setShowRightMemberPane(true);
    setMemberPickerOpen(false);
    setOpenScopePermKey(null);
    setMatrixState({
      kind: "CUSTOM",
      isNew: true,
      group: {
        id: `pg-${uid()}`,
        name: "",
        description: "",
        member_names: [],
        permissions: {},
        scopes: {},
      },
    });
  };

  const openEditGroupModal = (group: HqPermissionGroupItem) => {
    setOpenMenuGroupId(null);
    setPermKeyword("");
    setActiveCatId(PERMISSION_CATEGORIES[0].id);
    setShowRightMemberPane(true);
    setMemberPickerOpen(false);
    setOpenScopePermKey(null);
    setMatrixState({
      kind: "CUSTOM",
      isNew: false,
      group: JSON.parse(JSON.stringify(group)),
    });
  };

  const handleDuplicateGroup = async (group: HqPermissionGroupItem) => {
    setOpenMenuGroupId(null);
    const copy: HqPermissionGroupItem = {
      ...JSON.parse(JSON.stringify(group)),
      id: `pg-${uid()}`,
      name: `${group.name} (복사본)`,
    };
    await patchPermSettings(
      { groups: [...permSettings.groups, copy] },
      `'${copy.name}' 권한 그룹이 복제되었습니다.`
    );
  };

  const handleDeleteGroup = async (group: HqPermissionGroupItem) => {
    setOpenMenuGroupId(null);
    if (!confirm(`'${group.name}' 권한 그룹을 삭제하시겠습니까?`)) return;
    await patchPermSettings(
      {
        groups: permSettings.groups.filter((g) => g.id !== group.id),
      },
      `'${group.name}' 권한 그룹이 삭제되었습니다.`
    );
  };

  const handleSaveMatrixModal = async () => {
    if (!matrixState) return;
    if (matrixState.kind === "CUSTOM") {
      const cleanName = matrixState.group.name.trim();
      if (!cleanName) {
        alert("그룹 이름을 입력해주세요.");
        return;
      }
      const saved: HqPermissionGroupItem = {
        ...matrixState.group,
        name: cleanName,
        description: matrixState.group.description.trim(),
      };
      const nextGroups = matrixState.isNew
        ? [...permSettings.groups, saved]
        : permSettings.groups.map((g) => (g.id === saved.id ? saved : g));

      await patchPermSettings(
        { groups: nextGroups },
        matrixState.isNew
          ? `'${saved.name}' 권한 그룹이 추가되었습니다.`
          : `'${saved.name}' 권한 그룹이 저장되었습니다.`
      );
    } else if (matrixState.kind === "ORG_HEAD") {
      await patchPermSettings(
        {
          org_head_permissions: matrixState.permissions,
          org_head_scopes: matrixState.scopes,
        },
        "조직장 전용 권한 설정이 저장되었습니다."
      );
    } else {
      await patchPermSettings(
        {
          default_member_permissions: matrixState.permissions,
        },
        "전 구성원 기본 권한 설정이 저장되었습니다."
      );
    }
    setMatrixState(null);
  };

  // 구성원 권한 탭에서 특정 구성원 클릭 -> 배정 그룹 편집 모달
  const openMemberAssignModal = (person: DirectoryPerson) => {
    setEditingMemberRow(person);
    setMemberIsSuperDraft(permSettings.super_admin_names.includes(person.name));
    setMemberAssignedGroupIds(
      permSettings.groups
        .filter((g) => g.member_names.includes(person.name))
        .map((g) => g.id)
    );
  };

  const handleSaveMemberAssign = async () => {
    if (!editingMemberRow) return;
    const nm = editingMemberRow.name;
    let nextSupers = permSettings.super_admin_names.filter((x) => x !== nm);
    if (memberIsSuperDraft) {
      nextSupers = [...nextSupers, nm];
    }
    if (nextSupers.length === 0) {
      alert("최소 1명 이상의 최고 관리자가 유지되어야 합니다.");
      return;
    }

    const nextGroups = permSettings.groups.map((g) => {
      const without = g.member_names.filter((x) => x !== nm);
      return {
        ...g,
        member_names: memberAssignedGroupIds.includes(g.id)
          ? [...without, nm]
          : without,
      };
    });

    await patchPermSettings(
      {
        super_admin_names: nextSupers,
        groups: nextGroups,
      },
      `${nm} 님의 권한 그룹 배정이 저장되었습니다.`
    );
    setEditingMemberRow(null);
  };

  const scrollToCategory = (catId: string) => {
    setActiveCatId(catId);
    const el = sectionRefs.current[catId];
    if (el && matrixScrollRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // 현재 매트릭스 모달의 permissions / scopes 접근 헬퍼
  const activePerms: Record<string, boolean> =
    matrixState?.kind === "CUSTOM"
      ? matrixState.group.permissions
      : matrixState?.kind === "ORG_HEAD"
        ? matrixState.permissions
        : matrixState?.kind === "DEFAULT_MEMBER"
          ? matrixState.permissions
          : {};

  const activeScopes: Record<string, HqPermissionScope> =
    matrixState?.kind === "CUSTOM"
      ? matrixState.group.scopes
      : matrixState?.kind === "ORG_HEAD"
        ? matrixState.scopes
        : {};

  const toggleMatrixPermission = (key: string) => {
    if (!matrixState || !canEdit) return;
    const nextVal = !activePerms[key];
    if (matrixState.kind === "CUSTOM") {
      setMatrixState({
        ...matrixState,
        group: {
          ...matrixState.group,
          permissions: { ...matrixState.group.permissions, [key]: nextVal },
        },
      });
    } else if (matrixState.kind === "ORG_HEAD") {
      setMatrixState({
        ...matrixState,
        permissions: { ...matrixState.permissions, [key]: nextVal },
      });
    } else {
      setMatrixState({
        ...matrixState,
        permissions: { ...matrixState.permissions, [key]: nextVal },
      });
    }
  };

  const setMatrixScope = (key: string, scope: HqPermissionScope) => {
    if (!matrixState || !canEdit) return;
    if (matrixState.kind === "CUSTOM") {
      setMatrixState({
        ...matrixState,
        group: {
          ...matrixState.group,
          scopes: { ...matrixState.group.scopes, [key]: scope },
        },
      });
    } else if (matrixState.kind === "ORG_HEAD") {
      setMatrixState({
        ...matrixState,
        scopes: { ...matrixState.scopes, [key]: scope },
      });
    }
    setOpenScopePermKey(null);
  };

  const renderAvatarCluster = (names: string[]) => {
    if (names.length === 0) {
      return (
        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 text-[11px] font-semibold">
          구성원 없음
        </span>
      );
    }
    return (
      <span className="flex items-center -space-x-1">
        {names.slice(0, 4).map((nm) => (
          <span
            key={nm}
            title={nm}
            style={{ backgroundColor: colorForName(nm) }}
            className="w-6 h-6 rounded-lg border-2 border-white text-white text-[9px] font-extrabold flex items-center justify-center shadow-2xs"
          >
            {shortAvatarText(nm)}
          </span>
        ))}
        {names.length > 4 && (
          <span className="w-6 h-6 rounded-lg border-2 border-white bg-slate-200 text-slate-600 text-[9px] font-extrabold flex items-center justify-center">
            +{names.length - 4}
          </span>
        )}
      </span>
    );
  };

  return (
    <>
      <div
        onClick={() => {
          if (openMenuGroupId) setOpenMenuGroupId(null);
        }}
        className="space-y-8"
      >
        {/* 상단 타이틀 + 연구DB 전용 권한 바로가기 */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            권한 설정
          </h2>
          <button
            type="button"
            onClick={() => {
              onCloseSettings?.();
              router.push("/hq/permissions");
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-600 flex items-center gap-1"
          >
            <span>연구DB · 직급 권한 패널</span>
            <span className="text-slate-400">↗</span>
          </button>
        </div>

        {/* 상단 세그먼트 탭 (권한 그룹 | 구성원 권한 — 190110, 190734 동일) */}
        <div className="grid grid-cols-2 p-1 rounded-xl bg-[#f4f5f7] border border-slate-200/60">
          <button
            type="button"
            onClick={() => setSubTab("GROUPS")}
            className={`py-2 rounded-lg text-xs transition-all ${
              subTab === "GROUPS"
                ? "bg-white text-slate-900 font-extrabold shadow-2xs"
                : "text-slate-500 font-semibold hover:text-slate-700"
            }`}
          >
            권한 그룹
          </button>
          <button
            type="button"
            onClick={() => setSubTab("MEMBERS")}
            className={`py-2 rounded-lg text-xs transition-all ${
              subTab === "MEMBERS"
                ? "bg-white text-slate-900 font-extrabold shadow-2xs"
                : "text-slate-500 font-semibold hover:text-slate-700"
            }`}
          >
            구성원 권한
          </button>
        </div>

        {/* =============================================================== */}
        {/* TAB 1: 권한 그룹 (190110, 190122 동일)                          */}
        {/* =============================================================== */}
        {subTab === "GROUPS" && (
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-900">
                  권한 그룹
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  그룹별 권한을 설정하고 구성원을 추가해 보세요.
                </p>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={openCreateGroupModal}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5 shrink-0"
                >
                  <span className="text-[#00c458] font-extrabold text-sm leading-none">
                    +
                  </span>
                  <span>권한 그룹 추가</span>
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              {/* 시스템 그룹 1: 최고 관리자 */}
              <div
                onClick={() => {
                  setSuperAdminDraft([...permSettings.super_admin_names]);
                  setSuperAdminQuery("");
                  setSuperAdminModalOpen(true);
                }}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center text-base shrink-0">
                    👑
                  </span>
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">
                      최고 관리자
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      모든 권한을 보유한 구성원을 지정할 수 있어요.
                    </p>
                  </div>
                </div>
                {renderAvatarCluster(permSettings.super_admin_names)}
              </div>

              {/* 시스템 그룹 2: 조직장 */}
              <div
                onClick={() => {
                  setPermKeyword("");
                  setActiveCatId(PERMISSION_CATEGORIES[0].id);
                  setOpenScopePermKey(null);
                  setMatrixState({
                    kind: "ORG_HEAD",
                    permissions: { ...permSettings.org_head_permissions },
                    scopes: { ...permSettings.org_head_scopes },
                  });
                }}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-base shrink-0">
                    📢
                  </span>
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">
                      조직장
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      조직장에게만 적용되는 권한을 설정할 수 있어요.
                    </p>
                  </div>
                </div>
              </div>

              {/* 시스템 그룹 3: 기본 권한 */}
              <div
                onClick={() => {
                  setPermKeyword("");
                  setActiveCatId(PERMISSION_CATEGORIES[0].id);
                  setOpenScopePermKey(null);
                  setMatrixState({
                    kind: "DEFAULT_MEMBER",
                    permissions: { ...permSettings.default_member_permissions },
                  });
                }}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center text-base shrink-0">
                    👥
                  </span>
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">
                      기본 권한
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      모든 구성원이 공통으로 가지는 권한이에요.
                    </p>
                  </div>
                </div>
              </div>

              {/* 커스텀 권한 그룹 목록 (1.0 근무 관리 ~ 1.0 인사 관리 등) */}
              {permSettings.groups.map((grp) => (
                <div
                  key={grp.id}
                  onClick={() => openEditGroupModal(grp)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors relative"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center text-sm shrink-0">
                      🪪
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-slate-900 truncate">
                        {grp.name}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {grp.description ||
                          `권한 ${
                            Object.values(grp.permissions).filter(Boolean).length
                          }개 설정됨`}
                      </p>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div onClick={() => openEditGroupModal(grp)}>
                      {renderAvatarCluster(grp.member_names)}
                    </div>

                    {canEdit && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuGroupId(
                              openMenuGroupId === grp.id ? null : grp.id
                            )
                          }
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center font-extrabold"
                        >
                          ⋯
                        </button>

                        {openMenuGroupId === grp.id && (
                          <div className="absolute right-0 top-full mt-1 w-[140px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30 text-xs">
                            <button
                              type="button"
                              onClick={() => openEditGroupModal(grp)}
                              className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                            >
                              권한 수정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateGroup(grp)}
                              className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                            >
                              그룹 복제
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGroup(grp)}
                              className="w-full px-3.5 py-2 text-left hover:bg-rose-50 font-semibold text-rose-600"
                            >
                              삭제하기
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* =============================================================== */}
        {/* TAB 2: 구성원 권한 (190734 동일 + 클릭 시 개인별 배정 편집)     */}
        {/* =============================================================== */}
        {subTab === "MEMBERS" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-extrabold text-slate-900">
                구성원 권한
              </h3>

              <div className="flex items-center gap-2">
                {memberSearchOpen && (
                  <input
                    autoFocus
                    value={memberTabKeyword}
                    onChange={(e) => setMemberTabKeyword(e.target.value)}
                    placeholder="이름 · 직무 · 그룹 검색"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-[#00c458]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMemberSearchOpen((p) => !p);
                    if (memberSearchOpen) setMemberTabKeyword("");
                  }}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
                  title="구성원 검색"
                >
                  🔍
                </button>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#f8f9fa] grid grid-cols-12 text-[11px] font-bold text-slate-500">
                <div className="col-span-5">구성원</div>
                <div className="col-span-7">권한 그룹</div>
              </div>

              <div className="divide-y divide-slate-100">
                {directoryPeople
                  .filter((p) => {
                    const kw = memberTabKeyword.trim();
                    if (!kw) return true;
                    const myGroupNames = permSettings.groups
                      .filter((g) => g.member_names.includes(p.name))
                      .map((g) => g.name)
                      .join(" ");
                    return (
                      p.name.includes(kw) ||
                      p.jobOrDept.includes(kw) ||
                      myGroupNames.includes(kw)
                    );
                  })
                  .map((person) => {
                    const isSuper = permSettings.super_admin_names.includes(
                      person.name
                    );
                    const myGroups = permSettings.groups.filter((g) =>
                      g.member_names.includes(person.name)
                    );

                    return (
                      <div
                        key={person.name}
                        onClick={() => openMemberAssignModal(person)}
                        className="px-4 py-3.5 hover:bg-slate-50/80 grid grid-cols-12 items-center gap-2 cursor-pointer transition-colors"
                      >
                        <div className="col-span-5 flex items-center gap-3 min-w-0">
                          <span
                            style={{
                              backgroundColor: colorForName(person.name),
                            }}
                            className="w-7 h-7 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                          >
                            {shortAvatarText(person.name)}
                          </span>
                          <span className="text-[13px] font-bold text-slate-900 shrink-0">
                            {person.name}
                          </span>
                          {person.jobOrDept && (
                            <span className="text-xs text-slate-400 truncate">
                              {person.jobOrDept}
                            </span>
                          )}
                        </div>

                        <div className="col-span-7 flex flex-wrap items-center gap-1.5">
                          {isSuper && (
                            <span
                              title="최고 관리자"
                              className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-500 text-[11px] font-extrabold"
                            >
                              👑
                            </span>
                          )}
                          {person.isDeptHead && (
                            <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[11px] font-semibold">
                              📢 조직장
                            </span>
                          )}
                          <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200/80 text-slate-600 text-[11px] font-semibold">
                            👥 기본 권한
                          </span>
                          {myGroups.map((g) => (
                            <span
                              key={g.id}
                              className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold"
                            >
                              🪪 {g.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {/* 하단 이전/다음 이동 카드 (← 로그인 설정 / 회사 정보 →) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("login-setting")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                로그인 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("company")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                회사 정보
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">처음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 최고 관리자 구성원 지정 모달                              */}
      {/* ================================================================= */}
      {superAdminModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">👑</span>
                <h3 className="text-base font-extrabold text-slate-900">
                  최고 관리자 설정
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSuperAdminModalOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl bg-amber-50/70 border border-amber-200/70 px-4 py-3 text-[11px] text-amber-800 leading-relaxed">
                최고 관리자는 회사의 모든 인사 · 급여 · 승인 · 보안 · 권한 설정을 조회하고 변경할 수 있습니다.
              </div>

              <input
                value={superAdminQuery}
                onChange={(e) => setSuperAdminQuery(e.target.value)}
                placeholder="🔍 구성원 이름 검색"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] focus:outline-none font-medium"
              />

              <div className="max-h-[260px] overflow-y-auto custom-scroll space-y-1">
                {directoryPeople
                  .filter(
                    (p) =>
                      !superAdminQuery.trim() ||
                      p.name.includes(superAdminQuery.trim()) ||
                      p.jobOrDept.includes(superAdminQuery.trim())
                  )
                  .map((p) => {
                    const checked = superAdminDraft.includes(p.name);
                    return (
                      <label
                        key={p.name}
                        className={`px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer ${
                          checked ? "bg-amber-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span
                            style={{ backgroundColor: colorForName(p.name) }}
                            className="w-6 h-6 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center"
                          >
                            {shortAvatarText(p.name)}
                          </span>
                          <span className="font-bold text-slate-800">
                            {p.name}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {p.jobOrDept}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={checked}
                          onChange={() => {
                            if (checked && superAdminDraft.length <= 1) {
                              alert(
                                "최소 1명 이상의 최고 관리자가 지정되어야 합니다."
                              );
                              return;
                            }
                            setSuperAdminDraft(
                              checked
                                ? superAdminDraft.filter((x) => x !== p.name)
                                : [...superAdminDraft, p.name]
                            );
                          }}
                          className="rounded border-slate-300"
                        />
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuperAdminModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await patchPermSettings(
                      { super_admin_names: superAdminDraft },
                      `최고 관리자(${superAdminDraft.length}명) 설정이 저장되었습니다.`
                    );
                    setSuperAdminModalOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                >
                  저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: 권한 그룹 매트릭스 편집 모달 (스크린샷 190151 ~ 190704)   */}
      {/* ================================================================= */}
      {matrixState && (
        <div
          onClick={() => {
            if (openScopePermKey) setOpenScopePermKey(null);
            if (memberPickerOpen) setMemberPickerOpen(false);
          }}
          className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-3 sm:p-5"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (openScopePermKey) setOpenScopePermKey(null);
            }}
            className="bg-white w-full max-w-[880px] h-[90vh] max-h-[860px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs"
          >
            {/* 상단 헤더 바 */}
            <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-full border border-slate-200 text-[11px] font-bold text-slate-600">
                  권한 그룹
                </span>
                <span className="text-xs font-extrabold text-slate-800">
                  {matrixState.kind === "CUSTOM"
                    ? matrixState.group.name || ""
                    : matrixState.kind === "ORG_HEAD"
                      ? "조직장 전용 권한"
                      : "모든 구성원 기본 권한"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {matrixState.kind === "CUSTOM" && (
                  <button
                    type="button"
                    onClick={() => setShowRightMemberPane((p) => !p)}
                    className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs ${
                      showRightMemberPane
                        ? "border-slate-300 bg-slate-100 text-slate-700"
                        : "border-slate-200 text-slate-400 hover:bg-slate-50"
                    }`}
                    title="우측 구성원 패널 열기/닫기"
                  >
                    ◨
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMatrixState(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 본문 2단 레이아웃 */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* 좌측 권한 매트릭스 영역 */}
              <div className="flex-1 flex flex-col min-w-0">
                <div
                  ref={matrixScrollRef}
                  className="flex-1 overflow-y-auto custom-scroll px-7 pt-6 pb-8 space-y-6"
                >
                  {/* 그룹 이름 · 설명 입력란 */}
                  {matrixState.kind === "CUSTOM" ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg text-slate-400">🪪</span>
                        <input
                          value={matrixState.group.name}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setMatrixState({
                              ...matrixState,
                              group: {
                                ...matrixState.group,
                                name: e.target.value,
                              },
                            })
                          }
                          placeholder="그룹 이름을 입력해주세요."
                          className="w-full px-3 py-1.5 rounded-lg border border-transparent focus:border-[#00c458] text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                        />
                      </div>
                      <input
                        value={matrixState.group.description}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setMatrixState({
                            ...matrixState,
                            group: {
                              ...matrixState.group,
                              description: e.target.value,
                            },
                          })
                        }
                        placeholder="그룹 설명을 입력해주세요."
                        className="w-full px-1 text-xs text-slate-500 placeholder:text-slate-300 underline decoration-slate-200 underline-offset-4 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-xl font-extrabold text-slate-900">
                        {matrixState.kind === "ORG_HEAD"
                          ? "📢 조직장 전용 권한"
                          : "👥 기본 권한"}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {matrixState.kind === "ORG_HEAD"
                          ? "조직도에서 부서·조직의 장(팀장·실장 등)으로 지정된 구성원에게 자동 부여되는 권한입니다."
                          : "입사한 모든 본부 구성원에게 기본으로 공통 적용되는 권한입니다."}
                      </p>
                    </div>
                  )}

                  {/* 검색창 + 가로 스크롤 카테고리 탭 바 (sticky) */}
                  <div className="sticky -top-6 bg-white pt-2 pb-1 z-20 space-y-3 border-b border-slate-100">
                    <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 flex items-center gap-2 bg-white">
                      <span className="text-slate-400">🔍</span>
                      <input
                        value={permKeyword}
                        onChange={(e) => setPermKeyword(e.target.value)}
                        placeholder="검색"
                        className="w-full text-xs focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          catTabsScrollRef.current?.scrollBy({
                            left: -200,
                            behavior: "smooth",
                          })
                        }
                        className="w-6 h-6 rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0"
                      >
                        ‹
                      </button>

                      <div
                        ref={catTabsScrollRef}
                        className="flex-1 flex items-center gap-4 overflow-x-auto no-scrollbar"
                      >
                        {PERMISSION_CATEGORIES.map((cat) => {
                          const isActive = activeCatId === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => scrollToCategory(cat.id)}
                              className={`pb-2.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                                isActive
                                  ? "border-slate-900 text-slate-900 font-extrabold"
                                  : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                              }`}
                            >
                              {cat.label}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          catTabsScrollRef.current?.scrollBy({
                            left: 200,
                            behavior: "smooth",
                          })
                        }
                        className="w-6 h-6 rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0"
                      >
                        ›
                      </button>
                    </div>
                  </div>

                  {/* 19개 카테고리별 권한 체크리스트 */}
                  <div className="space-y-8">
                    {PERMISSION_CATEGORIES.map((cat) => {
                      const kw = permKeyword.trim();
                      const visibleItems = cat.items.filter(
                        (it) =>
                          !kw ||
                          it.title.includes(kw) ||
                          it.description.includes(kw) ||
                          cat.label.includes(kw)
                      );
                      if (visibleItems.length === 0) return null;

                      return (
                        <div
                          key={cat.id}
                          ref={(el) => {
                            sectionRefs.current[cat.id] = el;
                          }}
                          className="space-y-2 scroll-mt-28"
                        >
                          <h4 className="text-[15px] font-extrabold text-slate-900">
                            {cat.label}
                          </h4>

                          <div className="divide-y divide-slate-100">
                            {visibleItems.map((item) => {
                              const checked = Boolean(activePerms[item.key]);
                              const curScope =
                                activeScopes[item.key] || "전체 구성원";

                              return (
                                <div
                                  key={item.key}
                                  className="py-3.5 flex items-center justify-between gap-4"
                                >
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-800">
                                      {item.title}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                                      {item.description}
                                    </p>
                                    {item.warningText && (
                                      <p className="text-[11px] text-rose-500 font-semibold mt-0.5">
                                        {item.warningText}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    {item.supportsScope &&
                                      matrixState.kind !== "DEFAULT_MEMBER" && (
                                        <div
                                          className="relative"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            type="button"
                                            disabled={!canEdit}
                                            onClick={() =>
                                              setOpenScopePermKey(
                                                openScopePermKey === item.key
                                                  ? null
                                                  : item.key
                                              )
                                            }
                                            className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1"
                                          >
                                            <span>{curScope}</span>
                                            <span className="text-[9px] text-slate-400">
                                              ▾
                                            </span>
                                          </button>

                                          {openScopePermKey === item.key && (
                                            <div className="absolute right-0 top-full mt-1 w-[135px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40">
                                              {PERMISSION_SCOPE_OPTIONS.map(
                                                (sc) => (
                                                  <button
                                                    key={sc}
                                                    type="button"
                                                    onClick={() =>
                                                      setMatrixScope(
                                                        item.key,
                                                        sc
                                                      )
                                                    }
                                                    className={`w-full px-3 py-1.5 text-left text-[11px] ${
                                                      curScope === sc
                                                        ? "bg-slate-100 font-bold text-slate-900"
                                                        : "hover:bg-slate-50 text-slate-700"
                                                    }`}
                                                  >
                                                    {sc}
                                                  </button>
                                                )
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                    {item.lockedFullScope && (
                                      <span className="text-[11px] text-slate-300 font-medium flex items-center gap-1 select-none">
                                        <span>전체 구성원</span>
                                        <span className="text-[9px]">▾</span>
                                      </span>
                                    )}

                                    <input
                                      type="checkbox"
                                      disabled={!canEdit}
                                      checked={checked}
                                      onChange={() =>
                                        toggleMatrixPermission(item.key)
                                      }
                                      className="w-4 h-4 rounded border-slate-300 accent-[#00c458] cursor-pointer"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 하단 그라데이션 저장 버튼 (190151 동일) */}
                {canEdit && (
                  <div className="px-7 py-4 border-t border-slate-100 bg-white shrink-0">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveMatrixModal}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00c49a] hover:opacity-95 text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                    >
                      저장
                    </button>
                  </div>
                )}
              </div>

              {/* 우측 권한 그룹 구성원 사이드바 (190151 우측 동일) */}
              {matrixState.kind === "CUSTOM" && showRightMemberPane && (
                <aside
                  onClick={(e) => e.stopPropagation()}
                  className="w-[240px] border-l border-slate-100 p-5 flex flex-col shrink-0 bg-white relative"
                >
                  <div>
                    <div className="text-xs font-extrabold text-slate-800">
                      권한 그룹 구성원{" "}
                      <span className="text-[#00c458]">
                        {matrixState.group.member_names.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      그룹에 포함할 구성원을 추가해 주세요.
                    </p>
                  </div>

                  {canEdit && (
                    <div className="mt-3 pt-3 border-t border-slate-100 relative">
                      <button
                        type="button"
                        onClick={() => setMemberPickerOpen((p) => !p)}
                        className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
                      >
                        <span className="text-slate-400 text-sm leading-none">
                          +
                        </span>
                        <span>추가하기</span>
                      </button>

                      {memberPickerOpen && (
                        <div className="absolute right-0 top-full mt-2 w-[225px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2.5 z-40">
                          <input
                            autoFocus
                            value={memberPickerQuery}
                            onChange={(e) =>
                              setMemberPickerQuery(e.target.value)
                            }
                            placeholder="🔍 구성원 검색"
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[#00c458] text-[11px] focus:outline-none mb-2"
                          />
                          <div className="max-h-[220px] overflow-y-auto custom-scroll space-y-0.5">
                            {directoryPeople
                              .filter(
                                (p) =>
                                  !memberPickerQuery.trim() ||
                                  p.name.includes(memberPickerQuery.trim()) ||
                                  p.jobOrDept.includes(memberPickerQuery.trim())
                              )
                              .map((p) => {
                                const exists =
                                  matrixState.group.member_names.includes(
                                    p.name
                                  );
                                return (
                                  <button
                                    key={p.name}
                                    type="button"
                                    onClick={() => {
                                      const cur =
                                        matrixState.group.member_names;
                                      const next = exists
                                        ? cur.filter((x) => x !== p.name)
                                        : [...cur, p.name];
                                      setMatrixState({
                                        ...matrixState,
                                        group: {
                                          ...matrixState.group,
                                          member_names: next,
                                        },
                                      });
                                    }}
                                    className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left ${
                                      exists
                                        ? "bg-emerald-50"
                                        : "hover:bg-slate-50"
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span
                                        style={{
                                          backgroundColor: colorForName(p.name),
                                        }}
                                        className="w-5 h-5 rounded-md text-white text-[9px] font-extrabold flex items-center justify-center"
                                      >
                                        {shortAvatarText(p.name)}
                                      </span>
                                      <span className="font-bold text-slate-800">
                                        {p.name}
                                      </span>
                                      <span className="text-[10px] text-slate-400">
                                        {p.jobOrDept}
                                      </span>
                                    </span>
                                    {exists && (
                                      <span className="text-[#00c458] font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 배정된 구성원 리스트 */}
                  <div className="flex-1 overflow-y-auto custom-scroll mt-3 space-y-1.5">
                    {matrixState.group.member_names.map((nm) => {
                      const info = directoryPeople.find((d) => d.name === nm);
                      return (
                        <div
                          key={nm}
                          className="px-2.5 py-2 rounded-xl bg-slate-50 flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              style={{ backgroundColor: colorForName(nm) }}
                              className="w-6 h-6 rounded-lg text-white text-[9px] font-extrabold flex items-center justify-center shrink-0"
                            >
                              {shortAvatarText(nm)}
                            </span>
                            <span className="font-bold text-slate-800 truncate">
                              {nm}
                            </span>
                            {info?.jobOrDept && (
                              <span className="text-[10px] text-slate-400 truncate">
                                {info.jobOrDept}
                              </span>
                            )}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                setMatrixState({
                                  ...matrixState,
                                  group: {
                                    ...matrixState.group,
                                    member_names:
                                      matrixState.group.member_names.filter(
                                        (x) => x !== nm
                                      ),
                                  },
                                })
                              }
                              className="text-slate-400 hover:text-rose-500 font-bold"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </aside>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 3: 구성원별 권한 그룹 배정 편집 모달                          */}
      {/* ================================================================= */}
      {editingMemberRow && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  style={{
                    backgroundColor: colorForName(editingMemberRow.name),
                  }}
                  className="w-7 h-7 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center"
                >
                  {shortAvatarText(editingMemberRow.name)}
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingMemberRow.name} 님의 권한 그룹
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {editingMemberRow.jobOrDept || "본부 구성원"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingMemberRow(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-3 max-h-[65vh] overflow-y-auto custom-scroll">
              <label className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2.5">
                  <span className="text-base">👑</span>
                  <span>
                    <b className="text-slate-900 block">최고 관리자</b>
                    <span className="text-[11px] text-slate-500">
                      모든 기능 및 설정 권한 보유
                    </span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={memberIsSuperDraft}
                  onChange={(e) => setMemberIsSuperDraft(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 accent-amber-500"
                />
              </label>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between opacity-75">
                <span className="flex items-center gap-2.5">
                  <span>👥</span>
                  <span>
                    <b className="text-slate-800 block">기본 권한</b>
                    <span className="text-[11px] text-slate-400">
                      전 구성원 기본 부여
                    </span>
                  </span>
                </span>
                <span className="text-[11px] font-bold text-slate-400">
                  자동 포함
                </span>
              </div>

              <div className="pt-1 text-[11px] font-bold text-slate-400">
                커스텀 권한 그룹 배정
              </div>

              <div className="space-y-1.5">
                {permSettings.groups.map((grp) => {
                  const checked = memberAssignedGroupIds.includes(grp.id);
                  return (
                    <label
                      key={grp.id}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                        checked
                          ? "border-[#00c458] bg-emerald-50/30"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-800">
                          🪪 {grp.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {grp.description ||
                            `세부 권한 ${
                              Object.values(grp.permissions).filter(Boolean)
                                .length
                            }개`}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={checked}
                        onChange={() =>
                          setMemberAssignedGroupIds(
                            checked
                              ? memberAssignedGroupIds.filter(
                                  (id) => id !== grp.id
                                )
                              : [...memberAssignedGroupIds, grp.id]
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300 accent-[#00c458]"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMemberRow(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveMemberAssign}
                  className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                >
                  저장하기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
