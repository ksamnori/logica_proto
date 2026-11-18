// src/lib/hq/defaultWorkflowForms.ts
import { DEFAULT_APPROVAL_POLICIES, PRESET_ASSIGNEES } from "./defaultApprovalPolicies";
import type {
  HqApprovalPolicyItem,
  HqMember,
  HqPolicyAssignee,
  HqSubstituteApprovalRule,
  HqWorkflowFieldDef,
  HqWorkflowFieldType,
  HqWorkflowFormDef,
} from "./types";

export interface WorkflowFieldCatalogEntry {
  type: HqWorkflowFieldType;
  label: string;
  badge: string;
  group: "BASIC" | "MEMBER" | "HR";
  autoLinked?: boolean;
}

export const WORKFLOW_FIELD_CATALOG: WorkflowFieldCatalogEntry[] = [
  // 기본 필드 (Screenshot 8 상단)
  { type: "TEXT", label: "글자", badge: "TT", group: "BASIC" },
  { type: "NUMBER", label: "숫자", badge: "1", group: "BASIC" },
  { type: "KRW", label: "금액 (원)", badge: "₩", group: "BASIC" },
  { type: "USD", label: "금액 (달러)", badge: "$", group: "BASIC" },
  { type: "JPY", label: "금액 (엔)", badge: "¥", group: "BASIC" },
  { type: "DATE", label: "날짜", badge: "📅", group: "BASIC" },
  { type: "SELECT", label: "선택", badge: "⊙", group: "BASIC" },
  { type: "MULTI_SELECT", label: "다중 선택", badge: "☰", group: "BASIC" },
  { type: "REF_DOC", label: "참조 문서", badge: "🔗", group: "BASIC" },

  // 구성원 정보 연동 (Screenshot 8 중단)
  { type: "MEMBER_NAME", label: "이름", badge: "Aa", group: "MEMBER", autoLinked: true },
  { type: "MEMBER_NICKNAME", label: "닉네임", badge: "😊", group: "MEMBER", autoLinked: true },
  { type: "MEMBER_ENG_NAME", label: "영문 이름", badge: "🌐", group: "MEMBER", autoLinked: true },
  { type: "MEMBER_EMAIL", label: "이메일", badge: "✉️", group: "MEMBER", autoLinked: true },
  { type: "MEMBER_PHONE", label: "전화번호", badge: "📞", group: "MEMBER", autoLinked: true },
  { type: "MEMBER_BIRTH", label: "생년월일", badge: "🎂", group: "MEMBER", autoLinked: true },

  // 인사 정보 연동 (Screenshot 8 하단)
  { type: "HR_EMP_NO", label: "사번", badge: "#", group: "HR", autoLinked: true },
  { type: "HR_DEPT", label: "조직", badge: "🏢", group: "HR", autoLinked: true },
  { type: "HR_TITLE", label: "직책", badge: "☑️", group: "HR", autoLinked: true },
  { type: "HR_JOB", label: "직무", badge: "✏️", group: "HR", autoLinked: true },
  { type: "HR_POSITION", label: "직위", badge: "🎖️", group: "HR", autoLinked: true },
  { type: "HR_HIRE_DATE", label: "입사일", badge: "📆", group: "HR", autoLinked: true },
];

export const DEFAULT_WORKFLOW_CATEGORIES: string[] = [
  "지출 · 비용",
  "인사 · 근태",
  "출판 · 외주",
  "일반 · 계정",
];

function findSeedPolicy(id: string): HqApprovalPolicyItem | undefined {
  return DEFAULT_APPROVAL_POLICIES.find((p) => p.id === id);
}

const seedPost = findSeedPolicy("wf-expense-post");
const seedPre = findSeedPolicy("wf-expense-pre");
const seedAnnual = findSeedPolicy("wf-annual-plan");
const seedMeal = findSeedPolicy("wf-meal");
const seedGeneral = findSeedPolicy("wf-general");
const seedHolidaySub = findSeedPolicy("wf-holiday-sub");
const seedAccount = findSeedPolicy("wf-account-req");

