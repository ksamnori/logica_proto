// src/components/hq/members/HqMemberHrChangeModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useOptionalHqShell } from "@/components/hq/HqShellContext";
import HqOrgChartSettingsModal from "@/components/hq/org-chart/HqOrgChartSettingsModal";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import {
  buildFlatOrgTreeOptions,
  inferRankCodeFromHrSelection,
} from "@/lib/hq/orgTreeHelper";
import type {
  HqMember,
  HqMemberOrgAssignment,
  HqOrgChartNode,
} from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  member: HqMember;
  onClose: () => void;
  onSaved: () => void;
}

const APPOINTMENT_LABELS = [
  "부서 이동 (전보)",
  "승진",
  "직책 변경",
  "직무 변경",
  "수습 종료",
  "신규 배정",
];

function makeAsgId(): string {
  return `asg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function HqMemberHrChangeModal({
  isOpen,
  member,
  onClose,
  onSaved,
}: Props) {
  const shell = useOptionalHqShell();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const companySettings = shell?.companySettings;
  const ex = companySettings?.extra_settings;

  const hrJobs = useMemo(
    () =>
      ex?.hr_jobs && ex.hr_jobs.length > 0
        ? ex.hr_jobs
        : [
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
          ],
    [ex?.hr_jobs]
  );

  const hrPositions = useMemo(
    () =>
      ex?.hr_positions && ex.hr_positions.length > 0
        ? ex.hr_positions
        : ["대표", "사원", "실장", "팀장"],
    [ex?.hr_positions]
  );

  const hrTitles = useMemo(
    () =>
      ex?.hr_titles && ex.hr_titles.length > 0
        ? ex.hr_titles
        : ["사원", "실장", "총괄", "팀장"],
    [ex?.hr_titles]
  );

  const hrJobGroups = useMemo(() => ex?.hr_job_groups || [], [ex?.hr_job_groups]);
  const hrGrades = useMemo(() => ex?.hr_grades || [], [ex?.hr_grades]);

  const orgNodes = useMemo(
    () =>
      ex?.org_chart_nodes && ex.org_chart_nodes.length > 0
        ? ex.org_chart_nodes
        : DEFAULT_ORG_CHART_NODES,
    [ex?.org_chart_nodes]
  );

  // 트리 드롭다운용 조직 목록 (조직도 설정과 100% 동일한 계층 트리)
  const treeOrgOptions = useMemo(
    () =>
      buildFlatOrgTreeOptions(orgNodes, shell?.members || [], {
        includeHiddenSystemNodes: false,
        excludeRetired: true,
      }),
    [orgNodes, shell?.members]
  );

  // 상단 적용일 / 발령 라벨 / 메모 상태
  const [effectiveDate, setEffectiveDate] = useState(todayIso);
  const [dateOpen, setDateOpen] = useState(false);
  const [appointLabel, setAppointLabel] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [memoOpen, setMemoOpen] = useState(false);

  // 2x2 인사 마스터 상태 (직무 / 직군 / 직위 / 직급)
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [jobGroup, setJobGroup] = useState("");
  const [position, setPosition] = useState("");
  const [grade, setGrade] = useState("");

  // 하단 조직 · 직책 배열 (0번 인덱스 = 주조직)
  const [orgRows, setOrgRows] = useState<HqMemberOrgAssignment[]>([]);

  // 열린 커스텀 드롭다운 팝오버 제어
  const [openDropdown, setOpenDropdown] = useState<
    | null
    | "JOBS"
    | "POSITION"
    | { kind: "ORG"; idx: number }
    | { kind: "TITLE"; idx: number }
  >(null);
  const [dropdownSearch, setDropdownSearch] = useState("");

  // 드롭다운 내 ⚙ 클릭 시 바로 조직도 설정 모달 오픈 지원
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [savingOrgSettings, setSavingOrgSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const mex = member.profile_extra || {};
    setEffectiveDate(todayIso);
    setDateOpen(false);
    setAppointLabel("");
    setLabelOpen(false);
    setMemo("");
    setMemoOpen(false);
    setOpenDropdown(null);
    setDropdownSearch("");

    // 직무 초기값 복원
    const initJobs =
      mex.hr_jobs_selected && mex.hr_jobs_selected.length > 0
        ? mex.hr_jobs_selected
        : member.job_description
          ? member.job_description
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
    setSelectedJobs(initJobs);
    setJobGroup(mex.hr_job_group || "");
    setPosition(
      mex.hr_position ||
        (hrPositions.includes(member.job_title) ? member.job_title : "")
    );
    setGrade(mex.hr_grade || "");

    // 조직 · 직책 초기값 복원 (조직도에 등록된 실제 조직 기준으로 정렬)
    const defaultOrg =
      treeOrgOptions.find((o) => o.name === member.department)?.name ||
      treeOrgOptions.find((o) => o.name !== "대표")?.name ||
      treeOrgOptions[0]?.name ||
      "집필팀";

    if (mex.org_assignments && mex.org_assignments.length > 0) {
      setOrgRows(
        mex.org_assignments.map((r, i) => ({
          ...r,
          id: r.id || makeAsgId(),
          is_primary: i === 0,
        }))
      );
    } else {
      setOrgRows([
        {
          id: makeAsgId(),
          org_name: defaultOrg,
          is_primary: true,
          is_leader: Boolean(member.is_dept_head),
          title: hrTitles.includes(member.job_title) ? member.job_title : "",
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, member.instructor_id]);

  if (!isOpen) return null;

  const koreanTodayLabel = (() => {
    const [y, m, d] = effectiveDate.split("-");
    if (!y || !m || !d) return effectiveDate;
    return `${Number(y)}년 ${Number(m)}월 ${Number(d)}일 조직`;
  })();

  const handlePromoteRowToPrimary = (idx: number) => {
    if (idx <= 0) return;
    setOrgRows((prev) => {
      const target = prev[idx];
      const rest = prev.filter((_, i) => i !== idx);
      return [target, ...rest].map((r, i) => ({ ...r, is_primary: i === 0 }));
    });
  };

  const handleAddOrgRow = () => {
    const usedNames = new Set(orgRows.map((r) => r.org_name));
    const fallbackOrg =
      treeOrgOptions.find((o) => !usedNames.has(o.name) && o.name !== "대표")
        ?.name ||
      treeOrgOptions[0]?.name ||
      "집필팀";

    setOrgRows((prev) => [
      ...prev,
      {
        id: makeAsgId(),
        org_name: fallbackOrg,
        is_primary: prev.length === 0,
        is_leader: false,
        title: "",
      },
    ]);
  };

  const handleRemoveOrgRow = (idx: number) => {
    if (orgRows.length <= 1) {
      alert("최소 1개의 주조직은 지정되어야 합니다.");
      return;
    }
    setOrgRows((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((r, i) => ({ ...r, is_primary: i === 0 }))
    );
  };

  const handleSaveOrgChartQuick = async (payload: {
    nodes: HqOrgChartNode[];
    effectiveDate: string;
    memo: string;
    renameMap: Record<string, string>;
  }) => {
    if (!companySettings) return;
    setSavingOrgSettings(true);
    try {
      await hqFetch("/api/hq/settings", {
        method: "PATCH",
        body: {
          extra_settings: {
            ...companySettings.extra_settings,
            org_chart_nodes: payload.nodes,
            org_chart_effective_date: payload.effectiveDate,
            org_chart_memo: payload.memo,
          },
          org_rename_map: payload.renameMap,
        },
      });
      await Promise.all([
        shell?.refreshCompanySettings(),
        shell?.refreshMembers(),
      ]);
      setOrgSettingsOpen(false);
    } catch (e: any) {
      alert(e?.message || "조직도 설정 저장 실패");
    } finally {
      setSavingOrgSettings(false);
    }
  };

  const handleSubmit = async () => {
    const normalizedRows = orgRows.map((r, idx) => ({
      ...r,
      is_primary: idx === 0,
    }));
    const primary = normalizedRows[0];
    if (!primary || !primary.org_name) {
      alert("주조직을 선택해 주세요.");
      return;
    }

    const displayJobTitle =
      primary.title.trim() || position.trim() || member.job_title || "사원";
    const inferredRank = inferRankCodeFromHrSelection({
      orgName: primary.org_name,
      position,
      title: primary.title,
      isLeader: primary.is_leader,
      fallbackRank: member.rank_code,
    });

    const jobText = selectedJobs.join(", ");
    const summaryParts = [`주조직: ${primary.org_name}`];
    if (primary.title) summaryParts.push(`직책: ${primary.title}`);
    if (position) summaryParts.push(`직위: ${position}`);
    if (appointLabel) summaryParts.unshift(`[${appointLabel}]`);

    setSaving(true);
    try {
      await hqFetch("/api/hq/members", {
        method: "PATCH",
        body: {
          instructor_id: member.instructor_id,
          department: primary.org_name,
          job_title: displayJobTitle,
          is_dept_head: primary.is_leader,
          rank_code: inferredRank,
          job_description: jobText,
          change_summary: `인사 정보 변경 (${summaryParts.join(" · ")})`,
          profile_extra: {
            hr_effective_date: effectiveDate,
            hr_appointment_label: appointLabel,
            hr_appointment_memo: memo.trim(),
            hr_jobs_selected: selectedJobs,
            hr_job_group: jobGroup,
            hr_position: position,
            hr_grade: grade,
            org_assignments: normalizedRows,
          },
        },
      });

      onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "인사 정보 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const isDropdown = (target: typeof openDropdown) =>
    JSON.stringify(openDropdown) === JSON.stringify(target);

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/45 z-[65] flex items-center justify-center p-4"
        onClick={() => setOpenDropdown(null)}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="bg-white w-full max-w-[600px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-visible text-xs"
        >
          {/* 1. 헤더 + 적용일 / 발령 라벨 / 메모 (Screenshot 4) */}
          <div className="px-6 pt-5 pb-3 flex items-center justify-between">
            <h4 className="text-[15px] font-extrabold text-slate-900">
              인사 정보 변경하기
            </h4>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-base font-bold"
            >
              ✕
            </button>
          </div>

          <div className="px-6 pb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDateOpen((p) => !p)}
                className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-600 text-[11px] font-extrabold"
              >
                적용일 {effectiveDate === todayIso ? "오늘" : effectiveDate}
              </button>
              <button
                type="button"
                onClick={() => setLabelOpen((p) => !p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  appointLabel
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {appointLabel ? `라벨: ${appointLabel}` : "발령 라벨"}
              </button>
              <button
                type="button"
                onClick={() => setMemoOpen((p) => !p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  memo
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                메모{memo ? " ✓" : ""}
              </button>
            </div>

            {dateOpen && (
              <div className="flex items-center gap-2 pt-1">
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

            {labelOpen && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {APPOINTMENT_LABELS.map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => {
                      setAppointLabel(appointLabel === lbl ? "" : lbl);
                      setLabelOpen(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                      appointLabel === lbl
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            {memoOpen && (
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="인사 변경 사유 또는 메모를 입력해 주세요."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none"
              />
            )}
          </div>

          {/* 2. 본문: 2x2 인사 체계 그리드 + 조직·직책 (Screenshots 4, 5, 6, 7) */}
          <div className="px-6 py-2 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* (1) 직무 (다중 선택) */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                  직무
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDropdownSearch("");
                    setOpenDropdown(isDropdown("JOBS") ? null : "JOBS");
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 flex items-center justify-between text-left"
                >
                  <span
                    className={`truncate font-bold ${
                      selectedJobs.length > 0
                        ? "text-slate-900"
                        : "text-slate-400 font-medium"
                    }`}
                  >
                    {selectedJobs.length > 0
                      ? selectedJobs.join(", ")
                      : "직무 선택"}
                  </span>
                  <span className="text-slate-400 text-[10px] ml-2">▾</span>
                </button>

                {isDropdown("JOBS") && (
                  <div className="absolute left-0 top-full mt-1.5 z-40 w-full rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={dropdownSearch}
                        onChange={(e) => setDropdownSearch(e.target.value)}
                        placeholder="🔍 검색"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs focus:outline-none"
                      />
                      {shell?.openSettingsModal && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenDropdown(null);
                            shell.openSettingsModal("hr-info");
                          }}
                          title="직무 설정"
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                        >
                          ⚙
                        </button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scroll">
                      {hrJobs
                        .filter(
                          (j) =>
                            !dropdownSearch.trim() ||
                            j
                              .toLowerCase()
                              .includes(dropdownSearch.trim().toLowerCase())
                        )
                        .map((job) => {
                          const checked = selectedJobs.includes(job);
                          return (
                            <button
                              key={job}
                              type="button"
                              onClick={() =>
                                setSelectedJobs((prev) =>
                                  checked
                                    ? prev.filter((x) => x !== job)
                                    : [...prev, job]
                                )
                              }
                              className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                            >
                              <span>{job}</span>
                              {checked && (
                                <span className="text-[#00c458]">✓</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* (2) 직군 */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                  직군
                </label>
                <select
                  value={jobGroup}
                  onChange={(e) => setJobGroup(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 font-bold focus:outline-none ${
                    jobGroup ? "text-slate-900" : "text-slate-400 font-medium"
                  }`}
                >
                  <option value="">직군 선택</option>
                  {hrJobGroups.map((jg) => (
                    <option key={jg.id} value={jg.name}>
                      {jg.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* (3) 직위 (Screenshot 5) */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                  직위
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDropdownSearch("");
                    setOpenDropdown(isDropdown("POSITION") ? null : "POSITION");
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 flex items-center justify-between text-left"
                >
                  <span
                    className={
                      position
                        ? "font-bold text-slate-900"
                        : "text-slate-400 font-medium"
                    }
                  >
                    {position || "직위 선택"}
                  </span>
                  <span className="text-slate-400 text-[10px]">▾</span>
                </button>

                {isDropdown("POSITION") && (
                  <div className="absolute left-0 top-full mt-1.5 z-40 w-56 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={dropdownSearch}
                        onChange={(e) => setDropdownSearch(e.target.value)}
                        placeholder="🔍 검색"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs focus:outline-none"
                      />
                      {shell?.openSettingsModal && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenDropdown(null);
                            shell.openSettingsModal("hr-info");
                          }}
                          title="직위 설정"
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                        >
                          ⚙
                        </button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scroll">
                      <button
                        type="button"
                        onClick={() => {
                          setPosition("");
                          setOpenDropdown(null);
                        }}
                        className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-400 font-semibold"
                      >
                        <span>직위 없음</span>
                        {!position && <span className="text-[#00c458]">✓</span>}
                      </button>
                      {hrPositions
                        .filter(
                          (p) =>
                            !dropdownSearch.trim() ||
                            p
                              .toLowerCase()
                              .includes(dropdownSearch.trim().toLowerCase())
                        )
                        .map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => {
                              setPosition(pos);
                              setOpenDropdown(null);
                            }}
                            className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                          >
                            <span>{pos}</span>
                            {position === pos && (
                              <span className="text-[#00c458]">✓</span>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* (4) 직급 */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                  직급
                </label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 font-bold focus:outline-none ${
                    grade ? "text-slate-900" : "text-slate-400 font-medium"
                  }`}
                >
                  <option value="">직급 선택</option>
                  {hrGrades.map((gr) => (
                    <option key={gr.id} value={gr.name}>
                      {gr.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 3. 조직 · 직책 섹션 (Screenshots 4, 6, 7) */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-extrabold text-slate-800">
                    조직 · 직책
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    최상단에 노출되는 조직이 주조직으로 설정돼요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddOrgRow}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                >
                  조직 추가
                </button>
              </div>

              <div className="space-y-2.5">
                {orgRows.map((row, idx) => {
                  const orgDropOpen = isDropdown({ kind: "ORG", idx });
                  const titleDropOpen = isDropdown({ kind: "TITLE", idx });

                  return (
                    <div
                      key={row.id}
                      className="flex flex-wrap sm:flex-nowrap items-center gap-2 relative"
                    >
                      {/* 순서 이동 핸들 (클릭 시 주조직으로 승격) */}
                      <button
                        type="button"
                        onClick={() => handlePromoteRowToPrimary(idx)}
                        title={
                          idx === 0
                            ? "현재 주조직"
                            : "클릭하여 주조직(최상단)으로 변경"
                        }
                        className="text-slate-300 hover:text-slate-600 px-1 font-bold select-none"
                      >
                        ⋮⋮
                      </button>

                      {/* 조직 트리 선택기 (Screenshot 6) */}
                      <div className="relative flex-1 min-w-[180px]">
                        <button
                          type="button"
                          onClick={() => {
                            setDropdownSearch("");
                            setOpenDropdown(
                              orgDropOpen ? null : { kind: "ORG", idx }
                            );
                          }}
                          className="w-full px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {idx === 0 && (
                              <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-bold text-slate-500 shrink-0">
                                주조직
                              </span>
                            )}
                            <span className="font-bold text-slate-900 truncate">
                              {row.org_name}
                            </span>
                          </span>
                          <span className="text-slate-400 text-[10px] shrink-0">
                            ▾
                          </span>
                        </button>

                        {orgDropOpen && (
                          <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                value={dropdownSearch}
                                onChange={(e) =>
                                  setDropdownSearch(e.target.value)
                                }
                                placeholder="🔍 검색"
                                className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#00c458] text-xs focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenDropdown(null);
                                  setOrgSettingsOpen(true);
                                }}
                                title="조직도 설정 열기"
                                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center"
                              >
                                ⚙
                              </button>
                            </div>

                            <div className="text-[10px] font-extrabold text-orange-500 px-1">
                              {koreanTodayLabel}
                            </div>

                            <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scroll">
                              {treeOrgOptions
                                .filter(
                                  (opt) =>
                                    !dropdownSearch.trim() ||
                                    opt.name
                                      .toLowerCase()
                                      .includes(
                                        dropdownSearch.trim().toLowerCase()
                                      )
                                )
                                .map((opt) => {
                                  const selected = row.org_name === opt.name;
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() => {
                                        setOrgRows((prev) =>
                                          prev.map((r, i) =>
                                            i === idx
                                              ? { ...r, org_name: opt.name }
                                              : r
                                          )
                                        );
                                        setOpenDropdown(null);
                                      }}
                                      style={{
                                        paddingLeft: `${opt.depth * 14 + 10}px`,
                                      }}
                                      className="w-full pr-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-left"
                                    >
                                      <span className="flex items-center gap-1.5 truncate">
                                        <span className="text-[10px] text-slate-400">
                                          {opt.hasChildren ? "▾" : "•"}
                                        </span>
                                        <span className="font-bold text-slate-800 truncate">
                                          {opt.name}
                                        </span>
                                        {opt.memberCount > 0 && (
                                          <span className="text-[10px] font-bold text-slate-300">
                                            {opt.memberCount}
                                          </span>
                                        )}
                                      </span>
                                      {selected && (
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

                      {/* [ ] 조직장 체크박스 */}
                      <label className="flex items-center gap-1.5 px-2 py-2 cursor-pointer select-none shrink-0">
                        <input
                          type="checkbox"
                          checked={row.is_leader}
                          onChange={(e) =>
                            setOrgRows((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? { ...r, is_leader: e.target.checked }
                                  : r
                              )
                            )
                          }
                          className="w-4 h-4 rounded border-slate-300 accent-[#00c458]"
                        />
                        <span className="font-bold text-slate-700">조직장</span>
                      </label>

                      {/* 직책 선택기 (Screenshot 7) */}
                      <div className="relative w-36 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setDropdownSearch("");
                            setOpenDropdown(
                              titleDropOpen ? null : { kind: "TITLE", idx }
                            );
                          }}
                          className="w-full px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 flex items-center justify-between text-left"
                        >
                          <span
                            className={
                              row.title
                                ? "font-bold text-slate-900 truncate"
                                : "text-slate-400 font-medium"
                            }
                          >
                            {row.title || "직책 선택"}
                          </span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>

                        {titleDropOpen && (
                          <div className="absolute right-0 top-full mt-1.5 z-40 w-48 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2.5 space-y-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                value={dropdownSearch}
                                onChange={(e) =>
                                  setDropdownSearch(e.target.value)
                                }
                                placeholder="🔍 검색"
                                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs focus:outline-none"
                              />
                              {shell?.openSettingsModal && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenDropdown(null);
                                    shell.openSettingsModal("hr-info");
                                  }}
                                  title="직책 설정"
                                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                                >
                                  ⚙
                                </button>
                              )}
                            </div>

                            <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scroll">
                              <button
                                type="button"
                                onClick={() => {
                                  setOrgRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, title: "" } : r
                                    )
                                  );
                                  setOpenDropdown(null);
                                }}
                                className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-400 font-semibold"
                              >
                                <span>직책 없음</span>
                                {!row.title && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                              {hrTitles
                                .filter(
                                  (t) =>
                                    !dropdownSearch.trim() ||
                                    t
                                      .toLowerCase()
                                      .includes(
                                        dropdownSearch.trim().toLowerCase()
                                      )
                                )
                                .map((ttl) => (
                                  <button
                                    key={ttl}
                                    type="button"
                                    onClick={() => {
                                      setOrgRows((prev) =>
                                        prev.map((r, i) =>
                                          i === idx ? { ...r, title: ttl } : r
                                        )
                                      );
                                      setOpenDropdown(null);
                                    }}
                                    className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                                  >
                                    <span>{ttl}</span>
                                    {row.title === ttl && (
                                      <span className="text-[#00c458]">✓</span>
                                    )}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 행 삭제 */}
                      <button
                        type="button"
                        onClick={() => handleRemoveOrgRow(idx)}
                        className="text-slate-300 hover:text-rose-500 px-1 font-bold"
                        title="조직 제외"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. 하단 취소 / 변경 버튼 (Screenshot 4) */}
          <div className="px-6 py-4 mt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-600"
            >
              취소
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold shadow-xs disabled:opacity-50"
            >
              {saving ? "변경 중..." : "변경"}
            </button>
          </div>
        </div>
      </div>

      {/* 조직 드롭다운 내 ⚙ 클릭 시 바로 조직도 설정 모달 실행 */}
      <HqOrgChartSettingsModal
        isOpen={orgSettingsOpen}
        initialNodes={orgNodes}
        initialEffectiveDate={ex?.org_chart_effective_date}
        initialMemo={ex?.org_chart_memo}
        members={shell?.members || []}
        saving={savingOrgSettings}
        onClose={() => setOrgSettingsOpen(false)}
        onSave={handleSaveOrgChartQuick}
      />
    </>
  );
}
