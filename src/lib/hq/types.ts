// src/lib/hq/types.ts

export type HqRankCode = "STAFF" | "SENIOR" | "TEAM_LEAD" | "DIRECTOR" | "CEO";

export type HqWorkStatus = "재직" | "휴직" | "퇴직";

export type HqApprovalDocType = "GENERAL" | "LEAVE" | "PURCHASE" | "EXPENSE";

export type HqApprovalStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type HqApprovalStepStatus =
  | "WAITING"
  | "CURRENT"
  | "APPROVED"
  | "REJECTED"
  | "SKIPPED";

export type HqSettlementStatus = "정산대기" | "정산완료" | "반려";

// 근태 · 유연근무 타입
export type HqWorkMode =
  | "OFFICE"
  | "FLEX_08"
  | "FLEX_10"
  | "FLEX_11"
  | "REMOTE"
  | "OUTSIDE"
  | "LEAVE";

export type HqAttendanceStatus = "WORKING" | "DONE" | "LEAVE" | "HALF_LEAVE";

// 전자계약 타입
export type HqContractCategory =
  | "LABOR"
  | "SALARY"
  | "NDA"
  | "OUTSOURCING"
  | "ROYALTY";

export type HqContractTargetType = "INTERNAL" | "EXTERNAL";

export type HqContractStatus =
  | "DRAFT"
  | "SENT"
  | "SIGNED"
  | "EXPIRED"
  | "CANCELLED";

export type HqContractTaxType =
  | "FOUR_INSURANCE"
  | "BIZ_33"
  | "OTHER_88"
  | "INVOICE"
  | "NONE";

// 급여 · 외주 원천세 · 인세 정산 타입
export type HqPayrollType =
  | "EMPLOYEE"
  | "FREELANCER_33"
  | "OTHER_88"
  | "ROYALTY";

export type HqPayrollStatus = "DRAFT" | "CONFIRMED" | "PAID";

// 출판 공정 파이프라인 타입
export type HqPubStage =
  | "PLANNING"
  | "MANUSCRIPT"
  | "EDITING"
  | "DESIGN"
  | "PROOF_FINAL"
  | "PRINTING"
  | "PUBLISHED";

export type HqPubPriority = "HIGH" | "NORMAL" | "LOW";

// ============================================================================
// Flex 스타일 구성원 상세 프로필 확장 항목 (hq_member_profile.profile_extra)
// ============================================================================

export interface HqCareerItem {
  id: string;
  company_name: string;
  start_ym: string;
  end_ym: string;
  contract_type: string;
  department?: string;
  job_title?: string;
}

export interface HqEducationItem {
  id: string;
  school_name: string;
  degree_type: string;
  graduation_status: string;
  major?: string;
  start_ym: string;
  end_ym: string;
}

export interface HqFamilyItem {
  id: string;
  relation: string;
  name: string;
  birth_date?: string;
  basic_deduction: boolean;
  health_dependent: boolean;
}

export interface HqLeaveHistoryItem {
  id: string;
  leave_kind: string;
  start_date: string;
  end_date: string;
  reason?: string;
}

export interface HqAwardItem {
  id: string;
  title: string;
  awarded_date: string;
  issuer?: string;
  note?: string;
}

export interface HqDisciplineItem {
  id: string;
  kind: string;
  action_date: string;
  reason?: string;
}

export interface HqGrowthItem {
  id: string;
  period: string;
  title: string;
  progress: number;
  status: string;
  note?: string;
}

export interface HqTrainingItem {
  id: string;
  title: string;
  completed_date: string;
  hours: number;
  institution?: string;
  status: string;
}

export interface HqLaborContractInfo {
  contract_type?: string;
  start_date?: string;
  end_date?: string;
  probation_end_date?: string;
  work_place?: string;
  note?: string;
}

