// src/lib/hq/defaultPermissionSettings.ts
import type { HqPermissionScope, HqPermissionSettings } from "./types";

export type CanonicalPermissionScope =
  | "본인만"
  | "소속 주조직"
  | "소속 조직 전체"
  | "소속 주조직 및 하위 조직"
  | "소속 조직 전체 및 하위 조직"
  | "전체 구성원";

export type HqPermissionScopeMode =
  | "NONE" // 드롭다운 없음 (전사 단일 정책 또는 본인이 요청한 건만 고정인 항목)
  | "WITH_SELF" // 6종: 본인만 ~ 전체 구성원
  | "ORG_AND_ALL" // 5종: 소속 주조직 ~ 전체 구성원 ('본인만' 없음)
  | "INSIGHT" // 2종: 소속 조직 전체 및 하위 조직 / 전체 구성원
  | "LOCKED_FULL"; // '전체 구성원'으로만 고정 표기되는 관리 권한

export interface HqPermissionPrerequisiteRule {
  permKey: string;
  requiredScope?: CanonicalPermissionScope;
  matchChildScope?: boolean;
  skipWhenChildIsSelf?: boolean;
}

export interface HqPermissionCatalogItem {
  key: string;
  title: string;
  description: string;
  warningText?: string;
  scopeMode?: HqPermissionScopeMode;
  defaultScope?: CanonicalPermissionScope;
  supportsScope?: boolean;
  lockedFullScope?: boolean;
  prerequisites?: HqPermissionPrerequisiteRule[];
}

export interface HqPermissionCatalogCategory {
  id: string;
  label: string;
  items: HqPermissionCatalogItem[];
}

export interface PermissionScopeOptionMeta {
  value: CanonicalPermissionScope;
  label: CanonicalPermissionScope;
  description: string;
}

export const PERMISSION_SCOPE_DETAILS: PermissionScopeOptionMeta[] = [
  {
    value: "본인만",
    label: "본인만",
    description: "구성원 본인의 정보만 접근할 수 있어요.",
  },
  {
    value: "소속 주조직",
    label: "소속 주조직",
    description: "소속된 주조직의 구성원 정보에 접근할 수 있어요.",
  },
  {
    value: "소속 조직 전체",
    label: "소속 조직 전체",
    description: "소속된 주조직과 겸조직의 구성원 정보에 접근할 수 있어요.",
  },
  {
    value: "소속 주조직 및 하위 조직",
    label: "소속 주조직 및 하위 조직",
    description: "소속된 주조직 및 하위 조직의 구성원 정보에 접근할 수 있어요.",
  },
  {
    value: "소속 조직 전체 및 하위 조직",
    label: "소속 조직 전체 및 하위 조직",
    description:
      "소속된 주조직·겸조직 및 하위 조직의 구성원 정보에 접근할 수 있어요.",
  },
  {
    value: "전체 구성원",
    label: "전체 구성원",
    description: "모든 구성원 정보를 접근할 수 있어요.",
  },
];

export const PERMISSION_SCOPE_OPTIONS: CanonicalPermissionScope[] =
  PERMISSION_SCOPE_DETAILS.map((d) => d.value);

