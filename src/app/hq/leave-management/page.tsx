// src/app/hq/leave-management/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  HqManualAnnualAdjustModal,
  HqSettlementAnnualAdjustModal,
} from "@/components/hq/leaves/HqAnnualAdjustModals";
import HqCustomGrantModal from "@/components/hq/leaves/HqCustomGrantModal";
import HqFlexTargetPicker from "@/components/hq/leaves/HqFlexTargetPicker";
import HqMemberLeaveDetailView from "@/components/hq/leaves/HqMemberLeaveDetailView";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  DEFAULT_CUSTOM_LEAVES,
  formatCustomGrantPeriodLabel,
  isCustomGrantValidOnDate,
  isCustomLeaveEligibleForGender,
  isManuallyGrantableCustomLeave,
} from "@/lib/hq/defaultLeaveSettings";
import { computeMemberAnnualLeaveLedgerForYear } from "@/lib/hq/leaveBalanceEngine";
import type {
  HqAnnualLeaveGlobalSettings,
  HqAnnualLeavePlanItem,
  HqApprovalDoc,
  HqCustomLeaveGrantItem,
  HqCustomLeaveItem,
  HqLeaveAdjustmentItem,
  HqLeavePromotionTargetItem,
  HqPromotionKind,
  HqUploadedMonthlyUsageItem,
} from "@/lib/hq/types";

type LeaveMgmtTab = "BALANCE" | "HISTORY" | "MONTHLY" | "PROMOTION";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function avatarBg(name: string): string {
  if (name === "김근식" || name === "백시연" || name === "심혜영") return "#2dd4bf";
  if (name === "김동현") return "#4ade80";
  if (
    name === "김문수" ||
    name === "원종준" ||
    name === "조원형" ||
    name === "최수연"
  )
    return "#eb7d66";
  if (name === "민세리") return "#e57373";
  if (name === "천종현") return "#9ba8cf";
  if (name === "한민서") return "#b57edc";
  return "#64748b";
}

function formatHireDot(iso?: string | null): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${y}. ${m}. ${d}`;
}

function formatDateRangeKo(start?: string | null, end?: string | null): string {
  if (!start) return "-";
  const parse = (ymd: string) => {
    const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
    const dt = new Date(y || 2026, (m || 1) - 1, d || 1);
    return { y, m, d, dow: WEEKDAY_KO[dt.getDay()] };
  };
  const s = parse(start);
  if (!end || end === start) {
    return `${s.y}. ${s.m}. ${s.d} (${s.dow})`;
  }
  const e = parse(end);
  if (s.y === e.y) {
    return `${s.y}. ${s.m}. ${s.d} (${s.dow}) - ${e.m}. ${e.d} (${e.dow})`;
  }
  return `${s.y}. ${s.m}. ${s.d} (${s.dow}) - ${e.y}. ${e.m}. ${e.d} (${e.dow})`;
}

function formatExpireDateKo(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAY_KO[dt.getDay()]})`;
}