export const DEFAULT_WORKFLOW_FORMS: HqWorkflowFormDef[] = [
  {
    id: "wf-expense-post",
    category_name: "지출 · 비용",
    title: "1.지출품의서(사후)",
    description:
      "아래 항목들(날짜, 용처·거래처, 금액)을 입력해주시고 영수증 및 증빙자료를 첨부해주세요. 사전 지출계획서가 승인된 건은 [참조 문서]로 연결해 주세요.",
    icon: "📋",
    icon_bg: "#dbeafe",
    mapped_doc_type: "EXPENSE",
    fields: [
      {
        id: "fld-ref-pre",
        type: "REF_DOC",
        label: "사전 승인 문서 연결 (1.지출계획서)",
        required: false,
      },
      {
        id: "fld-dept",
        type: "HR_DEPT",
        label: "소속 조직",
      },
    ],
    body_template:
      "1. 지출 목적 및 사유:\n\n2. 세부 내역 (날짜 / 거래처 / 금액):\n- \n\n3. 비고 (영수증·세금계산서 증빙 확인):",
    attachment_mode: "REQUIRED",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: seedPost?.allow_edit ?? true,
    per_requester: seedPost?.per_requester ?? false,
    cc_list: seedPost?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedPost?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
  {
    id: "wf-expense-pre",
    category_name: "지출 · 비용",
    title: "1.지출계획서(사전)",
    description:
      "비용 지출 계획이 있는 경우 사전 승인 요청을 작성해주세요. 승인 완료 후 실제 결제 시 [1.지출품의서(사후)]로 이어서 정산할 수 있습니다.",
    icon: "📋",
    icon_bg: "#ffedd5",
    mapped_doc_type: "PURCHASE",
    fields: [
      {
        id: "fld-purpose",
        type: "SELECT",
        label: "지출 구분",
        required: true,
        options: [
          "도서·교재 인쇄/제작",
          "AI·클라우드·SW 구독",
          "외주 용역·디자인",
          "마케팅·홍보",
          "사무용품·비품 구매",
          "기타 업무 지출",
        ],
      },
      {
        id: "fld-expected-date",
        type: "DATE",
        label: "결제 예정일",
        required: false,
      },
    ],
    body_template:
      "1. 도입/지출 목적:\n\n2. 기대 효과 및 활용 계획:\n\n3. 예상 소요 비용 및 산출 근거:\n",
    attachment_mode: "OPTIONAL",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: seedPre?.allow_edit ?? true,
    per_requester: seedPre?.per_requester ?? false,
    cc_list: seedPre?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedPre?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
  {
    id: "wf-annual-plan",
    category_name: "인사 · 근태",
    title: "2.연차 사용 계획",
    description:
      "당해 연말(12월 31일) 기준 잔여 연차 소진을 위한 연차 사용 계획서를 제출해주세요.",
    icon: "📋",
    icon_bg: "#fce7f3",
    mapped_doc_type: "LEAVE",
    fields: [
      { id: "fld-emp-name", type: "MEMBER_NAME", label: "성명" },
      { id: "fld-emp-dept", type: "HR_DEPT", label: "조직" },
      {
        id: "fld-target-quarter",
        type: "SELECT",
        label: "사용 계획 시기",
        required: true,
        options: ["상반기 집중 사용", "하반기 집중 사용", "월별 분산 사용", "연말 일괄 소진"],
      },
    ],
    body_template:
      "1. 현재 잔여 연차 확인:\n2. 월별 연차 사용 예정일:\n- \n3. 부재 시 업무 인수인계 계획:\n",
    attachment_mode: "NONE",
    use_body: true,
    allow_doc_edit: false,
    allow_edit: seedAnnual?.allow_edit ?? false,
    per_requester: seedAnnual?.per_requester ?? true,
    cc_list: seedAnnual?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedAnnual?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
    requester_rules: seedAnnual?.requester_rules,
  },
  {
    id: "wf-meal",
    category_name: "지출 · 비용",
    title: "식비 사용 내역",
    description:
      "야근 식대, 팀 회식비, 외부 미팅 식비 사용 내역을 영수증과 함께 기록합니다.",
    icon: "🍔",
    icon_bg: "#fef3c7",
    mapped_doc_type: "EXPENSE",
    fields: [
      {
        id: "fld-meal-type",
        type: "SELECT",
        label: "식비 구분",
        required: true,
        options: ["야근·특근 식대", "부서 회식·간담회", "외부 저자·거래처 미팅", "기타 식비"],
      },
      {
        id: "fld-attendees",
        type: "TEXT",
        label: "참석 인원 및 명단",
        required: true,
        placeholder: "예: 집필팀 4명 (김문수, 백시연, 민세리, 원호준)",
      },
    ],
    body_template: "식사 일시 및 참석자 내역을 기재해 주세요.",
    attachment_mode: "OPTIONAL",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: seedMeal?.allow_edit ?? true,
    per_requester: seedMeal?.per_requester ?? false,
    cc_list: seedMeal?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedMeal?.steps ?? [],
  },
  {
    id: "wf-general",
    category_name: "일반 · 계정",
    title: "품의서",
    description: "업무 기안, 대외 협약, 신규 기획안 등 일반 품의 사항을 상신합니다.",
    icon: "📋",
    icon_bg: "#ede9fe",
    mapped_doc_type: "GENERAL",
    fields: [
      { id: "fld-gen-dept", type: "HR_DEPT", label: "기안 부서" },
      { id: "fld-gen-date", type: "DATE", label: "시행 예정일" },
    ],
    body_template: "1. 품의 배경 및 목적:\n\n2. 주요 내용:\n\n3. 기대 효과 및 향후 일정:\n",
    attachment_mode: "OPTIONAL",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: seedGeneral?.allow_edit ?? true,
    per_requester: seedGeneral?.per_requester ?? false,
    cc_list: seedGeneral?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedGeneral?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
  {
    id: "wf-holiday-sub",
    category_name: "인사 · 근태",
    title: "휴일 대체 동의서",
    description:
      "부득이한 주말·공휴일 출근(도서 마감, 입시 설명회 등) 시 대체 휴무일 지정 동의를 요청합니다.",
    icon: "📋",
    icon_bg: "#fef9c3",
    mapped_doc_type: "GENERAL",
    fields: [
      { id: "fld-hol-workdate", type: "DATE", label: "휴일 근무일", required: true },
      { id: "fld-hol-subdate", type: "DATE", label: "대체 휴무 예정일", required: true },
      {
        id: "fld-hol-reason",
        type: "TEXT",
        label: "휴일 근무 사유",
        required: true,
        placeholder: "예: 원리셈 개정판 하판 최종 교정",
      },
    ],
    body_template:
      "근로기준법 제55조 제2항에 의거하여 위와 같이 휴일 근로를 실시하고 지정한 대체 휴무일에 휴무하는 것에 동의합니다.",
    attachment_mode: "NONE",
    use_body: true,
    allow_doc_edit: false,
    allow_edit: seedHolidaySub?.allow_edit ?? true,
    per_requester: seedHolidaySub?.per_requester ?? false,
    cc_list: seedHolidaySub?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedHolidaySub?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
  {
    id: "wf-account-req",
    category_name: "일반 · 계정",
    title: "계정 신청",
    description:
      "Google Workspace, Adobe CC, Gemini/ChatGPT, Claude, AWS, 노션 등 업무용 소프트웨어 계정을 신청합니다.",
    icon: "🔑",
    icon_bg: "#dcfce7",
    mapped_doc_type: "GENERAL",
    fields: [
      {
        id: "fld-acc-service",
        type: "MULTI_SELECT",
        label: "신청 서비스 선택",
        required: true,
        options: [
          "Google Workspace (사내 메일)",
          "Adobe Creative Cloud (인디자인/일러스트)",
          "Google Gemini / ChatGPT 유료 계정",
          "Claude (Anthropic) 유료 계정",
          "AWS / 클라우드 인프라",
          "Slack / 협업툴",
          "기타 업무용 SW",
        ],
      },
      { id: "fld-acc-email", type: "MEMBER_EMAIL", label: "연동 이메일" },
    ],
    body_template: "1. 계정 사용 목적:\n\n2. 필요 권한 범위 및 사용 기간:\n",
    attachment_mode: "NONE",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: seedAccount?.allow_edit ?? true,
    per_requester: seedAccount?.per_requester ?? false,
    cc_list: seedAccount?.cc_list ?? [PRESET_ASSIGNEES.KIM_GS],
    steps: seedAccount?.steps ?? [{ step_order: 1, assignees: [PRESET_ASSIGNEES.KIM_GS] }],
  },
  // 천종현수학연구소 출판·연구 맞춤 스마트 양식 2종 추가
  {
    id: "wf-pub-print",
    category_name: "출판 · 외주",
    title: "인쇄·하판 제작발주 품의서",
    description:
      "신간 출간 및 중쇄 도서의 인쇄·제본·후가공 발주 내역과 견적서를 상신합니다.",
    icon: "📚",
    icon_bg: "#e0e7ff",
    mapped_doc_type: "PURCHASE",
    is_smart_form: true,
    fields: [
      {
        id: "fld-book-name",
        type: "TEXT",
        label: "교재 · 도서명",
        required: true,
        placeholder: "예: 소마 원리셈 P단계 개정판 / 따블 심화 4호",
      },
      {
        id: "fld-edition",
        type: "SELECT",
        label: "발주 구분",
        required: true,
        options: ["신간 초판 1쇄", "개정판 1쇄", "중쇄 (재발주)", "샘플·가제본 제작"],
      },
      {
        id: "fld-print-qty",
        type: "NUMBER",
        label: "발주 부수 (부)",
        required: true,
        placeholder: "3000",
      },
      {
        id: "fld-delivery-date",
        type: "DATE",
        label: "물류창고 입고 희망일",
        required: true,
      },
      {
        id: "fld-pub-ref",
        type: "REF_DOC",
        label: "사전 지출계획서 연결 (선택)",
      },
    ],
    body_template:
      "1. 판형 / 쪽수 / 용지 사양:\n- 표지: \n- 내지: \n- 후가공(코팅·박·형압): \n\n2. 인쇄소 및 제본처:\n\n3. 특이사항 (ISBN 바코드 / 정가 표기 검수 완료 여부):",
    attachment_mode: "OPTIONAL",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: true,
    per_requester: false,
    cc_list: [PRESET_ASSIGNEES.KIM_GS],
    steps: [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
  {
    id: "wf-pub-outsource",
    category_name: "출판 · 외주",
    title: "외주 원고료·삽화료 지급 품의서",
    description:
      "외부 집필진 원고료, 문항 검토비, 일러스트 삽화료 지급을 요청하며 승인 시 비용 정산 장부와 자동 연동됩니다.",
    icon: "🖋️",
    icon_bg: "#fae8ff",
    mapped_doc_type: "EXPENSE",
    is_smart_form: true,
    fields: [
      {
        id: "fld-out-book",
        type: "TEXT",
        label: "대상 교재 · 프로젝트명",
        required: true,
        placeholder: "예: 아키텍처 사고력 수학 C단계",
      },
      {
        id: "fld-out-worker",
        type: "TEXT",
        label: "외주 작업자 성명 (또는 업체명)",
        required: true,
      },
      {
        id: "fld-out-tax",
        type: "SELECT",
        label: "세무 · 원천징수 구분",
        required: true,
        options: [
          "사업소득 원천징수 (3.3%)",
          "기타소득 원천징수 (8.8%)",
          "전자세금계산서 (부가세 10%)",
        ],
      },
      {
        id: "fld-out-bank",
        type: "TEXT",
        label: "입금 계좌 정보 (은행 / 계좌번호 / 예금주)",
        required: true,
      },
    ],
    body_template:
      "1. 작업 범위 및 납품 수량 (예: 문항 집필 120문항 / 삽화 24컷):\n\n2. 검수 완료일 및 담당 편집자 확인:\n\n3. 지급 요청일:",
    attachment_mode: "OPTIONAL",
    use_body: true,
    allow_doc_edit: true,
    allow_edit: true,
    per_requester: false,
    cc_list: [PRESET_ASSIGNEES.KIM_GS],
    steps: [{ step_order: 1, assignees: [PRESET_ASSIGNEES.CHUN] }],
  },
];

export function isAutoLinkedMemberField(type: HqWorkflowFieldType): boolean {
  return type.startsWith("MEMBER_") || type.startsWith("HR_");
}

export function resolveAutoMemberFieldValue(
  type: HqWorkflowFieldType,
  me: HqMember | null
): string {
  if (!me) return "";
  switch (type) {
    case "MEMBER_NAME":
      return me.name || "";
    case "MEMBER_NICKNAME":
      return me.profile_extra?.nickname || me.name || "";
    case "MEMBER_ENG_NAME":
      return "";
    case "MEMBER_EMAIL":
      return me.email || "";
    case "MEMBER_PHONE":
      return me.phone || "";
    case "MEMBER_BIRTH":
      return me.birth_date || "";
    case "HR_EMP_NO":
      return me.employee_no || "";
    case "HR_DEPT":
      return me.department || "";
    case "HR_TITLE":
      return me.is_dept_head ? "조직장" : me.job_title || "";
    case "HR_JOB":
      return me.job_description || me.department || "";
    case "HR_POSITION":
      return me.job_title || me.rank_label || "";
    case "HR_HIRE_DATE":
      return me.hire_date || "";
    default:
      return "";
  }
}

export function mergeFormsWithPolicies(
  savedForms: HqWorkflowFormDef[],
  workflowPolicies: HqApprovalPolicyItem[]
): HqWorkflowFormDef[] {
  const baseForms =
    savedForms && savedForms.length > 0 ? savedForms : DEFAULT_WORKFLOW_FORMS;
  const byId = new Map<string, HqWorkflowFormDef>();
  baseForms.forEach((f) => byId.set(f.id, { ...f }));

  workflowPolicies.forEach((pol) => {
    if (pol.category !== "workflow") return;
    const existing = byId.get(pol.id);
    if (existing) {
      byId.set(pol.id, {
        ...existing,
        title: pol.title || existing.title,
        description: pol.description ?? existing.description,
        icon: pol.icon || existing.icon,
        mapped_doc_type: pol.mapped_doc_type || existing.mapped_doc_type || "GENERAL",
        allow_edit: pol.allow_edit,
        per_requester: pol.per_requester,
        cc_list: pol.cc_list || [],
        steps: pol.steps || [],
        requester_rules: pol.requester_rules,
      });
    } else {
      byId.set(pol.id, {
        id: pol.id,
        category_name: "일반 · 계정",
        title: pol.title,
        description: pol.description || "",
        icon: pol.icon || "📋",
        icon_bg: "#f1f5f9",
        mapped_doc_type: pol.mapped_doc_type || "GENERAL",
        fields: [],
        body_template: "",
        attachment_mode: "OPTIONAL",
        use_body: true,
        allow_doc_edit: true,
        allow_edit: pol.allow_edit,
        per_requester: pol.per_requester,
        cc_list: pol.cc_list || [],
        steps: pol.steps || [],
        requester_rules: pol.requester_rules,
      });
    }
  });

  return Array.from(byId.values()).map(ensureSeedFieldOptions);
}

/**
 * 이미 저장된(커스텀) 양식에도 새로 추가된 기본 선택지를 보강
 * - 계정 신청: "Claude (Anthropic) 유료 계정"
 */
const SEED_OPTION_PATCHES: {
  formId: string;
  fieldId: string;
  option: string;
  insertAfter?: string;
}[] = [
  {
    formId: "wf-account-req",
    fieldId: "fld-acc-service",
    option: "Claude (Anthropic) 유료 계정",
    insertAfter: "Google Gemini / ChatGPT 유료 계정",
  },
];

function ensureSeedFieldOptions(form: HqWorkflowFormDef): HqWorkflowFormDef {
  const patches = SEED_OPTION_PATCHES.filter((p) => p.formId === form.id);
  if (patches.length === 0 || !Array.isArray(form.fields)) return form;
  let changed = false;
  const fields = form.fields.map((fld) => {
    const fp = patches.filter((p) => p.fieldId === fld.id);
    if (fp.length === 0 || !Array.isArray(fld.options)) return fld;
    const options = [...fld.options];
    fp.forEach((p) => {
      if (options.includes(p.option)) return;
      const idx = p.insertAfter ? options.indexOf(p.insertAfter) : -1;
      if (idx >= 0) options.splice(idx + 1, 0, p.option);
      else options.push(p.option);
      changed = true;
    });
    return changed ? { ...fld, options } : fld;
  });
  return changed ? { ...form, fields } : form;
}

export interface ResolvedWorkflowStep {
  step_order: number;
  step_role: "REVIEWER" | "FINAL_APPROVER";
  role_label: string;
  approver_id: string;
  approver_name: string;
  approver_dept: string;
  approver_rank: string;
  approver_title: string;
}

export interface ResolvedWorkflowLine {
  steps: ResolvedWorkflowStep[];
  ccMembers: { id: string; name: string; dept: string }[];
  allowEdit: boolean;
  zeroStepConfigured: boolean;
}

function resolveAssigneeToMember(
  asg: HqPolicyAssignee,
  me: HqMember | null,
  members: HqMember[]
): HqMember | undefined {
  const activeMembers = members.filter((m) => m.work_status === "재직");
  if (asg.kind === "ROLE") {
    if (asg.role_key === "ORG_HEAD_1" && me) {
      return (
        activeMembers.find(
          (m) =>
            m.department === me.department &&
            m.is_dept_head &&
            m.instructor_id !== me.instructor_id
        ) ||
        activeMembers.find(
          (m) => m.rank_level >= 5 && m.instructor_id !== me.instructor_id
        )
      );
    }
    if (asg.role_key === "ORG_HEAD_2" && me) {
      return activeMembers.find(
        (m) => m.rank_level >= 4 && m.instructor_id !== me.instructor_id
      );
    }
    if (asg.role_key === "HR_MANAGER") {
      return (
        activeMembers.find(
          (m) => m.department.includes("관리") || m.department.includes("경영")
        ) || activeMembers.find((m) => m.rank_level >= 5)
      );
    }
    if (asg.role_key === "SELF" && me) {
      return me;
    }
  }
  if (asg.member_id) {
    const byId = activeMembers.find((m) => m.instructor_id === asg.member_id);
    if (byId) return byId;
  }
  return activeMembers.find((m) => m.name === asg.name);
}

function inferRankCodeFromSubLabel(subLabel?: string): string {
  const s = (subLabel || "").trim();
  if (s.includes("대표") || s.includes("원장")) return "CEO";
  if (s.includes("본부장") || s.includes("이사") || s.includes("부원장")) {
    return "DIRECTOR";
  }
  if (s.includes("팀장") || s.includes("실장") || s.includes("파트장")) {
    return "TEAM_LEAD";
  }
  if (s.includes("선임") || s.includes("수석") || s.includes("책임")) {
    return "SENIOR";
  }
  return "TEAM_LEAD";
}

export function resolvePolicyApprovalLine(params: {
  policy: Pick<
    HqApprovalPolicyItem,
    "id" | "allow_edit" | "per_requester" | "cc_list" | "steps" | "requester_rules"
  >;
  me: HqMember | null;
  members: HqMember[];
  substituteRules?: HqSubstituteApprovalRule[];
}): ResolvedWorkflowLine {
  const { policy, me, members, substituteRules = [] } = params;
  const matchedRule =
    policy.per_requester && me
      ? (policy.requester_rules || []).find((r) =>
          r.requester_names.includes(me.name)
        )
      : null;

  const targetSteps = matchedRule ? matchedRule.steps : policy.steps || [];
  const targetCc = matchedRule ? matchedRule.cc_list : policy.cc_list || [];
  const hasConfiguredStepAssignees = targetSteps.some(
    (s) => Array.isArray(s.assignees) && s.assignees.length > 0
  );

  const todayKey = new Date().toISOString().slice(0, 10);
  const activeSubs = substituteRules.filter(
    (sr) => sr.is_active && sr.start_date <= todayKey && sr.end_date >= todayKey
  );

  const resolvedSteps: ResolvedWorkflowStep[] = [];
  const seenApproverKeys = new Set<string>();

  targetSteps.forEach((st) => {
    (st.assignees || []).forEach((asg) => {
      let member = resolveAssigneeToMember(asg, me, members);
      let isSubbed = false;
      let fallbackName = (asg.name || "").trim();
      let fallbackSubLabel = (asg.sub_label || "").trim();
      const baseName = member?.name || fallbackName;

      const subHit = activeSubs.find(
        (sr) => sr.original_approver_name === baseName
      );
      if (subHit) {
        const polOverride = subHit.per_policy_enabled
          ? subHit.policy_substitutes?.find((po) => po.policy_id === policy.id)
          : undefined;
        const subName = polOverride
          ? polOverride.substitute_name
          : subHit.substitute_approver_name;
        const subMember = members.find(
          (m) => m.work_status === "재직" && m.name === subName
        );
        if (subMember) {
          member = subMember;
          isSubbed = true;
        } else if (subName) {
          member = undefined;
          fallbackName = subName.trim();
          fallbackSubLabel = "대결승인";
          isSubbed = true;
        }
      }

      if (member) {
        // 본인 기안 시 본인이 결재자로 중복 지정된 경우 제외
        if (me && member.instructor_id === me.instructor_id) {
          return;
        }
        if (!seenApproverKeys.has(member.instructor_id)) {
          seenApproverKeys.add(member.instructor_id);
          resolvedSteps.push({
            step_order: resolvedSteps.length + 1,
            step_role: "FINAL_APPROVER",
            role_label: isSubbed
              ? `${resolvedSteps.length + 1}단계 대결승인`
              : `${resolvedSteps.length + 1}단계 승인`,
            approver_id: member.instructor_id,
            approver_name: member.name,
            approver_dept: member.department,
            approver_rank: member.rank_code,
            approver_title: member.job_title,
          });
        }
        return;
      }

      // 프리셋(더미) 구성원 또는 아직 실제 DB 계정이 매칭되지 않은 지정 승인자도 누락 없이 단계에 유지!
      if (!fallbackName) return;
      if (asg.kind === "ROLE" && asg.role_key === "SELF") return;
      if (me && asg.kind !== "ROLE" && me.name.trim() === fallbackName) {
        return;
      }

      const presetKey = `preset:${fallbackName}`;
      if (seenApproverKeys.has(presetKey)) return;
      seenApproverKeys.add(presetKey);

      resolvedSteps.push({
        step_order: resolvedSteps.length + 1,
        step_role: "FINAL_APPROVER",
        role_label: isSubbed
          ? `${resolvedSteps.length + 1}단계 대결승인`
          : `${resolvedSteps.length + 1}단계 승인`,
        approver_id: presetKey,
        approver_name: fallbackName,
        approver_dept: fallbackSubLabel || "본부",
        approver_rank: inferRankCodeFromSubLabel(fallbackSubLabel),
        approver_title:
          fallbackSubLabel || (asg.kind === "ROLE" ? fallbackName : ""),
      });
    });
  });

  const normalizedSteps = resolvedSteps.map((s, idx) => ({
    ...s,
    step_order: idx + 1,
    step_role:
      idx === resolvedSteps.length - 1
        ? ("FINAL_APPROVER" as const)
        : ("REVIEWER" as const),
  }));

  const ccMembers: { id: string; name: string; dept: string }[] = [];
  const seenCc = new Set<string>();
  targetCc.forEach((c) => {
    const m = resolveAssigneeToMember(c, me, members);
    const key = m ? m.instructor_id : `name:${c.name}`;
    if (seenCc.has(key)) return;
    seenCc.add(key);
    ccMembers.push({
      id: m ? m.instructor_id : "",
      name: m ? m.name : c.name,
      dept: m ? m.department : c.sub_label || "",
    });
  });

  return {
    steps: normalizedSteps,
    ccMembers,
    allowEdit: policy.allow_edit,
    // 원래 양식에 승인 단계가 없거나, 대표(결재권자 본인)가 자신의 결재 단계만 있는 양식을 직접 작성한 경우 0단계 즉시 완료 허용
    zeroStepConfigured: !hasConfiguredStepAssignees || normalizedSteps.length === 0,
  };
}
