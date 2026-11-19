// src/components/hq/settings/HqPermissionSettingsSection.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildPrereqSatisfyingPatch,
  getAllowedScopeOptionsForItem,
  getMissingPrerequisitesForPerm,
  normalizePermissionScope,
  PERMISSION_CATEGORIES,
} from "@/lib/hq/defaultPermissionSettings";
import {
  buildDefaultSuperAdminPermsAndScopes,
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
import { useOptionalHqShell } from "../HqShellContext";
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
      kind: "SUPER_ADMIN";
      member_names: string[];
      permissions: Record<string, boolean>;
      scopes: Record<string, HqPermissionScope>;
    }
  | {
      kind: "ORG_HEAD";
      permissions: Record<string, boolean>;
      scopes: Record<string, HqPermissionScope>;
    }
  | {
      kind: "DEFAULT_MEMBER";
      permissions: Record<string, boolean>;
      scopes: Record<string, HqPermissionScope>;
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
  const shell = useOptionalHqShell();

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

  // 권한 매트릭스 생성/수정 모달 (최고 관리자 · 조직장 · 기본 권한 · 커스텀 그룹 통합)
  const [matrixState, setMatrixState] = useState<MatrixEditorMode | null>(null);
  const [matrixHeaderScrolled, setMatrixHeaderScrolled] = useState(false);
  const [activeCatId, setActiveCatId] = useState<string>(
    PERMISSION_CATEGORIES[0].id
  );
  const [permKeyword, setPermKeyword] = useState("");
  const [showRightMemberPane, setShowRightMemberPane] = useState(true);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberPickerQuery, setMemberPickerQuery] = useState("");
  const [openScopePermKey, setOpenScopePermKey] = useState<string | null>(null);
  const [openPrereqPermKey, setOpenPrereqPermKey] = useState<string | null>(
    null
  );

  const catTabsScrollRef = useRef<HTMLDivElement>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 3) 구성원별 권한 그룹 & 좌측 메뉴 · 세부 권한 개별 ON/OFF 편집 모달
  const [editingMemberRow, setEditingMemberRow] =
    useState<DirectoryPerson | null>(null);
  const [memberModalTab, setMemberModalTab] = useState<
    "MENUS" | "WORK" | "GROUPS"
  >("MENUS");
  const [memberAssignedGroupIds, setMemberAssignedGroupIds] = useState<
    string[]
  >([]);
  const [memberIsSuperDraft, setMemberIsSuperDraft] = useState(false);
  const [memberOverridesDraft, setMemberOverridesDraft] = useState<
    Record<string, boolean>
  >({});
  const [memberScopeOverridesDraft, setMemberScopeOverridesDraft] = useState<
    Record<string, HqPermissionScope>
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

  const resetMatrixUiState = () => {
    setPermKeyword("");
    setActiveCatId(PERMISSION_CATEGORIES[0].id);
    setMatrixHeaderScrolled(false);
    setShowRightMemberPane(true);
    setMemberPickerOpen(false);
    setMemberPickerQuery("");
    setOpenScopePermKey(null);
    setOpenPrereqPermKey(null);
  };

  const openSuperAdminMatrixModal = () => {
    resetMatrixUiState();
    const defSuper = buildDefaultSuperAdminPermsAndScopes();
    setMatrixState({
      kind: "SUPER_ADMIN",
      member_names: [...permSettings.super_admin_names],
      permissions: {
        ...defSuper.permissions,
        ...(permSettings.super_admin_permissions || {}),
      },
      scopes: {
        ...defSuper.scopes,
        ...(permSettings.super_admin_scopes || {}),
      },
    });
  };

  const openCreateGroupModal = () => {
    resetMatrixUiState();
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
    resetMatrixUiState();
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

    const curPerms =
      matrixState.kind === "CUSTOM"
        ? matrixState.group.permissions
        : matrixState.permissions;
    const curScopes =
      matrixState.kind === "CUSTOM" ? matrixState.group.scopes : matrixState.scopes;

    const unresolvedKeys = Object.keys(curPerms).filter(
      (k) =>
        curPerms[k] &&
        getMissingPrerequisitesForPerm(k, curPerms, curScopes).length > 0
    );

    let finalPerms = curPerms;
    let finalScopes = curScopes;

    if (unresolvedKeys.length > 0) {
      const ok = confirm(
        `체크한 권한 중 상위(필수) 권한이 아직 선택되지 않은 항목이 ${unresolvedKeys.length}건 있습니다.\n\n[확인]을 누르면 필요한 상위 권한과 범위를 자동으로 함께 적용하여 저장합니다.`
      );
      if (!ok) return;
      const patched = buildPrereqSatisfyingPatch(
        unresolvedKeys,
        curPerms,
        curScopes
      );
      finalPerms = patched.nextPerms;
      finalScopes = patched.nextScopes;
    }

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
        permissions: finalPerms,
        scopes: finalScopes,
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
    } else if (matrixState.kind === "SUPER_ADMIN") {
      if (matrixState.member_names.length === 0) {
        alert("최소 1명 이상의 최고 관리자가 지정되어야 합니다.");
        return;
      }
      const superIds = directoryPeople
        .filter(
          (p) =>
            p.instructor_id && matrixState.member_names.includes(p.name)
        )
        .map((p) => p.instructor_id!);

      await patchPermSettings(
        {
          super_admin_names: matrixState.member_names,
          super_admin_ids: superIds,
          super_admin_permissions: finalPerms,
          super_admin_scopes: finalScopes,
        },
        `최고 관리자(${matrixState.member_names.length}명) 및 세부 권한 설정이 저장되었습니다.`
      );
    } else if (matrixState.kind === "ORG_HEAD") {
      await patchPermSettings(
        {
          org_head_permissions: finalPerms,
          org_head_scopes: finalScopes,
        },
        "조직장 전용 권한 설정이 좌측 메뉴에 반영되었습니다."
      );
    } else {
      await patchPermSettings(
        {
          default_member_permissions: finalPerms,
          default_member_scopes: finalScopes,
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

    const sByName = permSettings.member_scope_overrides?.[person.name] || {};
    const sById = person.instructor_id
      ? permSettings.member_scope_overrides?.[person.instructor_id] || {}
      : {};
    setMemberScopeOverridesDraft({ ...sByName, ...sById });
  };

  // 모달 내 현재 Draft 기준 해당 구성원의 상속 권한 실시간 계산
  const draftMemberInherited = useMemo(() => {
    if (!editingMemberRow) return {};
    if (memberIsSuperDraft) {
      const defSuper = buildDefaultSuperAdminPermsAndScopes();
      return {
        ...defSuper.permissions,
        ...(permSettings.super_admin_permissions || {}),
      };
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
    if (!canEdit) return;
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
    const nextScopeOverrides = {
      ...(permSettings.member_scope_overrides || {}),
    };
    const storeKey = id || nm;
    // 이름 키 중복 제거 후 ID(없으면 이름) 단일 키로 깔끔히 저장
    delete nextOverrides[nm];
    if (id) delete nextOverrides[id];
    delete nextScopeOverrides[nm];
    if (id) delete nextScopeOverrides[id];

    if (!memberIsSuperDraft && Object.keys(memberOverridesDraft).length > 0) {
      nextOverrides[storeKey] = memberOverridesDraft;
    }
    if (
      !memberIsSuperDraft &&
      Object.keys(memberScopeOverridesDraft).length > 0
    ) {
      nextScopeOverrides[storeKey] = memberScopeOverridesDraft;
    }

    await patchPermSettings(
      {
        super_admin_names: nextSupers,
        super_admin_ids: nextSuperIds,
        groups: nextGroups,
        member_overrides: nextOverrides,
        member_scope_overrides: nextScopeOverrides,
      },
      `${nm} 님의 메뉴·근무 권한 및 그룹 배정이 저장되었습니다.`
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
      : matrixState
        ? matrixState.permissions
        : {};

  const activeScopes: Record<string, HqPermissionScope> =
    matrixState?.kind === "CUSTOM"
      ? matrixState.group.scopes
      : matrixState
        ? matrixState.scopes
        : {};

  const applyMatrixPermsAndScopes = (
    nextPerms: Record<string, boolean>,
    nextScopes: Record<string, HqPermissionScope>
  ) => {
    if (!matrixState || !canEdit) return;
    if (matrixState.kind === "CUSTOM") {
      setMatrixState({
        ...matrixState,
        group: {
          ...matrixState.group,
          permissions: nextPerms,
          scopes: nextScopes,
        },
      });
    } else if (matrixState.kind === "ORG_HEAD") {
      setMatrixState({
        ...matrixState,
        permissions: nextPerms,
        scopes: nextScopes,
      });
    } else {
      setMatrixState({
        ...matrixState,
        permissions: nextPerms,
        scopes: nextScopes,
      });
    }
  };

  const applyPermPatchInMatrix = (patch: Record<string, boolean>) => {
    applyMatrixPermsAndScopes({ ...activePerms, ...patch }, activeScopes);
  };

  const toggleMatrixPermission = (key: string) => {
    if (!matrixState || !canEdit) return;
    const nextChecked = !activePerms[key];
    const nextPerms = { ...activePerms, [key]: nextChecked };
    applyMatrixPermsAndScopes(nextPerms, activeScopes);

    if (nextChecked) {
      const missing = getMissingPrerequisitesForPerm(
        key,
        nextPerms,
        activeScopes
      );
      if (missing.length > 0) {
        setOpenScopePermKey(null);
        setOpenPrereqPermKey(key);
      }
    } else if (openPrereqPermKey === key) {
      setOpenPrereqPermKey(null);
    }
  };

  const applyPrereqsForPermKeys = (targetKeys: string[]) => {
    if (!matrixState || !canEdit || targetKeys.length === 0) return;
    const { nextPerms, nextScopes } = buildPrereqSatisfyingPatch(
      targetKeys,
      activePerms,
      activeScopes
    );
    applyMatrixPermsAndScopes(nextPerms, nextScopes);
    setOpenPrereqPermKey(null);
  };

  const unresolvedMatrixPermKeys = useMemo(() => {
    if (!matrixState) return [];
    return Object.keys(activePerms).filter(
      (k) =>
        activePerms[k] &&
        getMissingPrerequisitesForPerm(k, activePerms, activeScopes).length > 0
    );
  }, [matrixState, activePerms, activeScopes]);

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
    const nextScopes = { ...activeScopes, [key]: scope };
    applyMatrixPermsAndScopes(activePerms, nextScopes);
    setOpenScopePermKey(null);

    if (
      activePerms[key] &&
      getMissingPrerequisitesForPerm(key, activePerms, nextScopes).length > 0
    ) {
      setOpenPrereqPermKey(key);
    }
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
          {shell?.isDevSuperAdmin && (
            <button
              type="button"
              onClick={() => {
                onCloseSettings?.();
                router.push(hqHref("/hq/permissions"));
              }}
              className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-50 text-[11px] font-bold text-rose-700 flex items-center gap-1 shrink-0"
            >
              <span>포털 권한 관리 (Lv.6)</span>
              <span className="text-rose-400">↗</span>
            </button>
          )}
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
                onClick={openSuperAdminMatrixModal}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span className="w-8 h-8 rounded-xl bg-[#FDD835] text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 fill-current">
                      <path d="M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                    </svg>
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
                  resetMatrixUiState();
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
                  resetMatrixUiState();
                  setMatrixState({
                    kind: "DEFAULT_MEMBER",
                    permissions: { ...permSettings.default_member_permissions },
                    scopes: { ...(permSettings.default_member_scopes || {}) },
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
      {/* 통합 권한 그룹 매트릭스 편집 모달 (최고 관리자 · 조직장 · 기본 · 커스텀) */}
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
              if (openPrereqPermKey) setOpenPrereqPermKey(null);
              if (memberPickerOpen) setMemberPickerOpen(false);
            }}
            className="bg-white w-full max-w-[1000px] h-[90vh] max-h-[860px] rounded-3xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden text-xs"
          >
            {/* 상단 헤더 바 (Flex 스타일: 스크롤 시 그룹 타이틀 표시) */}
            <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full border border-slate-200 text-[11px] font-bold text-slate-600">
                  권한 그룹
                </span>
                {matrixHeaderScrolled && (
                  <>
                    <span className="w-px h-3.5 bg-slate-200" />
                    <span className="text-[14px] font-extrabold text-slate-900">
                      {matrixState.kind === "SUPER_ADMIN"
                        ? "최고 관리자"
                        : matrixState.kind === "ORG_HEAD"
                          ? "조직장"
                          : matrixState.kind === "DEFAULT_MEMBER"
                            ? "기본 권한"
                            : matrixState.group.name || "새 권한 그룹"}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRightMemberPane((p) => !p)}
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs transition-colors ${
                    showRightMemberPane
                      ? "border-slate-200 bg-slate-100 text-slate-700"
                      : "border-slate-200 text-slate-400 hover:bg-slate-50"
                  }`}
                  title="우측 구성원 패널 열기/닫기"
                >
                  ◨
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixState(null)}
                  className="w-7 h-7 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-600 flex items-center justify-center font-bold transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 본문 2단 레이아웃 */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 relative bg-white">
                <div
                  ref={matrixScrollRef}
                  onScroll={(e) => {
                    const top = e.currentTarget.scrollTop;
                    if (top > 52 && !matrixHeaderScrolled) {
                      setMatrixHeaderScrolled(true);
                    } else if (top <= 52 && matrixHeaderScrolled) {
                      setMatrixHeaderScrolled(false);
                    }
                  }}
                  className="flex-1 overflow-y-auto custom-scroll px-8 pt-7 pb-8 space-y-6"
                >
                  {matrixState.kind === "CUSTOM" ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="w-12 h-12 rounded-[18px] bg-slate-100 text-slate-500 flex items-center justify-center text-xl shrink-0">
                          🪪
                        </span>
                        <div className="flex-1 min-w-0">
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
                            className="w-full px-2 py-1 rounded-lg border border-transparent focus:border-[#00c458] text-[21px] font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                          />
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
                            className="w-full px-2 text-[13px] text-slate-400 placeholder:text-slate-300 focus:outline-none mt-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  ) : matrixState.kind === "SUPER_ADMIN" ? (
                    <div className="flex items-center gap-4">
                      <div className="w-13 h-13 rounded-[18px] bg-[#FDD835] text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-6 h-6 fill-current"
                        >
                          <path d="M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-[22px] font-extrabold text-slate-900 tracking-tight leading-tight">
                          최고 관리자
                        </h3>
                        <p className="text-[13px] text-slate-400 mt-1">
                          모든 권한을 보유한 구성원을 지정할 수 있어요.
                        </p>
                      </div>
                    </div>
                  ) : matrixState.kind === "ORG_HEAD" ? (
                    <div className="flex items-center gap-4">
                      <div className="w-13 h-13 rounded-[18px] bg-[#66AEE6] text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-6 h-6 fill-current"
                        >
                          <path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-[22px] font-extrabold text-slate-900 tracking-tight leading-tight">
                          조직장
                        </h3>
                        <p className="text-[13px] text-slate-400 mt-1">
                          조직장에게만 적용되는 권한을 설정할 수 있어요.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className="w-13 h-13 rounded-[18px] bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 shadow-2xs">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-6 h-6 fill-current"
                        >
                          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-[22px] font-extrabold text-slate-900 tracking-tight leading-tight">
                          기본 권한
                        </h3>
                        <p className="text-[13px] text-slate-400 mt-1">
                          모든 구성원에게 기본으로 적용되는 권한을 설정할 수 있어요.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 검색창 + 가로 스크롤 카테고리 탭 바 (Flex 스타일) */}
                  <div className="sticky -top-7 bg-white pt-2 pb-0 z-20 space-y-3 border-b border-slate-100">
                    <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 focus-within:border-[#00c458] flex items-center gap-2.5 bg-white transition-colors">
                      <svg
                        viewBox="0 0 24 24"
                        className="w-4 h-4 text-slate-400 shrink-0 fill-none stroke-current"
                        strokeWidth={2}
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                      </svg>
                      <input
                        value={permKeyword}
                        onChange={(e) => setPermKeyword(e.target.value)}
                        placeholder="검색"
                        className="w-full text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div
                        ref={catTabsScrollRef}
                        className="flex-1 flex items-center gap-5 overflow-x-auto no-scrollbar"
                      >
                        {PERMISSION_CATEGORIES.map((cat) => {
                          const isActive = activeCatId === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => scrollToCategory(cat.id)}
                              className={`pb-3 text-[13px] whitespace-nowrap border-b-2 transition-colors ${
                                isActive
                                  ? "border-slate-900 text-slate-900 font-extrabold"
                                  : "border-transparent text-slate-400 hover:text-slate-700 font-bold"
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
                        className="mb-1.5 w-6 h-6 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0 bg-white shadow-2xs"
                        title="다음 카테고리 보기"
                      >
                        ›
                      </button>
                    </div>
                  </div>

                  {/* 카테고리별 권한 체크리스트 */}
                  <div className="space-y-9 pb-48">
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
                          className="space-y-2 scroll-mt-32"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                            <h4 className="text-[16px] font-extrabold text-slate-900">
                              {cat.label}
                            </h4>
                            {cat.id === "cat-sidebar-menu" && canEdit && (
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("ALL_ON")
                                  }
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  전체 켜기
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("BASIC_ONLY")
                                  }
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  사원 기본값
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAllSidebarMenusInMatrix("ALL_OFF")
                                  }
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
                                >
                                  전체 끄기
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="divide-y divide-slate-100">
                            {visibleItems.map((item) => {
                              const checked = Boolean(activePerms[item.key]);
                              const scopeOptions =
                                getAllowedScopeOptionsForItem(item);
                              const isLockedFull = Boolean(
                                item.scopeMode === "LOCKED_FULL" ||
                                  item.lockedFullScope
                              );
                              const curScope = normalizePermissionScope(
                                activeScopes[item.key],
                                item
                              );
                              const missingPrereqs = checked
                                ? getMissingPrerequisitesForPerm(
                                    item.key,
                                    activePerms,
                                    activeScopes
                                  )
                                : [];
                              const hasMissingPrereq =
                                missingPrereqs.length > 0;

                              return (
                                <div
                                  key={item.key}
                                  className="py-4 flex items-center justify-between gap-4 relative"
                                >
                                  <div className="min-w-0">
                                    <div className="text-[13px] font-extrabold text-slate-800">
                                      {item.title}
                                    </div>
                                    <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
                                      {item.description}
                                    </p>
                                    {item.warningText && (
                                      <p className="text-[11.5px] text-[#ff4d37] font-bold mt-1">
                                        {item.warningText}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2.5 shrink-0 relative">
                                    {/* 상위(필수) 권한 누락 알림 배지 + 팝오버 */}
                                    {hasMissingPrereq && (
                                      <>
                                        <div
                                          className="relative"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOpenScopePermKey(null);
                                              setOpenPrereqPermKey(
                                                openPrereqPermKey === item.key
                                                  ? null
                                                  : item.key
                                              );
                                            }}
                                            className="px-2.5 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-extrabold flex items-center gap-1 transition-colors"
                                          >
                                            <span className="text-[10px]">
                                              ▲
                                            </span>
                                            <span>추가 권한 필요</span>
                                          </button>

                                          {openPrereqPermKey === item.key && (
                                            <div className="absolute right-0 top-full mt-2 w-[330px] sm:w-[390px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden">
                                              <div className="px-4 py-3 border-b border-slate-100 font-extrabold text-xs text-slate-700">
                                                추가로 필요한 권한
                                              </div>

                                              <div className="divide-y divide-slate-100 max-h-[260px] overflow-y-auto custom-scroll">
                                                {missingPrereqs.map((mp) => (
                                                  <div
                                                    key={mp.permKey}
                                                    className="px-4 py-3.5 flex items-center justify-between gap-3"
                                                  >
                                                    <div className="min-w-0">
                                                      <div className="text-xs font-extrabold text-slate-800">
                                                        {mp.title}
                                                      </div>
                                                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                                                        {mp.description}
                                                      </p>
                                                    </div>
                                                    {mp.hasScopeDisplay &&
                                                      mp.requiredScope && (
                                                        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 shrink-0 whitespace-nowrap">
                                                          <span>
                                                            {mp.requiredScope}
                                                          </span>
                                                          <span className="text-[9px] text-slate-400">
                                                            ▾
                                                          </span>
                                                        </span>
                                                      )}
                                                  </div>
                                                ))}
                                              </div>

                                              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    setOpenPrereqPermKey(null)
                                                  }
                                                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                                                >
                                                  닫기
                                                </button>
                                                {canEdit && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      applyPrereqsForPermKeys([
                                                        item.key,
                                                      ])
                                                    }
                                                    className="px-3.5 py-1.5 rounded-xl bg-[#00b843] hover:bg-[#00a33b] text-white text-xs font-extrabold shadow-2xs"
                                                  >
                                                    적용하기
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        <span className="w-px h-3.5 bg-slate-200" />
                                      </>
                                    )}

                                    {/* 세분화된 대상 범위 드롭다운 (6종 / 5종 / 2종) */}
                                    {scopeOptions.length > 0 && (
                                      <div
                                        className="relative"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          disabled={!canEdit}
                                          onClick={() => {
                                            setOpenPrereqPermKey(null);
                                            setOpenScopePermKey(
                                              openScopePermKey === item.key
                                                ? null
                                                : item.key
                                            );
                                          }}
                                          className="px-2 py-1 rounded-lg hover:bg-slate-100 text-[11px] font-bold text-slate-700 hover:text-slate-900 flex items-center gap-1 transition-colors disabled:opacity-60"
                                        >
                                          <span>{curScope}</span>
                                          <span className="text-[9px] text-slate-400">
                                            ▾
                                          </span>
                                        </button>

                                        {openScopePermKey === item.key && (
                                          <div className="absolute right-0 top-full mt-1.5 w-[310px] sm:w-[345px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-1.5 z-50">
                                            {scopeOptions.map((opt) => {
                                              const selected =
                                                curScope === opt.value;
                                              return (
                                                <button
                                                  key={opt.value}
                                                  type="button"
                                                  onClick={() =>
                                                    setMatrixScope(
                                                      item.key,
                                                      opt.value
                                                    )
                                                  }
                                                  className={`w-full px-3 py-2.5 rounded-xl text-left flex items-start gap-2.5 transition-colors ${
                                                    selected
                                                      ? "bg-slate-100/90"
                                                      : "hover:bg-slate-50"
                                                  }`}
                                                >
                                                  <span className="w-4 text-[#00c458] font-extrabold text-xs leading-5 shrink-0">
                                                    {selected ? "✓" : ""}
                                                  </span>
                                                  <div className="min-w-0">
                                                    <div className="text-xs font-extrabold text-slate-800">
                                                      {opt.label}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                                      {opt.description}
                                                    </div>
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* 전체 구성원 고정 관리 권한 안내 드롭다운 */}
                                    {isLockedFull && (
                                      <div
                                        className="relative"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenPrereqPermKey(null);
                                            setOpenScopePermKey(
                                              openScopePermKey === item.key
                                                ? null
                                                : item.key
                                            );
                                          }}
                                          className="px-2 py-1 rounded-lg hover:bg-slate-50 text-[11px] text-slate-400 font-semibold flex items-center gap-1 transition-colors"
                                          title="전체 구성원 대상으로만 부여되는 관리 권한입니다."
                                        >
                                          <span>전체 구성원</span>
                                          <span className="text-[9px]">▾</span>
                                        </button>

                                        {openScopePermKey === item.key && (
                                          <div className="absolute right-0 top-full mt-1.5 w-[290px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 z-50">
                                            <div className="px-3 py-2.5 rounded-xl bg-slate-50 flex items-start gap-2.5">
                                              <span className="w-4 text-[#00c458] font-extrabold text-xs leading-5 shrink-0">
                                                ✓
                                              </span>
                                              <div>
                                                <div className="text-xs font-extrabold text-slate-800">
                                                  전체 구성원 (고정)
                                                </div>
                                                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                                  이 관리 권한은 회사 전체 구성원을 대상으로만 설정할 수 있어요.
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Flex 스타일 커스텀 체크박스 */}
                                    <button
                                      type="button"
                                      role="checkbox"
                                      aria-checked={checked}
                                      disabled={!canEdit}
                                      onClick={() =>
                                        toggleMatrixPermission(item.key)
                                      }
                                      className={`w-5 h-5 rounded-[6px] border flex items-center justify-center transition-colors shrink-0 disabled:opacity-50 ${
                                        checked
                                          ? hasMissingPrereq
                                            ? "bg-rose-500 border-rose-500 text-white"
                                            : "bg-[#52d068] border-[#52d068] text-white"
                                          : "bg-white border-slate-300 hover:border-slate-400"
                                      }`}
                                    >
                                      {checked && (
                                        <svg
                                          viewBox="0 0 16 16"
                                          className="w-3.5 h-3.5 fill-none stroke-current"
                                          strokeWidth={2.5}
                                        >
                                          <path
                                            d="M3.5 8.2L6.6 11.3L12.5 4.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      )}
                                    </button>
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

                {/* 하단 페이드 그라데이션 + 저장 버튼 (Flex 스타일) */}
                {canEdit && (
                  <div className="relative shrink-0 bg-white px-8 pb-5 pt-2">
                    <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-white to-transparent" />
                    <div className="space-y-2">
                      {unresolvedMatrixPermKeys.length > 0 && (
                        <div className="px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-rose-700">
                            ⚠️ 상위(필수) 권한이 필요한 항목이{" "}
                            <b>{unresolvedMatrixPermKeys.length}건</b> 있습니다.
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              applyPrereqsForPermKeys(unresolvedMatrixPermKeys)
                            }
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold shrink-0"
                          >
                            필요한 상위 권한 일괄 적용
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleSaveMatrixModal}
                        className={`w-full py-3.5 rounded-xl text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all ${
                          unresolvedMatrixPermKeys.length > 0
                            ? "bg-gradient-to-r from-[#ff6b00] to-[#ec4899] hover:opacity-95"
                            : "bg-gradient-to-r from-[#00c73c] to-[#00c49a] hover:opacity-95"
                        }`}
                      >
                        저장
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 우측 권한 그룹 구성원 사이드바 (최고 관리자 · 커스텀 그룹: + 추가하기 및 구성원 목록 / 조직장 · 기본 권한: Flex 안내 카드) */}
              {showRightMemberPane && (
                <aside
                  onClick={(e) => {
                    e.stopPropagation();
                    if (memberPickerOpen) setMemberPickerOpen(false);
                  }}
                  className="w-[252px] sm:w-[276px] border-l border-slate-100 p-6 flex flex-col shrink-0 bg-white relative"
                >
                  {matrixState.kind === "SUPER_ADMIN" ||
                  matrixState.kind === "CUSTOM" ? (
                    (() => {
                      const groupMemberNames =
                        matrixState.kind === "SUPER_ADMIN"
                          ? matrixState.member_names
                          : matrixState.group.member_names;

                      const toggleGroupMember = (name: string) => {
                        const exists = groupMemberNames.includes(name);
                        if (
                          exists &&
                          matrixState.kind === "SUPER_ADMIN" &&
                          groupMemberNames.length <= 1
                        ) {
                          alert(
                            "최소 1명 이상의 최고 관리자가 지정되어야 합니다."
                          );
                          return;
                        }
                        const nextNames = exists
                          ? groupMemberNames.filter((x) => x !== name)
                          : [...groupMemberNames, name];

                        if (matrixState.kind === "SUPER_ADMIN") {
                          setMatrixState({
                            ...matrixState,
                            member_names: nextNames,
                          });
                        } else {
                          setMatrixState({
                            ...matrixState,
                            group: {
                              ...matrixState.group,
                              member_names: nextNames,
                            },
                          });
                        }
                      };

                      return (
                        <>
                          <div>
                            <div className="text-[13px] font-extrabold text-slate-800">
                              권한 그룹 구성원{" "}
                              <span className="text-[#00c458] ml-0.5">
                                {groupMemberNames.length}
                              </span>
                            </div>
                            <p className="text-[11.5px] text-slate-400 mt-1">
                              그룹에 포함할 구성원을 추가해 주세요.
                            </p>
                          </div>

                          <div className="border-t border-slate-100 my-4" />

                          {canEdit && (
                            <div
                              className="relative mb-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => setMemberPickerOpen((p) => !p)}
                                className="inline-flex items-center gap-2 py-1 text-[13px] font-bold text-slate-500 hover:text-slate-900 transition-colors"
                              >
                                <span className="text-base leading-none text-slate-400 font-normal">
                                  +
                                </span>
                                <span>추가하기</span>
                              </button>

                              {memberPickerOpen && (
                                <div className="absolute left-0 top-full mt-2 w-[232px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2.5 z-50">
                                  <input
                                    autoFocus
                                    value={memberPickerQuery}
                                    onChange={(e) =>
                                      setMemberPickerQuery(e.target.value)
                                    }
                                    placeholder="🔍 이름 · 부서 검색"
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#00c458] text-[11px] focus:outline-none mb-2"
                                  />
                                  <div className="max-h-[240px] overflow-y-auto custom-scroll space-y-0.5">
                                    {directoryPeople
                                      .filter(
                                        (p) =>
                                          !memberPickerQuery.trim() ||
                                          p.name.includes(
                                            memberPickerQuery.trim()
                                          ) ||
                                          p.jobOrDept.includes(
                                            memberPickerQuery.trim()
                                          )
                                      )
                                      .map((p) => {
                                        const exists =
                                          groupMemberNames.includes(p.name);
                                        return (
                                          <button
                                            key={p.key}
                                            type="button"
                                            onClick={() =>
                                              toggleGroupMember(p.name)
                                            }
                                            className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left ${
                                              exists
                                                ? "bg-emerald-50"
                                                : "hover:bg-slate-50"
                                            }`}
                                          >
                                            <span className="flex items-center gap-2 min-w-0">
                                              <span
                                                style={{
                                                  backgroundColor: colorForName(
                                                    p.name
                                                  ),
                                                }}
                                                className="w-6 h-6 rounded-lg text-white text-[9.5px] font-extrabold flex items-center justify-center shrink-0"
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

                          <div className="flex-1 overflow-y-auto custom-scroll space-y-2.5">
                            {groupMemberNames.map((nm) => {
                              const info = directoryPeople.find(
                                (d) => d.name === nm
                              );
                              const deptLabel = info?.jobOrDept
                                ? info.jobOrDept.split(" · ")[0]
                                : "";
                              return (
                                <div
                                  key={nm}
                                  className="group py-1 flex items-center justify-between gap-2"
                                >
                                  <span className="flex items-center gap-3 min-w-0">
                                    <span
                                      style={{
                                        backgroundColor: colorForName(nm),
                                      }}
                                      className="w-8 h-8 rounded-[11px] text-white text-[10.5px] font-extrabold flex items-center justify-center shrink-0"
                                    >
                                      {shortAvatarText(nm)}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-[13px] font-bold text-slate-800 truncate leading-tight">
                                        {nm}
                                      </span>
                                      {deptLabel && (
                                        <span className="block text-[11px] text-slate-400 truncate mt-0.5 leading-tight">
                                          {deptLabel}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => toggleGroupMember(nm)}
                                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 font-bold px-1 transition-opacity"
                                      title="그룹에서 제외"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="flex-1 flex flex-col min-h-0 space-y-4">
                      <div className="text-[13px] font-extrabold text-slate-800">
                        권한 그룹 구성원
                      </div>

                      <div className="rounded-2xl bg-[#f3f8fd] px-5 py-6 space-y-3.5 text-xs">
                        <div className="flex flex-col items-center text-center">
                          <div className="text-[#4da1f7]">
                            <svg
                              viewBox="0 0 24 24"
                              className="w-6 h-6 fill-current"
                            >
                              <path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z" />
                            </svg>
                          </div>
                          <div className="text-[15px] font-extrabold text-[#1d6ce0] mt-2">
                            {matrixState.kind === "ORG_HEAD"
                              ? "조직장"
                              : "기본 권한"}
                          </div>
                          <div className="text-[11.5px] font-semibold text-[#3576d0] mt-1">
                            아래와 같은 주의사항이 있어요.
                          </div>
                        </div>

                        <div className="border-t border-[#ddeaf7]" />

                        <ul className="list-disc pl-4 space-y-2.5 text-[11.5px] text-[#2864b8] leading-relaxed">
                          <li>
                            내용을 저장하면{" "}
                            {matrixState.kind === "ORG_HEAD"
                              ? "조직장에게 "
                              : "모든 구성원에게 "}
                            <b className="font-extrabold">
                              즉시 권한이 활성화되니 설정 시 주의가 필요해요.
                            </b>
                          </li>
                          <li>
                            권한이 잘못 설정되면 의도치 않은 정보 열람 및 관리 기능 접근이 가능해질 수 있어요.
                          </li>
                        </ul>
                      </div>

                      <div className="flex-1 flex flex-col min-h-0 pt-1">
                        <div className="text-xs font-extrabold text-slate-700 mb-2">
                          자동 적용 대상{" "}
                          <span className="text-[#00c458]">
                            {matrixState.kind === "DEFAULT_MEMBER"
                              ? directoryPeople.length
                              : directoryPeople.filter((p) => p.isDeptHead)
                                  .length}
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scroll space-y-2">
                          {(matrixState.kind === "DEFAULT_MEMBER"
                            ? directoryPeople
                            : directoryPeople.filter((p) => p.isDeptHead)
                          ).map((p) => (
                            <div
                              key={p.key}
                              className="py-1 flex items-center gap-2.5"
                            >
                              <span
                                style={{
                                  backgroundColor: colorForName(p.name),
                                }}
                                className="w-7 h-7 rounded-[10px] text-white text-[9.5px] font-extrabold flex items-center justify-center shrink-0"
                              >
                                {shortAvatarText(p.name)}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-bold text-slate-800 truncate">
                                  {p.name}
                                </span>
                                {p.jobOrDept && (
                                  <span className="block text-[10.5px] text-slate-400 truncate">
                                    {p.jobOrDept}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
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

            {/* 서브 탭: 좌측 메뉴 ON/OFF | 근무 권한 | 소속 권한 그룹 */}
            <div className="px-6 pt-3 shrink-0">
              <div className="grid grid-cols-3 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => setMemberModalTab("MENUS")}
                  className={`py-1.5 rounded-lg font-bold transition-all ${
                    memberModalTab === "MENUS"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  좌측 메뉴 ON/OFF
                </button>
                <button
                  type="button"
                  onClick={() => setMemberModalTab("WORK")}
                  className={`py-1.5 rounded-lg font-bold transition-all ${
                    memberModalTab === "WORK"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  근무 열람 · 편집
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
                  권한 그룹 ({memberAssignedGroupIds.length})
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto custom-scroll space-y-3 flex-1">
              {memberModalTab === "WORK" ? (
                <>
                  {memberIsSuperDraft ? (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
                      👑 현재 <strong>최고 관리자</strong>로 지정되어 전체 구성원 근무 조회·편집이 허용됩니다.
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 leading-relaxed">
                      이 구성원에게 적용되는 <strong>근무 조회 · 근무 편집</strong> 권한과 허용 조직 범위를 개별 오버라이드할 수 있습니다.
                    </div>
                  )}

                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {(
                      PERMISSION_CATEGORIES.find((c) => c.id === "cat-work")
                        ?.items || []
                    ).map((wItem) => {
                      const inherited = Boolean(draftMemberInherited[wItem.key]);
                      const hasOverride =
                        memberOverridesDraft[wItem.key] !== undefined;
                      const effective = hasOverride
                        ? Boolean(memberOverridesDraft[wItem.key])
                        : inherited;
                      const scopeOpts = getAllowedScopeOptionsForItem(wItem);
                      const curScope = normalizePermissionScope(
                        memberScopeOverridesDraft[wItem.key] ||
                          (memberIsSuperDraft
                            ? permSettings.super_admin_scopes?.[wItem.key] || "전체 구성원"
                            : permSettings.default_member_scopes?.[wItem.key]),
                        wItem
                      );

                      return (
                        <div
                          key={wItem.key}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 flex items-center gap-1.5">
                              <span>{wItem.title}</span>
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
                            <div className="text-[10.5px] text-slate-400 mt-0.5">
                              {wItem.description}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {scopeOpts.length > 0 && (
                              <select
                                disabled={!canEdit}
                                value={curScope}
                                onChange={(e) =>
                                  setMemberScopeOverridesDraft((prev) => ({
                                    ...prev,
                                    [wItem.key]:
                                      e.target.value as HqPermissionScope,
                                  }))
                                }
                                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 outline-none"
                              >
                                {scopeOpts.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            )}

                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                handleToggleMemberMenuSwitch(wItem.key)
                              }
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
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : memberModalTab === "MENUS" ? (
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
                        memberOverridesDraft[item.permKey] !== undefined;
                      const effective = hasOverride
                        ? Boolean(memberOverridesDraft[item.permKey])
                        : inherited;

                      return (
                        <div
                          key={item.permKey}
                          onClick={() =>
                            handleToggleMemberMenuSwitch(item.permKey)
                          }
                          className={`px-4 py-2.5 flex items-center justify-between gap-3 ${
                            !canEdit
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
                            disabled={!canEdit}
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