export const PERMISSION_CATEGORIES: HqPermissionCatalogCategory[] = [
  {
    id: "cat-sidebar-menu",
    label: "좌측 메뉴 (ON/OFF)",
    items: [
      {
        key: "menu.notices",
        title: "📢 공지 메뉴 표시 · 열람",
        description:
          "좌측 사이드바에 [공지] 메뉴를 표시하고 사내 공지 열람을 허용해요.",
      },
      {
        key: "menu.members",
        title: "👥 구성원 메뉴 표시 · 접근",
        description:
          "좌측 사이드바에 [구성원] 메뉴를 표시하고 임직원 인사 디렉토리 접근을 허용해요.",
      },
      {
        key: "menu.org_chart",
        title: "🏢 조직도 메뉴 표시 · 열람",
        description:
          "좌측 사이드바에 [조직도] 메뉴를 표시하고 부서 트리 열람을 허용해요.",
      },
      {
        key: "menu.meetings",
        title: "💬 미팅 메뉴 표시 · 참여",
        description:
          "좌측 사이드바에 [미팅] 메뉴를 표시하고 회의록·일정 공유를 허용해요.",
      },
      {
        key: "menu.attendance",
        title: "⏱️ 근무 (내 출퇴근) 메뉴 표시",
        description:
          "좌측 사이드바에 [근무] 메뉴를 표시하고 출퇴근 기록을 허용해요.",
      },
      {
        key: "menu.leaves",
        title: "🏖️ 휴가 (내 휴가) 메뉴 표시",
        description:
          "좌측 사이드바에 [휴가] 메뉴를 표시하고 연차·맞춤휴가 신청을 허용해요.",
      },
      {
        key: "menu.work_management",
        title: "🕒 근태 관리 > 근무 관리 메뉴 표시",
        description:
          "좌측 [근태 관리 > 근무 관리] 관리자 메뉴 노출 및 접근을 허용해요.",
      },
      {
        key: "menu.leave_management",
        title: "🗓️ 근태 관리 > 휴가 관리 메뉴 표시",
        description:
          "좌측 [근태 관리 > 휴가 관리] 관리자 메뉴 노출 및 접근을 허용해요.",
      },
      {
        key: "menu.approvals",
        title: "📋 워크플로우 메뉴 표시",
        description:
          "좌측 사이드바에 [워크플로우] 전자결재 메뉴를 표시해요.",
      },
      {
        key: "menu.contracts",
        title: "📑 전자계약 · 저작권 메뉴 표시",
        description:
          "좌측 사이드바에 [전자계약 · 저작권] 메뉴를 표시해요.",
      },
      {
        key: "menu.expenses",
        title: "💳 비용 · 경비 정산 메뉴 표시",
        description:
          "좌측 사이드바에 [비용 · 경비 정산] 메뉴를 표시해요.",
      },
      {
        key: "menu.payroll",
        title: "💰 급여 · 인세 · 원천세 메뉴 표시",
        description:
          "좌측 사이드바에 [급여 · 인세 · 원천세] 메뉴를 표시해요 (일반 구성원은 본인 급여명세서만 열람).",
      },
      {
        key: "menu.year_end_tax",
        title: "🧾 연말정산 메뉴 표시",
        description:
          "좌측 사이드바에 [연말정산] 메뉴를 표시해요 (간소화 PDF 제출 및 원천징수영수증 발급).",
      },
      {
        key: "menu.insights",
        title: "📈 인사이트 메뉴 표시 · 열람",
        description:
          "좌측 사이드바에 [인사이트] 경영·인력·비용·출판 지표 대시보드를 표시해요.",
        warningText:
          "주의: 인건비·경비 추이 등 경영 지표가 포함되므로 권한 대상을 확인해 주세요.",
      },
      {
        key: "menu.publishing",
        title: "📚 출판 공정 · ISBN 보드 메뉴 표시",
        description:
          "좌측 사이드바에 [출판 공정 · ISBN 보드] 메뉴를 표시해요.",
      },
      {
        key: "menu.analytics",
        title: "📊 진단평가 분석 메뉴 표시",
        description:
          "좌측 사이드바에 [진단평가 분석] 메뉴를 표시해요.",
      },
      {
        key: "menu.contest_db",
        title: "📐 사고력·문장제 문제 DB 메뉴 표시",
        description:
          "좌측 사이드바에 [사고력·문장제 문제 DB] 메뉴를 표시해요.",
      },
      {
        key: "menu.messenger",
        title: "💬 사내 메신저 메뉴 표시",
        description:
          "좌측 사이드바에 [사내 메신저] 메뉴를 표시해요.",
      },
      {
        key: "menu.permissions",
        title: "🔐 포털 권한 관리 메뉴 표시",
        description:
          "좌측 사이드바에 [포털 권한 관리] 메뉴를 표시해요.",
      },
      {
        key: "menu.settings",
        title: "⚙️ 설정 메뉴 표시 · 접근",
        description:
          "좌측 하단에 [설정] 메뉴를 표시하고 회사·인사·근태·권한 설정 접근을 허용해요.",
      },
    ],
  },
  {
    id: "cat-company",
    label: "회사 정보",
    items: [
      {
        key: "company.basic_manage",
        title: "회사 기본 정보 관리",
        description:
          "회사 기본 정보들(이름, 대표자명, 전화번호, 사업자 등록 번호, 주소 등)을 관리할 수 있어요.",
      },
      {
        key: "company.doc_manage",
        title: "회사 문서 관리",
        description:
          "회사의 공유 문서(사업자 등록증, 취업 규칙 등)를 등록하고 관리할 수 있어요.",
      },
      {
        key: "company.holiday_manage",
        title: "회사 쉬는날 설정",
        description:
          "회사에서 사용할 휴일 목록을 관리하고 적용 가능한 쉬는 날 유형을 설정할 수 있어요.",
      },
      {
        key: "company.hr_structure",
        title: "회사 인사 정보 관리",
        description:
          "회사 조직도 및 직위, 직책, 직무, 직급 등의 인사 정보를 관리할 수 있어요.",
      },
      {
        key: "company.org_trend_view",
        title: "회사 조직도 트렌드 조회",
        description:
          "조직도에서 조직의 현황을 확인할 수 있는 각종 지표를 함께 조회할 수 있어요.",
        warningText:
          "주의: 권한 부여 시 급여 등 민감 정보가 노출될 수 있으니 주의해주세요.",
      },
      {
        key: "company.seal_manage",
        title: "회사 직인 설정",
        description: "증명서나 계약에 사용되는 회사 직인을 설정할 수 있어요.",
      },
      {
        key: "company.workplace_manage",
        title: "회사 근무지 설정",
        description:
          "GPS를 이용한 근무 등록 제한에 사용되는 근무지 정보를 설정할 수 있어요.",
      },
      {
        key: "company.custom_info",
        title: "회사 커스텀 정보 설정",
        description:
          "구성원들의 추가 커스텀 정보 입력을 위한 카테고리와 필드를 설정할 수 있어요.",
      },
      {
        key: "company.onboarding_template",
        title: "회사 입퇴사 체크리스트 템플릿 관리",
        description:
          "입퇴사 시 확인 필요한 체크리스트 템플릿을 관리할 수 있어요.",
      },
      {
        key: "company.cert_policy",
        title: "증명서 발급 정책 관리",
        description: "증명서 발급 시의 승인 정책을 관리할 수 있어요.",
      },
      {
        key: "company.doc_box_setting",
        title: "문서함 설정",
        description:
          "주민등록등본, 각종 증명서 등 구성원에게 수집할 서류의 종류를 설정할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-member",
    label: "구성원",
    items: [
      {
        key: "member.directory_access",
        title: "구성원 관리",
        description: "구성원 관리 메뉴에 접근할 수 있어요.",
      },
      {
        key: "member.retiree_view",
        title: "퇴직자 조회",
        description: "구성원 관리 메뉴에서 퇴직자를 포함해 조회할 수 있어요.",
        prerequisites: [{ permKey: "member.directory_access" }],
      },
    ],
  },
  {
    id: "cat-personal",
    label: "구성원 개인 정보",
    items: [
      {
        key: "personal.basic_view",
        title: "구성원 개인 정보 조회",
        description:
          "선택 범위 구성원들의 주민등록번호, 주소, 계좌 등을 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "personal.basic_manage",
        title: "구성원 개인 정보 관리",
        description:
          "전체 구성원 개인 정보를 편집하거나 변경 승인, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "personal.basic_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "personal.family_view",
        title: "구성원 가족 정보 조회",
        description: "선택 범위 구성원들의 가족 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "personal.family_manage",
        title: "구성원 가족 정보 관리",
        description:
          "전체 구성원 가족 정보를 편집하거나 변경 승인, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "personal.family_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "personal.career_edu_view",
        title: "구성원 경력/학력 조회",
        description:
          "선택 범위 구성원들의 경력과 학력 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "personal.career_edu_manage",
        title: "구성원 경력/학력 관리",
        description:
          "전체 구성원들의 경력과 학력 정보를 편집하거나 변경 승인, 검색, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "personal.career_edu_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "personal.doc_view",
        title: "구성원 문서 조회",
        description:
          "선택 범위 구성원들 및 가족에 관련한 제출 문서들을 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "personal.doc_manage",
        title: "구성원 문서 관리",
        description:
          "비밀문서를 포함하여 전체 구성원 문서들을 편집하거나 변경 승인할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "personal.doc_view", requiredScope: "전체 구성원" },
        ],
      },
    ],
  },
  {
    id: "cat-hr",
    label: "구성원 인사 정보",
    items: [
      {
        key: "hr.employment_view",
        title: "구성원 재직 정보 조회",
        description:
          "선택 범위 구성원들의 기본 인사정보와 휴직, 퇴직, 쉬는 날, 포상 및 징계 등의 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.employment_manage",
        title: "구성원 재직 정보 관리",
        description:
          "전체 구성원의 재직 정보를 편집 및 삭제하거나 변경 승인, 검색, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "company.holiday_manage" },
          { permKey: "company.hr_structure" },
          { permKey: "hr.employment_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "hr.labor_contract_view",
        title: "구성원 근로 계약 정보 조회",
        description:
          "선택 범위 구성원들의 근로 계약, 수습 계약 등의 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.labor_contract_manage",
        title: "구성원 근로 계약 정보 관리",
        description:
          "전체 구성원 근로 계약 정보를 편집하거나 검색, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "hr.labor_contract_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "hr.wage_contract_view",
        title: "구성원 임금 계약 정보 조회",
        description: "선택 범위 구성원들의 임금 계약 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.wage_contract_manage",
        title: "구성원 임금 계약 정보 관리",
        description:
          "전체 구성원 임금 계약 정보를 편집하거나 검색, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "hr.wage_contract_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "hr.pay_info_view",
        title: "구성원 지급 정보 조회",
        description: "선택 범위 구성원들의 급여 지급 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
        prerequisites: [
          { permKey: "hr.wage_contract_view", matchChildScope: true },
        ],
      },
      {
        key: "hr.pay_info_manage",
        title: "구성원 지급 정보 관리",
        description:
          "전체 구성원의 급여 지급 정보를 편집하고 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "member.directory_access" },
          { permKey: "hr.pay_info_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "hr.payslip_view",
        title: "구성원 급여 정보 조회",
        description: "선택 범위 구성원들의 급여 명세서를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.custom_info_view",
        title: "구성원 커스텀 정보 조회",
        description: "선택 범위 구성원들의 커스텀 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.custom_info_manage",
        title: "구성원 커스텀 정보 관리",
        description:
          "전체 구성원의 커스텀 정보를 편집하고 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "hr.custom_info_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "hr.training_view",
        title: "구성원 교육 및 역량 조회",
        description:
          "선택 범위 구성원들의 자격증, 외국어, 사내 교육, 사내 경력 등의 정보를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.training_manage",
        title: "구성원 교육 및 역량 관리",
        description:
          "전체 구성원의 교육, 자격증 정보 등을 편집하거나 변경 승인, 검색, 다운로드할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "hr.training_view", requiredScope: "전체 구성원" },
          { permKey: "member.directory_access" },
        ],
      },
      {
        key: "hr.note_view",
        title: "구성원 인사노트 조회",
        description:
          "선택 범위 구성원들에게 작성된 인사노트를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "hr.note_manage",
        title: "구성원 인사노트 관리",
        description: "전체 구성원의 인사노트를 편집할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [
          { permKey: "hr.note_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "hr.checklist_manage",
        title: "구성원 입퇴사 체크리스트 관리",
        description:
          "전체 구성원의 입퇴사 시 체크리스트를 할당하고 편집할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [{ permKey: "member.directory_access" }],
      },
      {
        key: "hr.cert_issue_manage",
        title: "구성원 증명서 발급 관리",
        description:
          "전체 구성원의 재직증명서 및 경력증명서 발급 내역을 조회하고 편집할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
        prerequisites: [{ permKey: "member.directory_access" }],
      },
      {
        key: "hr.invite_manage",
        title: "구성원 초대 관리",
        description: "새로운 구성원을 초대하고 초대 내역을 관리할 수 있어요.",
      },
      {
        key: "hr.invite_template",
        title: "구성원 초대 템플릿 관리",
        description:
          "새로운 구성원 초대를 위한 메일 템플릿을 편집할 수 있어요.",
        prerequisites: [{ permKey: "hr.invite_manage" }],
      },
    ],
  },
  {
    id: "cat-work",
    label: "근무",
    items: [
      {
        key: "work.record_view",
        title: "근무 조회",
        description: "선택 범위 구성원들의 근무 기록을 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "work.approval_view",
        title: "구성원 근무 승인 조회",
        description: "선택 범위 구성원들의 근무 승인 문서를 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
        prerequisites: [
          { permKey: "work.record_view", matchChildScope: true },
        ],
      },
      {
        key: "work.record_edit",
        title: "근무 편집",
        description: "선택 범위 구성원들의 근무 기록을 편집할 수 있어요.",
        scopeMode: "WITH_SELF",
        defaultScope: "본인만",
        supportsScope: true,
        prerequisites: [
          {
            permKey: "work.record_view",
            matchChildScope: true,
            skipWhenChildIsSelf: true,
          },
        ],
      },
      {
        key: "work.realtime_view",
        title: "구성원 실시간 근무 기록 조회",
        description:
          "선택 범위 구성원들의 지나간 실시간 근무 기록(얇은 줄)을 조회할 수 있어요.",
        scopeMode: "WITH_SELF",
        defaultScope: "본인만",
        supportsScope: true,
      },
      {
        key: "work.realtime_edit",
        title: "구성원 실시간 근무 기록 편집",
        description:
          "선택 범위 구성원들의 실시간 근무 기록(얇은 줄)을 종료 후 사후 편집할 수 있어요.",
        scopeMode: "WITH_SELF",
        defaultScope: "본인만",
        supportsScope: true,
        prerequisites: [
          { permKey: "work.realtime_view", matchChildScope: true },
        ],
      },
      {
        key: "work.stats_view",
        title: "구성원 근태 통계 조회",
        description:
          "선택 범위 구성원들의 근태 관련 통계 정보를 근태 대시보드와 근무 기록 다운로드를 통해 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
        prerequisites: [
          { permKey: "work.record_view", matchChildScope: true },
        ],
      },
      {
        key: "work.shift_manage",
        title: "교대근무 관리",
        description:
          "교대 근무표를 관리하고 관련 설정을 변경할 수 있어요. 근무 조회, 휴가 조회, 근무 편집 권한에 따라 근무표를 조회 및 편집할 수 있어요.",
      },
      {
        key: "work.policy_manage",
        title: "근무 유형 및 정책 설정",
        description:
          "회사의 근무 정책과 구성원의 근무 유형을 설정할 수 있어요.",
      },
      {
        key: "work.overtime_comp_manage",
        title: "초과 근무 및 보상 정책 관리",
        description:
          "회사의 초과 근무 정책과 이에 대한 구성원별 보상 정책을 설정할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
      },
      {
        key: "work.comp_leave_manage",
        title: "보상 휴가 관리",
        description:
          "전체 구성원의 초과 근무에 따른 보상 휴가를 관리할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
      },
      {
        key: "work.holiday_sub_manage",
        title: "휴일 대체 관리",
        description: "전체 구성원의 휴일 대체 정보를 관리할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
      },
      {
        key: "work.close_manage",
        title: "근태 마감 관리",
        description:
          "전체 구성원의 등록된 근무 기록 마감 처리를 관리할 수 있어요.",
        scopeMode: "LOCKED_FULL",
        lockedFullScope: true,
      },
    ],
  },
  {
    id: "cat-leave",
    label: "휴가",
    items: [
      {
        key: "leave.view",
        title: "구성원 휴가 조회",
        description:
          "선택 범위 구성원들의 휴가 부여와 사용 내용을 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
      },
      {
        key: "leave.edit",
        title: "구성원 휴가 편집",
        description:
          "선택 범위 구성원들의 휴가 부여와 사용 내용을 편집할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
        prerequisites: [{ permKey: "leave.view", matchChildScope: true }],
      },
      {
        key: "leave.balance_view",
        title: "휴가 보유 현황, 사용 내역 조회",
        description:
          "선택 범위 구성원들의 휴가 보유 현황 및 사용 내역을 근태 관리 메뉴에서 조회할 수 있어요.",
        scopeMode: "ORG_AND_ALL",
        supportsScope: true,
        prerequisites: [{ permKey: "leave.view", matchChildScope: true }],
      },
      {
        key: "leave.annual_policy",
        title: "연차 정책 및 촉진 관리",
        description: "회사의 연차 정책을 설정하고 연차 촉진을 실행할 수 있어요.",
      },
      {
        key: "leave.custom_policy",
        title: "맞춤 휴가 관리",
        description: "회사의 맞춤휴가를 등록하고 관리할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-workflow",
    label: "워크플로우",
    items: [
      {
        key: "workflow.template_manage",
        title: "워크플로우 양식 관리",
        description: "전체 워크플로우 양식과 분류를 편집할 수 있어요.",
      },
      {
        key: "workflow.doc_box_manage",
        title: "회사 문서함 관리",
        description:
          "회사에서 작성된 모든 워크플로우 문서를 조회하고 삭제할 수 있어요.",
        prerequisites: [{ permKey: "workflow.template_manage" }],
      },
    ],
  },
  {
    id: "cat-approval",
    label: "승인",
    items: [
      {
        key: "approval.policy_manage",
        title: "승인 정책 관리",
        description:
          "회사의 모든 승인 정책과 템플릿 및 승인 라벨을 조회하고 편집할 수 있어요.",
      },
      {
        key: "approval.substitute_manage",
        title: "대결 설정 관리",
        description:
          "선택 범위 구성원이 부재 시, 대신 승인할 대결자를 지정할 수 있어요.",
        scopeMode: "WITH_SELF",
        defaultScope: "본인만",
        supportsScope: true,
      },
    ],
  },
  {
    id: "cat-contract",
    label: "전자계약",
    items: [
      {
        key: "contract.all_manage",
        title: "전자계약 관리",
        description: "전체 구성원의 계약을 조회하고 편집할 수 있어요.",
      },
      {
        key: "contract.requested_manage",
        title: "요청 전자계약 관리",
        description: "본인이 요청한 계약만 조회하고 편집할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-payroll",
    label: "급여정산",
    items: [
      {
        key: "payroll.run",
        title: "급여정산",
        description: "급여정산 템플릿을 관리하고 급여정산을 실행할 수 있어요.",
        prerequisites: [
          { permKey: "member.retiree_view" },
          { permKey: "member.directory_access" },
          { permKey: "hr.payslip_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "payroll.severance",
        title: "퇴직소득 관리",
        description: "퇴직소득 정보를 관리하고 퇴직금 정산을 실행할 수 있어요.",
        prerequisites: [
          { permKey: "payroll.run" },
          { permKey: "hr.payslip_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "payroll.social_insurance",
        title: "사회보험 관리",
        description:
          "전체 구성원의 사회보험 자격과 납부 및 신고 내역을 관리할 수 있어요.",
        prerequisites: [
          { permKey: "payroll.run" },
          { permKey: "hr.payslip_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "payroll.cert_issue",
        title: "증명서 발급",
        description: "구성원들의 근로소득 증명서를 발급할 수 있어요.",
        prerequisites: [
          { permKey: "payroll.run" },
          { permKey: "hr.payslip_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "payroll.file_vault",
        title: "급여 파일 관리",
        description: "파일 보관함에 파일을 업로드하고 삭제할 수 있어요.",
        prerequisites: [{ permKey: "payroll.run" }],
      },
      {
        key: "payroll.migration",
        title: "급여자료 이관",
        description: "과거의 급여 정산 결과를 이관할 수 있어요.",
        prerequisites: [{ permKey: "payroll.run" }],
      },
      {
        key: "payroll.year_end",
        title: "연말정산 관리",
        description:
          "연말정산 처리를 위한 구성원 정보와 공제자료를 조회하고 편집할 수 있어요.",
        prerequisites: [
          { permKey: "payroll.run" },
          { permKey: "hr.payslip_view", requiredScope: "전체 구성원" },
        ],
      },
      {
        key: "payroll.year_end_installment",
        title: "연말정산 분납 관리",
        description: "연말 정산 분납 정보를 조회하고 편집할 수 있어요.",
        prerequisites: [
          { permKey: "payroll.year_end" },
          { permKey: "payroll.run" },
        ],
      },
      {
        key: "payroll.pay_item_manage",
        title: "지급 항목 관리",
        description: "급여 지급 항목들을 조회하고 편집할 수 있어요.",
      },
      {
        key: "payroll.deduction_item_manage",
        title: "공제 항목 관리",
        description: "급여 공제 항목들을 조회하고 편집할 수 있어요.",
      },
      {
        key: "payroll.settlement_setting",
        title: "급여 정산 설정",
        description:
          "급여 업무 처리를 위한 회사정보, 사회보험 설정, 공동인증서, 계산 설정 등을 변경할 수 있어요.",
        prerequisites: [{ permKey: "payroll.run" }],
      },
      {
        key: "payroll.tax_filing",
        title: "세금 신고 관리",
        description:
          "원천세, 지방소득세 신고서를 작성 및 관리할 수 있으며 소득에 대한 지급명세서를 받을 수 있어요.",
        prerequisites: [{ permKey: "payroll.run" }],
      },
      {
        key: "payroll.other_income",
        title: "소득 관리",
        description:
          "사업, 기타, 이자·배당, 비거주자 소득을 등록하고 관리할 수 있어요.",
      },
      {
        key: "payroll.workplace_setting",
        title: "사업장 설정",
        description: "지방소득세 신고 사업장을 설정할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-accounting",
    label: "인사 회계",
    items: [
      {
        key: "accounting.cost_center",
        title: "비용 부서 관리",
        description:
          "비용 부서를 생성 및 편집하고 조직 혹은 구성원에 연결 할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-ai",
    label: "AI",
    items: [
      {
        key: "ai.studio_manage",
        title: "AI 스튜디오 관리",
        description:
          "AI 스튜디오에서 에이전트 · 회사 지식 · 커넥터 정책 · 사용량 · 권한을 관리할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-notice",
    label: "공지사항",
    items: [
      {
        key: "notice.manage",
        title: "공지사항 관리",
        description:
          "모든 카테고리와 게시글을 관리하고, 카테고리별 관리자를 지정할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-feedback",
    label: "인정과 피드백",
    items: [
      {
        key: "feedback.manage",
        title: "인정과 피드백 관리",
        description: "인정 메시지를 삭제할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-integration",
    label: "외부 서비스 연동",
    items: [
      {
        key: "integration.slack",
        title: "Slack 연동 관리",
        description:
          "Slack으로 근태 기록을 발송하고 개별 구성원이 승인 요청 등을 받을 수 있도록 관리할 수 있어요.",
      },
      {
        key: "integration.gcal",
        title: "Google 캘린더 연동 관리",
        description:
          "구성원 일정을 Google 그룹 캘린더에 연동되도록 관리할 수 있어요.",
      },
      {
        key: "integration.access_control",
        title: "출입 관리 연동 관리",
        description: "출입관리 시스템 연동 설정을 관리할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-insight",
    label: "인사이트",
    items: [
      {
        key: "insight.view",
        title: "인사이트 조회",
        description:
          "선택 범위 구성원들이 포함된 인사이트 정보를 조회할 수 있어요.",
        warningText:
          "주의: 권한 부여 시 급여 등 민감 정보가 노출될 수 있으니 주의해주세요.",
        scopeMode: "INSIGHT",
        supportsScope: true,
      },
      {
        key: "insight.member_detail_view",
        title: "구성원 정보 포함 조회",
        description:
          "인사이트에서 구성원들의 인사 정보, 개인 정보, 근무 및 휴가 정보 등을 참조한 상세 조회를 할 수 있어요.",
        warningText:
          "주의: 권한 부여 시 급여 등 민감 정보가 노출될 수 있으니 주의해주세요.",
        prerequisites: [{ permKey: "insight.view" }],
      },
    ],
  },
  {
    id: "cat-retiree",
    label: "비구성원",
    items: [
      {
        key: "retiree.account_manage",
        title: "퇴직자 계정 관리",
        description:
          "퇴직자 목록을 조회하고, 셀프 서비스 초대 발송 및 취소와 계정 해지를 할 수 있어요.",
      },
      {
        key: "retiree.doc_history_view",
        title: "퇴직자 문서 발급 이력 조회",
        description: "퇴직자의 서류 발급 이력을 조회할 수 있어요.",
        prerequisites: [{ permKey: "retiree.account_manage" }],
      },
      {
        key: "retiree.doc_policy_manage",
        title: "퇴직자 서류 발급 정책 관리",
        description: "퇴직자 서류의 발급 정책을 관리할 수 있어요.",
        prerequisites: [
          { permKey: "retiree.doc_history_view" },
          { permKey: "retiree.account_manage" },
        ],
      },
    ],
  },
  {
    id: "cat-security",
    label: "보안",
    items: [
      {
        key: "security.otp_manage",
        title: "OTP 2차 인증 설정",
        description:
          "로그인 2차 인증으로 OTP를 설정하고 구성원별 초기화 등의 처리를 할 수 있어요.",
      },
      {
        key: "security.ip_manage",
        title: "접근 허용 IP 설정",
        description:
          "특정 IP에서만 접근 가능한 기능을 설정하고 활성화 여부를 변경할 수 있어요.",
      },
      {
        key: "security.login_manage",
        title: "로그인 설정",
        description:
          "로그인 비밀번호의 옵션을 설정하고 다양한 로그인 관리 기능을 사용할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-billing",
    label: "구독 · 결제",
    items: [
      {
        key: "billing.manage",
        title: "구독 · 결제 관리",
        description:
          "구독 서비스 변경, 청구 요금 조회 및 결제 수단 관리를 할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-audit",
    label: "감사 로그",
    items: [
      {
        key: "audit.view",
        title: "감사 로그 조회",
        description:
          "정보처리 시스템으로써 중요 기록에 대한 조회와 다운로드를 할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-group-insurance",
    label: "단체 보험",
    items: [
      {
        key: "insurance.quote_view",
        title: "예상 견적 조회",
        description:
          "단체 보험 상품 정보 및 예상 견적을 조회하고 다운로드 할 수 있어요.",
      },
      {
        key: "insurance.manage",
        title: "단체 보험 관리",
        description:
          "단체 보험 가입자 목록을 관리하고, 가입 시 입력한 개인 정보를 조회하거나 계약을 갱신할 수 있어요.",
        prerequisites: [{ permKey: "insurance.quote_view" }],
      },
    ],
  },
  {
    id: "cat-it-asset",
    label: "IT 자산",
    items: [
      {
        key: "it_asset.manage",
        title: "IT 자산 관리",
        description: "회사 IT 자산을 등록하고 상태를 관리할 수 있어요.",
      },
    ],
  },
  {
    id: "cat-permission",
    label: "권한",
    items: [
      {
        key: "permission.manage",
        title: "권한 설정",
        description:
          "권한 그룹과 권한 연결을 설정하고 구성원을 할당 할 수 있어요.",
      },
    ],
  },
];

export const PERMISSION_ITEM_BY_KEY: Record<string, HqPermissionCatalogItem> =
  Object.fromEntries(
    PERMISSION_CATEGORIES.flatMap((cat) => cat.items.map((it) => [it.key, it]))
  );

/**
 * 권한 항목의 scopeMode에 따라 실제 선택 가능한 드롭다운 옵션 목록 반환
 */
export function getAllowedScopeOptionsForItem(
  item: HqPermissionCatalogItem
): PermissionScopeOptionMeta[] {
  const mode: HqPermissionScopeMode =
    item.scopeMode ||
    (item.lockedFullScope
      ? "LOCKED_FULL"
      : item.supportsScope
        ? "ORG_AND_ALL"
        : "NONE");

  if (mode === "WITH_SELF") {
    return PERMISSION_SCOPE_DETAILS;
  }
  if (mode === "ORG_AND_ALL") {
    return PERMISSION_SCOPE_DETAILS.filter((d) => d.value !== "본인만");
  }
  if (mode === "INSIGHT") {
    return PERMISSION_SCOPE_DETAILS.filter(
      (d) =>
        d.value === "소속 조직 전체 및 하위 조직" || d.value === "전체 구성원"
    );
  }
  return [];
}

/**
 * 구버전 저장값("하위 조직 포함", "소속 조직")을 6단계 정식 범위로 정규화하고,
 * 해당 권한에서 허용하지 않는 범위(예: '본인만' 불가 항목)일 경우 안전한 기본값 반환
 */
export function normalizePermissionScope(
  rawScope: HqPermissionScope | string | undefined,
  item: HqPermissionCatalogItem
): CanonicalPermissionScope {
  if (item.scopeMode === "LOCKED_FULL" || item.lockedFullScope) {
    return "전체 구성원";
  }

  let mapped: CanonicalPermissionScope | undefined;
  if (rawScope === "하위 조직 포함") {
    mapped =
      item.scopeMode === "INSIGHT"
        ? "소속 조직 전체 및 하위 조직"
        : "소속 주조직 및 하위 조직";
  } else if (rawScope === "소속 조직") {
    mapped = "소속 주조직";
  } else if (
    rawScope === "본인만" ||
    rawScope === "소속 주조직" ||
    rawScope === "소속 조직 전체" ||
    rawScope === "소속 주조직 및 하위 조직" ||
    rawScope === "소속 조직 전체 및 하위 조직" ||
    rawScope === "전체 구성원"
  ) {
    mapped = rawScope;
  }

  const allowed = getAllowedScopeOptionsForItem(item).map((o) => o.value);
  if (allowed.length === 0) return "전체 구성원";
  if (mapped && allowed.includes(mapped)) return mapped;
  if (item.defaultScope && allowed.includes(item.defaultScope)) {
    return item.defaultScope;
  }
  return "전체 구성원";
}

/**
 * 부분순서(Partial-Order) 범위 포함 관계 판별:
 * grantedScope가 requiredScope 이상의 구성원 범위를 포괄하는지 검사
 */
export function doesScopeCover(
  grantedScope: CanonicalPermissionScope,
  requiredScope: CanonicalPermissionScope
): boolean {
  if (grantedScope === requiredScope) return true;
  if (grantedScope === "전체 구성원") return true;
  if (grantedScope === "소속 조직 전체 및 하위 조직") {
    return requiredScope !== "전체 구성원";
  }
  if (grantedScope === "소속 주조직 및 하위 조직") {
    return (
      requiredScope === "소속 주조직" ||
      requiredScope === "본인만"
    );
  }
  if (grantedScope === "소속 조직 전체") {
    return (
      requiredScope === "소속 주조직" ||
      requiredScope === "본인만"
    );
  }
  if (grantedScope === "소속 주조직") {
    return requiredScope === "본인만";
  }
  return false;
}

/**
 * 기존 범위와 필수 요구 범위를 모두 포괄하는 최소 상위 범위 계산
 */
export function mergeScopeToCover(
  currentScope: CanonicalPermissionScope | undefined,
  requiredScope: CanonicalPermissionScope,
  targetItem: HqPermissionCatalogItem
): CanonicalPermissionScope {
  const normTargetReq = normalizePermissionScope(requiredScope, targetItem);
  if (!currentScope) return normTargetReq;
  const normCur = normalizePermissionScope(currentScope, targetItem);
  if (doesScopeCover(normCur, normTargetReq)) return normCur;
  if (doesScopeCover(normTargetReq, normCur)) return normTargetReq;

  // '소속 조직 전체'(겸직 포함) + '소속 주조직 및 하위 조직'(하위 포함) -> '소속 조직 전체 및 하위 조직'
  if (
    (normCur === "소속 조직 전체" &&
      normTargetReq === "소속 주조직 및 하위 조직") ||
    (normCur === "소속 주조직 및 하위 조직" &&
      normTargetReq === "소속 조직 전체")
  ) {
    return normalizePermissionScope("소속 조직 전체 및 하위 조직", targetItem);
  }
  return "전체 구성원";
}

export interface MissingPrerequisiteDetail {
  permKey: string;
  title: string;
  description: string;
  requiredScope?: CanonicalPermissionScope;
  hasScopeDisplay: boolean;
}

/**
 * 특정 권한(permKey)이 체크된 상태에서 현재 누락된 상위(필수) 권한 목록 계산 (연쇄 상위 권한 포함)
 */
export function getMissingPrerequisitesForPerm(
  permKey: string,
  activePerms: Record<string, boolean>,
  activeScopes: Record<string, HqPermissionScope>
): MissingPrerequisiteDetail[] {
  if (!activePerms[permKey]) return [];
  const rootItem = PERMISSION_ITEM_BY_KEY[permKey];
  if (!rootItem?.prerequisites || rootItem.prerequisites.length === 0) {
    return [];
  }

  const requiredMap = new Map<
    string,
    { item: HqPermissionCatalogItem; reqScope?: CanonicalPermissionScope }
  >();
  const visited = new Set<string>();

  const walk = (
    curKey: string,
    effectiveChildScope: CanonicalPermissionScope
  ) => {
    const visitToken = `${curKey}@${effectiveChildScope}`;
    if (visited.has(visitToken)) return;
    visited.add(visitToken);

    const curItem = PERMISSION_ITEM_BY_KEY[curKey];
    if (!curItem?.prerequisites) return;

    for (const rule of curItem.prerequisites) {
      if (rule.skipWhenChildIsSelf && effectiveChildScope === "본인만") {
        continue;
      }
      const parentItem = PERMISSION_ITEM_BY_KEY[rule.permKey];
      if (!parentItem) continue;

      const parentSupportsScope =
        getAllowedScopeOptionsForItem(parentItem).length > 0 ||
        Boolean(parentItem.lockedFullScope || parentItem.scopeMode === "LOCKED_FULL");

      let neededScope: CanonicalPermissionScope | undefined;
      if (rule.requiredScope) {
        neededScope = normalizePermissionScope(rule.requiredScope, parentItem);
      } else if (rule.matchChildScope && parentSupportsScope) {
        neededScope = normalizePermissionScope(effectiveChildScope, parentItem);
      } else if (parentItem.lockedFullScope || parentItem.scopeMode === "LOCKED_FULL") {
        neededScope = "전체 구성원";
      }

      const prev = requiredMap.get(parentItem.key);
      const mergedReq =
        neededScope && prev?.reqScope
          ? mergeScopeToCover(prev.reqScope, neededScope, parentItem)
          : neededScope || prev?.reqScope;

      requiredMap.set(parentItem.key, {
        item: parentItem,
        reqScope: mergedReq,
      });

      const nextWalkScope =
        mergedReq ||
        normalizePermissionScope(activeScopes[parentItem.key], parentItem);
      walk(parentItem.key, nextWalkScope);
    }
  };

  const rootScope = normalizePermissionScope(activeScopes[permKey], rootItem);
  walk(permKey, rootScope);

  const missing: MissingPrerequisiteDetail[] = [];
  requiredMap.forEach(({ item: pItem, reqScope }) => {
    const isChecked = Boolean(activePerms[pItem.key]);
    const pAllowed = getAllowedScopeOptionsForItem(pItem);
    const hasScopeDisplay =
      pAllowed.length > 0 ||
      Boolean(pItem.lockedFullScope || pItem.scopeMode === "LOCKED_FULL");

    if (!isChecked) {
      missing.push({
        permKey: pItem.key,
        title: pItem.title,
        description: pItem.description,
        requiredScope: reqScope,
        hasScopeDisplay: Boolean(reqScope && hasScopeDisplay),
      });
      return;
    }

    if (reqScope && pAllowed.length > 0) {
      const currentGrant = normalizePermissionScope(
        activeScopes[pItem.key],
        pItem
      );
      if (!doesScopeCover(currentGrant, reqScope)) {
        missing.push({
          permKey: pItem.key,
          title: pItem.title,
          description: pItem.description,
          requiredScope: mergeScopeToCover(currentGrant, reqScope, pItem),
          hasScopeDisplay: true,
        });
      }
    }
  });

  return missing;
}

/**
 * [적용하기] 클릭 시 해당 권한(또는 전체 권한)의 상위 필수 권한 및 범위를 한 번에 채워주는 패치 생성
 */
export function buildPrereqSatisfyingPatch(
  targetPermKeys: string[],
  activePerms: Record<string, boolean>,
  activeScopes: Record<string, HqPermissionScope>
): {
  nextPerms: Record<string, boolean>;
  nextScopes: Record<string, HqPermissionScope>;
} {
  const nextPerms: Record<string, boolean> = { ...activePerms };
  const nextScopes: Record<string, HqPermissionScope> = { ...activeScopes };

  let changed = true;
  let guard = 0;
  while (changed && guard < 10) {
    changed = false;
    guard++;
    const keysToInspect =
      guard === 1
        ? targetPermKeys
        : Object.keys(nextPerms).filter((k) => nextPerms[k]);

    for (const k of keysToInspect) {
      const missing = getMissingPrerequisitesForPerm(k, nextPerms, nextScopes);
      for (const m of missing) {
        const pItem = PERMISSION_ITEM_BY_KEY[m.permKey];
        if (!nextPerms[m.permKey]) {
          nextPerms[m.permKey] = true;
          changed = true;
        }
        if (m.requiredScope && pItem && getAllowedScopeOptionsForItem(pItem).length > 0) {
          const merged = mergeScopeToCover(
            nextScopes[m.permKey] as CanonicalPermissionScope | undefined,
            m.requiredScope,
            pItem
          );
          if (nextScopes[m.permKey] !== merged) {
            nextScopes[m.permKey] = merged;
            changed = true;
          }
        }
      }
    }
  }

  return { nextPerms, nextScopes };
}

export const DEFAULT_PERMISSION_SETTINGS: HqPermissionSettings = {
  menu_linked_v2: true,
  super_admin_names: ["천종현", "김근식", "이웅행"],
  super_admin_ids: [],
  org_head_permissions: {
    "menu.members": true,
    "menu.work_management": true,
    "menu.leave_management": true,
    "menu.publishing": true,
    "member.directory_access": true,
    "hr.employment_view": true,
    "work.record_view": true,
    "work.approval_view": true,
    "work.realtime_view": true,
    "work.stats_view": true,
    "leave.view": true,
    "leave.balance_view": true,
    "approval.substitute_manage": true,
  },
  org_head_scopes: {
    "hr.employment_view": "소속 주조직 및 하위 조직",
    "work.record_view": "소속 주조직 및 하위 조직",
    "work.approval_view": "소속 주조직 및 하위 조직",
    "work.realtime_view": "소속 주조직 및 하위 조직",
    "work.stats_view": "소속 주조직 및 하위 조직",
    "leave.view": "소속 주조직 및 하위 조직",
    "leave.balance_view": "소속 주조직 및 하위 조직",
    "approval.substitute_manage": "소속 주조직",
  },
  default_member_permissions: {
    "menu.notices": true,
    "menu.org_chart": true,
    "menu.meetings": true,
    "menu.attendance": true,
    "menu.leaves": true,
    "menu.approvals": true,
    "menu.contracts": true,
    "menu.expenses": true,
    "menu.payroll": true,
    "menu.year_end_tax": true,
    "menu.messenger": true,
    "work.record_edit": true,
    "approval.substitute_manage": true,
  },
  default_member_scopes: {
    "work.record_edit": "본인만",
    "approval.substitute_manage": "본인만",
  },
  member_overrides: {},
  groups: [
    {
      id: "pg-v1-work",
      name: "1.0 근무 관리",
      description: "migrated from v1",
      member_names: ["천종현", "김근식", "이웅행"],
      permissions: {
        "work.record_view": true,
        "work.approval_view": true,
        "work.record_edit": true,
        "work.realtime_view": true,
        "work.realtime_edit": true,
        "work.stats_view": true,
        "work.policy_manage": true,
        "work.overtime_comp_manage": true,
        "work.comp_leave_manage": true,
        "work.holiday_sub_manage": true,
        "work.close_manage": true,
        "leave.view": true,
        "leave.edit": true,
        "leave.balance_view": true,
        "leave.annual_policy": true,
        "leave.custom_policy": true,
      },
      scopes: {
        "work.record_edit": "전체 구성원",
      },
    },
    {
      id: "pg-v1-payroll-yearend",
      name: "1.0 급여, 연말정산",
      description: "migrated from v1",
      member_names: ["천종현", "김근식"],
      permissions: {
        "member.directory_access": true,
        "member.retiree_view": true,
        "hr.payslip_view": true,
        "payroll.run": true,
        "payroll.severance": true,
        "payroll.social_insurance": true,
        "payroll.cert_issue": true,
        "payroll.file_vault": true,
        "payroll.year_end": true,
        "payroll.year_end_installment": true,
        "payroll.tax_filing": true,
        "payroll.settlement_setting": true,
        "payroll.workplace_setting": true,
      },
      scopes: {
        "hr.payslip_view": "전체 구성원",
      },
    },
    {
      id: "pg-v1-settings",
      name: "1.0 설정 관리",
      description: "migrated from v1",
      member_names: ["천종현", "김근식"],
      permissions: {
        "company.basic_manage": true,
        "company.doc_manage": true,
        "company.holiday_manage": true,
        "company.hr_structure": true,
        "company.seal_manage": true,
        "company.workplace_manage": true,
        "company.custom_info": true,
        "company.cert_policy": true,
        "company.doc_box_setting": true,
        "workflow.template_manage": true,
        "approval.policy_manage": true,
        "retiree.account_manage": true,
        "retiree.doc_history_view": true,
        "retiree.doc_policy_manage": true,
        "security.otp_manage": true,
        "security.ip_manage": true,
        "security.login_manage": true,
        "permission.manage": true,
      },
      scopes: {},
    },
    {
      id: "pg-v1-pay-deduct",
      name: "1.0 수당, 공제 관리",
      description: "migrated from v1",
      member_names: ["천종현", "김근식"],
      permissions: {
        "member.directory_access": true,
        "hr.wage_contract_view": true,
        "hr.pay_info_view": true,
        "hr.pay_info_manage": true,
        "payroll.pay_item_manage": true,
        "payroll.deduction_item_manage": true,
      },
      scopes: {
        "hr.wage_contract_view": "전체 구성원",
        "hr.pay_info_view": "전체 구성원",
      },
    },
    {
      id: "pg-v1-viewer-career",
      name: "1.0 열람권자(경력, 학력)",
      description: "migrated from v1",
      member_names: ["천종현", "김근식"],
      permissions: {
        "personal.career_edu_view": true,
        "hr.training_view": true,
      },
      scopes: {
        "personal.career_edu_view": "전체 구성원",
        "hr.training_view": "전체 구성원",
      },
    },
    {
      id: "pg-v1-viewer-attendance",
      name: "1.0 열람권자(근태)",
      description: "migrated from v1",
      member_names: [],
      permissions: {
        "work.record_view": true,
        "work.realtime_view": true,
        "work.stats_view": true,
        "leave.view": true,
        "leave.balance_view": true,
      },
      scopes: {},
    },
    {
      id: "pg-v1-viewer-payroll",
      name: "1.0 열람권자(급여)",
      description: "migrated from v1",
      member_names: [],
      permissions: {
        "hr.wage_contract_view": true,
        "hr.pay_info_view": true,
        "hr.payslip_view": true,
      },
      scopes: {},
    },
    {
      id: "pg-v1-hr-contract",
      name: "1.0 인사 관리(급여, 계약)",
      description: "migrated from v1",
      member_names: ["천종현", "김근식"],
      permissions: {
        "company.holiday_manage": true,
        "company.hr_structure": true,
        "member.directory_access": true,
        "member.retiree_view": true,
        "personal.basic_view": true,
        "personal.basic_manage": true,
        "personal.family_view": true,
        "personal.family_manage": true,
        "personal.doc_view": true,
        "personal.doc_manage": true,
        "hr.employment_view": true,
        "hr.employment_manage": true,
        "hr.labor_contract_view": true,
        "hr.labor_contract_manage": true,
        "hr.wage_contract_view": true,
        "hr.wage_contract_manage": true,
        "hr.cert_issue_manage": true,
        "hr.invite_manage": true,
        "contract.all_manage": true,
      },
      scopes: {},
    },
  ],
};
