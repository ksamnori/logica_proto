// src/lib/hq/approvalLine.ts
import {
  AUTO_DELEGATION_RULES,
  getRankLevel,
} from "./constants";
import type {
  HqApprovalDocType,
  HqMember,
  HqRankCode,
} from "./types";

export interface RecommendedStepDraft {
  step_order: number;
  step_role: "REVIEWER" | "DIRECTOR_APPROVER" | "FINAL_APPROVER" | "DELEGATED_FINAL";
  role_label: string;
  approver_id: string;
  approver_name: string;
  approver_dept: string;
  approver_rank: HqRankCode | string;
  approver_title: string;
}

export interface ApprovalLineRecommendation {
  steps: RecommendedStepDraft[];
  isAutoDelegated: boolean;
  delegationReason: string;
  instantSelfApprove: boolean;
}

/**
 * 기안자의 직급·부서, 문서 종류, 금액/휴가일수, 전결 규정 적용 여부에 따라
 * 3단계 표준 결재선 (담당자 기안 → 팀장/부서장 1차 검토 → 본부장/이사 2차 → 대표 최종승인) 자동 생성
 */
export function buildRecommendedApprovalLine(params: {
  drafter: HqMember;
  allMembers: HqMember[];
  docType: HqApprovalDocType;
  amount?: number;
  leaveDays?: number;
  useAutoDelegation?: boolean;
}): ApprovalLineRecommendation {
  const {
    drafter,
    allMembers,
    docType,
    amount = 0,
    leaveDays = 0,
    useAutoDelegation = true,
  } = params;

  const activeOthers = allMembers.filter(
    (m) => m.work_status === "재직" && m.instructor_id !== drafter.instructor_id
  );

  const drafterLevel = getRankLevel(drafter.rank_code);

  // 대표·소장(Lv.5) 본인 기안 시 즉시 전결 처리
  if (drafterLevel >= 5) {
    return {
      steps: [],
      isAutoDelegated: true,
      delegationReason: "최고결재권자(대표·소장) 기안으로 즉시 전결 승인됩니다.",
      instantSelfApprove: true,
    };
  }

  // 1. 문서 성격·금액에 따른 목표 결재 직급(targetMaxLevel) 판정
  let targetMaxLevel = 5; // 기본: 대표(Lv.5) 최종 승인
  let delegationReason = "표준 3단계 결재 규정 (최종 결재권자 승인)";
  let isAutoDelegated = false;

  if (useAutoDelegation) {
    if (docType === "LEAVE") {
      if (leaveDays <= AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_LEAVE_DAYS) {
        targetMaxLevel = Math.max(3, drafterLevel + 1);
        if (targetMaxLevel <= 3) {
          isAutoDelegated = true;
          delegationReason = `단기 휴가(${leaveDays}일 ≤ ${AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_LEAVE_DAYS}일) 팀장 전결 규정 적용`;
        } else if (targetMaxLevel === 4) {
          isAutoDelegated = true;
          delegationReason = "팀장 휴가 신청 → 본부장·이사 전결 규정 적용";
        }
      } else {
        targetMaxLevel = 5;
        delegationReason = `장기 휴가(${leaveDays}일 > ${AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_LEAVE_DAYS}일) 대표 최종 승인 대상`;
      }
    } else if (docType === "EXPENSE" || docType === "PURCHASE") {
      if (amount <= AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_AMOUNT) {
        targetMaxLevel = Math.max(3, drafterLevel + 1);
        if (targetMaxLevel <= 3) {
          isAutoDelegated = true;
          delegationReason = `소액 지출·품의(30만원 이하) 팀장 전결 규정 적용`;
        } else if (targetMaxLevel === 4) {
          isAutoDelegated = true;
          delegationReason = `소액 지출·품의(30만원 이하) 차상위 임원 전결 적용`;
        }
      } else if (amount <= AUTO_DELEGATION_RULES.DIRECTOR_MAX_AMOUNT) {
        targetMaxLevel = Math.max(4, drafterLevel + 1);
        if (targetMaxLevel === 4) {
          isAutoDelegated = true;
          delegationReason = `중액 지출·품의(100만원 이하) 본부장·이사 전결 규정 적용`;
        }
      } else {
        targetMaxLevel = 5;
        delegationReason = `고액 지출·품의(100만원 초과) 3단계 대표 최종 승인 대상`;
      }
    }
  }

  // 후보자 탐색 유틸리티
  const pickBestByRank = (level: number, preferSameDept = false): HqMember | undefined => {
    const matching = activeOthers.filter((m) => getRankLevel(m.rank_code) === level);
    if (matching.length === 0) return undefined;

    if (preferSameDept) {
      const sameDeptHead = matching.find(
        (m) => m.department === drafter.department && m.is_dept_head
      );
      if (sameDeptHead) return sameDeptHead;
      const sameDept = matching.find((m) => m.department === drafter.department);
      if (sameDept) return sameDept;
    }
    const anyHead = matching.find((m) => m.is_dept_head);
    return anyHead || matching[0];
  };

  const chosen: { member: HqMember; role: RecommendedStepDraft["step_role"]; label: string }[] = [];
  const usedIds = new Set<string>();

  const pushUnique = (
    member: HqMember | undefined,
    role: RecommendedStepDraft["step_role"],
    label: string
  ) => {
    if (!member || usedIds.has(member.instructor_id)) return;
    usedIds.add(member.instructor_id);
    chosen.push({ member, role, label });
  };

  // Step 1: 실무자(Lv.1~2) 기안 시 소속 부서 팀장(Lv.3) 검토
  if (drafterLevel <= 2 && targetMaxLevel >= 3) {
    const teamLead = pickBestByRank(3, true);
    if (teamLead) {
      const isFinalHere = targetMaxLevel === 3;
      pushUnique(
        teamLead,
        isFinalHere ? "DELEGATED_FINAL" : "REVIEWER",
        isFinalHere ? "1차 결재 (팀장 전결)" : "1차 검토 (부서장)"
      );
    }
  }

  // Step 2: 본부장·이사(Lv.4) 검토 또는 전결
  if (drafterLevel <= 3 && targetMaxLevel >= 4) {
    const director = pickBestByRank(4, true);
    if (director) {
      const isFinalHere = targetMaxLevel === 4;
      pushUnique(
        director,
        isFinalHere ? "DELEGATED_FINAL" : "DIRECTOR_APPROVER",
        isFinalHere ? "최종 결재 (임원 전결)" : "2차 검토 (임원)"
      );
    }
  }

  // Step 3: 대표·소장(Lv.5) 최종 승인 (또는 상위 전결권자가 부재할 때 폴백)
  if (
    targetMaxLevel >= 5 ||
    chosen.length === 0 ||
    (targetMaxLevel === 4 && !chosen.some((c) => getRankLevel(c.member.rank_code) >= 4))
  ) {
    const ceo = pickBestByRank(5, false);
    if (ceo) {
      pushUnique(ceo, "FINAL_APPROVER", "최종 승인 (대표)");
    }
  }

  // 만약 아직 직급 설정 전이라 상위 직급자가 한 명도 없다면, 같은 부서 부서장 또는 재직 구성원 중 최고 직급자를 1명 추천
  if (chosen.length === 0 && activeOthers.length > 0) {
    const fallback = [...activeOthers].sort(
      (a, b) => getRankLevel(b.rank_code) - getRankLevel(a.rank_code)
    )[0];
    pushUnique(fallback, "FINAL_APPROVER", "결재 승인");
    isAutoDelegated = false;
    delegationReason = "상위 직급자가 아직 지정되지 않아 기본 결재자를 추천했습니다. 구성원 관리에서 직급을 지정해주세요.";
  }

  const steps: RecommendedStepDraft[] = chosen.map((item, idx) => ({
    step_order: idx + 1,
    step_role: item.role,
    role_label: item.label,
    approver_id: item.member.instructor_id,
    approver_name: item.member.name,
    approver_dept: item.member.department,
    approver_rank: item.member.rank_code,
    approver_title: item.member.job_title,
  }));

  return {
    steps,
    isAutoDelegated,
    delegationReason,
    instantSelfApprove: false,
  };
}
