// src/components/hq/settings/HqPermissionSettingsSection.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_SCOPE_OPTIONS,
} from "@/lib/hq/defaultPermissionSettings";
import {
  HQ_SIDEBAR_MENU_PERM_ITEMS,
  isMemberInGroup,
  normalizeHqPermissionSettings,
  resolveMemberPermissions,
} from "@/lib/hq/hqPermissionEngine";
import { useHqHref } from "@/lib/hq/hqRoutes";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqPermissionGroupItem,
  HqPermissionScope,
  HqPermissionSettings,
  HqRankCode,
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
  key: string; // instructor_id 또는 fallback 이름
  instructor_id?: string;
  name: string;
  jobOrDept: string;
  isDeptHead: boolean;
  rank_code: HqRankCode;
}

const FALLBACK_MEMBER_ROSTER: DirectoryPerson[] = [
  { key: "fb-김근식", name: "김근식", jobOrDept: "관리팀", isDeptHead: true, rank_code: "DIRECTOR" },
  { key: "fb-김동현", name: "김동현", jobOrDept: "집필팀", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-김문수", name: "김문수", jobOrDept: "편집", isDeptHead: true, rank_code: "TEAM_LEAD" },
  { key: "fb-민세리", name: "민세리", jobOrDept: "집필팀", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-박주원", name: "박주원", jobOrDept: "집필팀", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-백시연", name: "백시연", jobOrDept: "교재 집필", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-심혜영", name: "심혜영", jobOrDept: "디자인", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-원종준", name: "원종준", jobOrDept: "교재 집필", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-이웅행", name: "이웅행", jobOrDept: "경영", isDeptHead: true, rank_code: "DIRECTOR" },
  { key: "fb-조원형", name: "조원형", jobOrDept: "마케팅", isDeptHead: true, rank_code: "TEAM_LEAD" },
  { key: "fb-천종현", name: "천종현", jobOrDept: "대표", isDeptHead: true, rank_code: "CEO" },
  { key: "fb-최수연", name: "최수연", jobOrDept: "디자인", isDeptHead: false, rank_code: "STAFF" },
  { key: "fb-한민서", name: "한민서", jobOrDept: "마케팅", isDeptHead: false, rank_code: "STAFF" },
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
  const hqHref = useHqHref();

  const permSettings: HqPermissionSettings = useMemo(
    () =>
      normalizeHqPermissionSettings(settings.extra_settings?.permission_settings),
    [settings.extra_settings?.permission_settings]
  );

  // 상단 탭: 권한 그룹 | 구성원 권한
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

  // 2) 권한 매트릭스 생성/수정 모달
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

  // 3) 구성원별 권한 그룹 & 좌측 메뉴 개별 ON/OFF 편집 모달
  const [editingMemberRow, setEditingMemberRow] =
    useState<DirectoryPerson | null>(null);
  const [memberModalTab, setMemberModalTab] = useState<"MENUS" | "GROUPS">(
    "MENUS"
  );
  const [memberAssignedGroupIds, setMemberAssignedGroupIds] = useState<
    string[]
  >([]);
  const [memberIsSuperDraft, setMemberIsSuperDraft] = useState(false);
  const [memberOverridesDraft, setMemberOverridesDraft] = useState<
    Record<string, boolean>
  >({});

  // 재직 구성원 전체(신규 가입 테스트 계정 포함) ID 기준 정렬
  const directoryPeople: DirectoryPerson[] = useMemo(() => {
    const activeReal = members.filter((m) => m.work_status !== "퇴직");
    if (activeReal.length > 0) {
      const list: DirectoryPerson[] = activeReal.map((m) => {
        const label = [
          m.department && m.department !== "미지정" ? m.department : "",
          m.job_title || "",
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          key: m.instructor_id,
          instructor_id: m.instructor_id,
          name: m.name,
          jobOrDept: label,
          isDeptHead: Boolean(
            m.is_dept_head ||
              m.rank_code === "TEAM_LEAD" ||
              m.rank_code === "DIRECTOR" ||
              m.rank_code === "CEO"
          ),
          rank_code: m.rank_code || "STAFF",
        };
      });
      return list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return FALLBACK_MEMBER_ROSTER;
  }, [members]);

  const patchPermSettings = async (
    partial: Partial<HqPermissionSettings>,
    toast: string
  ) => {
    await onSaveExtra(
      {
        permission_settings: {
          ...permSettings,
          ...partial,
          menu_linked_v2: true,
        },
      },
      toast
    );
  };

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
        member_ids: [],
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
      // member_names에 해당하는 실계정 ID 동기화
      const matchedIds = directoryPeople
        .filter(
          (p) =>
            p.instructor_id && matrixState.group.member_names.includes(p.name)
        )
        .map((p) => p.instructor_id!);

      const saved: HqPermissionGroupItem = {
        ...matrixState.group,
        name: cleanName,
        description: matrixState.group.description.trim(),
        member_ids: matchedIds,
      };
      const nextGroups = matrixState.isNew
        ? [...permSettings.groups, saved]
        : permSettings.groups.map((g) => (g.id === saved.id ? saved : g));

      await patchPermSettings(
        { groups: nextGroups },
        matrixState.isNew
          ? `'${saved.name}' 권한 그룹이 추가되었습니다.`
          : `'${saved.name}' 권한 그룹이 좌측 메뉴에 반영되었습니다.`
      );
    } else if (matrixState.kind === "ORG_HEAD") {
      await patchPermSettings(
        {
          org_head_permissions: matrixState.permissions,
          org_head_scopes: matrixState.scopes,
        },
        "조직장 전용 권한 설정이 좌측 메뉴에 반영되었습니다."
      );
    } else {
      await patchPermSettings(
        {
          default_member_permissions: matrixState.permissions,
        },
        "전 구성원 기본 메뉴 · 권한 설정이 반영되었습니다."
      );
    }
    setMatrixState(null);
  };

  // 구성원 권한 탭에서 특정 구성원 클릭 -> 배정 그룹 & 메뉴 ON/OFF 편집 모달
  const openMemberAssignModal = (person: DirectoryPerson) => {
    setEditingMemberRow(person);
    setMemberModalTab("MENUS");
    const isSuper = Boolean(
      (person.instructor_id &&
        permSettings.super_admin_ids?.includes(person.instructor_id)) ||
        permSettings.super_admin_names.includes(person.name)
    );
    setMemberIsSuperDraft(isSuper);
    setMemberAssignedGroupIds(
      permSettings.groups
        .filter((g) =>
          isMemberInGroup(
            { instructor_id: person.instructor_id, name: person.name },
            g
          )
        )
        .map((g) => g.id)
    );
    const byName = permSettings.member_overrides?.[person.name] || {};
    const byId = person.instructor_id
      ? permSettings.member_overrides?.[person.instructor_id] || {}
      : {};
    setMemberOverridesDraft({ ...byName, ...byId });
  };

  // 모달 내 현재 Draft 기준 해당 구성원의 상속 권한 실시간 계산
  const draftMemberInherited = useMemo(() => {
    if (!editingMemberRow) return {};
    if (memberIsSuperDraft) {
      const all: Record<string, boolean> = {};
      HQ_SIDEBAR_MENU_PERM_ITEMS.forEach((m) => {
        all[m.permKey] = true;
      });
      return all;
    }
    const base: Record<string, boolean> = {};
    Object.entries(permSettings.default_member_permissions || {}).forEach(
      ([k, v]) => {
        if (v) base[k] = true;
      }
    );
    if (editingMemberRow.isDeptHead) {
      Object.entries(permSettings.org_head_permissions || {}).forEach(
        ([k, v]) => {
          if (v) base[k] = true;
        }
      );
    }
    permSettings.groups
      .filter((g) => memberAssignedGroupIds.includes(g.id))
      .forEach((g) => {
        Object.entries(g.permissions || {}).forEach(([k, v]) => {
          if (v) base[k] = true;
        });
      });
    return base;
  }, [
    editingMemberRow,
    memberIsSuperDraft,
    memberAssignedGroupIds,
    permSettings,
  ]);

  const handleToggleMemberMenuSwitch = (permKey: string) => {
    if (!canEdit || memberIsSuperDraft) return;
    const inheritedVal = Boolean(draftMemberInherited[permKey]);
    const currentEffective =
      memberOverridesDraft[permKey] !== undefined
        ? memberOverridesDraft[permKey]
        : inheritedVal;
    const nextVal = !currentEffective;

    setMemberOverridesDraft((prev) => {
      const next = { ...prev };
      // 그룹 기본값과 같아지면 불필요한 오버라이드 엔트리 자동 정리
      if (nextVal === inheritedVal) {
        delete next[permKey];
      } else {
        next[permKey] = nextVal;
      }
      return next;
    });
  };

  const handleSaveMemberAssign = async () => {
    if (!editingMemberRow) return;
    const nm = editingMemberRow.name;
    const id = editingMemberRow.instructor_id;

    let nextSupers = permSettings.super_admin_names.filter((x) => x !== nm);
    let nextSuperIds = (permSettings.super_admin_ids || []).filter(
      (x) => x !== id
    );
    if (memberIsSuperDraft) {
      nextSupers = [...nextSupers, nm];
      if (id) nextSuperIds = [...nextSuperIds, id];
    }
    if (nextSupers.length === 0 && nextSuperIds.length === 0) {
      alert("최소 1명 이상의 최고 관리자가 유지되어야 합니다.");
      return;
    }

    const nextGroups = permSettings.groups.map((g) => {
      const withoutName = g.member_names.filter((x) => x !== nm);
      const withoutId = (g.member_ids || []).filter((x) => x !== id);
      const assigned = memberAssignedGroupIds.includes(g.id);
      return {
        ...g,
        member_names: assigned ? [...withoutName, nm] : withoutName,
        member_ids: assigned && id ? [...withoutId, id] : withoutId,
      };
    });

    const nextOverrides = { ...(permSettings.member_overrides || {}) };
    const storeKey = id || nm;
    // 이름 키 중복 제거 후 ID(없으면 이름) 단일 키로 깔끔히 저장
    delete nextOverrides[nm];
    if (id) delete nextOverrides[id];

    if (!memberIsSuperDraft && Object.keys(memberOverridesDraft).length > 0) {
      nextOverrides[storeKey] = memberOverridesDraft;
    }

    await patchPermSettings(
      {
        super_admin_names: nextSupers,
        super_admin_ids: nextSuperIds,
        groups: nextGroups,
        member_overrides: nextOverrides,
      },
      `${nm} 님의 메뉴 권한 및 그룹 배정이 저장되었습니다.`
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

  const applyPermPatchInMatrix = (patch: Record<string, boolean>) => {
    if (!matrixState || !canEdit) return;
    if (matrixState.kind === "CUSTOM") {
      setMatrixState({
        ...matrixState,
        group: {
          ...matrixState.group,
          permissions: { ...matrixState.group.permissions, ...patch },
        },
      });
    } else if (matrixState.kind === "ORG_HEAD") {
      setMatrixState({
        ...matrixState,
        permissions: { ...matrixState.permissions, ...patch },
      });
    } else {
      setMatrixState({
        ...matrixState,
        permissions: { ...matrixState.permissions, ...patch },
      });
    }
  };

  const toggleMatrixPermission = (key: string) => {
    applyPermPatchInMatrix({ [key]: !activePerms[key] });
  };

  const setAllSidebarMenusInMatrix = (mode: "ALL_ON" | "BASIC_ONLY" | "ALL_OFF") => {
    const patch: Record<string, boolean> = {};
    HQ_SIDEBAR_MENU_PERM_ITEMS.forEach((m) => {
      patch[m.permKey] =
        mode === "ALL_ON"
          ? true
          : mode === "BASIC_ONLY"
          ? m.defaultForMember
          : false;
    });
    applyPermPatchInMatrix(patch);
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
          <div>
            <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
              권한 설정
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              권한 그룹과 구성원별 개별 설정이 좌측 사이드바 메뉴 노출 및 페이지 접근에 실시간 연동됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onCloseSettings?.();
              router.push(hqHref("/hq/permissions"));
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-600 flex items-center gap-1 shrink-0"
          >
            <span>연구DB · 직급 권한 패널</span>
            <span className="text-slate-400">↗</span>
          </button>
        </div>

        {/* 상단 세그먼트 탭 (권한 그룹 | 구성원 권한) */}
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
            구성원 권한 ({directoryPeople.length}명)
          </button>
        </div>

        {/* =============================================================== */}
        {/* TAB 1: 권한 그룹                                                */}
        {/* =============================================================== */}
        {subTab === "GROUPS" && (
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-900">
                  권한 그룹
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  [기본 권한]에서 신규 사원의 기본 좌측 메뉴를 정하고, 부서·직무별 권한 그룹에 구성원을 추가해 보세요.
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
                      모든 좌측 메뉴(인사이트·설정 포함)와 전체 관리 권한을 보유한 구성원이에요.
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
                      부서장·팀장에게 자동 부여되는 좌측 메뉴(구성원·근무관리·휴가관리·출판공정 등) 및 권한을 설정해요.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-blue-600 shrink-0">
                  메뉴{" "}
                  {
                    HQ_SIDEBAR_MENU_PERM_ITEMS.filter(
                      (m) => permSettings.org_head_permissions[m.permKey]
                    ).length
                  }
                  개 추가 허용
                </span>
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
                      기본 권한 (신규·일반 구성원 공통)
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      새 계정을 만들었을 때 기본으로 보이는 좌측 메뉴 ON/OFF를 설정해요.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-slate-600 shrink-0">
                  기본 메뉴{" "}
                  {
                    HQ_SIDEBAR_MENU_PERM_ITEMS.filter(
                      (m) => permSettings.default_member_permissions[m.permKey]
                    ).length
                  }
                  /{HQ_SIDEBAR_MENU_PERM_ITEMS.length} ON
                </span>
              </div>

              {/* 커스텀 권한 그룹 목록 */}
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
        {/* TAB 2: 구성원 권한 (클릭 시 개인별 그룹 + 메뉴 ON/OFF 직접 제어) */}
        {/* =============================================================== */}
        {subTab === "MEMBERS" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-900">
                  구성원 권한
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  구성원을 클릭하면 권한 그룹 배정과 20개 좌측 메뉴의 개별 ON/OFF 스위치를 직접 조정할 수 있습니다.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {memberSearchOpen && (
                  <input
                    autoFocus
                    value={memberTabKeyword}
                    onChange={(e) => setMemberTabKeyword(e.target.value)}
                    placeholder="이름 · 부서 · 그룹 검색"
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

            <div className="rounded-xl border border-slate-200/70 overflow-hidden">
              <div className="px-4 py-2.5 bg-[#f8f9fa] grid grid-cols-12 text-[11px] font-bold text-slate-500">
                <div className="col-span-4">구성원</div>
                <div className="col-span-6">적용 권한 그룹 · 개별 메뉴 조정</div>
                <div className="col-span-2 text-right">활성 좌측 메뉴</div>
              </div>

              <div className="divide-y divide-slate-100 bg-white">
                {directoryPeople
                  .filter((p) => {
                    const kw = memberTabKeyword.trim();
                    if (!kw) return true;
                    const myGroupNames = permSettings.groups
                      .filter((g) =>
                        isMemberInGroup(
                          { instructor_id: p.instructor_id, name: p.name },
                          g
                        )
                      )
                      .map((g) => g.name)
                      .join(" ");
                    return (
                      p.name.includes(kw) ||
                      p.jobOrDept.includes(kw) ||
                      myGroupNames.includes(kw)
                    );
                  })
                  .map((person) => {
                    const resolved = resolveMemberPermissions({
                      member: {
                        instructor_id: person.instructor_id || "",
                        name: person.name,
                        is_dept_head: person.isDeptHead,
                        rank_code: person.rank_code,
                      },
                      rawSettings: permSettings,
                    });

                    const enabledMenuCount = HQ_SIDEBAR_MENU_PERM_ITEMS.filter(
                      (m) => resolved.effectivePermissions[m.permKey]
                    ).length;

                    const overrideEntries = Object.entries(
                      resolved.personalOverrides
                    ).filter(([k]) => k.startsWith("menu."));

                    return (
                      <div
                        key={person.key}
                        onClick={() => openMemberAssignModal(person)}
                        className="px-4 py-3.5 hover:bg-slate-50/80 grid grid-cols-12 items-center gap-2 cursor-pointer transition-colors"
                      >
                        <div className="col-span-4 flex items-center gap-3 min-w-0">
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

                        <div className="col-span-6 flex flex-wrap items-center gap-1.5">
                          {resolved.isSuperAdmin && (
                            <span
                              title="최고 관리자"
                              className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-600 text-[11px] font-extrabold"
                            >
                              👑 최고관리자
                            </span>
                          )}
                          {person.isDeptHead && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[11px] font-semibold">
                              📢 조직장
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200/80 text-slate-600 text-[11px] font-semibold">
                            👥 기본 권한
                          </span>
                          {resolved.assignedGroups.map((g) => (
                            <span
                              key={g.id}
                              className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold"
                            >
                              🪪 {g.name}
                            </span>
                          ))}
                          {overrideEntries.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold">
                              개별 메뉴 조정 {overrideEntries.length}건
                            </span>
                          )}
                        </div>

                        <div className="col-span-2 text-right">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
                            {enabledMenuCount}/{HQ_SIDEBAR_MENU_PERM_ITEMS.length} ON
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {/* 하단 이전/다음 이동 카드 */}
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
            onClick={() => onNavigateTab("integration-setting")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                연결 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 최고 관리자 구성원 지정 모달                              */}
      {/* ================================================================= */}
      {superAdminModalOpen && (
        <div
          onClick={() => setSuperAdminModalOpen(false)}
          className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs"
          >
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
                최고 관리자는 본부의 모든 좌측 메뉴(인사이트 · 급여 · 설정 등)와 권한 설정을 조회하고 변경할 수 있습니다.
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
                        key={p.key}
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
                    const superIds = directoryPeople
                      .filter(
                        (p) =>
                          p.instructor_id && superAdminDraft.includes(p.name)
                      )
                      .map((p) => p.instructor_id!);
                    await patchPermSettings(
                      {
                        super_admin_names: superAdminDraft,
                        super_admin_ids: superIds,
                      },
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
      {/* 모달 2: 권한 그룹 매트릭스 편집 모달                              */}
      {/* ================================================================= */}
      {matrixState && (
        <div
          onClick={() => setMatrixState(null)}
          className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-3 sm:p-5"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (openScopePermKey) setOpenScopePermKey(null);
            }}
            className="bg-white w-full max-w-[920px] h-[90vh] max-h-[860px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs"
          >
            {/* 상단 헤더 바 */}
            <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-full border border-slate-200 text-[11px] font-bold text-slate-600">
                  권한 그룹
                </span>
                <span className="text-xs font-extrabold text-slate-800">
                  {matrixState.kind === "CUSTOM"
                    ? matrixState.group.name || "새 권한 그룹"
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
              <div className="flex-1 flex flex-col min-w-0">
                <div
                  ref={matrixScrollRef}
                  className="flex-1 overflow-y-auto custom-scroll px-7 pt-6 pb-8 space-y-6"
                >
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
                          ? "부서장·팀장으로 지정된 구성원에게 추가 부여되는 좌측 메뉴와 기능 권한입니다."
                          : "가입한 모든 본부 구성원에게 기본으로 노출되는 좌측 메뉴와 공통 권한입니다."}
                      </p>
                    </div>
                  )}

                  {/* 검색창 + 가로 스크롤 카테고리 탭 바 */}
                  <div className="sticky -top-6 bg-white pt-2 pb-1 z-20 space-y-3 border-b border-slate-100">
                    <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 flex items-center gap-2 bg-white">
                      <span className="text-slate-400">🔍</span>
                      <input
                        value={permKeyword}
                        onChange={(e) => setPermKeyword(e.target.value)}
                        placeholder="메뉴명 또는 세부 권한 검색"
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

                  {/* 카테고리별 권한 체크리스트 */}
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
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-[15px] font-extrabold text-slate-900">
                              {cat.label}
                            </h4>
                            {cat.id === "cat-sidebar-menu" && canEdit && (
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("ALL_ON")
                                  }
                                  className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  전체 켜기
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("BASIC_ONLY")
                                  }
                                  className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  사원 기본값
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("ALL_OFF")
                                  }
                                  className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  전체 끄기
                                </button>
                              </div>
                            )}
                          </div>

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

                {canEdit && (
                  <div className="px-7 py-4 border-t border-slate-100 bg-white shrink-0">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveMatrixModal}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00c49a] hover:opacity-95 text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                    >
                      저장 및 좌측 메뉴 반영
                    </button>
                  </div>
                )}
              </div>

              {/* 우측 권한 그룹 구성원 사이드바 */}
              {matrixState.kind === "CUSTOM" && showRightMemberPane && (
                <aside
                  onClick={(e) => e.stopPropagation()}
                  className="w-[245px] border-l border-slate-100 p-5 flex flex-col shrink-0 bg-white relative"
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
                                    key={p.key}
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
                                    <span className="flex items-center gap-2 min-w-0">
                                      <span
                                        style={{
                                          backgroundColor: colorForName(p.name),
                                        }}
                                        className="w-5 h-5 rounded-md text-white text-[9px] font-extrabold flex items-center justify-center shrink-0"
                                      >
                                        {shortAvatarText(p.name)}
                                      </span>
                                      <span className="font-bold text-slate-800 shrink-0">
                                        {p.name}
                                      </span>
                                      <span className="text-[10px] text-slate-400 truncate">
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
      {/* 모달 3: 구성원별 좌측 메뉴 ON/OFF & 권한 그룹 배정 모달            */}
      {/* ================================================================= */}
      {editingMemberRow && (
        <div
          onClick={() => setEditingMemberRow(null)}
          className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-[560px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs flex flex-col max-h-[88vh]"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span
                  style={{
                    backgroundColor: colorForName(editingMemberRow.name),
                  }}
                  className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center"
                >
                  {shortAvatarText(editingMemberRow.name)}
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingMemberRow.name} 님의 메뉴 노출 · 권한 설정
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

            {/* 서브 탭: 좌측 메뉴 ON/OFF | 소속 권한 그룹 */}
            <div className="px-6 pt-3 shrink-0">
              <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => setMemberModalTab("MENUS")}
                  className={`py-1.5 rounded-lg font-bold transition-all ${
                    memberModalTab === "MENUS"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  좌측 메뉴 ON / OFF
                </button>
                <button
                  type="button"
                  onClick={() => setMemberModalTab("GROUPS")}
                  className={`py-1.5 rounded-lg font-bold transition-all ${
                    memberModalTab === "GROUPS"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  권한 그룹 배정 ({memberAssignedGroupIds.length})
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto custom-scroll space-y-3 flex-1">
              {memberModalTab === "MENUS" ? (
                <>
                  {memberIsSuperDraft ? (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
                      👑 현재 <strong>최고 관리자</strong>로 지정되어 모든 좌측 메뉴가 항상 표시됩니다. 개별 메뉴를 숨기려면 [권한 그룹 배정] 탭에서 최고 관리자 체크를 먼저 해제해 주세요.
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        스위치를 켜거나 끄면 이 구성원에게만 좌측 메뉴를 개별 추가·차단할 수 있습니다.
                      </span>
                      {Object.keys(memberOverridesDraft).length > 0 && canEdit && (
                        <button
                          type="button"
                          onClick={() => setMemberOverridesDraft({})}
                          className="text-brand font-bold hover:underline shrink-0 ml-2"
                        >
                          그룹 기본값으로 초기화
                        </button>
                      )}
                    </div>
                  )}

                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {HQ_SIDEBAR_MENU_PERM_ITEMS.map((item) => {
                      const inherited = Boolean(
                        draftMemberInherited[item.permKey]
                      );
                      const hasOverride =
                        !memberIsSuperDraft &&
                        memberOverridesDraft[item.permKey] !== undefined;
                      const effective = memberIsSuperDraft
                        ? true
                        : hasOverride
                          ? Boolean(memberOverridesDraft[item.permKey])
                          : inherited;

                      return (
                        <div
                          key={item.permKey}
                          onClick={() =>
                            handleToggleMemberMenuSwitch(item.permKey)
                          }
                          className={`px-4 py-2.5 flex items-center justify-between gap-3 ${
                            memberIsSuperDraft || !canEdit
                              ? "opacity-75"
                              : "hover:bg-slate-50 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-sm shrink-0">
                              {item.icon}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                <span>{item.label}</span>
                                {hasOverride && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                                      effective
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-rose-50 text-rose-600"
                                    }`}
                                  >
                                    {effective ? "개별 허용" : "개별 차단"}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {item.sectionLabel} · 그룹기본:{" "}
                                {inherited ? "ON" : "OFF"}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={!canEdit || memberIsSuperDraft}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleMemberMenuSwitch(item.permKey);
                            }}
                            className={`w-10 h-5.5 rounded-full transition-colors relative shrink-0 ${
                              effective ? "bg-[#00c458]" : "bg-slate-300"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${
                                effective ? "left-5" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <label className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-2.5">
                      <span className="text-base">👑</span>
                      <span>
                        <b className="text-slate-900 block">최고 관리자</b>
                        <span className="text-[11px] text-slate-500">
                          모든 좌측 메뉴 및 설정 권한 보유
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
                          전 구성원 공통 적용
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
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0 bg-white">
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