function addDaysIso(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function downloadCsvFile(filename: string, lines: string[]) {
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HqLeaveManagementPage() {
  const {
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshCompanySettings,
    refreshMembers,
    openSettingsModal,
  } = useHqShell();

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [tab, setTab] = useState<LeaveMgmtTab>("BALANCE");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 공통 필터
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");

  // 탭별 연도 / 기간 필터
  const [historyStart, setHistoryStart] = useState(`${currentYear}-01-01`);
  const [historyEnd, setHistoryEnd] = useState(`${currentYear}-12-31`);
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const [sortPeriodAsc, setSortPeriodAsc] = useState(false);
  const [monthlyYear, setMonthlyYear] = useState(currentYear);
  const [promoYear, setPromoYear] = useState(currentYear);
  const [promoWorkStatus, setPromoWorkStatus] = useState<"ALL" | "재직">("재직");
  const [promoProgressFilter, setPromoProgressFilter] = useState("ALL");

  // 서버 원장 데이터
  const [leaveDocs, setLeaveDocs] = useState<HqApprovalDoc[]>([]);
  const [adjustments, setAdjustments] = useState<HqLeaveAdjustmentItem[]>([]);
  const [promotionTargets, setPromotionTargets] = useState<
    HqLeavePromotionTargetItem[]
  >([]);
  const [plans, setPlans] = useState<HqAnnualLeavePlanItem[]>([]);
  const [customGrants, setCustomGrants] = useState<HqCustomLeaveGrantItem[]>([]);
  const [uploadedMonthly, setUploadedMonthly] = useState<
    HqUploadedMonthlyUsageItem[]
  >([]);

  // 모달 & 드롭다운 & 서브내역 뷰 상태들
  const [customGrantMenuOpen, setCustomGrantMenuOpen] = useState(false);
  const [adjMenuOpen, setAdjMenuOpen] = useState(false);
  const [ledgerSubView, setLedgerSubView] = useState<
    | null
    | "ANNUAL_ADJ_HISTORY"
    | "SETTLEMENT_ADJ_HISTORY"
    | "CUSTOM_GRANT_HISTORY"
  >(null);
  const [settlementHistoryFilter, setSettlementHistoryFilter] = useState<
    "ALL" | "ACTIVE_SETTLEMENT" | "RETIREE_SETTLEMENT"
  >("ALL");

  // 1) 맞춤 휴가 부여 모달
  const [customGrantModalOpen, setCustomGrantModalOpen] = useState(false);
  const [cgLeaveId, setCgLeaveId] = useState("cl-subfertility");
  const [cgTargetIds, setCgTargetIds] = useState<string[]>([]);
  const [personalGrantMemberId, setPersonalGrantMemberId] = useState<
    string | null
  >(null);

  // 2) 연차 조정 모달 (일반 수동 조정 / 재직자·퇴직자 정산 조정)
  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjTargetIds, setAdjTargetIds] = useState<string[]>([]);
  const [adjYm, setAdjYm] = useState(
    `${currentYear}-${String(currentMonth).padStart(2, "0")}`
  );
  const [settlementModalMode, setSettlementModalMode] = useState<
    "ACTIVE_SETTLEMENT" | "RETIREE_SETTLEMENT" | null
  >(null);

  // 3) 월별 연차 사용 내역 업로드 모달
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadRawCsv, setUploadRawCsv] = useState("");

  // 4) 연차 촉진 설정 모달 (스크린샷 011016~011042)
  const [promoSettingOpen, setPromoSettingOpen] = useState(false);
  const [promoDraft, setPromoDraft] = useState<HqAnnualLeaveGlobalSettings>(
    DEFAULT_ANNUAL_LEAVE_SETTINGS
  );

  // 5) 연차 사용 계획 요청 모달 (스크린샷 011052)
  const [promoReqOpen, setPromoReqOpen] = useState(false);
  const [reqPromoType, setReqPromoType] = useState<HqPromotionKind>("연차");
  const [reqTargetMode, setReqTargetMode] = useState<"ALL_REMAIN" | "SELECT">(
    "ALL_REMAIN"
  );
  const [reqSelectedIds, setReqSelectedIds] = useState<string[]>([]);
  const [reqDueDate, setReqDueDate] = useState(() => addDaysIso(10));

  // 6) 제출된 사용 계획 [보기] 모달
  const [viewPlanTarget, setViewPlanTarget] =
    useState<HqAnnualLeavePlanItem | null>(null);

  const canManage = Boolean(isHrManager || isHqAdmin);

  const annualSettings = useMemo(
    () =>
      companySettings?.extra_settings?.annual_leave_settings ||
      DEFAULT_ANNUAL_LEAVE_SETTINGS,
    [companySettings]
  );

  const annualPolicy = useMemo(
    () =>
      annualSettings.policies?.[0] || DEFAULT_ANNUAL_LEAVE_SETTINGS.policies[0],
    [annualSettings]
  );

  const customLeaves: HqCustomLeaveItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.custom_leaves;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_CUSTOM_LEAVES;
  }, [companySettings]);

  useEffect(() => {
    setPromoDraft(annualSettings);
  }, [annualSettings]);

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.work_status === "재직")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members]
  );

  const departments = useMemo(() => {
    const s = new Set<string>();
    activeMembers.forEach((m) => {
      if (m.department) s.add(m.department);
    });
    return Array.from(s);
  }, [activeMembers]);

  const loadLeavesAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          adjustments: HqLeaveAdjustmentItem[];
          promotionTargets: HqLeavePromotionTargetItem[];
          plans: HqAnnualLeavePlanItem[];
          customGrants: HqCustomLeaveGrantItem[];
          uploadedMonthly: HqUploadedMonthlyUsageItem[];
          leaveDocs: HqApprovalDoc[];
        };
      }>("/api/hq/leaves");
      setAdjustments(res.data?.adjustments || []);
      setPromotionTargets(res.data?.promotionTargets || []);
      setPlans(res.data?.plans || []);
      setCustomGrants(res.data?.customGrants || []);
      setUploadedMonthly(res.data?.uploadedMonthly || []);
      setLeaveDocs(res.data?.leaveDocs || []);
    } catch {
      setLeaveDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeavesAll();
  }, [loadLeavesAll]);

  const filteredMembers = useMemo(() => {
    return activeMembers.filter((m) => {
      if (deptFilter !== "ALL" && m.department !== deptFilter) return false;
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !(m.employee_no || "").toLowerCase().includes(q) &&
          !(m.department || "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeMembers, deptFilter, keyword]);

  // ============================================================================
  // 구성원별 당해연도(연말 12.31 기준) 및 조회연도 연차 원장 일괄 계산
  // ============================================================================
  const currentYearSummaryMap = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof computeMemberAnnualLeaveLedgerForYear>
    >();
    activeMembers.forEach((m) => {
      map.set(
        m.instructor_id,
        computeMemberAnnualLeaveLedgerForYear({
          memberId: m.instructor_id,
          hireDate: m.hire_date,
          groupHireDate: m.profile_extra?.group_hire_date || null,
          year: currentYear,
          currentYear,
          currentMonth,
          policy: annualPolicy,
          leaveDocs,
          adjustments,
          uploadedMonthly,
        })
      );
    });
    return map;
  }, [
    activeMembers,
    currentYear,
    currentMonth,
    annualPolicy,
    leaveDocs,
    adjustments,
    uploadedMonthly,
  ]);

  const monthlyYearSummaryMap = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof computeMemberAnnualLeaveLedgerForYear>
    >();
    activeMembers.forEach((m) => {
      map.set(
        m.instructor_id,
        computeMemberAnnualLeaveLedgerForYear({
          memberId: m.instructor_id,
          hireDate: m.hire_date,
          groupHireDate: m.profile_extra?.group_hire_date || null,
          year: monthlyYear,
          currentYear,
          currentMonth,
          policy: annualPolicy,
          leaveDocs,
          adjustments,
          uploadedMonthly,
        })
      );
    });
    return map;
  }, [
    activeMembers,
    monthlyYear,
    currentYear,
    currentMonth,
    annualPolicy,
    leaveDocs,
    adjustments,
    uploadedMonthly,
  ]);

  const todayIso = useMemo(
    () =>
      `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`,
    [currentYear, currentMonth, now]
  );

  const grantableCustomLeaves = useMemo(
    () => customLeaves.filter((c) => isManuallyGrantableCustomLeave(c)),
    [customLeaves]
  );

  // 구성원별 맞춤 휴가 보유량 표시 헬퍼
  // - '신청 시 부여' / '관리자가 직접 부여' / '연차 소진 시 부여': 신청·직접부여 전에는 기본 일수를 표시하지 않음 (빈칸)
  // - 사용 가능 기간(만료일)이 지난 부여분은 잔여에서 제외
  // - '여성' 전용은 성별 '여'에게만, '남성' 전용은 성별 '남'에게만 적용
  const getCustomLeaveDisplayValue = (
    memberId: string,
    memberGender: string,
    item: HqCustomLeaveItem
  ): string => {
    if (!isCustomLeaveEligibleForGender(item, memberGender)) return "";

    const grantedSum = customGrants
      .filter(
        (g) =>
          g.member_id === memberId &&
          g.leave_id === item.id &&
          isCustomGrantValidOnDate(g, todayIso, false)
      )
      .reduce((acc, g) => acc + Number(g.granted_amount || 0), 0);

    const usedSum = leaveDocs
      .filter(
        (d) =>
          d.drafter_id === memberId &&
          d.status === "APPROVED" &&
          d.leave_type === item.name
      )
      .reduce((acc, d) => acc + Number(d.leave_days || 0), 0);

    if (
      item.grant_method === "신청 시 부여" ||
      isManuallyGrantableCustomLeave(item)
    ) {
      const rem = Math.max(0, Math.round((grantedSum - usedSum) * 100) / 100);
      return rem > 0 ? String(rem) : "";
    }

    // 반복 부여 (예: 보건 매월 1일 부여 — 여성 전용)
    if (item.grant_method === "반복 부여") {
      if (item.target_gender !== "모두" && !memberGender) return "";
      const ymPrefix = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
      const usedThisCycle = leaveDocs
        .filter(
          (d) =>
            d.drafter_id === memberId &&
            d.status === "APPROVED" &&
            d.leave_type === item.name &&
            (d.effective_date || "").startsWith(ymPrefix)
        )
        .reduce((acc, d) => acc + Number(d.leave_days || 0), 0);
      const rem = Math.max(
        0,
        Number(item.grant_amount || 0) + grantedSum - usedThisCycle
      );
      return rem > 0 ? String(rem) : "";
    }

    const rem = Math.max(0, Math.round((grantedSum - usedSum) * 100) / 100);
    return rem > 0 ? String(rem) : "";
  };

  // 탭 2: 휴가 사용 내역 필터링
  const filteredHistoryRows = useMemo(() => {
    const memberById = new Map(members.map((m) => [m.instructor_id, m]));
    const list = leaveDocs.filter((doc) => {
      const eff = doc.effective_date || "";
      if (eff < historyStart || eff > historyEnd) return false;
      const m = memberById.get(doc.drafter_id);
      const dept = m?.department || doc.drafter_dept || "";
      if (deptFilter !== "ALL" && dept !== deptFilter) return false;
      if (historyStatusFilter !== "ALL" && doc.status !== historyStatusFilter) {
        return false;
      }
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        const hay = `${doc.drafter_name} ${m?.employee_no || ""} ${
          doc.leave_type || ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      const da = a.effective_date || "";
      const db = b.effective_date || "";
      return sortPeriodAsc ? da.localeCompare(db) : db.localeCompare(da);
    });

    return list;
  }, [
    leaveDocs,
    members,
    historyStart,
    historyEnd,
    deptFilter,
    historyStatusFilter,
    keyword,
    sortPeriodAsc,
  ]);

  // 탭 4: 연차 촉진 목록 필터링
  const filteredPromoRows = useMemo(() => {
    const memberById = new Map(members.map((m) => [m.instructor_id, m]));
    return promotionTargets.filter((t) => {
      if (t.year !== promoYear) return false;
      const m = memberById.get(t.member_id);
      if (promoWorkStatus === "재직" && m && m.work_status !== "재직")
        return false;
      if (deptFilter !== "ALL" && t.department !== deptFilter) return false;
      if (promoProgressFilter !== "ALL" && t.status !== promoProgressFilter)
        return false;
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        if (!t.member_name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    promotionTargets,
    members,
    promoYear,
    promoWorkStatus,
    deptFilter,
    promoProgressFilter,
    keyword,
  ]);

  // ============================================================================
  // 액션 핸들러 (조정/부여 취소 · 월별 업로드 · 촉진 설정 · 계획 요청 · CSV 다운로드)
  // ============================================================================
  const handleDeleteAdjustment = async (id: string) => {
    if (!confirm("해당 연차 조정 내역을 취소(삭제)하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: { action: "DELETE_ADJUSTMENT", id },
      });
      await Promise.all([loadLeavesAll(), refreshMembers()]);
    } catch (err: any) {
      alert(err?.message || "조정 내역 삭제 실패");
    }
  };

  const handleDeleteCustomGrant = async (id: string) => {
    if (!confirm("해당 맞춤 휴가 부여 내역을 취소(삭제)하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: { action: "DELETE_CUSTOM_GRANT", id },
      });
      await loadLeavesAll();
    } catch (err: any) {
      alert(err?.message || "부여 내역 삭제 실패");
    }
  };

  const downloadMonthlyUploadSample = () => {
    const sample = activeMembers[0]?.name || "김문수";
    const lines = [
      "이름,1월,2월,3월,4월,5월,6월,7월,8월,9월,10월,11월,12월",
      `${sample},2,2,0,2,4.25,0,1.25,2.25,1,0,1,0`,
    ];
    downloadCsvFile(`${monthlyYear}년_월별연차사용내역_업로드양식.csv`, lines);
  };

  const handleMonthlyUploadFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadFileName(f.name);
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder("utf-8").decode(buf);
    if (txt.includes("\uFFFD")) {
      try {
        txt = new TextDecoder("euc-kr").decode(buf);
      } catch {
        // ignore
      }
    }
    setUploadRawCsv(txt);
  };

  const handleSubmitMonthlyUpload = async () => {
    if (!uploadRawCsv.trim()) return;
    setSubmitting(true);
    try {
      const lines = uploadRawCsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedRows: {
        member_id: string;
        member_name: string;
        months: number[];
      }[] = [];

      lines.slice(1).forEach((line) => {
        const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        const nameOrEmpNo = cols[0];
        if (!nameOrEmpNo) return;
        const matched = activeMembers.find(
          (m) => m.name === nameOrEmpNo || m.employee_no === nameOrEmpNo
        );
        if (!matched) return;
        const months = Array.from({ length: 12 }, (_, idx) =>
          Math.max(0, Number(cols[idx + 1] || 0))
        );
        parsedRows.push({
          member_id: matched.instructor_id,
          member_name: matched.name,
          months,
        });
      });

      if (parsedRows.length === 0) {
        alert("일치하는 재직 구성원이 포함된 행이 없습니다.");
        setSubmitting(false);
        return;
      }

      const res = await hqFetch<{ success: boolean; data: { count: number } }>(
        "/api/hq/leaves",
        {
          method: "POST",
          body: {
            action: "UPLOAD_MONTHLY_USAGE",
            year: monthlyYear,
            rows: parsedRows,
          },
        }
      );
      alert(
        `${res.data?.count || 0}명의 ${monthlyYear}년 월별 연차 사용 내역이 반영되었습니다.`
      );
      setUploadModalOpen(false);
      setUploadFileName("");
      setUploadRawCsv("");
      await Promise.all([loadLeavesAll(), refreshMembers()]);
    } catch (err: any) {
      alert(err?.message || "월별 내역 업로드 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 연차 촉진 설정 저장 -> 회사 설정(annual_leave_settings) 1:1 동기화
  const handleSavePromoSettings = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/settings", {
        method: "PATCH",
        body: {
          extra_settings: {
            ...companySettings.extra_settings,
            annual_leave_settings: promoDraft,
          },
        },
      });
      await refreshCompanySettings();
      setPromoSettingOpen(false);
      alert("연차 촉진 설정이 저장되었습니다.");
    } catch (err: any) {
      alert(err?.message || "촉진 설정 저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 연차 사용계획 요청 실행
  const handleSubmitPromoRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetMembers =
      reqTargetMode === "ALL_REMAIN"
        ? activeMembers.filter(
            (m) =>
              (currentYearSummaryMap.get(m.instructor_id)?.availableRemainDays ||
                0) > 0
          )
        : activeMembers.filter((m) => reqSelectedIds.includes(m.instructor_id));

    if (targetMembers.length === 0) {
      alert("요청할 대상 구성원이 없습니다.");
      return;
    }

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "REQUEST_PROMOTION_PLANS",
          year: promoYear,
          promo_type: reqPromoType,
          due_date: reqDueDate,
          targets: targetMembers.map((m) => ({
            member_id: m.instructor_id,
            member_name: m.name,
            department: m.department,
            employee_no: m.employee_no,
            expire_date: `${promoYear + 1}-01-01`,
          })),
        },
      });
      setPromoReqOpen(false);
      await loadLeavesAll();
      alert(
        `${targetMembers.length}명에게 ${reqPromoType} 사용 계획 작성 요청을 발송했습니다.`
      );
    } catch (err: any) {
      alert(err?.message || "요청 발송 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePromoTarget = async (id: string) => {
    if (!confirm("해당 연차 촉진 요청 내역을 삭제하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: { action: "DELETE_PROMOTION_TARGET", id },
      });
      await loadLeavesAll();
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    }
  };

  // 현재 탭 CSV 다운로드
  const handleExportCurrentTabCsv = () => {
    if (tab === "BALANCE") {
      const header = [
        "이름",
        "부서",
        "사번",
        `연차(${currentYear}.12.31기준잔여)`,
        ...customLeaves.map((c) => c.name),
      ];
      const rows = filteredMembers.map((m) => {
        const rem =
          currentYearSummaryMap.get(m.instructor_id)?.availableRemainDays ?? 0;
        const gender = m.profile_extra?.gender || "";
        return [
          m.name,
          m.department,
          m.employee_no || "",
          String(rem),
          ...customLeaves.map((c) =>
            getCustomLeaveDisplayValue(m.instructor_id, gender, c)
          ),
        ].join(",");
      });
      downloadCsvFile(`휴가보유현황_${currentYear}.csv`, [
        header.join(","),
        ...rows,
      ]);
      return;
    }

    if (tab === "HISTORY") {
      const header = ["이름", "부서", "시작일", "종료일", "항목", "사용일수", "상태"];
      const rows = filteredHistoryRows.map((d) =>
        [
          d.drafter_name,
          d.drafter_dept,
          d.effective_date || "",
          d.end_date || "",
          d.leave_type || "연차",
          String(d.leave_days),
          d.status,
        ].join(",")
      );
      downloadCsvFile(`휴가사용내역_${historyStart}_${historyEnd}.csv`, [
        header.join(","),
        ...rows,
      ]);
      return;
    }

    if (tab === "MONTHLY") {
      const header = [
        "이름",
        "사번",
        "입사일",
        "잔여연차(연말기준)",
        ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      ];
      const rows = filteredMembers.map((m) => {
        const sum = monthlyYearSummaryMap.get(m.instructor_id);
        const months = sum?.monthlyUsed12 || Array(12).fill(0);
        return [
          m.name,
          m.employee_no || "",
          m.hire_date || "",
          String(sum?.availableRemainDays ?? 0),
          ...months.map(String),
        ].join(",");
      });
      downloadCsvFile(`월별연차사용내역_${monthlyYear}.csv`, [
        header.join(","),
        ...rows,
      ]);
      return;
    }

    const header = ["이름", "부서", "촉진유형", "소멸일", "작성기한", "상태"];
    const rows = filteredPromoRows.map((t) =>
      [
        t.member_name,
        t.department,
        t.promo_type,
        t.expire_date,
        t.due_date,
        t.status,
      ].join(",")
    );
    downloadCsvFile(`연차촉진내역_${promoYear}.csv`, [
      header.join(","),
      ...rows,
    ]);
  };

  const selectedDetailMember = useMemo(
    () =>
      selectedMemberId
        ? members.find((m) => m.instructor_id === selectedMemberId) || null
        : null,
    [members, selectedMemberId]
  );

  const personalGrantMember = useMemo(
    () =>
      personalGrantMemberId
        ? members.find((m) => m.instructor_id === personalGrantMemberId) || null
        : null,
    [members, personalGrantMemberId]
  );

  const manualAdjustmentsOnly = useMemo(
    () =>
      adjustments.filter(
        (a) =>
          !a.adjustment_category || a.adjustment_category === "MANUAL"
      ),
    [adjustments]
  );

  const settlementAdjustmentsOnly = useMemo(
    () =>
      adjustments.filter((a) => {
        const cat = a.adjustment_category;
        if (
          cat !== "ACTIVE_SETTLEMENT" &&
          cat !== "RETIREE_SETTLEMENT"
        ) {
          return false;
        }
        if (settlementHistoryFilter === "ALL") return true;
        return cat === settlementHistoryFilter;
      }),
    [adjustments, settlementHistoryFilter]
  );

  return (
    <div
      className="w-full min-h-full bg-white flex flex-col"
      onClick={() => {
        setCustomGrantMenuOpen(false);
        setAdjMenuOpen(false);
      }}
    >
      {selectedDetailMember ? (
        <HqMemberLeaveDetailView
          member={selectedDetailMember}
          canManage={canManage}
          annualPolicy={annualPolicy}
          customLeaves={customLeaves}
          holidaysByYear={companySettings?.holidays_by_year || {}}
          leaveDocs={leaveDocs}
          adjustments={adjustments}
          customGrants={customGrants}
          uploadedMonthly={uploadedMonthly}
          onBack={() => setSelectedMemberId(null)}
          onOpenGrantModalForMember={(mId, lvId) => {
            setPersonalGrantMemberId(mId);
            setCgTargetIds([mId]);
            if (lvId) setCgLeaveId(lvId);
            setCustomGrantModalOpen(true);
          }}
          onOpenAdjustModalForMember={(mId, ym) => {
            setAdjTargetIds([mId]);
            if (ym) setAdjYm(ym);
            setAdjModalOpen(true);
          }}
          onMutated={async () => {
            await Promise.all([loadLeavesAll(), refreshMembers()]);
          }}
        />
      ) : ledgerSubView ? (
        <div className="w-full flex-1 flex flex-col">
          <div className="px-9 pt-7 pb-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setLedgerSubView(null)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-600 flex items-center justify-center text-lg font-bold"
              >
                ‹
              </button>
              <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                {ledgerSubView === "ANNUAL_ADJ_HISTORY"
                  ? "연차 조정 내역"
                  : ledgerSubView === "SETTLEMENT_ADJ_HISTORY"
                    ? "재직 · 퇴직자 잔여 연차 조정 내역"
                    : "맞춤 휴가 부여 내역"}
              </h1>
            </div>

            {ledgerSubView === "SETTLEMENT_ADJ_HISTORY" && (
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 text-xs">
                {(
                  [
                    { key: "ALL", label: "전체" },
                    { key: "ACTIVE_SETTLEMENT", label: "재직자 정산" },
                    { key: "RETIREE_SETTLEMENT", label: "퇴직자 정산" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setSettlementHistoryFilter(f.key)}
                    className={`px-3 py-1.5 rounded-lg font-bold ${
                      settlementHistoryFilter === f.key
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-full flex-1 overflow-x-auto">
            {ledgerSubView === "CUSTOM_GRANT_HISTORY" ? (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-3 pl-9 pr-4">부여 일시</th>
                    <th className="py-3 px-4">대상 구성원</th>
                    <th className="py-3 px-4">휴가 종류</th>
                    <th className="py-3 px-4 text-right">부여 시간</th>
                    <th className="py-3 px-4">사용 가능 기간</th>
                    <th className="py-3 px-4">사유</th>
                    <th className="py-3 px-4">처리자</th>
                    <th className="py-3 pl-4 pr-9 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customGrants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-20 text-center text-slate-400 font-semibold"
                      >
                        등록된 맞춤 휴가 부여 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    customGrants.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-50/60">
                        <td className="py-3.5 pl-9 pr-4 text-slate-500 tabular-nums">
                          {g.created_at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {g.member_name}
                          {g.department ? (
                            <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                              {g.department}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {g.leave_name}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-[#00a84b] tabular-nums">
                          +{g.granted_amount}일
                          {g.grant_unit_mode === "HOURS" && g.granted_hours
                            ? ` (${g.granted_hours}시간)`
                            : ""}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-600 tabular-nums">
                          {formatCustomGrantPeriodLabel(g)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {g.reason}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {g.actor_name}
                        </td>
                        <td className="py-3.5 pl-4 pr-9 text-right">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomGrant(g.id)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-rose-600 font-bold"
                            >
                              부여 취소
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-3 pl-9 pr-4">조정 일시</th>
                    <th className="py-3 px-4">대상 구성원</th>
                    {ledgerSubView === "SETTLEMENT_ADJ_HISTORY" && (
                      <th className="py-3 px-4">정산 구분</th>
                    )}
                    <th className="py-3 px-4">적용 연월</th>
                    <th className="py-3 px-4 text-right">조정 일수</th>
                    {ledgerSubView === "SETTLEMENT_ADJ_HISTORY" && (
                      <th className="py-3 px-4 text-right">정산 전 → 후</th>
                    )}
                    <th className="py-3 px-4">조정 사유</th>
                    <th className="py-3 px-4">처리자</th>
                    <th className="py-3 pl-4 pr-9 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(ledgerSubView === "ANNUAL_ADJ_HISTORY"
                    ? manualAdjustmentsOnly
                    : settlementAdjustmentsOnly
                  ).length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          ledgerSubView === "SETTLEMENT_ADJ_HISTORY" ? 9 : 7
                        }
                        className="py-20 text-center text-slate-400 font-semibold"
                      >
                        등록된 조정 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    (ledgerSubView === "ANNUAL_ADJ_HISTORY"
                      ? manualAdjustmentsOnly
                      : settlementAdjustmentsOnly
                    ).map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/60">
                        <td className="py-3.5 pl-9 pr-4 text-slate-500 tabular-nums">
                          {a.created_at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {a.member_name}
                          {a.department ? (
                            <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                              {a.department}
                            </span>
                          ) : null}
                        </td>
                        {ledgerSubView === "SETTLEMENT_ADJ_HISTORY" && (
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                a.adjustment_category === "RETIREE_SETTLEMENT"
                                  ? "bg-rose-50 text-rose-600"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {a.adjustment_category === "RETIREE_SETTLEMENT"
                                ? "퇴직자 정산"
                                : "재직자 정산"}
                            </span>
                          </td>
                        )}
                        <td className="py-3.5 px-4 font-semibold text-slate-700 tabular-nums">
                          {a.year_month}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-extrabold tabular-nums ${
                            a.delta_days > 0
                              ? "text-[#00a84b]"
                              : "text-rose-600"
                          }`}
                        >
                          {a.delta_days > 0
                            ? `+${a.delta_days}일`
                            : `${a.delta_days}일`}
                        </td>
                        {ledgerSubView === "SETTLEMENT_ADJ_HISTORY" && (
                          <td className="py-3.5 px-4 text-right font-semibold text-slate-600 tabular-nums">
                            {typeof a.before_remain_days === "number" &&
                            typeof a.after_remain_days === "number"
                              ? `${a.before_remain_days}일 → ${a.after_remain_days}일`
                              : "-"}
                          </td>
                        )}
                        <td className="py-3.5 px-4 text-slate-600">
                          {a.reason}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {a.actor_name}
                        </td>
                        <td className="py-3.5 pl-4 pr-9 text-right">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAdjustment(a.id)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-rose-600 font-bold"
                            >
                              조정 취소
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <>
      {/* 상단 타이틀 & 탭별 우측 액션 버튼 */}
      <div className="w-full px-9 pt-7 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
              휴가 관리
            </h1>
            {annualPolicy.annual_expire_point ===
              "당해 연말 (매년 12월 31일)" && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold">
                <span>✓</span>
                <span>당해 연말(12월 31일) 사용 · 소멸 기준 적용 중</span>
              </span>
            )}
          </div>

          {tab === "BALANCE" && canManage && (
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1) 맞춤 휴가 부여 ▾ 드롭다운 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setAdjMenuOpen(false);
                    setCustomGrantMenuOpen((v) => !v);
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5"
                >
                  <span>맞춤 휴가 부여</span>
                  <span className="text-[10px] text-slate-400">▾</span>
                </button>

                {customGrantMenuOpen && (
                  <div className="absolute right-0 top-10 z-30 w-64 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-xs">
                    <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-400">
                      맞춤 휴가 부여
                    </div>
                    <div className="py-1">
                      {grantableCustomLeaves.map((lv) => (
                        <button
                          key={lv.id}
                          type="button"
                          onClick={() => {
                            setCustomGrantMenuOpen(false);
                            setPersonalGrantMemberId(null);
                            setCgLeaveId(lv.id);
                            setCgTargetIds([]);
                            setCustomGrantModalOpen(true);
                          }}
                          className="w-full px-4 py-2 text-left font-bold text-slate-800 hover:bg-slate-50 flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <span>{lv.icon}</span>
                            <span>{lv.name}</span>
                          </span>
                          {lv.target_gender !== "모두" && (
                            <span className="text-[10px] font-semibold text-slate-400">
                              {lv.target_gender}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-slate-100 py-1.5">
                      <div className="px-4 py-1 text-[10px] font-bold text-slate-400">
                        부여 내역
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomGrantMenuOpen(false);
                          setLedgerSubView("CUSTOM_GRANT_HISTORY");
                        }}
                        className="w-full px-4 py-2 text-left font-bold text-slate-700 hover:bg-slate-50"
                      >
                        맞춤 휴가 부여 내역
                      </button>
                    </div>
                    <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
                      휴가 종류 중 &apos;일정 주기&apos;, &apos;신청 시 부여&apos;를 제외하고 부여가 가능해요.
                    </div>
                  </div>
                )}
              </div>

              {/* 2) 연차 조정 ▾ 드롭다운 (Screenshot 6 100% 재현) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setCustomGrantMenuOpen(false);
                    setAdjMenuOpen((v) => !v);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs flex items-center gap-1.5"
                >
                  <span>연차 조정</span>
                  <span className="text-[10px] opacity-80">▾</span>
                </button>

                {adjMenuOpen && (
                  <div className="absolute right-0 top-10 z-30 w-72 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-xs py-2">
                    <div className="px-4 py-1.5 text-[11px] font-bold text-slate-400">
                      조정
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjMenuOpen(false);
                        setAdjTargetIds([]);
                        setAdjModalOpen(true);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="font-extrabold text-slate-900">
                        연차 조정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        연차를 수동으로 부여 · 차감해요.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAdjMenuOpen(false);
                        setSettlementModalMode("ACTIVE_SETTLEMENT");
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="font-extrabold text-slate-900">
                        재직자 정산용 잔여 연차 조정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        재직자 연차 수당 지급을 위해 잔여분을 확인 · 조정해요.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAdjMenuOpen(false);
                        setSettlementModalMode("RETIREE_SETTLEMENT");
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="font-extrabold text-slate-900">
                        퇴직자 정산용 잔여 연차 조정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        퇴직자 연차 수당 지급을 위해 잔여분을 확인 · 조정해요.
                      </div>
                    </button>

                    <div className="my-1.5 border-t border-slate-100" />

                    <div className="px-4 py-1.5 text-[11px] font-bold text-slate-400">
                      조정 내역
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjMenuOpen(false);
                        setLedgerSubView("ANNUAL_ADJ_HISTORY");
                      }}
                      className="w-full px-4 py-2 text-left font-bold text-slate-800 hover:bg-slate-50"
                    >
                      연차 조정 내역
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjMenuOpen(false);
                        setSettlementHistoryFilter("ALL");
                        setLedgerSubView("SETTLEMENT_ADJ_HISTORY");
                      }}
                      className="w-full px-4 py-2 text-left font-bold text-slate-800 hover:bg-slate-50"
                    >
                      재직 · 퇴직자 잔여 연차 조정 내역
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "MONTHLY" && canManage && (
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5"
            >
              <span>↑</span>
              <span>연차 사용 내역 업로드</span>
            </button>
          )}

          {tab === "PROMOTION" && canManage && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPromoSettingOpen(true)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5"
              >
                <span>⚙️</span>
                <span>촉진 설정</span>
              </button>
              <button
                type="button"
                onClick={() => setPromoReqOpen(true)}
                className="px-4 py-2 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs flex items-center gap-1.5"
              >
                <span>➤</span>
                <span>연차 사용계획 요청</span>
              </button>
            </div>
          )}
        </div>

        {/* 4개 서브탭 + 우측 검색/다운로드 아이콘 */}
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {(
              [
                { key: "BALANCE", label: "휴가 보유 현황" },
                { key: "HISTORY", label: "휴가 사용 내역" },
                { key: "MONTHLY", label: "월별 연차 사용 내역" },
                { key: "PROMOTION", label: "연차 촉진" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`pb-3 text-[13px] font-bold border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="pb-2 flex items-center gap-1.5">
            {searchOpen ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">
                <input
                  autoFocus
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="이름, 사번 검색..."
                  className="bg-transparent text-xs font-semibold outline-none w-36"
                />
                <button
                  type="button"
                  onClick={() => {
                    setKeyword("");
                    setSearchOpen(false);
                  }}
                  className="text-xs text-slate-400"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="검색"
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 text-sm"
              >
                🔍
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCurrentTabCsv}
              title="현재 탭 엑셀(CSV) 다운로드"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 text-sm font-bold"
            >
              ⤓
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          탭 1: [휴가 보유 현황] (스크린샷 010944 100% 대응)
         ===================================================================== */}
      {tab === "BALANCE" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex items-center gap-2 text-xs">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[1440px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs bg-white">
                  <th className="py-3 pl-9 pr-4 w-52 sticky left-0 bg-white z-10 font-semibold text-slate-500">
                    이름
                  </th>
                  <th className="py-3 px-4 w-28 font-semibold text-slate-500 text-right">
                    사번
                  </th>
                  <th className="py-3 px-4 w-24 font-bold text-slate-700 text-right border-r border-slate-100">
                    연차
                  </th>
                  {customLeaves.map((c) => {
                    const subDesc =
                      c.id === "cl-miscarriage" ||
                      c.id === "cl-miscarriage-multi"
                        ? "관리자가 직접 부여"
                        : c.grant_method === "관리자가 직접 부여"
                          ? `관리자가 직접 부여${
                              c.grant_amount
                                ? `(${c.grant_amount}${
                                    c.grant_unit.startsWith("시간") ? "시간" : "일"
                                  })`
                                : ""
                            }`
                          : c.grant_method === "연차 소진 시 부여"
                            ? `소진 시 부여(${c.grant_amount}일)`
                            : c.id === "cl-military"
                              ? "신청 시 부여"
                              : c.grant_method === "반복 부여"
                                ? `매월 부여(${c.grant_amount}일)`
                                : `신청 시 부여(${c.grant_amount}일)`;
                    return (
                      <th
                        key={c.id}
                        className="py-2.5 px-4 min-w-[132px] text-right border-r border-slate-100/80"
                      >
                        <div className="font-semibold text-slate-600 whitespace-nowrap">
                          {c.name}
                        </div>
                        <div className="text-[10px] font-medium text-slate-400 whitespace-nowrap mt-0.5">
                          {subDesc}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td
                      colSpan={3 + customLeaves.length}
                      className="py-20 text-center text-slate-400 font-semibold"
                    >
                      구성원 휴가 보유 현황을 계산하는 중입니다...
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m) => {
                    const annualRem =
                      currentYearSummaryMap.get(m.instructor_id)
                        ?.availableRemainDays ?? 0;
                    const gender = m.profile_extra?.gender || "";
                    const subJob =
                      m.job_description ||
                      (m.department !== "미지정" ? m.department : "");
                    const cleanEmpNo = (m.employee_no || "").startsWith(
                      "HQ-TEMP"
                    )
                      ? ""
                      : m.employee_no;

                    return (
                      <tr
                        key={m.instructor_id}
                        onClick={() => setSelectedMemberId(m.instructor_id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-9 pr-4 sticky left-0 bg-white group-hover:bg-emerald-50/40 z-10 transition-colors">
                          <div className="flex items-center gap-3">
                            <span
                              style={{ backgroundColor: avatarBg(m.name) }}
                              className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                            >
                              {m.name.slice(-2)}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">
                                {m.name}
                              </div>
                              {subJob && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  {subJob}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-500 tabular-nums">
                          {cleanEmpNo}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-slate-900 tabular-nums border-r border-slate-100">
                          {annualRem}
                        </td>
                        {customLeaves.map((c) => (
                          <td
                            key={c.id}
                            className="py-3.5 px-4 text-right font-semibold text-slate-700 tabular-nums border-r border-slate-100/80"
                          >
                            {getCustomLeaveDisplayValue(
                              m.instructor_id,
                              gender,
                              c
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 2: [휴가 사용 내역] (스크린샷 010951 100% 대응)
         ===================================================================== */}
      {tab === "HISTORY" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
              <span className="text-slate-400">📅 조회 기간</span>
              <input
                type="date"
                value={historyStart}
                onChange={(e) => setHistoryStart(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
              <span>~</span>
              <input
                type="date"
                value={historyEnd}
                onChange={(e) => setHistoryEnd(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={historyStatusFilter}
              onChange={(e) => setHistoryStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">+ 상태 전체</option>
              <option value="APPROVED">승인완료</option>
              <option value="PENDING">승인대기</option>
              <option value="CANCELLED">휴가취소</option>
              <option value="REJECTED">반려</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-9 pr-4 w-56">이름</th>
                  <th className="py-3 px-4 w-36">사번</th>
                  <th
                    onClick={() => setSortPeriodAsc((v) => !v)}
                    className="py-3 px-4 cursor-pointer hover:text-slate-800"
                  >
                    기간 ⇅
                  </th>
                  <th className="py-3 px-4">항목</th>
                  <th className="py-3 px-4">사용 시간 ⇅</th>
                  <th className="py-3 px-4">상태</th>
                  <th className="py-3 pl-4 pr-9">증명자료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredHistoryRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-20 text-center text-slate-400 font-semibold"
                    >
                      조회 기간에 등록된 휴가 사용 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredHistoryRows.map((doc) => {
                    const memberObj = members.find(
                      (m) => m.instructor_id === doc.drafter_id
                    );
                    const subJob =
                      memberObj?.job_description ||
                      doc.drafter_dept ||
                      "";
                    const empNo = (memberObj?.employee_no || "").startsWith(
                      "HQ-TEMP"
                    )
                      ? ""
                      : memberObj?.employee_no || "";

                    const badge =
                      doc.status === "APPROVED"
                        ? {
                            label: "승인완료",
                            cls: "bg-emerald-50 text-emerald-600",
                          }
                        : doc.status === "PENDING" ||
                          doc.status === "IN_PROGRESS"
                        ? {
                            label: "승인대기",
                            cls: "bg-amber-50 text-amber-700",
                          }
                        : doc.status === "REJECTED"
                        ? {
                            label: "반려",
                            cls: "bg-rose-50 text-rose-600",
                          }
                        : {
                            label: "휴가취소",
                            cls: "bg-orange-50 text-orange-600",
                          };

                    return (
                      <tr
                        key={doc.approval_id}
                        onClick={() => setSelectedMemberId(doc.drafter_id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 pl-9 pr-4">
                          <div className="flex items-center gap-3">
                            <span
                              style={{
                                backgroundColor: avatarBg(doc.drafter_name),
                              }}
                              className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                            >
                              {doc.drafter_name.slice(-2)}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900">
                                {doc.drafter_name}
                              </div>
                              {subJob && (
                                <div className="text-[11px] text-slate-400">
                                  {subJob}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 tabular-nums">
                          {empNo}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-800 tabular-nums">
                          {formatDateRangeKo(doc.effective_date, doc.end_date)}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-800">
                          {doc.leave_type || "연차"}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800 tabular-nums">
                          {doc.leave_days}일
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3.5 pl-4 pr-9 text-slate-400">
                          {doc.receipt_url ? (
                            <a
                              href={doc.receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 font-bold hover:underline"
                            >
                              확인
                            </a>
                          ) : (
                            ""
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 3: [월별 연차 사용 내역] (스크린샷 010959 100% 대응 · 연말 잔여 기준)
         ===================================================================== */}
      {tab === "MONTHLY" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
              <span className="text-slate-400">📅 조회 기간</span>
              <select
                value={monthlyYear}
                onChange={(e) => setMonthlyYear(Number(e.target.value))}
                className="font-extrabold text-slate-800 outline-none bg-transparent cursor-pointer"
              >
                {[
                  currentYear - 2,
                  currentYear - 1,
                  currentYear,
                  currentYear + 1,
                ].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}년
                  </option>
                ))}
              </select>
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-9 pr-4 w-52">이름</th>
                  <th className="py-3 px-4 w-28 text-right">사번</th>
                  <th className="py-3 px-4 w-32 text-right">입사일</th>
                  <th className="py-3 px-4 w-28 text-right font-bold text-slate-700 border-r border-slate-100">
                    잔여 연차
                  </th>
                  {Array.from({ length: 12 }, (_, idx) => (
                    <th
                      key={idx}
                      className="py-3 px-3 text-right border-r border-slate-100/70"
                    >
                      {idx + 1}월
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredMembers.map((m) => {
                  const summary = monthlyYearSummaryMap.get(m.instructor_id);
                  const remain = summary?.availableRemainDays ?? 0;
                  const months = summary?.monthlyUsed12 || Array(12).fill(0);
                  const cleanEmpNo = (m.employee_no || "").startsWith("HQ-TEMP")
                    ? ""
                    : m.employee_no;
                  const subJob =
                    m.job_description ||
                    (m.department !== "미지정" ? m.department : "");

                  return (
                    <tr
                      key={m.instructor_id}
                      onClick={() => setSelectedMemberId(m.instructor_id)}
                      className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 pl-9 pr-4">
                        <div className="flex items-center gap-3">
                          <span
                            style={{ backgroundColor: avatarBg(m.name) }}
                            className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                          >
                            {m.name.slice(-2)}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900">
                              {m.name}
                            </div>
                            {subJob && (
                              <div className="text-[11px] text-slate-400">
                                {subJob}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-500 tabular-nums">
                        {cleanEmpNo}
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-600 tabular-nums">
                        {formatHireDot(m.hire_date)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-slate-900 tabular-nums border-r border-slate-100">
                        {remain}
                      </td>
                      {months.map((val, idx) => (
                        <td
                          key={idx}
                          className={`py-3.5 px-3 text-right tabular-nums border-r border-slate-100/70 ${
                            val > 0
                              ? "font-bold text-slate-800"
                              : "text-slate-400"
                          }`}
                        >
                          {val}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 4: [연차 촉진] (스크린샷 011009 100% 대응)
         ===================================================================== */}
      {tab === "PROMOTION" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
              <span className="text-slate-400">📅 조회 기간</span>
              <select
                value={promoYear}
                onChange={(e) => setPromoYear(Number(e.target.value))}
                className="font-extrabold text-slate-800 outline-none bg-transparent"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}년
                  </option>
                ))}
              </select>
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                setPromoWorkStatus((s) => (s === "재직" ? "ALL" : "재직"))
              }
              className={`px-3 py-1.5 rounded-lg border font-bold flex items-center gap-1.5 ${
                promoWorkStatus === "재직"
                  ? "bg-blue-50 border-blue-200 text-blue-700"
                  : "border-slate-200 text-slate-600"
              }`}
            >
              <span>👤 재직 상태</span>
              <span>{promoWorkStatus === "재직" ? "재직 ✕" : "전체"}</span>
            </button>

            <select
              value={promoProgressFilter}
              onChange={(e) => setPromoProgressFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">◐ 진행 상태</option>
              <option value="PENDING">작성 대기 중</option>
              <option value="COMPLETED">완료</option>
              <option value="EXPIRED">작성 기간 지남</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-9 pr-3 w-20">재직 상태</th>
                  <th className="py-3 px-4 w-52">이름</th>
                  <th className="py-3 px-4 w-32">사번</th>
                  <th className="py-3 px-4">촉진 유형</th>
                  <th className="py-3 px-4">소멸일</th>
                  <th className="py-3 px-4">진행 상태</th>
                  <th className="py-3 px-4">사용 계획</th>
                  <th className="py-3 pl-4 pr-9 text-right">더 보기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPromoRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-20 text-center text-slate-400 font-semibold"
                    >
                      우측 상단 [연차 사용계획 요청] 버튼을 눌러 대상자에게 연차 촉진을 시작해보세요.
                    </td>
                  </tr>
                ) : (
                  filteredPromoRows.map((row) => {
                    const submittedPlan = plans.find(
                      (p) =>
                        p.year === row.year && p.member_id === row.member_id
                    );
                    const cleanEmpNo = (row.employee_no || "").startsWith(
                      "HQ-TEMP"
                    )
                      ? ""
                      : row.employee_no || "";

                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedMemberId(row.member_id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 pl-9 pr-3">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                            재직
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <span
                              style={{
                                backgroundColor: avatarBg(row.member_name),
                              }}
                              className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
                            >
                              {row.member_name.slice(-2)}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900">
                                {row.member_name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {row.department}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 tabular-nums">
                          {cleanEmpNo}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-800">
                          {row.promo_type}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {formatExpireDateKo(row.expire_date)}{" "}
                          <span
                            title="당해 연도 말일(12월 31일) 경과 시 소멸됩니다."
                            className="text-slate-300 cursor-help"
                          >
                            ⓘ
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {row.status === "COMPLETED" || submittedPlan ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-600">
                              <span>●</span>
                              <span>완료</span>
                            </span>
                          ) : row.status === "EXPIRED" ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
                              <span>⊖</span>
                              <span>작성 기간 지남</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-blue-600">
                              <span>●</span>
                              <span>작성 대기 중 (~{row.due_date})</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {submittedPlan && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewPlanTarget(submittedPlan);
                              }}
                              className="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700"
                            >
                              보기
                            </button>
                          )}
                        </td>
                        <td className="py-3.5 pl-4 pr-9 text-right">
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePromoTarget(row.id);
                              }}
                              className="px-2 py-1 rounded hover:bg-slate-100 text-slate-400 hover:text-rose-600 font-bold"
                              title="촉진 내역 삭제"
                            >
                              ⋯
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}

      {/* =====================================================================
          모달 1: 플렉스형 맞춤 휴가 부여하기 모달 (전원선택 + 조직2단피커 + 사용가능기간 + 개인대상 필터)
         ===================================================================== */}
      <HqCustomGrantModal
        isOpen={customGrantModalOpen}
        onClose={() => {
          setCustomGrantModalOpen(false);
          setPersonalGrantMemberId(null);
        }}
        customLeaves={customLeaves}
        activeMembers={activeMembers}
        orgNodes={companySettings?.extra_settings?.org_chart_nodes}
        lockedPersonalMember={personalGrantMember}
        initialLeaveId={cgLeaveId}
        initialTargetIds={cgTargetIds}
        onSubmitted={async () => {
          await loadLeavesAll();
        }}
      />

      {/* =====================================================================
          모달 2-A: 플렉스형 일반 연차 수동 조정 모달
         ===================================================================== */}
      <HqManualAnnualAdjustModal
        isOpen={adjModalOpen}
        onClose={() => setAdjModalOpen(false)}
        activeMembers={activeMembers}
        orgNodes={companySettings?.extra_settings?.org_chart_nodes}
        initialTargetIds={adjTargetIds}
        initialYm={adjYm}
        onSubmitted={async () => {
          await Promise.all([loadLeavesAll(), refreshMembers()]);
        }}
      />

      {/* =====================================================================
          모달 2-B: 플렉스형 재직자 / 퇴직자 정산용 잔여 연차 조정 모달
         ===================================================================== */}
      <HqSettlementAnnualAdjustModal
        mode={settlementModalMode}
        onClose={() => setSettlementModalMode(null)}
        allMembers={members}
        annualPolicy={annualPolicy}
        retireeRule={
          annualSettings.retiree_adjustment_rule ||
          "구성원에게 유리한 기준으로 적용"
        }
        leaveDocs={leaveDocs}
        adjustments={adjustments}
        uploadedMonthly={uploadedMonthly}
        onSubmitted={async () => {
          await Promise.all([loadLeavesAll(), refreshMembers()]);
        }}
      />

      {/* =====================================================================
          모달 3: 월별 연차 사용 내역 CSV 업로드 모달
         ===================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                ↑ {monthlyYear}년 월별 연차 사용 내역 업로드
              </h3>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                <div className="font-bold text-slate-800">CSV 업로드 양식</div>
                <div className="text-[11px] text-slate-400">
                  이름, 1월 ~ 12월 사용일수 (0.25 단위 지원)
                </div>
              </div>
              <button
                type="button"
                onClick={downloadMonthlyUploadSample}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700"
              >
                양식 받기
              </button>
            </div>

            <label className="block border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/40">
              <input
                type="file"
                accept=".csv"
                onChange={handleMonthlyUploadFile}
                className="hidden"
              />
              <div className="text-xl mb-1">📂</div>
              <div className="text-xs font-extrabold text-slate-800">
                {uploadFileName || "클릭하여 CSV 파일 선택"}
              </div>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
              >
                취소
              </button>
              <button
                type="button"
                disabled={submitting || !uploadRawCsv}
                onClick={handleSubmitMonthlyUpload}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold disabled:opacity-40"
              >
                반영하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          모달 4: 연차 촉진 설정 모달 (스크린샷 011016 ~ 011042 1:1 재현)
         ===================================================================== */}
      {promoSettingOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-[520px] p-7 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[20px] font-extrabold text-slate-900">
                  연차 촉진 설정
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  구성원에게 연차 사용 촉진 시, 기본적으로 적용되는 설정이에요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPromoSettingOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="divide-y divide-slate-100 text-xs">
              {/* 승인 · 참조 대상 */}
              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">
                    승인 · 참조 대상
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    구성원이 작성한 연차 사용 계획의 승인 · 참조 대상을 설정할 수 있어요.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPromoSettingOpen(false);
                    openSettingsModal("workflow_approval");
                  }}
                  className="text-slate-400 hover:text-slate-700 font-semibold shrink-0"
                >
                  사용 안 함 ›
                </button>
              </div>

              {/* 구성원 작성 리마인드 */}
              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">
                    구성원 작성 리마인드 <span className="text-slate-300">ⓘ</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    구성원에게 사용 계획 작성 알림을 제출 기한 동안 매일 보내요.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPromoDraft((p) => ({
                      ...p,
                      promotion_remind_member: !p.promotion_remind_member,
                    }))
                  }
                  className={`w-10 h-6 rounded-full transition-colors p-0.5 ${
                    promoDraft.promotion_remind_member
                      ? "bg-emerald-500"
                      : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      promoDraft.promotion_remind_member ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>

              {/* 관리자 작성 리마인드 */}
              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">
                    관리자 작성 리마인드 <span className="text-slate-300">ⓘ</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    관리자에게 사용 계획 작성 알림을 제출 기한 동안 매일 보내요.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPromoDraft((p) => ({
                      ...p,
                      promotion_remind_admin: !p.promotion_remind_admin,
                    }))
                  }
                  className={`w-10 h-6 rounded-full transition-colors p-0.5 ${
                    promoDraft.promotion_remind_admin
                      ? "bg-emerald-500"
                      : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      promoDraft.promotion_remind_admin ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>

              {/* 사용 계획일 알림 시점 */}
              <div className="py-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-800">
                    사용 계획일 알림 시점
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    구성원에게 사용 계획일 이전에 알림을 보내요.
                  </div>
                </div>
                <select
                  value={promoDraft.promotion_plan_notify_timing}
                  onChange={(e) =>
                    setPromoDraft((p) => ({
                      ...p,
                      promotion_plan_notify_timing: e.target.value,
                    }))
                  }
                  className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-800 bg-white w-48"
                >
                  <option value="사용 계획일 1일 전">사용 계획일 1일 전</option>
                  <option value="사용 계획일 3일 전">사용 계획일 3일 전</option>
                  <option value="사용 계획일 5일 전">사용 계획일 5일 전</option>
                  <option value="사용 계획일 7일 전">사용 계획일 7일 전</option>
                  <option value="사용 계획일 10일 전">사용 계획일 10일 전</option>
                </select>
              </div>
            </div>

            {/* 스마트 연차 촉진 */}
            <div className="pt-2 space-y-3.5 text-xs">
              <div>
                <div className="text-sm font-extrabold text-slate-900">
                  스마트 연차 촉진
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  스마트 연차 촉진 사용 시, 근로기준법을 준수한 연차 촉진을 자동화할 수 있어요.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-800">연차 촉진 시점</div>
                  <div className="text-[11px] text-slate-400">
                    1년 이상 재직 구성원의 자동 촉진 시점
                  </div>
                </div>
                <select
                  value={promoDraft.smart_annual_timing}
                  onChange={(e) =>
                    setPromoDraft((p) => ({
                      ...p,
                      smart_annual_timing: e.target.value,
                    }))
                  }
                  className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-800 bg-white w-48"
                >
                  <option value="소멸 6개월 전">소멸 6개월 전</option>
                  <option value="소멸 6개월 전 + 5일 후">
                    소멸 6개월 전 + 5일 후
                  </option>
                  <option value="소멸 6개월 전 + 10일 후">
                    소멸 6개월 전 + 10일 후
                  </option>
                </select>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="pt-1">
                  <div className="font-bold text-slate-800">월차 촉진 시점</div>
                  <div className="text-[11px] text-slate-400">
                    1년 미만 재직 구성원의 자동 촉진 시점
                  </div>
                </div>
                <div className="space-y-2 w-48">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                      1차
                    </span>
                    <select
                      value={promoDraft.smart_monthly_timing_1st}
                      onChange={(e) =>
                        setPromoDraft((p) => ({
                          ...p,
                          smart_monthly_timing_1st: e.target.value,
                        }))
                      }
                      className="flex-1 font-semibold text-slate-800 outline-none bg-transparent"
                    >
                      <option value="소멸 3개월 전">소멸 3개월 전</option>
                      <option value="소멸 3개월 전 + 5일 후">
                        소멸 3개월 전 + 5일 후
                      </option>
                      <option value="소멸 3개월 전 + 10일 후">
                        소멸 3개월 전 + 10일 후
                      </option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                      2차
                    </span>
                    <select
                      value={promoDraft.smart_monthly_timing_2nd}
                      onChange={(e) =>
                        setPromoDraft((p) => ({
                          ...p,
                          smart_monthly_timing_2nd: e.target.value,
                        }))
                      }
                      className="flex-1 font-semibold text-slate-800 outline-none bg-transparent"
                    >
                      <option value="소멸 1개월 전">소멸 1개월 전</option>
                      <option value="소멸 1개월 전 + 5일 후">
                        소멸 1개월 전 + 5일 후
                      </option>
                      <option value="소멸 1개월 전 + 10일 후">
                        소멸 1개월 전 + 10일 후
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                ⓘ 스마트 연차 촉진은 소멸 유예 설정과 관계없이 법정 연차 소멸일을 기준으로 실행됩니다.
              </p>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSavePromoSettings}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00c800] to-[#00b8b0] hover:opacity-95 text-white text-xs font-extrabold shadow-md disabled:opacity-50"
            >
              {submitting ? "저장 중..." : "변경 사항 저장"}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          모달 5: 연차 사용 계획 요청 모달 (스크린샷 011052 1:1 재현)
         ===================================================================== */}
      {promoReqOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-[440px] p-7">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[20px] font-extrabold text-slate-900">
                  연차 사용 계획 요청
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  소멸되는 휴가에 &apos;연차 촉진&apos;을 해야한다는 사실 알고 계신가요?
                  <br />
                  계획을 요청하여 휴가 사용을 촉진해보세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPromoReqOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSubmitPromoRequest}
              className="mt-5 space-y-4 text-xs"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  👤 촉진 유형 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={reqPromoType}
                  onChange={(e) =>
                    setReqPromoType(e.target.value as HqPromotionKind)
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-800 bg-white"
                >
                  <option value="연차">연차</option>
                  <option value="월차 1차">월차 1차</option>
                  <option value="월차 2차">월차 2차</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  👥 요청 대상 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={reqTargetMode}
                  onChange={(e) =>
                    setReqTargetMode(
                      e.target.value as "ALL_REMAIN" | "SELECT"
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-800 bg-white"
                >
                  <option value="ALL_REMAIN">
                    잔여 연차 보유 전체 구성원 자동 선택
                  </option>
                  <option value="SELECT">직접 구성원 선택</option>
                </select>

                {reqTargetMode === "SELECT" && (
                  <div className="mt-2.5">
                    <HqFlexTargetPicker
                      label="요청 대상 구성원"
                      members={activeMembers}
                      orgNodes={companySettings?.extra_settings?.org_chart_nodes}
                      selectedIds={reqSelectedIds}
                      onChange={setReqSelectedIds}
                      placeholder="요청 대상 선택"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  📅 작성 기한 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={reqDueDate}
                  onChange={(e) => setReqDueDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800"
                />
              </div>

              <p className="text-center text-[11px] text-slate-400 pt-1">
                선택한 대상에게 작성 요청 할 일과 알림이 바로 보내집니다.
              </p>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00c800] to-[#00b8b0] hover:opacity-95 text-white text-xs font-extrabold shadow-md disabled:opacity-50"
              >
                {submitting ? "발송 중..." : "요청하기"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          모달 6: 제출된 연차 사용 계획 [보기] 모달
         ===================================================================== */}
      {viewPlanTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                📅 {viewPlanTarget.member_name} 님의 {viewPlanTarget.year}년 연차 사용 계획
              </h3>
              <button
                type="button"
                onClick={() => setViewPlanTarget(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-500">
              제출 일시: {viewPlanTarget.submitted_at.slice(0, 10)} · 총{" "}
              <strong className="text-slate-900">
                {viewPlanTarget.planned_dates.length}일
              </strong>{" "}
              예정
            </div>

            <div className="flex flex-wrap gap-1.5">
              {viewPlanTarget.planned_dates.map((d) => (
                <span
                  key={d}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold tabular-nums"
                >
                  {d}
                </span>
              ))}
            </div>

            {viewPlanTarget.memo && (
              <p className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700">
                {viewPlanTarget.memo}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