export interface HqWageContractInfo {
  wage_type?: string;
  annual_salary?: number;
  monthly_base?: number;
  pay_day?: string;
  effective_date?: string;
  meal_allowance?: number;
  note?: string;
}

export interface HqProfileChangeLog {
  at: string;
  actor_name: string;
  summary: string;
}

export interface HqProfileExtra {
  nickname?: string;
  bio?: string;
  personal_email?: string;
  group_hire_date?: string;
  hire_type?: string;
  rrn_front?: string;
  gender?: "남" | "여" | "";
  nationality?: string;
  postal_code?: string;
  work_schedule_type?: string;
  work_schedule_mode?: string;
  weekly_work_hours?: number;
  leave_policy_name?: string;
  leave_policy_tags?: string[];
  holiday_policy_name?: string;
  holiday_summary?: string;
  special_notes?: string;
  labor_contract?: HqLaborContractInfo;
  wage_contract?: HqWageContractInfo;
  leave_histories?: HqLeaveHistoryItem[];
  awards?: HqAwardItem[];
  disciplines?: HqDisciplineItem[];
  careers?: HqCareerItem[];
  educations?: HqEducationItem[];
  families?: HqFamilyItem[];
  growth_goals?: HqGrowthItem[];
  trainings?: HqTrainingItem[];
  doc_files?: Record<
    string,
    { url: string; file_name: string; uploaded_at: string }
  >;
  change_logs?: HqProfileChangeLog[];
}

export interface HqMember {
  instructor_id: string;
  name: string;
  email: string;
  phone: string;
  profile_image_url: string | null;
  tenant_id: string | null;
  tenant_name: string;
  is_hq_tenant: boolean;
  auto_reply_active?: boolean;
  chat_allow_start?: string | null;
  chat_allow_end?: string | null;
  auto_reply_message?: string | null;
  // Core HR 프로필 (hq_member_profile)
  employee_no: string;
  department: string;
  rank_code: HqRankCode;
  rank_level: number;
  rank_label: string;
  job_title: string;
  is_dept_head: boolean;
  employment_type: string;
  work_status: HqWorkStatus;
  hire_date: string | null;
  resign_date: string | null;
  birth_date: string | null;
  annual_leave_total: number;
  annual_leave_used: number;
  annual_leave_remain: number;
  bank_name: string;
  bank_account: string;
  account_holder: string;
  extension_no: string;
  emergency_contact: string;
  address: string;
  job_description: string;
  hr_memo: string;
  profile_extra?: HqProfileExtra;
  can_view_private?: boolean;
  has_profile_row: boolean;
}

export interface PurchaseLineItem {
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface HqApprovalStep {
  step_id?: string;
  approval_id?: string;
  step_order: number;
  step_role: string;
  approver_id: string;
  approver_name: string;
  approver_dept: string;
  approver_rank: HqRankCode | string;
  approver_title: string;
  status: HqApprovalStepStatus;
  comment: string | null;
  acted_at: string | null;
}

export interface HqApprovalDoc {
  approval_id: string;
  doc_no: string;
  doc_type: HqApprovalDocType;
  title: string;
  content: string;
  drafter_id: string;
  drafter_name: string;
  drafter_dept: string;
  drafter_rank: HqRankCode | string;
  drafter_title: string;
  status: HqApprovalStatus;
  current_step_order: number;
  total_steps: number;
  is_auto_delegated: boolean;
  amount: number;
  effective_date: string | null;
  end_date: string | null;
  leave_type: string | null;
  leave_days: number;
  handover_name: string | null;
  expense_category: string | null;
  payment_method: string | null;
  merchant_name: string | null;
  card_last4: string | null;
  receipt_url: string | null;
  items_json: PurchaseLineItem[];
  urgent: boolean;
  submitted_at: string;
  completed_at: string | null;
  updated_at: string;
  steps: HqApprovalStep[];
}

export interface HqExpense {
  expense_id: string;
  expense_no: string;
  source_type: "DIRECT" | "APPROVAL";
  approval_id: string | null;
  approval_doc_no?: string | null;
  requester_id: string;
  requester_name: string;
  department: string;
  expense_date: string;
  category: string;
  payment_method: string;
  merchant_name: string;
  amount: number;
  tax_amount: number;
  card_last4: string | null;
  description: string | null;
  receipt_url: string | null;
  settlement_status: HqSettlementStatus;
  settled_by: string | null;
  settled_at: string | null;
  admin_memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqAttendanceRecord {
  attendance_id: string;
  instructor_id: string;
  member_name: string;
  department: string;
  work_date: string;
  work_mode: HqWorkMode;
  status: HqAttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  break_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  location_note: string | null;
  memo: string | null;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqContract {
  contract_id: string;
  contract_no: string;
  category: HqContractCategory;
  target_type: HqContractTargetType;
  target_member_id: string | null;
  counterparty_name: string;
  counterparty_role: string;
  counterparty_phone: string | null;
  counterparty_email: string | null;
  department: string;
  title: string;
  book_title: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_amount: number;
  royalty_rate: number | null;
  tax_type: HqContractTaxType;
  body_text: string;
  special_terms: string | null;
  status: HqContractStatus;
  company_signer_name: string;
  company_signed_at: string | null;
  party_signature_data: string | null;
  party_signed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqPayrollRecord {
  payroll_id: string;
  statement_no: string;
  pay_month: string;
  pay_type: HqPayrollType;
  member_id: string | null;
  payee_name: string;
  department_or_role: string;
  bank_info: string | null;
  book_or_project: string | null;
  base_pay: number;
  meal_allowance: number;
  overtime_pay: number;
  bonus_pay: number;
  gross_amount: number;
  national_pension: number;
  health_insurance: number;
  long_term_care: number;
  employment_insurance: number;
  income_tax: number;
  local_income_tax: number;
  deduction_total: number;
  net_amount: number;
  calc_meta: Record<string, any>;
  status: HqPayrollStatus;
  pay_date: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqPublication {
  pub_id: string;
  book_code: string;
  title: string;
  subtitle: string | null;
  series_name: string | null;
  target_grade: string | null;
  stage: HqPubStage;
  proof_round: string | null;
  progress_pct: number;
  author_name: string | null;
  editor_id: string | null;
  editor_name: string | null;
  designer_name: string | null;
  isbn: string | null;
  edition_info: string | null;
  list_price: number;
  print_run: number;
  print_vendor: string | null;
  press_deadline: string | null;
  publish_date: string | null;
  priority: HqPubPriority;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 본부 설정 (회사 정보 · 쉬는 날 · 회사 직인 · 계열사 관리)
// ============================================================================

export interface HqHolidayItem {
  id: string;
  name: string;
  date_text: string;
  start_date: string;
  end_date?: string;
  icon: string;
  substitute_label?: string;
  is_mandatory?: boolean;
  is_annual: boolean;
  is_custom?: boolean;
  days_count: number;
}

export interface HqHolidayGroup {
  id: string;
  name: string;
  description: string;
  target_dept?: string;
}

export interface HqCompanySeal {
  id: string;
  name: string;
  image_url: string;
  seal_type: "UPLOAD" | "GENERATED";
  is_default: boolean;
  created_at: string;
}

export interface HqAffiliateItem {
  id: string;
  name: string;
  relation_type: "계열사" | "자회사" | "직영학원" | "관계사";
  ceo_name: string;
  founded_date: string;
  business_reg_no?: string;
  company_code?: string;
  address?: string;
  tenant_id?: string | null;
}

export interface HqOrgChartNode {
  id: string;
  name: string;
  parent_id: string | null;
  is_hidden?: boolean;
  order: number;
}

export interface HqJobGroupItem {
  id: string;
  name: string;
  jobs?: string[];
}

export interface HqJobGradeItem {
  id: string;
  name: string;
  description?: string;
}

export interface HqEmpNoPolicy {
  id: string;
  name: string;
  target_employment: string; // "전체" | "정규직" | "계약직" | "수습" | "프리랜서" | "임원"
  prefix: string;
  date_part: "YYYYMM" | "YYYY" | "YY" | "NONE";
  seq_digits: number; // 2 | 3 | 4
  start_seq: number;
}

export interface HqInfoApprovalPolicy {
  require_approval_basic?: boolean;
  require_approval_bank?: boolean;
  require_approval_career?: boolean;
  require_approval_family?: boolean;
  require_approval_doc?: boolean;
  require_approval_license?: boolean;
  approver_role?: "HR_MANAGER" | "DEPT_HEAD" | "CEO";
}

export interface HqCustomInfoCategory {
  id: string;
  name: string;
}

export interface HqCustomInfoField {
  id: string;
  name: string;
  field_type: "텍스트" | "숫자" | "날짜" | "선택형" | "파일";
  category_id: string | null;
  description?: string;
  required?: boolean;
}

export interface HqDocFolderItem {
  id: string;
  name: string;
  description?: string;
  is_required?: boolean;
  order: number;
}

export type HqCcNotifyMode = "BOTH" | "COMPLETE_ONLY" | "NONE";

export interface HqPolicyAssignee {
  id: string;
  kind: "MEMBER" | "ROLE";
  role_key?: "ORG_HEAD_1" | "ORG_HEAD_2" | "HR_MANAGER" | "SELF";
  member_id?: string;
  name: string;
  sub_label?: string;
  avatar_bg?: string;
  notify_mode?: HqCcNotifyMode;
  step_action?: string;
}

export interface HqPolicyStep {
  step_order: number;
  assignees: HqPolicyAssignee[];
}

export interface HqPolicyRequesterRule {
  id: string;
  requester_summary: string;
  requester_names: string[];
  cc_list: HqPolicyAssignee[];
  steps: HqPolicyStep[];
}

export type HqApprovalPolicyCategory =
  | "workflow"
  | "work"
  | "leave"
  | "member_info"
  | "retiree_doc";

export interface HqApprovalPolicyItem {
  id: string;
  category: HqApprovalPolicyCategory;
  title: string;
  description?: string;
  icon: string;
  allow_edit: boolean;
  per_requester: boolean;
  cc_list: HqPolicyAssignee[];
  steps: HqPolicyStep[];
  requester_rules?: HqPolicyRequesterRule[];
  mapped_doc_type?: HqApprovalDocType;
}

export interface HqApprovalTemplate {
  id: string;
  name: string;
  cc_list: HqPolicyAssignee[];
  steps: HqPolicyStep[];
}

export interface HqCustomApprovalLabel {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface HqSubstituteApprovalRule {
  id: string;
  original_approver_name: string;
  substitute_approver_name: string;
  absence_type?: string; // "휴가" | "출장" | "휴직" | "기타"
  absence_label?: string; // 예: "연차", "반차", "외부 출장"
  start_date: string;
  end_date: string;
  reason?: string;
  per_policy_enabled?: boolean;
  policy_substitutes?: {
    policy_id: string;
    policy_title: string;
    substitute_name: string;
  }[];
  is_active: boolean;
}

export interface HqWorkRuleAssignedMember {
  id: string;
  name: string;
  job_label?: string;
  avatar_bg?: string;
  applied_from_label: string; // 예: "2023년 1월 1일 부터 적용 중" | "입사일 부터 적용 중"
  status: "ACTIVE" | "SCHEDULED" | "PAST";
}

export interface HqWorkRuleItem {
  id: string;
  name: string;
  is_default?: boolean;
  is_hidden?: boolean;
  // 1) 기본 설정
  pattern_type: "고정 근무 유형" | "시차 출퇴근 유형" | "선택적 근로시간 유형";
  worker_type: "통상 근로자" | "단시간 근로자";
  cycle_start_day: "월요일" | "일요일";
  work_days: string[]; // ["월", "화", "수", "목", "금"]
  paid_rest_days: string[]; // ["일"]
  start_time: string; // "08:30" | "09:00" | "09:30" | "10:00" 등 24시간 표기
  daily_work_hours: number; // 예: 4 또는 8
  daily_work_minutes: number; // 예: 0 또는 30
  break_start_1?: string; // "12:00" | "13:00"
  break_end_1?: string; // "13:00" | "14:00"
  break_start_2?: string;
  break_end_2?: string;
  custom_leave_day_hours?: boolean;
  leave_include_break_mode:
    | "구성원이 사용 시 선택"
    | "휴게 시간 제외"
    | "휴게 시간 포함";
  leave_break_duration: "30분" | "1시간" | "1시간 30분" | "2시간";
  // 2) 적용 구성원
  assigned_members: HqWorkRuleAssignedMember[];
  past_assigned_count?: number;
  // 3) 초과 근무
  overtime_cycle_unit: "월 단위" | "주 단위";
  overtime_cycle_day: string; // "매월 1일" 등
  overtime_allow_mode:
    | "한도 없이 허용"
    | "주 12시간 한도 내 허용"
    | "허용 안 함";
  split_within_statutory_overtime: boolean;
  overtime_input_unit: "제한 안 함" | "10분 단위" | "30분 단위" | "1시간 단위";
  overtime_min_duration: "제한 안 함" | "30분 이상" | "1시간 이상";
  night_work_allow_mode: "한도 없이 허용" | "허용 안 함";
  holiday_work_allow_mode: "한도 없이 허용" | "허용 안 함";
  // 4) 실시간 근무 기록
  realtime_enabled: boolean;
  grace_minutes: number; // 0 | 5 | 10 | 15 | 30
  reflect_checkin_on_checkout: boolean;
  allow_early_checkin: boolean;
  allow_manual_break_log: boolean;
  missing_checkout_policy:
    | "출근 기록만 남김"
    | "정시 퇴근 시각으로 자동 기록"
    | "기록 삭제";
  default_checkout_mode:
    | "현재 시각으로 퇴근을 우선"
    | "정시 퇴근 시각을 우선";
  checkout_confirm_mode:
    | "항상 확인 후 퇴근하도록 제한"
    | "확인 없이 즉시 퇴근";
  // 5) 자동 근무 기록
  auto_record_enabled: boolean;
  // 6) 고급 설정
  reflect_realtime_to_work_hours: boolean;
  allow_exceed_max_52h: boolean;
  allow_insufficient_break: boolean;
}

export interface HqWorkConditionRule {
  policy_id: string; // approval_policies 내 work 카테고리 id 매칭
  title: string;
  subtitle: string;
  icon: string;
  reason_required: boolean;
  allow_holiday_substitute?: boolean; // 휴일 근무 전용
  past_edit_limit_days?: string; // 과거 근무 수정 전용 (예: "3일")
}

export interface HqWorkFormPolicy {
  id: string;
  policy_id: string; // approval_policies 내 work 카테고리 id 매칭
  name: string;
  icon: string;
  description: string;
  is_mandatory?: boolean; // '근무' 기본 정책 (필수 배지)
  available_time_range:
    | "제한 없음"
    | "정규 근무 시간 내"
    | "평일 08:00 ~ 20:00";
  schedule_share_scope: "공유 안함" | "소속 조직 공유" | "전사 공유";
  offsite_restriction:
    | "사용 안 함"
    | "GPS 위치 제한"
    | "IP 네트워크 제한"
    | "GPS · IP 모두 제한";
  allow_night_work: boolean;
  allow_holiday_work: boolean;
  reason_required: boolean;
}

export interface HqOvertimeAssignedMember {
  id: string;
  name: string;
  job_label?: string;
  avatar_bg?: string;
  period_label: string; // 예: "입사일 - 퇴직일까지"
  status: "ACTIVE" | "SCHEDULED" | "PAST";
}

export interface HqOvertimeCompPolicyItem {
  id: string;
  name: string; // 예: "기본 초과 근무 보상 정책"
  description: string;
  is_default?: boolean;
  deduction_cycle_unit: "월 단위" | "주 단위";
  deduction_cycle_period: string; // 예: "매달 1일 ~ 매달 31일 (말일)"
  apply_all_inclusive_default?: boolean; // 전사 포괄계약 기본 자동 포함 여부
  assigned_members: HqOvertimeAssignedMember[];
}

export interface HqOvertimeCompSettings {
  item_count_mode: "3_ITEMS" | "7_ITEMS";
  deduct_within_statutory_from_inclusive: boolean;
  policies: HqOvertimeCompPolicyItem[];
}

export interface HqWorkplaceLocationItem {
  id: string;
  name: string;
  address: string;
  detail_address?: string;
  latitude: number;
  longitude: number;
  radius_meters: number; // 50 | 100 | 200 | 300 | 500 | 1000
  gps_enabled: boolean;
  is_primary?: boolean;
  sync_company_address?: boolean;
  apply_scope: "ALL" | "DEPARTMENT";
  applied_departments?: string[];
}

export interface HqWorkplaceWifiIpItem {
  id: string;
  name: string;
  ip_cidr: string;
  memo?: string;
  is_enabled: boolean;
}

export interface HqCompanyExtraSettings {
  doc_prefix_cert?: string;
  doc_prefix_approval?: string;
  team_lead_max_amount?: number;
  director_max_amount?: number;
  team_lead_max_leave_days?: number;
  default_annual_leave?: number;
  leave_basis?: "회계일 기준" | "입사일 기준";
  allow_hourly_leave?: boolean;
  // 인사 · 구성원 정보 체계 설정 (Flex 이식)
  hr_positions?: string[];
  hr_titles?: string[];
  hr_jobs?: string[];
  hr_job_groups?: HqJobGroupItem[];
  hr_grades?: HqJobGradeItem[];
  org_chart_nodes?: HqOrgChartNode[];
  org_chart_effective_date?: string;
  org_chart_memo?: string;
  emp_no_locked?: boolean;
  emp_no_policies?: HqEmpNoPolicy[];
  info_approval_policy?: HqInfoApprovalPolicy;
  // 커스텀 정보 · 문서함 · 승인 정책 관리 (Flex 이식)
  custom_info_categories?: HqCustomInfoCategory[];
  custom_info_fields?: HqCustomInfoField[];
  doc_folders?: HqDocFolderItem[];
  approval_policies?: HqApprovalPolicyItem[];
  approval_templates?: HqApprovalTemplate[];
  approval_labels?: HqCustomApprovalLabel[];
  substitute_approvals?: HqSubstituteApprovalRule[];
  work_rules?: HqWorkRuleItem[];
  work_condition_rules?: HqWorkConditionRule[];
  work_form_policies?: HqWorkFormPolicy[];
  overtime_comp_settings?: HqOvertimeCompSettings;
  workplaces?: HqWorkplaceLocationItem[];
  workplace_ips?: HqWorkplaceWifiIpItem[];
}

export interface HqCompanySettings {
  company_name: string;
  company_code: string;
  ceo_names: string[];
  phone: string;
  founded_date: string;
  address: string;
  business_reg_no: string;
  corp_reg_no: string;
  cover_image_url: string | null;
  logo_image_url: string | null;
  seals: HqCompanySeal[];
  holidays_by_year: Record<string, HqHolidayItem[]>;
  holiday_groups: HqHolidayGroup[];
  affiliates: HqAffiliateItem[];
  extra_settings: HqCompanyExtraSettings;
  updated_by?: string | null;
  updated_at?: string | null;
}
